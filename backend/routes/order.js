const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const {
  generateAndQueueKOTs,
  generateAndQueueReceipt
} = require("../utils/printHelper");
const DEFAULT_GUID = "00000000-0000-0000-0000-000000000000";

const NOTE_KEYS = ["note", "Note", "notes", "Notes", "remarks", "Remarks"];
const TAKEAWAY_KEYS = ["isTakeaway", "IsTakeaway", "isTakeAway", "IsTakeAway"];
const SPICY_KEYS = ["spicy", "Spicy"];
const SALT_KEYS = ["salt", "Salt"];
const OIL_KEYS = ["oil", "Oil"];
const SUGAR_KEYS = ["sugar", "Sugar"];

const toGuidOrNull = (value) => {
  if (!value) return null;
  const s = String(value).trim().replace(/^\{|\}$/g, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
};

function resolveItemTextField(item = {}, keys = []) {
  const itemKeys = Object.keys(item || {});
  for (const k of keys) {
    const actualKey = itemKeys.find(ik => ik.toLowerCase() === k.toLowerCase());
    if (actualKey !== undefined) {
      const raw = item[actualKey];
      if (raw !== undefined && raw !== null) return { hasExplicitValue: true, value: String(raw) };
    }
  }
  return { hasExplicitValue: false, value: "" };
}

function resolveItemNote(item = {}) { return resolveItemTextField(item, NOTE_KEYS); }
function resolveItemTakeaway(item = {}) {
  const result = resolveItemTextField(item, TAKEAWAY_KEYS);
  const val = result.value.toLowerCase();
  return {
    hasExplicitTakeaway: result.hasExplicitValue,
    value: result.hasExplicitValue ? (val === "true" || val === "1") : false
  };
}

/**
 * Get or Generate Order ID for a table
 * Returns existing ID if table is active, otherwise generates a new one.
 */
let cachedBusinessUnitId = null;

async function getOrGenerateOrderId(req, tableId) {
  const pool = await poolPromise;
  const cleanId = String(tableId)
    .replace(/^\{|\}$/g, "")
    .trim();
  if (!tableId || tableId === "undefined" || tableId === "null") return "NEW";

  try {
    // 1. Instant check for existing ID
    const quickCheck = await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query("SELECT CurrentOrderId FROM TableMaster WHERE TableId = @tid");

    let existingId = quickCheck.recordset[0]?.CurrentOrderId;
    if (existingId && existingId !== "NEW" && existingId !== "#NEW" && !existingId.startsWith("TEMP-") && existingId.length > 5) return existingId;

    // 2. Optimized Business Unit ID Retrieval (Cached)
    if (!cachedBusinessUnitId) {
      const bizRow = await pool.request().query("SELECT TOP 1 BusinessUnitId FROM [dbo].[RestaurantOrderCur] WHERE BusinessUnitId IS NOT NULL AND BusinessUnitId <> '00000000-0000-0000-0000-000000000000'");
      cachedBusinessUnitId = bizRow.recordset.length > 0 ? bizRow.recordset[0].BusinessUnitId : DEFAULT_GUID;
    }

    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const todayStr = istDate.toISOString().split('T')[0];
    const datePrefix = todayStr.replace(/-/g, '');

    let dailySequence = 1;

    // 3. ATOMIC ATTEMPT: Use MERGE or Transaction for Sequence
    const seqResult = await pool.request()
      .input("RestId", sql.UniqueIdentifier, String(cachedBusinessUnitId))
      .input("Today", sql.Date, todayStr)
      .query(`
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM OrderSequences WHERE RestaurantId = @RestId AND SequenceDate = @Today)
        BEGIN
            INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber) VALUES (@RestId, @Today, 0);
        END
        UPDATE OrderSequences SET LastNumber = LastNumber + 1 OUTPUT INSERTED.LastNumber
        WHERE RestaurantId = @RestId AND SequenceDate = @Today;
        COMMIT TRANSACTION;
      `);

    dailySequence = seqResult.recordset[0]?.LastNumber || 1;

    const displayOrderId = `${datePrefix}-${String(dailySequence).padStart(4, '0')}`;

    // 4. Atomic Update of Table Status
    await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .input("oid", sql.NVarChar(50), displayOrderId)
      .query("UPDATE TableMaster SET CurrentOrderId = @oid, StartTime = ISNULL(StartTime, GETDATE()) WHERE TableId = @tid");

    return displayOrderId;
  } catch (err) {
    console.error("🔥 [Critical] OrderID Generation Failed:", err.message);
    // FALLBACK: Use count as emergency instead of returning "NEW"
    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const datePrefix = istDate.toISOString().split('T')[0].replace(/-/g, '');
    const countRes = await pool.request().query(`SELECT (COUNT(*) + 1) as LastNumber FROM RestaurantOrderCur WHERE OrderNumber LIKE '${datePrefix}%'`);
    const emergencySeq = countRes.recordset[0]?.LastNumber || 1;
    return `${datePrefix}-EM${String(emergencySeq).padStart(3, '0')}`;
  }
}

/**
 * Professional Table Sync Helper
 * Syncs CartItems to RestaurantOrderCur and RestaurantOrderDetailCur
 */
async function syncToProfessionalTables(transaction, tableId, displayOrderId, items, userId) {
  const isTakeaway = (!tableId || tableId === "undefined" || tableId === "null");
  const cleanTableId = isTakeaway ? null : String(tableId).replace(/^\{|\}$/g, "").trim();
  const cleanOrderNo = String(displayOrderId || "PENDING").replace(/^\{|\}$/g, "").trim();

  let actualTableNo = "TAKEAWAY";
  if (cleanTableId) {
    const tCheck = await transaction.request()
      .input("tid", sql.VarChar(50), cleanTableId)
      .query("SELECT TableNumber FROM TableMaster WHERE TableId = @tid");
    if (tCheck.recordset.length > 0) actualTableNo = tCheck.recordset[0].TableNumber;
  }

  let bizId = DEFAULT_GUID;
  const bizCheck = await transaction.request().query("SELECT TOP 1 BusinessUnitId FROM [dbo].[RestaurantOrderCur] WHERE BusinessUnitId IS NOT NULL AND BusinessUnitId <> '00000000-0000-0000-0000-000000000000'");
  if (bizCheck.recordset.length > 0) bizId = bizCheck.recordset[0].BusinessUnitId;
  if (!bizId) bizId = DEFAULT_GUID;

  let finalUserId = userId;
  if (!finalUserId || finalUserId.length < 10) finalUserId = DEFAULT_GUID;

  let orderGuid;
  // 🛡️ STRICT LOOKUP: Prioritize OrderNumber first, then most recent active table order
  const headerCheck = await transaction.request()
    .input("orderNo", sql.NVarChar(50), cleanOrderNo)
    .input("tableNo", sql.VarChar(20), actualTableNo)
    .query(`
      SELECT TOP 1 OrderId FROM RestaurantOrderCur WITH (UPDLOCK)
      WHERE OrderNumber = @orderNo 
      OR (LTRIM(RTRIM(Tableno)) = LTRIM(RTRIM(@tableNo)) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)) 
      ORDER BY CreatedOn DESC
    `);

  if (headerCheck.recordset.length > 0) {
    orderGuid = headerCheck.recordset[0].OrderId;
    // Ensure the OrderNumber is synced to the professional one if it was a draft (TEMP-, PENDING, etc)
    await transaction.request()
      .input("orderId", sql.UniqueIdentifier, orderGuid)
      .input("orderNo", sql.NVarChar(50), cleanOrderNo)
      .query(`
        UPDATE RestaurantOrderCur 
        SET OrderNumber = @orderNo 
        WHERE OrderId = @orderId 
        AND (OrderNumber IS NULL OR OrderNumber = '' OR OrderNumber = 'PENDING' OR OrderNumber = 'NEW' OR OrderNumber = '#NEW' OR OrderNumber LIKE 'TEMP-%')
      `);
  } else {
    orderGuid = require("crypto").randomUUID();
    await transaction.request().input("orderId", sql.UniqueIdentifier, orderGuid).input("orderNo", sql.NVarChar(50), cleanOrderNo).input("tableNo", sql.VarChar(20), actualTableNo).input(
      "userId",
      sql.UniqueIdentifier,
      toGuidOrNull(finalUserId) || DEFAULT_GUID
    )
      .input("bizId", sql.UniqueIdentifier, bizId)
      .input("entry_Status", sql.NVarChar(20), "q")
      .query("INSERT INTO RestaurantOrderCur (OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, isOrderClosed, BusinessUnitId,entry_Status, start_date) VALUES (@orderId, @orderNo, GETDATE(), LTRIM(RTRIM(@tableNo)), 1, @userId, GETDATE(), 0, @bizId, 'q', (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC))");
  }

  for (const item of items) {
    const rawProdId = item.DishId || item.dishId || item.id || item.ProductId || DEFAULT_GUID;
    const cleanProdId = String(rawProdId).replace(/^\{|\}$/g, "").trim();
    let finalProdId = cleanProdId;
    if (finalProdId.length < 10) finalProdId = DEFAULT_GUID;

    let lineItemId = item.lineItemId || item.ItemId;
    const statusCodes = { 'NEW': 1, 'SENT': 2, 'READY': 3, 'SERVED': 4, 'HOLD': 5, 'VOIDED': 0 };
    const currentStatusCode = statusCodes[item.status || item.Status] || 2;
    const dishName = String(
      item.DishName || item.dishName || item.Name || item.name || item.ProductName || "Dish"
    ).substring(0, 50);
    const unitPrice = Number(item.Price ?? item.price ?? item.finalPrice ?? item.Cost ?? 0);
    const noteInfo = resolveItemNote(item);
    const takeawayInfo = resolveItemTakeaway(item);
    const modsJSON = JSON.stringify(item.modifiers || []).substring(0, 500);
    const comboDetailsJSON = JSON.stringify(item.comboSelections || []).substring(0, 4000);

    // 🕵️‍♂️ SMART-MATCH: If ID is missing, try to find an existing item with same Dish & Modifiers
    // if (!lineItemId || lineItemId.length < 10) {
    //   const matchCheck = await transaction.request()
    //     .input("orderId", sql.UniqueIdentifier, orderGuid)
    //     .input("dishId", sql.UniqueIdentifier, finalProdId)
    //     .input("mods", sql.NVarChar(sql.MAX), modsJSON)
    //     .query("SELECT TOP 1 OrderDetailId FROM RestaurantOrderDetailCur WHERE OrderId = @orderId AND DishId = @dishId AND CAST(ModifiersJSON AS NVARCHAR(MAX)) = LTRIM(RTRIM(@mods)) AND StatusCode <> 0 ORDER BY CreatedOn DESC");

    //   if (matchCheck.recordset.length > 0) {
    //     lineItemId = matchCheck.recordset[0].OrderDetailId;
    //   } else {
    //     lineItemId = require("crypto").randomUUID();
    //   }
    // }

    // if (!lineItemId || lineItemId.length < 10) {
    //   const matchCheck = await transaction.request()
    //     .input("orderId", sql.UniqueIdentifier, orderGuid)
    //     .input("dishId", sql.UniqueIdentifier, finalProdId)
    //     .query(`
    //   SELECT TOP 1 OrderDetailId
    //   FROM RestaurantOrderDetailCur
    //   WHERE OrderId = @orderId
    //     AND DishId = @dishId
    //     AND StatusCode <> 0
    //   ORDER BY CreatedOn DESC
    // `);

    //   if (matchCheck.recordset.length > 0) {
    //     lineItemId = matchCheck.recordset[0].OrderDetailId;
    //   } else {
    //     lineItemId = require("crypto").randomUUID();
    //   }
    // }


    if (!lineItemId || lineItemId.length < 10) {

      const matchCheck = await transaction.request()
        .input("orderId", sql.UniqueIdentifier, orderGuid)
        .input("dishId", sql.UniqueIdentifier, finalProdId)
        .input("mods", sql.NVarChar(sql.MAX), modsJSON)
        .input("combo", sql.NVarChar(sql.MAX), comboDetailsJSON)
        .query(`
          SELECT TOP 1 OrderDetailId
          FROM RestaurantOrderDetailCur
          WHERE OrderId = @orderId
            AND DishId = @dishId
            AND ISNULL(CAST(ModifiersJSON AS NVARCHAR(MAX)), '') =
                ISNULL(@mods, '')
                AND ISNULL(CAST(ComboDetailsJSON AS NVARCHAR(MAX)), '') = ISNULL(@combo, '')
            AND StatusCode NOT IN (2,3,4)
          ORDER BY CreatedOn DESC
        `);

      if (matchCheck.recordset.length > 0) {
        lineItemId = matchCheck.recordset[0].OrderDetailId;
      } else {
        lineItemId = crypto.randomUUID();
      }
    }
    // const comboDetailsJSON = JSON.stringify(item.comboSelections || []).substring(0, 4000);

    console.log("MATCH LINEITEM:", lineItemId);
    console.log("ITEM:", item.name);
    console.log("COMBO:", comboDetailsJSON);
    console.log("QTY:", item.qty);

    const detailCheck = await transaction.request().input("detailId", sql.UniqueIdentifier, lineItemId).query("SELECT OrderDetailId,StatusCode FROM RestaurantOrderDetailCur WHERE OrderDetailId = @detailId");
    if (detailCheck.recordset.length > 0) {
      if (
        detailCheck.recordset[0].StatusCode !== 4 &&
        detailCheck.recordset[0].StatusCode !== 3 &&
        detailCheck.recordset[0].StatusCode !== 2
      ) {
        await transaction.request()
          .input("detailId", sql.UniqueIdentifier, lineItemId)
          .input("qty", sql.Int, item.qty || 1)
          .input("cost", sql.Decimal(18, 2), unitPrice)
          .input("statusCode", sql.Int, currentStatusCode)
          .input(
            "userId",
            sql.UniqueIdentifier,
            toGuidOrNull(finalUserId) || DEFAULT_GUID
          )
          .input("mods", sql.NVarChar(sql.MAX), modsJSON)
          .input("comboDetailsJSON", sql.NVarChar(sql.MAX), comboDetailsJSON)
          .input(
            "orderNo",
            sql.NVarChar(20),
            String(cleanOrderNo).substring(0, 20)
          )
          .input("dishName", sql.NVarChar(200), dishName)
          .input(
            "note",
            sql.NVarChar(100),
            String(noteInfo.value || "").substring(0, 100)
          )
          .input("isTakeaway", sql.Bit, takeawayInfo.value ? 1 : 0)
          .query("UPDATE RestaurantOrderDetailCur SET Quantity = @qty, PricePerUnit = @cost, ActualAmount = @cost * @qty, TotalDetailLineAmount = @cost * @qty, StatusCode = 1, Description = @dishName, DishName = @dishName, ModifiedBy = @userId, ModifiedOn = GETDATE(), ModifiersJSON = @mods, ComboDetailsJSON = @comboDetailsJSON, OrderNumber = @orderNo, Remarks = @note, isTakeAway = @isTakeaway WHERE OrderDetailId = @detailId AND StatusCode <> 4 and StatusCode <> 3 and StatusCode <> 2");
      }
    } else {
      await transaction.request()
        .input("detailId", sql.UniqueIdentifier, lineItemId)
        .input("orderId", sql.UniqueIdentifier, orderGuid)
        .input("dishId", sql.UniqueIdentifier, finalProdId)
        .input("qty", sql.Int, item.qty || 1)
        .input("cost", sql.Decimal(18, 2), unitPrice)
        .input("statusCode", sql.Int, currentStatusCode)
        .input(
          "userId",
          sql.UniqueIdentifier,
          toGuidOrNull(finalUserId) || DEFAULT_GUID
        )
        .input("mods", sql.NVarChar(sql.MAX), modsJSON)
        .input("comboDetailsJSON", sql.NVarChar(sql.MAX), comboDetailsJSON)
        .input(
          "orderNo",
          sql.NVarChar(20),
          String(cleanOrderNo).substring(0, 20)
        )
        .input("bizId", sql.UniqueIdentifier, bizId)
        .input("dishName", sql.NVarChar(200), dishName)
        .input(
          "note",
          sql.NVarChar(100),
          String(noteInfo.value || "").substring(0, 100)
        )
        .input("isTakeaway", sql.Bit, takeawayInfo.value ? 1 : 0)
        .input("isProcesse", sql.Bit, 0)
        .input("isReady", sql.Bit, 0)
        .input("isDelivered", sql.Bit, 0)
        .query(`
  INSERT INTO RestaurantOrderDetailCur
  (
    OrderDetailId,
    OrderId,
    DishId,
    Description,
    DishName,
    Quantity,
    PricePerUnit,
    ActualAmount,
    TotalDetailLineAmount,
    StatusCode,
    CreatedBy,
    CreatedOn,
    ModifiersJSON,
    OrderNumber,
    Remarks,
    isTakeAway,
    BusinessUnitId,
    OrderDateTime,
    isProcesse,
    isReady,
    isDelivered,
    ComboDetailsJSON,
    start_date
  )
  VALUES
  (
    @detailId,
    @orderId,
    @dishId,
    @dishName,
    @dishName,
    @qty,
    @cost,
    @cost * @qty,
    @cost * @qty,
    1, -- Always start as 1 (NEW) so KOT printing works reliably
    @userId,
    GETDATE(),
    @mods,
    @orderNo,
    @note,
    @isTakeaway,
    @bizId,
    GETDATE(),
    0,
    0,
    0,
    @comboDetailsJSON,
       (SELECT TOP 1 StartDate
     FROM DateEntry
     ORDER BY CreatedDate DESC)
  )
`);
    }

    // 🚀 Kitchen Compatibility
    await transaction.request().input("detailId", sql.UniqueIdentifier, lineItemId).query("DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId = @detailId");
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    if (modifiers.length > 0 || noteInfo.value) {
      let modQuery = "INSERT INTO RestaurantmodifierdetailCur (OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, CreatedBy, CreatedOn) VALUES ";
      const modReq = transaction.request();
      modReq.input("detailId", sql.UniqueIdentifier, lineItemId).input("orderId", sql.UniqueIdentifier, orderGuid).input("dishId", sql.UniqueIdentifier, finalProdId).input(
        "userId",
        sql.UniqueIdentifier,
        toGuidOrNull(finalUserId) || DEFAULT_GUID
      );
      const modItems = [...modifiers];
      if (noteInfo.value) modItems.push({ ModifierId: '00000000-0000-0000-0000-000000000001', ModifierName: "INSTR: " + noteInfo.value, Price: 0, qty: item.qty || 1 });
      modItems.forEach((mod, idx) => {
        modReq.input(`mId${idx}`, sql.UniqueIdentifier, mod.ModifierId || '00000000-0000-0000-0000-000000000001');
        modReq.input(`mQty${idx}`, sql.Int, mod.qty || 1);
        modReq.input(`mAmt${idx}`, sql.Decimal(18, 2), mod.Price || 0);
        modReq.input(`mName${idx}`, sql.NVarChar(800), (mod.ModifierName || "").substring(0, 800));
        modQuery += `(@detailId, @orderId, @dishId, @mId${idx}, @mQty${idx}, @mAmt${idx}, @mName${idx}, @userId, GETDATE())${idx === modItems.length - 1 ? "" : ","}`;
      });
      await modReq.query(modQuery);
    }
  }
  await transaction.request()
    .input("orderId", sql.UniqueIdentifier, orderGuid)
    .input("entry_Status", sql.NVarChar(20), "q")
    .query(`
  UPDATE RestaurantOrderCur
  SET 
      TotalAmount = (
          SELECT ISNULL(SUM(ActualAmount), 0)
          FROM RestaurantOrderDetailCur
          WHERE OrderId = @orderId
      ),
      entry_Status = 'q'
  WHERE OrderId = @orderId
`);
}

async function syncTableStatus(req, tableId) {
  if (!tableId || tableId === "undefined" || tableId === "null") return null;
  const pool = await poolPromise;
  const cleanId = String(tableId)
    .replace(/^\{|\}$/g, "")
    .trim();
  const res = await pool.request().input("tid", sql.UniqueIdentifier, cleanId).query(`
    DECLARE @ActualOrderId UNIQUEIDENTIFIER, @ActualOrderNo NVARCHAR(50), @TableNo VARCHAR(20), @count INT, @total DECIMAL(18,2);
    
    SELECT TOP 1 @TableNo = LTRIM(RTRIM(TableNumber)) FROM TableMaster WHERE TableId = @tid;

    SELECT TOP 1 @ActualOrderId = OrderId, @ActualOrderNo = OrderNumber
    FROM RestaurantOrderCur 
    WHERE LTRIM(RTRIM(Tableno)) = @TableNo
    AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
    ORDER BY CreatedOn DESC;

    -- Calculate Totals strictly
    SELECT @count = COUNT(*), @total = ISNULL(SUM(ActualAmount), 0) 
    FROM RestaurantOrderDetailCur 
    WHERE OrderId = @ActualOrderId AND StatusCode <> 0;

    -- 🛡️ SHIELD 1: ATOMIC SYNC - If no items, force close the order to prevent ghosts
    IF @count = 0 AND @ActualOrderId IS NOT NULL
    BEGIN
        UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE() WHERE OrderId = @ActualOrderId;
        SET @ActualOrderNo = NULL;
    END

    -- Update TableMaster with DEFINITIVE state
    UPDATE TableMaster 
    SET Status = CASE 
        WHEN Status = 2 THEN 2 
        WHEN Status = 3 THEN 3
        WHEN @count > 0 THEN 1 
        ELSE 0 
    END, 
       entry_status = 'q',
        TotalAmount = @total, 
        CurrentOrderId = @ActualOrderNo,
        StartTime = CASE WHEN @count > 0 AND (StartTime IS NULL OR StartTime < '2000-01-01') THEN GETDATE() 
                         WHEN @count = 0 THEN NULL 
                         ELSE StartTime END,
        ModifiedOn = GETDATE()
    WHERE TableId = @tid;

    SELECT 
      Status, TotalAmount, CONVERT(VARCHAR, StartTime, 126) AS StartTime, 
      CurrentOrderId, TableNumber as tableNo, DiningSection as section,
      CASE 
        WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
        ELSE 0 
      END AS isOvertime,
      CASE 
        WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= ISNULL((SELECT TOP 1 HoldOvertimeMinutes FROM CompanySettings), 30) THEN 1 
        ELSE 0 
      END AS isHoldOvertime
    FROM TableMaster WHERE TableId = @tid;
  `);
  const updated = res.recordset[0];
  if (updated) {
    const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
    const cleanOrderId = updated.CurrentOrderId || "EMPTY";

    req.app.get("io")?.emit("table_status_updated", {
      tableId: cleanId.toLowerCase(),
      status: Number(updated.Status),
      totalAmount: Number(updated.TotalAmount) || 0,
      startTime: updated.StartTime,
      currentOrderId: cleanOrderId,
      tableNo: updated.tableNo,
      section: sectionMap[String(updated.section)] || updated.section,
      isOvertime: updated.isOvertime || 0,
      isHoldOvertime: updated.isHoldOvertime || 0
    });
  }
  return updated;
}

// Routes
router.get("/kiosk/tables", async (req, res) => {
  try {
    const pool = await poolPromise;
    // Find next available empty table in Sections 1, 2, 3 in sequence order
    const result = await pool.request().query(`
      SELECT TOP 1 
        tm.TableId, 
        tm.TableNumber AS TableNo,
        tm.DiningSection,
        tm.SortCode
      FROM TableMaster tm
      WHERE tm.DiningSection IN ('1', '2', '3')
        AND ISNULL(tm.Status, 0) = 0
        AND tm.CurrentOrderId IS NULL
        AND NOT EXISTS (
          SELECT 1 
          FROM RestaurantOrderCur ro 
          WHERE (ro.Tableno = tm.TableNumber OR ro.Tableno = CAST(tm.TableId AS NVARCHAR(50)))
            AND ro.isOrderClosed = 0
            AND ro.StatusCode NOT IN (0, 3, 4)
        )
      ORDER BY 
        CASE 
          WHEN tm.DiningSection = '1' THEN 1
          WHEN tm.DiningSection = '2' THEN 2
          WHEN tm.DiningSection = '3' THEN 3
          ELSE 4
        END ASC,
        tm.SortCode ASC,
        tm.TableNumber ASC
    `);

    res.json({ success: true, table: result.recordset[0] || null, tables: result.recordset });
  } catch (err) {
    console.error("[Kiosk] /kiosk/tables ERROR:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/kiosk/start", async (req, res) => {
  try {
    let { tableId, tableNo, orderType } = req.body;
    const pool = await poolPromise;

    // If tableId was not provided, automatically find the next available empty table in Sections 1, 2, 3
    if (!tableId) {
      const tableCheck = await pool.request().query(`
        SELECT TOP 1 
          tm.TableId, 
          tm.TableNumber AS TableNo,
          tm.DiningSection,
          tm.SortCode
        FROM TableMaster tm
        WHERE tm.DiningSection IN ('1', '2', '3')
          AND ISNULL(tm.Status, 0) = 0
          AND tm.CurrentOrderId IS NULL
          AND NOT EXISTS (
            SELECT 1 
            FROM RestaurantOrderCur ro 
            WHERE (ro.Tableno = tm.TableNumber OR ro.Tableno = CAST(tm.TableId AS NVARCHAR(50)))
              AND ro.isOrderClosed = 0
              AND ro.StatusCode NOT IN (0, 3, 4)
          )
        ORDER BY 
          CASE 
            WHEN tm.DiningSection = '1' THEN 1
            WHEN tm.DiningSection = '2' THEN 2
            WHEN tm.DiningSection = '3' THEN 3
            ELSE 4
          END ASC,
          tm.SortCode ASC,
          tm.TableNumber ASC
      `);

      if (tableCheck.recordset.length > 0) {
        tableId = tableCheck.recordset[0].TableId;
        tableNo = tableCheck.recordset[0].TableNo;
      }
    }

    const orderNumber = await getOrGenerateOrderId(req, tableId || "TAKEAWAY");
    res.json({
      success: true,
      orderNumber,
      tableId: tableId || null,
      tableNo: tableNo || orderType || "TAKEAWAY"
    });
  } catch (err) {
    console.error("[Kiosk] /kiosk/start ERROR:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/save-cart", async (req, res) => {
  try {
    const { tableId, items, userId, orderId } = req.body;
    const pool = await poolPromise;
    const cleanId = String(tableId)
      .replace(/^\{|\}$/g, "")
      .trim();
    // 🚀 UNIFIED ID: Only generate a professional ID if we actually have items to save
    let currentOrderId = orderId;
    const hasItems = items && items.length > 0;

    if (hasItems && (!currentOrderId || currentOrderId === "NEW" || currentOrderId === "#NEW" || currentOrderId === "PENDING" || currentOrderId.length < 10)) {
      currentOrderId = await getOrGenerateOrderId(req, cleanId);
    } else if (!hasItems) {
      // If saving an empty cart, we should clear the TableMaster's CurrentOrderId
      currentOrderId = null;
    }

    // const transaction = new sql.Transaction(pool);
    // await transaction.begin();
    try {
      if (hasItems) {
        await syncToProfessionalTables(
          { request: () => pool.request() },
          cleanId,
          currentOrderId,
          items || [],
          userId
        );
      }

      // 🚀 CRITICAL: Update TableMaster INSIDE the same transaction 
      // await transaction.request()
      const isGuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
      if (isGuid) {
        await pool.request()
          .input("tid", sql.UniqueIdentifier, cleanId)
          .input("oid", sql.NVarChar(50), currentOrderId)
          .query(`
            UPDATE TableMaster 
            SET Status = CASE WHEN @oid IS NOT NULL THEN 1 ELSE 0 END, 
                CurrentOrderId = @oid,
                 entry_status = 'q',
                StartTime = CASE WHEN @oid IS NOT NULL AND (StartTime IS NULL OR StartTime < '2000-01-01') THEN GETDATE() 
                                 WHEN @oid IS NULL THEN NULL 
                                 ELSE StartTime END
            WHERE TableId = @tid
          `);
      }

      // await transaction.commit();

      res.json({ success: true, orderId: currentOrderId });

      // 🔥 LIVE SYNC: Notify all other devices that this table's cart has changed
      const io = req.app.get("io");
      if (io) {
        io.to(`table:${cleanId.toLowerCase()}`).emit("cart_updated", { tableId: cleanId, orderId: currentOrderId });
      }

      syncTableStatus(req, cleanId).catch(() => { });
    } catch (e) {
      // if (transaction._isStarted) await transaction.rollback(); 
      console.error("❌ SaveCart SQL Error:", e.message);
      res.status(500).json({ error: "DB_ERROR: " + e.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/send", async (req, res) => {
  try {
    const { tableId, orderId, items, userId, isKiosk } = req.body;

    console.log(
      "SYNC ITEMS:",
      JSON.stringify(items, null, 2)
    );
    console.log("SEND ITEMS RECEIVED:", JSON.stringify(items, null, 2));
    const pool = await poolPromise;

    let actualTableId = tableId;

    const isGuid = /^[0-9a-fA-F-]{36}$/;

    if (isKiosk) {
      actualTableId = null;
    } else if (!isGuid.test(String(tableId))) {

      const tableLookup = await pool.request()
        .input("tableNo", sql.VarChar(50), String(tableId))
        .query(`
      SELECT TOP 1 TableId
      FROM TableMaster
      WHERE TableNumber = @tableNo
    `);

      if (tableLookup.recordset.length === 0) {
        throw new Error("Table not found");
      }

      actualTableId = tableLookup.recordset[0].TableId;
    }

    const cleanId = actualTableId
      ? String(actualTableId).replace(/^\{|\}$/g, "").trim()
      : null;

    // const transaction = new sql.Transaction(pool);
    // await transaction.begin();
    try {
      // 1. 🚀 GENERATE PROFESSIONAL ID NOW (At the moment of sending)
      //   const finalOrderId = await getOrGenerateOrderId(req, cleanId);

      let finalOrderId = orderId;

      if (
        !finalOrderId ||
        finalOrderId === "NEW" ||
        finalOrderId === "#NEW" ||
        finalOrderId === "PENDING"
      ) {
        finalOrderId = await getOrGenerateOrderId(req, cleanId);
      }

      // 2. FORCE SENT STATUS — use items from client, or fall back to DB items
      let clientItems = items || [];
      if (clientItems.length === 0) {
        // 🔥 SAFETY NET: Frontend forgot to send items. Fetch from DB.
        console.warn("⚠️ [Send] No items received from client - fetching from DB as fallback");
        const dbItems = await pool.request()
          .input("tableNo", sql.UniqueIdentifier, cleanId)
          .query(`SELECT d.OrderDetailId as lineItemId, d.DishId as id, dish.Name as name,
            d.Quantity as qty, d.PricePerUnit as price, d.StatusCode, d.ModifiersJSON, d.Remarks as note, d.isTakeAway as isTakeaway
            FROM RestaurantOrderDetailCur d
            JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
            LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
            WHERE (LTRIM(RTRIM(h.Tableno)) = (SELECT LTRIM(RTRIM(TableNumber)) FROM TableMaster WHERE TableId = @tableNo)
              OR LTRIM(RTRIM(h.Tableno)) = LTRIM(RTRIM(@tableNo))) 
              AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL) 
              AND d.StatusCode <> 0`);
        clientItems = dbItems.recordset;
      }
      const sentItems = clientItems.map(item => ({
        ...item,
        status: (item.status === 'VOIDED' || item.StatusCode === 0) ? 'VOIDED' : (item.status || 'SENT')
      }));

      if (sentItems.length === 0) {
        return res.json({
          success: false,
          message: "No items found to send."
        });
      }

      // 3. FORCE SYNC with the new Professional ID
      await syncToProfessionalTables(
        { request: () => pool.request() },
        cleanId,
        finalOrderId,
        sentItems,
        userId
      );

      // 4. Lock Table to the new ID
      if (cleanId) {
        await pool.request()
          .input("tid", sql.UniqueIdentifier, cleanId)
          .input("oid", sql.NVarChar(50), finalOrderId)
          .query(`
            UPDATE TableMaster 
            SET Status = 1, 
                entry_status ='q',
                CurrentOrderId = @oid,
                StartTime = CASE WHEN StartTime IS NULL OR StartTime < '2000-01-01' THEN GETDATE() ELSE StartTime END,
                ModifiedOn = GETDATE()
            WHERE TableId = @tid
          `);
      }

      //   await transaction.commit();

      res.json({ success: true, orderId: finalOrderId });

      // 🔥 REAL-TIME BROADCAST: Notify KDS and all other Waiter devices
      const io = req.app.get("io");
      if (io && cleanId) {
        io.emit("new_order", {
          orderId: finalOrderId,
          context: {
            orderType: "DINE_IN",
            tableId: cleanId,
            tableNo: (await pool.request().input("tid", sql.UniqueIdentifier, cleanId).query("SELECT TableNumber FROM TableMaster WHERE TableId = @tid")).recordset[0]?.TableNumber,
            section: "SECTION_1" // Fallback, will be refined by store
          },
          items: sentItems,
          createdAt: Date.now()
        });
        io.to(`table:${cleanId.toLowerCase()}`).emit("cart_updated", { tableId: cleanId, orderId: finalOrderId });
        io.emit("kot_printed", { tableId: cleanId, orderId: finalOrderId });
      }

      // 5. Refresh totals and notify instantly
      if (cleanId) syncTableStatus(req, cleanId).catch(() => { });
    } catch (e) {
      //   await transaction.rollback(); 
      console.error("❌ FULL SEND ERROR:", e);
      res.status(500).json({ error: "SEND_ERROR: " + e.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/cart/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    if (!tableId || tableId === "undefined" || tableId === "null" || tableId.length < 5) {
      return res.json({ items: [], currentOrderId: null });
    }
    const pool = await poolPromise;
    const cleanId = tableId.replace(/^\{|\}$/g, "").trim();
    const isGuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
    if (!isGuid) {
      return res.json({ items: [], currentOrderId: null });
    }

    // Get table info (TableNumber + CurrentOrderId)
    const tableInfo = await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query("SELECT TableNumber, CurrentOrderId FROM TableMaster WHERE TableId = @tid");

    const tableRow = tableInfo.recordset[0];
    const tableNumber = tableRow?.TableNumber;
    const currentOrderId = tableRow?.CurrentOrderId;

    // Fetch items: prioritize by CurrentOrderId, fall back to open order by TableNumber
    // 💡 LIVE SYNC: Allow TEMP- IDs so other devices can see the draft cart items!
    const isRealOrderId = currentOrderId &&
      currentOrderId !== 'PENDING' &&
      currentOrderId !== 'NEW';

    const result = await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .input("tableNo", sql.VarChar(20), String(tableNumber || ""))
      .input("orderNo", sql.NVarChar(50), isRealOrderId ? currentOrderId : "__NONE__")
      .query(`
        SELECT 
  d.OrderDetailId as lineItemId,
  d.DishId as id,
  d.Quantity as qty,
  d.PricePerUnit as price,
  ISNULL(dish.Name, d.DishName) as name,
   dish.isServiceCharge AS isServiceCharge,
  d.ModifiersJSON,
  d.ComboDetailsJSON,
  d.Remarks as note,
  d.isTakeAway as isTakeaway,
  CASE d.StatusCode
    WHEN 1 THEN 'NEW'
    WHEN 2 THEN 'SENT'
    WHEN 3 THEN 'READY'
    WHEN 4 THEN 'SERVED'
    WHEN 5 THEN 'HOLD'
    WHEN 0 THEN 'VOIDED'
    ELSE 'SENT'
  END as status
FROM RestaurantOrderDetailCur d
JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
WHERE
  h.isOrderClosed = 0
  AND d.StatusCode <> 0
  AND (
    h.OrderNumber = @orderNo
    OR h.OrderId = (
      SELECT TOP 1 OrderId
      FROM RestaurantOrderCur
      WHERE Tableno = @tableNo
        AND isOrderClosed = 0
      ORDER BY CreatedOn DESC
    )
  )
ORDER BY d.CreatedOn ASC
      `);

    const items = result.recordset.map((i) => ({
      ...i,
      modifiers: i.ModifiersJSON ? (() => { try { return JSON.parse(i.ModifiersJSON); } catch { return []; } })() : []
    }));

    res.json({ items, currentOrderId: isRealOrderId ? currentOrderId : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/cart/kiosk/:orderId", async (req, res) => {
  try {
    const rawOrderId = req.params.orderId || "";
    if (!rawOrderId || rawOrderId === "null" || rawOrderId === "undefined") {
      return res.json({ items: [], currentOrderId: null });
    }
    const cleanOrderId = String(rawOrderId).split(":")[0].trim();
    const pool = await poolPromise;
    const itemsResult = await pool.request()
      .input("oid", sql.NVarChar(100), cleanOrderId)
      .query(`
        SELECT 
          d.OrderDetailId as lineItemId,
          d.OrderDetailId,
          d.DishId as id,
          d.DishId,
          d.Quantity as qty,
          d.Quantity,
          d.PricePerUnit as price,
          d.PricePerUnit,
          ISNULL(dish.Name, d.DishName) as name,
          ISNULL(dish.Name, d.DishName) as Name,
          dish.isServiceCharge AS isServiceCharge,
          d.ModifiersJSON,
          d.ComboDetailsJSON,
          d.Remarks as note,
          d.isTakeAway as isTakeaway,
          CASE d.StatusCode
            WHEN 1 THEN 'NEW'
            WHEN 2 THEN 'SENT'
            WHEN 3 THEN 'READY'
            WHEN 4 THEN 'SERVED'
            WHEN 5 THEN 'HOLD'
            WHEN 0 THEN 'VOIDED'
            ELSE 'SENT'
          END as status
        FROM RestaurantOrderDetailCur d
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        WHERE (h.OrderNumber = @oid OR d.OrderNumber = @oid OR CONVERT(varchar(50), h.OrderId) = @oid)
          AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
          AND d.StatusCode <> 0
      `);
    return res.json({ items: itemsResult.recordset || [], currentOrderId: cleanOrderId });
  } catch (err) {
    return res.json({ items: [], currentOrderId: req.params.orderId });
  }
});

router.post("/cancel", async (req, res) => {
  try {
    const { orderId, tableId, reason, userId, userName } = req.body;
    const pool = await poolPromise;
    const cleanTid = String(tableId).replace(/^\{|\}$/g, "").trim();

    // 1. Fetch Order Data for Reporting
    const orderData = await pool.request()
      .input("oid", sql.NVarChar(100), orderId)
      .query(`
        SELECT h.OrderId, h.OrderNumber, h.Tableno, h.BusinessUnitId, h.CreatedBy, h.MobileNo,
               tm.DiningSection, tm.TableId
        FROM RestaurantOrderCur h
        LEFT JOIN TableMaster tm ON LTRIM(RTRIM(h.Tableno)) = LTRIM(RTRIM(tm.TableNumber))
        WHERE h.OrderNumber = @oid AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
      `);

    const header = orderData.recordset[0];
    if (!header) {
      return res.status(404).json({ error: "Order not found or already closed" });
    }

    const itemsData = await pool.request()
      .input("orderId", sql.UniqueIdentifier, header.OrderId)
      .query(`
        SELECT d.*, dish.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName
        FROM RestaurantOrderDetailCur d
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dg ON dish.DishGroupId = dg.DishGroupId
        LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
        WHERE d.OrderId = @orderId
      `);

    const items = itemsData.recordset;
    const subTotal = items.reduce((sum, item) => sum + (item.ActualAmount || 0), 0);
    const voidQty = items.reduce((sum, item) => sum + (item.Quantity || 0), 0);

    // const transaction = new sql.Transaction(pool);
    // await transaction.begin();
    try {

      let settlementId = crypto.randomUUID();

      // 2. Insert into SettlementHeader (Cancelled Status)
      await transaction.request()
        .input("sid", sql.UniqueIdentifier, settlementId)
        .input("oid", sql.NVarChar(50), orderId)
        .input("tableNo", sql.NVarChar(50), header.Tableno)
        .input("section", sql.NVarChar(100), header.DiningSection)
        .input("userId", sql.UniqueIdentifier, toGuidOrNull(userId))
        .input("userName", sql.NVarChar(255), userName || "User")
        .input("reason", sql.NVarChar(500), reason || "Manual Cancellation")
        .input("bizId", sql.UniqueIdentifier, header.BusinessUnitId || DEFAULT_GUID)
        .input("subTotal", sql.Money, subTotal)
        .input("voidQty", sql.Int, voidQty)
        .input("voidAmt", sql.Money, subTotal)
        .input("mobile", sql.NVarChar(50), header.MobileNo)
        .query(`
          INSERT INTO SettlementHeader (
            SettlementID, LastSettlementDate, BillNo, OrderType, TableNo, Section, 
            CashierID, BusinessUnitId, SysAmount, ManualAmount, CreatedBy, CreatedOn, 
            IsCancelled, CancellationReason, CancelledDate, CancelledByUserName, 
            SubTotal, TotalTax, DiscountAmount, MobileNo, VoidItemQty, VoidItemAmount, start_date
          ) VALUES (
            @sid, GETDATE(), @oid, 'DINE-IN', @tableNo, @section, 
            @userId, @bizId, 0, 0, @userId, GETDATE(), 
            1, @reason, GETDATE(), @userName, 
            @subTotal, 0, 0, @mobile, @voidQty, @voidAmt,
            (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
          )
        `);

      // 3. Insert Items into SettlementItemDetail (Marked as VOIDED)
      for (const item of items) {
        await transaction.request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .input("dishId", sql.UniqueIdentifier, item.DishId)
          .input("dishName", sql.NVarChar(255), item.DishName)
          .input("qty", sql.Int, item.Quantity)
          .input("price", sql.Decimal(18, 2), item.PricePerUnit)
          .input("catId", sql.UniqueIdentifier, item.CategoryId)
          .input("catName", sql.NVarChar(255), item.CategoryName)
          .input("groupName", sql.NVarChar(255), item.DishGroupName)
          .query(`
            INSERT INTO SettlementItemDetail (
              SettlementID, DishId, DishName, Qty, Price, Status, OrderDateTime,
              CategoryId, CategoryName, SubCategoryName, start_date
            ) VALUES (
              @sid, @dishId, @dishName, @qty, @price, 'VOIDED', GETDATE(),
              @catId, @catName, @groupName,
              (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
            )
          `);
      }

      // 4. Update Current Tables (StatusCode 4 = Cancelled)
      await transaction.request()
        .input("oid", sql.NVarChar(50), orderId)
        .query(`
          UPDATE RestaurantOrderCur SET StatusCode = 4, isOrderClosed = 1, ModifiedOn = GETDATE() WHERE OrderNumber = @oid;
          UPDATE RestaurantOrderDetailCur SET StatusCode = 0, ModifiedOn = GETDATE() WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @oid);
        `);

      await transaction.request()
        .input("tid", sql.VarChar(50), cleanTid)
        .query("UPDATE TableMaster SET Status = 0, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, ModifiedOn = GETDATE() WHERE TableId = @tid");

      await transaction.commit();

      req.app.get("io")?.emit("table_status_updated", { tableId: cleanTid, status: 0, totalAmount: 0 });
      req.app.get("io")?.emit("order_closed", { tableId: cleanTid, orderId: orderId });

      res.json({ success: true });
    } catch (e) {
      await transaction.rollback();
      console.error("❌ Cancel Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/complete", async (req, res) => {
  try {
    const { tableId, userId } = req.body;
    const cleanId = tableId.replace(/^\{|\}$/g, "").trim();
    const pool = await poolPromise;

    // Final atomic update: Close the professional order and release the table
    await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query(`
        UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE() 
        WHERE LTRIM(RTRIM(Tableno)) = (SELECT TOP 1 LTRIM(RTRIM(TableNumber)) FROM TableMaster WHERE TableId = @tid) 
        AND (isOrderClosed = 0 OR isOrderClosed IS NULL);
        
        UPDATE TableMaster SET Status = 0, CurrentOrderId = NULL, StartTime = NULL, TotalAmount = 0, ModifiedOn = GETDATE() WHERE TableId = @tid;
      `);

    const updated = await syncTableStatus(req, cleanId);

    // 🔥 UNIFIED SIGNAL: Use order_status_update for consistency
    const io = req.app.get("io");
    if (io) {
      req.app.get("io")?.to(`table:${cleanId.toLowerCase()}`).emit("order_closed", { tableId: cleanId });
      req.app.get("io")?.emit("order_status_update", {
        tableId: cleanId,
        action: "CLOSE",
        orderId: updated?.CurrentOrderId
      });
    }
    res.json({ success: true, ...updated });
  } catch (err) {
    console.error("❌ Complete Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/hold", async (req, res) => {
  try {
    const { tableId } = req.body;
    const pool = await poolPromise;
    const cleanId = tableId.replace(/^\{|\}$/g, "").trim();

    // Set status to 3 (Hold)
    await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query(`
        UPDATE TableMaster 
        SET Status = 3, 
         entry_status = 'q',
            ModifiedOn = GETDATE() 
        WHERE TableId = @tid
      `);

    const updated = await syncTableStatus(req, cleanId);
    res.json({ success: true, ...updated });
  } catch (err) {
    console.error("❌ Hold Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/checkout", async (req, res) => {
  try {
    const { tableId, orderId, cart, userId } = req.body;
    const cleanId = tableId.replace(/^\{|\}$/g, "").trim();
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    let orderNumber = orderId || null;
    let orderGuid = null;
    let tableNumber = null;

    const tableInfo = await transaction.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query("SELECT TableNumber, CurrentOrderId FROM TableMaster WHERE TableId = @tid");

    if (tableInfo.recordset.length > 0) {
      tableNumber = tableInfo.recordset[0].TableNumber;
      orderNumber = orderNumber || tableInfo.recordset[0].CurrentOrderId || null;
    }

    if (orderNumber) {
      const headerCheck = await transaction.request()
        .input("orderNo", sql.NVarChar(50), orderNumber)
        .query("SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo");

      if (headerCheck.recordset.length > 0) {
        orderGuid = headerCheck.recordset[0].OrderId;
      } else {
        orderGuid = crypto.randomUUID();
        await transaction.request()
          .input("orderId", sql.UniqueIdentifier, orderGuid)
          .input("orderNo", sql.NVarChar(50), orderNumber)
          .input("tableNo", sql.VarChar(20), tableNumber || "TAKEAWAY")
          .input("userId", sql.UniqueIdentifier, toGuidOrNull(userId) || DEFAULT_GUID)
          .input("bizId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
            INSERT INTO RestaurantOrderCur (
              OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode,
              CreatedBy, CreatedOn, isOrderClosed, BusinessUnitId,
              entry_Status, start_date
            ) VALUES (
              @orderId, @orderNo, GETDATE(), LTRIM(RTRIM(@tableNo)), 1,
              @userId, GETDATE(), 0, @bizId, 'q',
              (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
            )
          `);

        await transaction.request()
          .input("tid", sql.UniqueIdentifier, cleanId)
          .input("orderNo", sql.NVarChar(50), orderNumber)
          .query(`
            UPDATE TableMaster
            SET CurrentOrderId = @orderNo,
                ModifiedOn = GETDATE()
            WHERE TableId = @tid
          `);
      }
    }

    if (orderGuid && Array.isArray(cart) && cart.length > 0) {
      const detailCheck = await transaction.request()
        .input("orderId", sql.UniqueIdentifier, orderGuid)
        .query("SELECT TOP 1 OrderDetailId FROM RestaurantOrderDetailCur WHERE OrderId = @orderId");

      if (detailCheck.recordset.length === 0) {
        for (const item of cart) {
          const itemId = crypto.randomUUID();
          const quantity = Number(item.qty || item.Quantity || 1);
          const price = Number(item.price || item.PricePerUnit || item.Price || 0);
          const dishName = String(item.name || item.DishName || item.ProductName || "Dish").substring(0, 200);
          const dishId = item.id || item.DishId || DEFAULT_GUID;

          await transaction.request()
            .input("detailId", sql.UniqueIdentifier, itemId)
            .input("orderId", sql.UniqueIdentifier, orderGuid)
            .input("dishId", sql.UniqueIdentifier, dishId)
            .input("dishName", sql.NVarChar(200), dishName)
            .input("qty", sql.Int, quantity)
            .input("price", sql.Decimal(18, 2), price)
            .input("amount", sql.Decimal(18, 2), price * quantity)
            .input("bizId", sql.UniqueIdentifier, DEFAULT_GUID)
            .input("orderNo", sql.NVarChar(50), orderNumber)
            .input("userId", sql.UniqueIdentifier, toGuidOrNull(userId) || DEFAULT_GUID)
            .input("note", sql.NVarChar(100), String(item.note || item.remarks || "").substring(0, 100))
            .input("mods", sql.NVarChar(sql.MAX), JSON.stringify(item.modifiers || []).substring(0, 4000))
            .input("combo", sql.NVarChar(sql.MAX), JSON.stringify(item.comboSelections || []).substring(0, 4000))
            .query(`
              INSERT INTO RestaurantOrderDetailCur (
                OrderDetailId, OrderId, DishId, Description, DishName,
                Quantity, PricePerUnit, ActualAmount, TotalDetailLineAmount,
                StatusCode, CreatedBy, CreatedOn, ModifiersJSON,
                OrderNumber, Remarks, isTakeAway, BusinessUnitId,
                OrderDateTime, ComboDetailsJSON, start_date
              ) VALUES (
                @detailId, @orderId, @dishId, @dishName, @dishName,
                @qty, @price, @amount, @amount, 1,
                @userId, GETDATE(), @mods,
                @orderNo, @note, 0, @bizId,
                GETDATE(), @combo,
                (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
              )
            `);
        }
      }
    }

    // Step 1: Move table to Payment Pending (Status 2) and mark items as SERVED (4)
    await transaction.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .query(`
        -- 1. Update Table Status to Checkout (2)
        UPDATE TableMaster SET Status = 2,  entry_status = 'q', ModifiedOn = GETDATE() WHERE TableId = @tid;

        -- 2. Mark all active items for this table as SERVED (4) so they leave KDS
        UPDATE d
        SET d.StatusCode = 4, d.ModifiedOn = GETDATE(), entry_status = 'q'
        FROM RestaurantOrderDetailCur d
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
        JOIN TableMaster tm ON LTRIM(RTRIM(h.Tableno)) = LTRIM(RTRIM(tm.TableNumber))
        WHERE tm.TableId = @tid 
        AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
        AND d.StatusCode IN (1, 2, 3, 5);
      `);

    await transaction.commit();

    const updated = await syncTableStatus(req, cleanId);

    // 🔥 KDS & GLOBAL SYNC: Harmonized signals
    const io = req.app.get("io");
    if (io) {
      req.app.get("io")?.to(`table:${cleanId.toLowerCase()}`).emit("order_closed", {
        tableId: cleanId,
        tableNo: updated?.tableNo,
        section: updated?.section
      });
      io.emit("order_status_update", {
        tableId: cleanId,
        action: "CLOSE",
        orderId: updated?.CurrentOrderId
      });
    }

    res.json({ success: true, ...updated });
  } catch (err) {
    try { if (transaction && transaction._isStarted) await transaction.rollback(); } catch (_) { }
    console.error("❌ Checkout Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/remove-item", async (req, res) => {
  try {
    const { tableId, itemId, qtyToVoid, reason } = req.body;
    const userId = req.body.userId || DEFAULT_GUID;
    const pool = await poolPromise;
    // const transaction = new sql.Transaction(pool);
    // await transaction.begin();
    try {
      // Professional Voiding
      await transaction.request().input("itemId", sql.UniqueIdentifier, itemId).input("userId", sql.UniqueIdentifier, userId).input("reason", sql.NVarChar(255), reason || "").query(`
        UPDATE RestaurantOrderDetailCur 
        SET StatusCode = 0, ModifiedBy = @userId, ModifiedOn = GETDATE(), Remarks = ISNULL(Remarks, '') + ' (VOID: ' + @reason + ')'
        WHERE OrderDetailId = @itemId
      `);
      await transaction.commit();

      // 🚀 Refresh total immediately
      syncTableStatus(req, tableId).catch(() => { });

      req.app.get("io")?.emit("cart_updated", { tableId });
      res.json({ success: true });
    } catch (e) { await transaction.rollback(); throw e; }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/update-item-status", async (req, res) => {
  try {
    const { lineItemId, status, tableId } = req.body;
    const pool = await poolPromise;
    const statusMap = { 'NEW': 1, 'SENT': 2, 'READY': 3, 'SERVED': 4, 'HOLD': 5, 'VOIDED': 0 };

    // Fetch orderNumber first so we can emit it
    const orderRes = await pool.request()
      .input("id", sql.UniqueIdentifier, lineItemId)
      .query("SELECT h.OrderNumber FROM RestaurantOrderDetailCur d JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId WHERE d.OrderDetailId = @id");

    const orderId = orderRes.recordset[0]?.OrderNumber;

    await pool.request()
      .input("id", sql.UniqueIdentifier, lineItemId)
      .input("code", sql.Int, statusMap[status] || 2)
      .query("UPDATE RestaurantOrderDetailCur SET StatusCode = @code, ModifiedOn = GETDATE() WHERE OrderDetailId = @id AND StatusCode <> 4 and StatusCode <> 3 and StatusCode <> 2");

    req.app.get("io")?.emit("item_status_updated", { lineItemId, status, tableId, orderId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/active-kitchen", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, d.StatusCode, 
        h.OrderNumber as orderId, dish.Name as name, LTRIM(RTRIM(h.Tableno)) as tableNo, 
        d.Remarks as note, d.ModifiersJSON, d.isTakeAway, DATEDIFF(SECOND, d.CreatedOn, GETDATE()) as elapsedSeconds,
        ISNULL(ckt.KitchenTypeCode, '0') as KitchenTypeCode, 
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'General') as KitchenTypeName,
        pm.PrinterName,
        pm.PrinterPath as PrinterIP,
        tm.TableId, tm.DiningSection
      FROM RestaurantOrderDetailCur d 
      JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
      LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
      LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN PrintMaster pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50))
      LEFT JOIN TableMaster tm ON LTRIM(RTRIM(h.Tableno)) = LTRIM(RTRIM(tm.TableNumber))
      WHERE (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
      AND (d.StatusCode IN (2,3,5) OR (d.StatusCode = 0 AND DATEDIFF(MINUTE, d.ModifiedOn, GETDATE()) < 10))
      AND h.OrderNumber IS NOT NULL
      AND h.OrderNumber NOT LIKE 'TEMP-%'
      AND h.OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '')
      ORDER BY d.CreatedOn ASC
    `);
    const orders = {};
    result.recordset.forEach(row => {
      if (!orders[row.orderId]) {
        const isTakeaway = !row.tableNo || row.tableNo === 'TAKEAWAY' || String(row.tableNo).startsWith('TW');
        orders[row.orderId] = {
          orderId: row.orderId,
          context: {
            orderType: isTakeaway ? 'TAKEAWAY' : 'DINE_IN',
            tableId: row.TableId,
            tableNo: isTakeaway ? null : row.tableNo,
            section: row.DiningSection || "",
            takeawayNo: isTakeaway ? (row.tableNo === 'TAKEAWAY' ? row.orderId.slice(-4) : row.tableNo) : null
          },
          items: [],
          createdAt: Date.now() - (row.elapsedSeconds * 1000)
        };
      }
      const statusMap = { 1: 'NEW', 2: 'SENT', 3: 'READY', 4: 'SERVED', 5: 'HOLD' };
      orders[row.orderId].items.push({
        ...row,
        status: statusMap[row.StatusCode],
        modifiers: row.ModifiersJSON ? JSON.parse(row.ModifiersJSON) : []
      });
    });
    res.json({ serverTime: Date.now(), orders: Object.values(orders) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/log-print", async (req, res) => {
  try {
    const { orderId, orderNumber, printType } = req.body;
    const pool = await poolPromise;
    await pool.request().input("oid", sql.UniqueIdentifier, orderId && orderId.length > 30 ? orderId : null).input("ono", sql.VarChar(50), orderNumber).input("pt", sql.Int, printType || 1).query("INSERT INTO PrintReport (OrderId, Ordernumber, PrintType, orderDate) VALUES (@oid, @ono, @pt, GETDATE())");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/delete-cart-item", async (req, res) => {

  try {

    const { lineItemId, tableId } = req.body;

    if (!lineItemId) {
      return res.status(400).json({
        success: false,
        error: "lineItemId missing"
      });
    }

    const pool = await poolPromise;

    // 1. Get the OrderId before deleting (needed for total recalc)
    const itemCheck = await pool.request()
      .input("detailId", sql.UniqueIdentifier, lineItemId)
      .query("SELECT OrderId FROM RestaurantOrderDetailCur WHERE OrderDetailId = @detailId");

    const orderId = itemCheck.recordset[0]?.OrderId;

    // 2. Delete modifiers for this line item first
    await pool.request()
      .input("detailId", sql.UniqueIdentifier, lineItemId)
      .query("DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId = @detailId");

    // 3. Delete the line item itself
    await pool.request()
      .input("detailId", sql.UniqueIdentifier, lineItemId)
      .query("DELETE FROM RestaurantOrderDetailCur WHERE OrderDetailId = @detailId");

    // 4. Recalculate order total
    if (orderId) {
      await pool.request()
        .input("orderId", sql.UniqueIdentifier, orderId)
        .query(`
          UPDATE RestaurantOrderCur
          SET TotalAmount = (
            SELECT ISNULL(SUM(ActualAmount), 0)
            FROM RestaurantOrderDetailCur
            WHERE OrderId = @orderId AND StatusCode <> 0
          )
          WHERE OrderId = @orderId
        `);
    }

    res.json({ success: true });

    // 5. Sync table status and broadcast (fire-and-forget after response)
    if (tableId) {
      const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();
      syncTableStatus(req, cleanId).catch(() => { });
      const io = req.app.get("io");
      if (io) {
        req.app.get("io")?.to(`table:${cleanId.toLowerCase()}`).emit("cart_updated", { tableId: cleanId });
      }
    }

  } catch (err) {

    console.log("DELETE CART ITEM ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

router.get("/order-details/:orderId", async (req, res) => {

  try {

    const { orderId } = req.params;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT
            o.Tableno,
            o.OrderDateTime,
            o.OrderNumber,

            CASE
                WHEN d.StatusCode = '2' THEN 'PREPARING'
                WHEN d.StatusCode = '3' THEN 'READY'
                WHEN d.StatusCode = '1' THEN 'PREPARING'
                ELSE 'UNKNOWN'
            END AS StatusLabel,

            d.StatusCode AS StatusCode,
            d.Description,
            d.DishName,
            d.Quantity,
            d.PricePerUnit AS Price,
             d.ComboDetailsJSON,
             d.ModifiersJSON


        FROM RestaurantOrderCur o

        INNER JOIN RestaurantOrderDetailCur d
            ON o.OrderId = d.OrderId

        WHERE ISNULL(d.isDelivered, 0) = 0
          AND d.StatusCode IN ('1','2', '3')
          AND o.entry_status = 'q'
          AND d.OrderNumber = @orderNo

        ORDER BY o.OrderDateTime ASC
      `);

    res.json(result.recordset);

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

//online payment process
router.post("/payment-status", async (req, res) => {
  try {
    const { tableId, paymentStatus } = req.body;
    const pStatus = paymentStatus !== undefined ? paymentStatus : 1;
    const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();

    const pool = await poolPromise;

    await pool.request()
      .input("tid", sql.UniqueIdentifier, cleanId)
      .input("pStatus", sql.Int, pStatus)
      .query(`
        UPDATE TableMaster
       SET PAYMENT_STATUS = @pStatus,
            Status = 1,
            entry_status = 'q',
            ModifiedOn = GETDATE()
        WHERE TableId = @tid
      `);

    res.json({
      success: true
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

router.post("/mark-sent", async (req, res) => {
  try {
    const { orderId } = req.body;

    const pool = await poolPromise;

    // ✅ KOT for kitchen
    try {
      await generateAndQueueKOTs(orderId);
    } catch (err) {
      console.error("Failed to queue KOT for mark-sent:", err);
    }

    // ✅ Receipt for Cash payment — called ONCE only here (not in complete-online-payment)
    try {
      await generateAndQueueReceipt(orderId, "CASH");
    } catch (err) {
      console.error("Failed to queue receipt for mark-sent:", err);
    }

    const result = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .input("statusCode", sql.Int, 2)
      .query(`
        UPDATE RestaurantOrderDetailCur
        SET StatusCode = @statusCode
        WHERE OrderNumber = @orderNo
          AND StatusCode <> 0
          AND StatusCode <> 4
          AND StatusCode <> 3
          AND StatusCode <> 2
      `);

    console.log("Rows Updated:", result.rowsAffected);

    if (req.io) {
      req.io.emit("qr-print-request", {
        orderId: orderId,
        source: "QR",
        paymentType: "cashier",
        printKOT: true,
        printBill: true
      });
    }

    res.json({
      success: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Unified complete-online-payment endpoint
// Performs: StatusCode=2 + SettlementHeader + SettlementItemDetail + table cleanup
// routes/order.js - FIXED complete-online-payment
router.post("/complete-online-payment", async (req, res) => {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    const { orderId, tableNo, tableId, totalAmount, cart, paymentMethod, gatewayReference, GatewayReference, kioskCarNumber, kioskCustomerName } = req.body;

    console.log("🔍 [PAYMENT] complete-online-payment called", {
      orderId,
      tableNo,
      tableId,
      totalAmount,
      paymentMethod,
      cartLength: cart?.length || 0
    });

    if (!orderId) {
      return res.status(400).json({ success: false, error: "orderId is required" });
    }

    const cleanTableId = tableId ? String(tableId).replace(/^\{|\}$/g, "").trim() : null;
    const amount = parseFloat(totalAmount) || 0;
    const pMethod = (paymentMethod || "ONLINE").toUpperCase();
    let settlementId = crypto.randomUUID();

    await transaction.begin();

    // ── STEP 1: GET OR CREATE ORDER ──────────────────────────────────────────
    let orderHeaderRes = await transaction.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
                SELECT TOP 1
                    h.OrderId, h.OrderNumber, h.Tableno, h.BusinessUnitId, h.MobileNo,
                    tm.DiningSection
                FROM RestaurantOrderCur h
                LEFT JOIN TableMaster tm ON LTRIM(RTRIM(h.Tableno)) = LTRIM(RTRIM(tm.TableNumber))
                WHERE h.OrderNumber = @orderNo
            `);

    let header = orderHeaderRes.recordset[0];
    let guidOrderId;
    let businessUnitId;

    if (!header) {
      console.log("⚠️ [PAYMENT] Order not found, creating new...");

      // Get BusinessUnitId
      const bizCheck = await transaction.request()
        .query("SELECT TOP 1 BusinessUnitId FROM RestaurantOrderCur WHERE BusinessUnitId IS NOT NULL AND BusinessUnitId <> '00000000-0000-0000-0000-000000000000'");
      businessUnitId = bizCheck.recordset[0]?.BusinessUnitId || DEFAULT_GUID;

      // Get TableNumber
      let tableNumber = tableNo || "TAKEAWAY";
      if (cleanTableId) {
        const tableInfo = await transaction.request()
          .input("tid", sql.UniqueIdentifier, cleanTableId)
          .query("SELECT TableNumber FROM TableMaster WHERE TableId = @tid");
        if (tableInfo.recordset.length > 0) {
          tableNumber = tableInfo.recordset[0].TableNumber;
        }
      }

      guidOrderId = crypto.randomUUID();
      await transaction.request()
        .input("orderId", sql.UniqueIdentifier, guidOrderId)
        .input("orderNo", sql.NVarChar(50), orderId)
        .input("tableNo", sql.VarChar(20), tableNumber)
        .input("bizId", sql.UniqueIdentifier, businessUnitId)
        .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
        .query(`
                    INSERT INTO RestaurantOrderCur (
                        OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, 
                        CreatedBy, CreatedOn, BusinessUnitId, isOrderClosed, entry_Status, start_date
                    ) VALUES (
                        @orderId, @orderNo, GETDATE(), @tableNo, 1, 
                        @userId, GETDATE(), @bizId, 0, 'q',
                        (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
                    )
                `);
    } else {
      guidOrderId = header.OrderId;
      businessUnitId = header.BusinessUnitId || DEFAULT_GUID;
    }

    console.log(`🔍 [PAYMENT] Using OrderId: ${guidOrderId}`);

    // ── STEP 2: UPDATE ORDER STATUS ──────────────────────────────────────────
    await transaction.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
                UPDATE RestaurantOrderDetailCur
                SET StatusCode = 2, ModifiedOn = GETDATE()
                WHERE OrderNumber = @orderNo
                  AND StatusCode NOT IN (0,3,4)
            `);

    // ── STEP 3: GET OR CREATE ITEMS ──────────────────────────────────────────
    let itemsRes = await transaction.request()
      .input("orderId", sql.UniqueIdentifier, guidOrderId)
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
                SELECT
                    d.DishId, d.DishName, d.Quantity, d.PricePerUnit,
                    d.TotalDetailLineAmount, d.StatusCode,
                    dish.DishGroupId,
                    dg.CategoryId,
                    cm.CategoryName,
                    dg.DishGroupName
                FROM RestaurantOrderDetailCur d
                LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
                LEFT JOIN DishGroupMaster dg ON dish.DishGroupId = dg.DishGroupId
                LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
                WHERE (d.OrderId = @orderId OR d.OrderNumber = @orderNo)
                  AND d.StatusCode NOT IN (0)
            `);

    let dbItems = itemsRes.recordset;

    // If no items found in DB, create from cart array sent in payload
    if (dbItems.length === 0 && cart && cart.length > 0) {
      console.log(`⚠️ [PAYMENT] No items found in DB, creating ${cart.length} items from cart`);

      for (const item of cart) {
        const itemId = crypto.randomUUID();
        const dishId = item.id || item.DishId || DEFAULT_GUID;
        const dishName = item.name || item.Name || "Unknown";
        const qty = Number(item.qty || item.Quantity || 1);
        const price = Number(item.price || item.Price || 0);

        await transaction.request()
          .input("detailId", sql.UniqueIdentifier, itemId)
          .input("orderId", sql.UniqueIdentifier, guidOrderId)
          .input("dishId", sql.UniqueIdentifier, dishId)
          .input("dishName", sql.NVarChar(255), dishName)
          .input("qty", sql.Int, qty)
          .input("price", sql.Decimal(18, 2), price)
          .input("bizId", sql.UniqueIdentifier, businessUnitId)
          .input("orderNo", sql.NVarChar(50), orderId)
          .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
                        INSERT INTO RestaurantOrderDetailCur (
                            OrderDetailId, OrderId, DishId, DishName, Quantity, PricePerUnit,
                            ActualAmount, TotalDetailLineAmount, StatusCode, CreatedOn,
                            BusinessUnitId, OrderNumber, CreatedBy, Description
                        ) VALUES (
                            @detailId, @orderId, @dishId, @dishName, @qty, @price,
                            @price * @qty, @price * @qty, 2, GETDATE(),
                            @bizId, @orderNo, @userId, @dishName
                        )
                    `);
      }

      // Re-fetch items
      itemsRes = await transaction.request()
        .input("orderId", sql.UniqueIdentifier, guidOrderId)
        .input("orderNo", sql.NVarChar(50), orderId)
        .query(`
                    SELECT
                        d.DishId, d.DishName, d.Quantity, d.PricePerUnit,
                        d.TotalDetailLineAmount, d.StatusCode,
                        dish.DishGroupId,
                        dg.CategoryId,
                        cm.CategoryName,
                        dg.DishGroupName
                    FROM RestaurantOrderDetailCur d
                    LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
                    LEFT JOIN DishGroupMaster dg ON dish.DishGroupId = dg.DishGroupId
                    LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
                    WHERE (d.OrderId = @orderId OR d.OrderNumber = @orderNo)
                      AND d.StatusCode NOT IN (0)
                `);
      dbItems = itemsRes.recordset;
    }

    const subTotal = dbItems.reduce((sum, i) => sum + (i.TotalDetailLineAmount || 0), 0);
    console.log(`🔍 [PAYMENT] Found ${dbItems.length} items, SubTotal: ${subTotal}`);

    const extraCharge = parseFloat(req.body.extraCharge) || 0;
    const isPaidOrder = pMethod.includes("YEAH") || pMethod.includes("YEA") || req.body.isPaid === true;
    const isYeahPay = true; // Always generate settlement records for the order

    // ── STEP 4: UPSERT SETTLEMENT HEADER (ONLY FOR YEAPAY / ONLINE PAID ORDERS) ─────
    if (isYeahPay) {
      const tableNoValue = tableNo || header?.Tableno || null;
      const sectionValue = header?.DiningSection || null;

      const existingSettlement = await transaction.request()
        .input("oid", sql.NVarChar(50), orderId)
        .query("SELECT SettlementID FROM SettlementHeader WHERE BillNo = @oid");

      let isSettlementExists = false;
      if (existingSettlement.recordset.length > 0) {
        settlementId = existingSettlement.recordset[0].SettlementID;
        isSettlementExists = true;
      }

      if (isSettlementExists) {
        await transaction.request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .input("tableNo", sql.NVarChar(50), tableNoValue)
          .input("section", sql.NVarChar(100), sectionValue)
          .input("bizId", sql.UniqueIdentifier, businessUnitId)
          .input("subTotal", sql.Money, subTotal || amount)
          .input("sysAmount", sql.Money, amount)
          .input("mobile", sql.NVarChar(50), header?.MobileNo || null)
          .input("payMode", sql.NVarChar(50), pMethod)
          .input("extraCharge", sql.Numeric(18, 2), extraCharge)
          .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
                    UPDATE SettlementHeader
                    SET LastSettlementDate = GETDATE(), TableNo = @tableNo, Section = @section,
                        BusinessUnitId = @bizId, SysAmount = @sysAmount, ManualAmount = @sysAmount,
                        SubTotal = @subTotal, MobileNo = @mobile,
                        PaymodeServiceCharge = @extraCharge
                    WHERE SettlementID = @sid
                `);
        console.log(`✅ [PAYMENT] SettlementHeader updated: ${settlementId}`);
      } else {
        await transaction.request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .input("oid", sql.NVarChar(50), orderId)
          .input("tableNo", sql.NVarChar(50), tableNoValue)
          .input("section", sql.NVarChar(100), sectionValue)
          .input("bizId", sql.UniqueIdentifier, businessUnitId)
          .input("subTotal", sql.Money, subTotal || amount)
          .input("sysAmount", sql.Money, amount)
          .input("mobile", sql.NVarChar(50), header?.MobileNo || null)
          .input("payMode", sql.NVarChar(50), pMethod)
          .input("extraCharge", sql.Numeric(18, 2), extraCharge)
          .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
                    INSERT INTO SettlementHeader (
                        SettlementID, LastSettlementDate, BillNo, OrderType, TableNo, Section,
                        BusinessUnitId, SysAmount, ManualAmount, CreatedOn,
                        SubTotal, TotalTax, DiscountAmount, MobileNo, IsCancelled,
                        CreatedBy, start_date, PaymodeServiceCharge
                    ) VALUES (
                        @sid, GETDATE(), @oid, 'DINE-IN', @tableNo, @section,
                        @bizId, @sysAmount, @sysAmount, GETDATE(),
                        @subTotal, 0, 0, @mobile, 0,
                        @userId,
                        (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC),
                        @extraCharge
                    )
                `);
        console.log(`✅ [PAYMENT] SettlementHeader inserted: ${settlementId}`);
      }

      // ── STEP 4.5: UPSERT SETTLEMENT TOTALS ─────────────────────────────────
      const receiptCount = dbItems.reduce((sum, item) => sum + (Number(item.Quantity) || 0), 0);
      const settlementGatewayReference = gatewayReference || GatewayReference || null;
      const cashIn = amount;

      await transaction.request()
        .input("sid", sql.UniqueIdentifier, settlementId)
        .input("payMode", sql.VarChar(50), pMethod)
        .input("sysAmount", sql.Money, amount)
        .input("manualAmount", sql.Money, amount)
        .input("amountDiff", sql.Money, 0)
        .input("receiptCount", sql.Numeric(18, 0), receiptCount)
        .input("gatewayReference", sql.NVarChar(255), settlementGatewayReference)
        .input("cashIn", sql.Numeric(18, 2), cashIn)
        .input("cashOut", sql.Numeric(18, 2), 0)
        .query(`
          DELETE FROM SettlementTotalSales WHERE SettlementID = @sid;
          DELETE FROM SettlementTranDetail WHERE SettlementID = @sid;

          INSERT INTO SettlementTotalSales
            (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount, GatewayReference)
          VALUES
            (@sid, @payMode, @sysAmount, @manualAmount, @amountDiff, @receiptCount, @gatewayReference);

          INSERT INTO SettlementTranDetail
            (SettlementID, PayMode, CashIn, CashOut)
          VALUES
            (@sid, @payMode, @cashIn, @cashOut);
        `);
      console.log(`✅ [PAYMENT] SettlementTotalSales and SettlementTranDetail updated: ${settlementId}`);

      // ── STEP 5: UPSERT SETTLEMENT ITEM DETAILS ──────────────────────────────
      if (isSettlementExists) {
        await transaction.request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .query("DELETE FROM SettlementItemDetail WHERE SettlementID = @sid");
      }

      for (const item of dbItems) {
        await transaction.request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .input("dishId", sql.UniqueIdentifier, item.DishId || null)
          .input("dishName", sql.NVarChar(255), item.DishName || "Unknown")
          .input("qty", sql.Int, item.Quantity || 1)
          .input("price", sql.Decimal(18, 2), item.PricePerUnit || 0)
          .input("catId", sql.UniqueIdentifier, item.CategoryId || null)
          .input("catName", sql.NVarChar(255), item.CategoryName || "")
          .input("groupName", sql.NVarChar(255), item.DishGroupName || "")
          .query(`
                      INSERT INTO SettlementItemDetail (
                          SettlementID, DishId, DishName, Qty, Price, Status, OrderDateTime,
                          CategoryId, CategoryName, SubCategoryName, start_date
                      ) VALUES (
                          @sid, @dishId, @dishName, @qty, @price, 'NORMAL', GETDATE(),
                          @catId, @catName, @groupName,
                          (SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC)
                      )
                  `);
      }
      console.log(`✅ [PAYMENT] ${dbItems.length} SettlementItemDetail(s) inserted`);
    }

    // ── STEP 6: UPSERT PAYMENT DETAIL ─────────────────────────────────────────
    if (isYeahPay) {
      const paymodeRes = await transaction.request()
        .input("payMode", sql.NVarChar(50), pMethod)
        .query(`SELECT TOP 1 Position FROM Paymode WHERE UPPER(LTRIM(RTRIM(PayMode))) = UPPER(LTRIM(RTRIM(@payMode)))`);
      const paymodePosition = paymodeRes.recordset[0]?.Position || 3;

      const existingPayment = await transaction.request()
        .input("orderId", sql.UniqueIdentifier, guidOrderId)
        .query("SELECT PaymentId FROM PaymentDetailCur WHERE OrderId = @orderId");

      if (existingPayment.recordset.length > 0) {
        await transaction.request()
          .input("orderId", sql.UniqueIdentifier, guidOrderId)
          .input("paymode", sql.Int, paymodePosition)
          .input("amount", sql.Decimal(18, 2), amount)
          .input("extraCharge", sql.Numeric(18, 2), extraCharge)
          .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
                    UPDATE PaymentDetailCur
                    SET PaymentCollectedOn = GETDATE(), Paymode = @paymode, Amount = @amount,
                        PaymodeServiceChargeAmount = @extraCharge, ModifiedBy = @userId, ModifiedOn = GETDATE()
                    WHERE OrderId = @orderId
                `);
        console.log(`✅ [PAYMENT] PaymentDetailCur updated`);
      } else {
        await transaction.request()
          .input("paymentId", sql.UniqueIdentifier, settlementId)
          .input("restaurantBillId", sql.UniqueIdentifier, settlementId)
          .input("orderId", sql.UniqueIdentifier, guidOrderId)
          .input("paymode", sql.Int, paymodePosition)
          .input("amount", sql.Decimal(18, 2), amount)
          .input("extraCharge", sql.Numeric(18, 2), extraCharge)
          .input("bizId", sql.UniqueIdentifier, businessUnitId)
          .input("userId", sql.UniqueIdentifier, DEFAULT_GUID)
          .query(`
                    INSERT INTO PaymentDetailCur (
                        PaymentId, RestaurantBillId, OrderId, BilledFor, 
                        PaymentCollectedOn, PaymentType, Paymode, Amount,
                        PaymodeServiceChargeAmount, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn
                    ) VALUES (
                        @paymentId, @restaurantBillId, @orderId, 1,
                        GETDATE(), 1, @paymode, @amount,
                        @extraCharge, @bizId, @userId, GETDATE(), @userId, GETDATE()
                    ) 
                `);
        console.log(`✅ [PAYMENT] PaymentDetailCur inserted`);
      }
    }

    // ── STEP 7: UPDATE TABLE MASTER ─────────────────────────────────────────
    if (cleanTableId) {
      await transaction.request()
        .input("tid", sql.UniqueIdentifier, cleanTableId)
        .input("payStatus", sql.Int, isPaidOrder ? 1 : 0)
        .query(`
                    UPDATE TableMaster
                    SET PAYMENT_STATUS = @payStatus,
                        Status = 2,
                        entry_status = 'q',
                        ModifiedOn = GETDATE()
                    WHERE TableId = @tid
                `);
      console.log(`✅ [PAYMENT] TableMaster updated (PAYMENT_STATUS=${isPaidOrder ? 1 : 0})`);
    }

    // ── STEP 8: ARCHIVE ORDER ────────────────────────────────────────────────
    // ✅ FIXED: Check if TotalAmount column exists in RestaurantOrder
    await transaction.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .input("totalAmt", sql.Decimal(18, 2), amount)
      .query(`
                -- Update RestaurantOrderCur TotalAmount
                UPDATE RestaurantOrderCur SET TotalAmount = @totalAmt, ModifiedOn = GETDATE() 
                WHERE OrderNumber = @orderNo;

                ${isPaidOrder ? `
                -- Archive to RestaurantOrder (only for paid digital orders)
                IF NOT EXISTS (SELECT 1 FROM RestaurantOrder WHERE OrderNumber = @orderNo)
                BEGIN
                    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'TotalAmount')
                    BEGIN
                        INSERT INTO RestaurantOrder (
                            OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, 
                            CreatedBy, CreatedOn, BusinessUnitId, isOrderClosed, TotalAmount
                        )
                        SELECT 
                            OrderId, OrderNumber, OrderDateTime, Tableno, 3, 
                            CreatedBy, CreatedOn, BusinessUnitId, 1, TotalAmount
                        FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
                    END
                    ELSE
                    BEGIN
                        INSERT INTO RestaurantOrder (
                            OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, 
                            CreatedBy, CreatedOn, BusinessUnitId, isOrderClosed
                        )
                        SELECT 
                            OrderId, OrderNumber, OrderDateTime, Tableno, 3, 
                            CreatedBy, CreatedOn, BusinessUnitId, 1
                        FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
                    END
                END
                ` : ''}

                -- Archive details (only rows not already archived)
                INSERT INTO RestaurantOrderDetail (
                    OrderDetailId, OrderId, DishId, Description, DishName, Quantity, 
                    PricePerUnit, ActualAmount, TotalDetailLineAmount, StatusCode, 
                    CreatedBy, CreatedOn, BusinessUnitId, OrderDateTime
                )
                SELECT 
                    d.OrderDetailId, d.OrderId, d.DishId, d.Description, d.DishName, d.Quantity, 
                    d.PricePerUnit, d.ActualAmount, d.TotalDetailLineAmount, 2, 
                    d.CreatedBy, d.CreatedOn, d.BusinessUnitId, d.OrderDateTime
                FROM RestaurantOrderDetailCur d
                WHERE d.OrderId = (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                  AND NOT EXISTS (
                      SELECT 1 FROM RestaurantOrderDetail rd WHERE rd.OrderDetailId = d.OrderDetailId
                  );
            `);
    await transaction.commit();
    console.log(`✅ [PAYMENT] Transaction committed for order ${orderId}`);

    try {
      // ✅ Queue KOT once using OrderNumber only
      await generateAndQueueKOTs(orderId);
    } catch (err) {
      console.error("Failed to queue KOT for online payment:", err);
    }

    try {
      // ✅ Queue receipt once using OrderNumber only
      await generateAndQueueReceipt(orderId, pMethod, extraCharge);
    } catch (err) {
      console.error("Failed to queue receipt:", err);
    }

    console.log(`✅ [PAYMENT] ✅✅✅ ALL COMPLETE for order ${orderId}`);

    const io = req.io || req.app?.get("io");
    if (io) {
      io.emit("qr-print-request", {
        orderId: orderId,
        source: "QR",
        paymentType: "online",
        printKOT: false, // KOT already generated and queued directly by generateAndQueueKOTs
        printBill: true
      });
      io.emit("kot_printed", { tableId: cleanTableId, orderId: orderId });
    }

    res.json({
      success: true,
      transactionId: settlementId,
      orderId: orderId,
      message: "Payment completed successfully"
    });

  } catch (err) {
    try { await transaction.rollback(); } catch (_) { }
    console.error("❌ [PAYMENT] ERROR:", err.message);
    console.error("❌ [PAYMENT] Stack:", err.stack);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post("/clear-cart", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "orderId missing"
      });
    }

    const pool = await poolPromise;

    // Delete modifiers first
    await pool.request()
      .input("orderId", sql.NVarChar(100), orderId)
      .query(`
        DELETE FROM RestaurantmodifierdetailCur
        WHERE OrderDetailId IN (
          SELECT OrderDetailId
          FROM RestaurantOrderDetailCur
          WHERE OrderId = TRY_CONVERT(uniqueidentifier, @orderId)
        )
      `);

    // Delete cart items
    await pool.request()
      .input("orderId", sql.NVarChar(100), orderId)
      .query(`
        DELETE FROM RestaurantOrderDetailCur
        WHERE OrderId = TRY_CONVERT(uniqueidentifier, @orderId)
      `);

    // Clear order total
    await pool.request()
      .input("orderId", sql.NVarChar(100), orderId)
      .query(`
        UPDATE RestaurantOrderCur
        SET TotalAmount = 0
        WHERE OrderId = TRY_CONVERT(uniqueidentifier, @orderId)
      `);

    res.json({
      success: true,
      message: "Cart cleared successfully"
    });

  } catch (err) {
    console.error("CLEAR CART ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get("/kiosk/customer/:carNumber", async (req, res) => {
  try {
    const { carNumber } = req.params;

    const pool = await poolPromise;

    const result = await pool.request()
      .input("CarNumber", sql.NVarChar(50), carNumber.trim())
      .query(`
        SELECT TOP 1
          CustomerVehicleId,
          CustomerName,
          CarNumber,
          MobileNumber,
          VehicleType,
          DefaultDishId
        FROM kioskCustomer
        WHERE CarNumber = @CarNumber
          AND IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.json({
        success: true,
        exists: false,
        customer: null
      });
    }

    return res.json({
      success: true,
      exists: true,
      customer: result.recordset[0]
    });

  } catch (error) {
    console.error("Kiosk customer search error:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to search customer."
    });
  }
});

router.get("/kiosk/customers", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        CustomerVehicleId,
        CustomerName,
        CarNumber,
        MobileNumber,
        VehicleType,
        DefaultDishId
      FROM kioskCustomer
      WHERE IsActive = 1
      ORDER BY CreatedOn DESC
    `);

    return res.json({
      success: true,
      customers: result.recordset
    });

  } catch (error) {
    console.error("Kiosk customers search error:", error);

    return res.status(500).json({
      success: false,
      error: "Unable to load customers."
    });
  }
});


// ── SAVE/UPDATE KIOSK CUSTOMER ──────────────────────────────────────────
router.post("/kiosk/customer/save", async (req, res) => {
  try {
    const { customerVehicleId, carNumber, customerName, defaultDishId, mobileNumber, vehicleType } = req.body;

    if (!carNumber || !carNumber.trim()) {
      return res.status(400).json({ success: false, error: "carNumber is required" });
    }

    const pool = await poolPromise;
    const cleanCar = carNumber.trim();
    const cleanName = customerName ? customerName.trim() : cleanCar;
    const dishGuid = defaultDishId ? String(defaultDishId).replace(/^\{|\}$/g, "").trim() : null;

    let existingId = customerVehicleId ? String(customerVehicleId).replace(/^\{|\}$/g, "").trim() : null;

    if (!existingId) {
      const checkRes = await pool.request()
        .input("car", sql.NVarChar(50), cleanCar)
        .query("SELECT TOP 1 CustomerVehicleId FROM kioskCustomer WHERE CarNumber = @car");
      if (checkRes.recordset.length > 0) {
        existingId = checkRes.recordset[0].CustomerVehicleId;
      }
    }

    if (existingId) {
      await pool.request()
        .input("id", sql.UniqueIdentifier, existingId)
        .input("car", sql.NVarChar(50), cleanCar)
        .input("name", sql.NVarChar(255), cleanName)
        .input("dishId", dishGuid ? sql.UniqueIdentifier : sql.NVarChar, dishGuid)
        .input("mobile", sql.NVarChar(50), mobileNumber || null)
        .input("type", sql.NVarChar(50), vehicleType || null)
        .query(`
          UPDATE kioskCustomer
          SET CarNumber = @car,
              CustomerName = @name,
              DefaultDishId = @dishId,
              MobileNumber = COALESCE(@mobile, MobileNumber),
              VehicleType = COALESCE(@type, VehicleType),
              IsActive = 1,
              UpdatedOn = GETDATE()
          WHERE CustomerVehicleId = @id
        `);

      return res.json({ success: true, customerVehicleId: existingId, updated: true });
    } else {
      const newId = crypto.randomUUID();
      await pool.request()
        .input("id", sql.UniqueIdentifier, newId)
        .input("car", sql.NVarChar(50), cleanCar)
        .input("name", sql.NVarChar(255), cleanName)
        .input("dishId", dishGuid ? sql.UniqueIdentifier : sql.NVarChar, dishGuid)
        .input("mobile", sql.NVarChar(50), mobileNumber || null)
        .input("type", sql.NVarChar(50), vehicleType || null)
        .query(`
          INSERT INTO kioskCustomer (
            CustomerVehicleId, CustomerName, CarNumber, MobileNumber, VehicleType,
            DefaultDishId, IsActive, CreatedOn
          ) VALUES (
            @id, @name, @car, @mobile, @type,
            @dishId, 1, GETDATE()
          )
        `);

      return res.json({ success: true, customerVehicleId: newId, created: true });
    }
  } catch (error) {
    console.error("Kiosk customer save error:", error);
    return res.status(500).json({ success: false, error: "Failed to save kiosk customer." });
  }
});

// ── GET ORDER ITEMS (FOR RECEIPT / REPRINT / SETTLEMENT DETAILS) ───────────
router.get("/order-items/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const pool = await poolPromise;

    const result = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT
            d.OrderDetailId,
            d.DishId,
            d.DishName,
            d.Description,
            d.Quantity,
            d.PricePerUnit,
            d.ActualAmount,
            d.TotalDetailLineAmount,
            d.StatusCode,
            d.ComboDetailsJSON,
            d.ModifiersJSON
        FROM RestaurantOrderDetailCur d
        WHERE (d.OrderNumber = @orderNo OR d.OrderId = TRY_CONVERT(uniqueidentifier, @orderNo))
          AND d.StatusCode NOT IN (0)
        UNION ALL
        SELECT
            rd.OrderDetailId,
            rd.DishId,
            rd.DishName,
            rd.Description,
            rd.Quantity,
            rd.PricePerUnit,
            rd.ActualAmount,
            rd.TotalDetailLineAmount,
            rd.StatusCode,
            NULL AS ComboDetailsJSON,
            NULL AS ModifiersJSON
        FROM RestaurantOrderDetail rd
        WHERE (rd.OrderId IN (SELECT OrderId FROM RestaurantOrder WHERE OrderNumber = @orderNo)
               OR rd.OrderId = TRY_CONVERT(uniqueidentifier, @orderNo))
          AND NOT EXISTS (
            SELECT 1 FROM RestaurantOrderDetailCur cd 
            WHERE (cd.OrderNumber = @orderNo OR cd.OrderId = TRY_CONVERT(uniqueidentifier, @orderNo))
              AND cd.StatusCode NOT IN (0)
          )
      `);

    return res.json({
      success: true,
      items: result.recordset
    });
  } catch (err) {
    console.error("Get order items error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch order items." });
  }
});

// ── REPRINT KOT ──────────────────────────────────────────────────────────
router.post("/reprint-kot", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, error: "orderId is required" });
    }

    await generateAndQueueKOTs(orderId);

    const io = req.io || req.app?.get("io");
    if (io) {
      io.emit("qr-print-request", {
        orderId: orderId,
        source: "QR",
        type: "KOT_REPRINT",
      });
    }

    return res.json({ success: true, message: `KOT reprint queued for order ${orderId}` });
  } catch (err) {
    console.error("Reprint KOT error:", err);
    return res.status(500).json({ success: false, error: "Failed to reprint KOT." });
  }
});

module.exports = router;





