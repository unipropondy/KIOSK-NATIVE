const { sql, poolPromise } = require("../config/db");
const crypto = require("crypto");

function formatToSingaporeTime(date, options = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: options.hour || "2-digit",
    minute: options.minute || "2-digit",
    hour12: options.hour12 || false,
  }).format(date);
}

function formatToSingaporeDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatThermalTextWithDiscount(saleData, company, discountInfo) {
  const symbol = company.currencySymbol || "$";
  const name = company.name || "POS SYSTEM";
  const address = company.address || "";
  const gstNo = company.gstNo || "";
  const tel = company.phone || company.tel || "";
  const email = company.email || "";

  const now = new Date();
  const dateStr = formatToSingaporeDate(now);
  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now).toUpperCase();

  const tableNo = saleData.tableNo || "";
  const orderNo = saleData.orderNo || saleData.id || saleData.saleId || "";
  const items = saleData.items || saleData.cartItems || [];

  const rawPayMode = String(saleData.payMode || saleData.paymentMode || saleData.PaymentMode || "CASH").toUpperCase().trim();
  const isYeahPay = rawPayMode.includes("YEAH") || rawPayMode.includes("YEA");
  const headerTitle = isYeahPay ? "PAYMENT RECEIPT" : "CHECKOUT BILL";

  // ── Header ────────────────────────────────────────────────────────────────
  let text = "[C]================================================\n";
  text += `[C]<font size='big'><B>${headerTitle}</B></font>\n`;
  if (!isYeahPay) {
    text += "[C]PAYMENT PENDING PLEASE PAY AT COUNTER\n";
  }
  text += "[C]================================================\n";
  text += `[C]<font size='big'><B>${name}</B></font>\n`;
  if (address) text += `[C]${address}\n`;
  if (tel) text += `[C]Tel: ${tel}\n`;
  if (email) text += `[C]Email: ${email}\n`;
  text += "[C]------------------------------------------------\n";

  // ── Bill Info ─────────────────────────────────────────────────────────────
  if (orderNo) {
    const last4 = String(orderNo).replace(/\D/g, '').slice(-4) || orderNo;
    text += `[L]<font size='big'><B>Order No: ${last4}</B></font>\n`;
  }
  if (tableNo) {
    if (tableNo === "KIOSK-IN" || tableNo === "KIOSK" || tableNo === "TAKEAWAY") {
      text += `[L]<B>ORDER TYPE: KIOSK</B>\n`;
    } else {
      text += `[L]<B>KIOSK: ${tableNo}</B>\n`;
    }
  }
  text += `[L]Date: ${dateStr} ${timeStr}\n`;
  text += "[L]------------------------------------------------\n";

  // ── Column Headers: ITEM (20) | QTY (5) | PRICE (7) | TOTAL (8) = 40 ─────
  text += "[L]" + "ITEM".padEnd(20) + "QTY".padEnd(5) + "PRICE".padStart(7) + "TOTAL".padStart(8) + "\n";
  text += "[L]------------------------------------------------\n";

  // ── Items ─────────────────────────────────────────────────────────────────
  items.forEach((item) => {
    const itemName = (item.name || item.Name || item.DishName || item.ProductName || "Item").substring(0, 19);
    const qty = Number(item.quantity || item.qty || 1);
    const unitPrice = Number(item.price || item.Price || 0);
    const lineTotal = unitPrice * qty;

    const qtyStr = `[${qty}]`;
    const priceStr = `${symbol}${unitPrice.toFixed(2)}`;
    const totalStr = `${symbol}${lineTotal.toFixed(2)}`;

    text += "[L]" + itemName.padEnd(20) + qtyStr.padEnd(5) + priceStr.padStart(7) + totalStr.padStart(8) + "\n";

    // Modifiers
    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach((m) => {
        text += `[L]  + ${m.name || m.ModifierName}\n`;
      });
    }

    // Combo selections
    const comboSels = item.comboSelections || (item.ComboDetailsJSON ? (() => { try { return JSON.parse(item.ComboDetailsJSON); } catch { return []; } })() : []);
    if (comboSels && comboSels.length > 0) {
      comboSels.forEach((g) => {
        text += `[L]    ${g.groupName || g.GroupName}:\n`;
        const comboItems = g.items || g.Items || [];
        comboItems.forEach((opt) => {
          text += `[L]      -> ${opt.name || opt.Name}\n`;
        });
      });
    }
  });

  text += "[L]------------------------------------------------\n";

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = Number(
    saleData.subtotal != null
      ? saleData.subtotal
      : items.reduce((s, i) => s + Number(i.price || i.Price || 0) * Number(i.quantity || i.qty || 1), 0)
  );

  const totalLine = (label, value) => {
    const valStr = `${symbol}${Number(value).toFixed(2)}`;
    return "[L]" + label + valStr.padStart(40 - label.length) + "\n";
  };

  text += totalLine("Sub Total:", subtotal);

  // Discount
  if (discountInfo && discountInfo.applied && discountInfo.amount > 0) {
    const discLabel = discountInfo.type === "percentage"
      ? `Discount (${discountInfo.value}%):`
      : "Discount:";
    const discStr = `-${symbol}${Number(discountInfo.amount).toFixed(2)}`;
    text += "[L]" + discLabel + discStr.padStart(40 - discLabel.length) + "\n";
  }

  const serviceCharge = Number(saleData.serviceCharge || saleData.serviceChargeAmount || 0);
  if (serviceCharge > 0) {
    text += totalLine("Service Charge:", serviceCharge);
  }

  const extraCharge = Number(saleData.extraCharge || saleData.PaymodeServiceCharge || 0);
  if (extraCharge > 0) {
    const chargeLabel = `Extra Charge (${(saleData.payMode || "Payment").toUpperCase().trim()}):`;
    text += totalLine(chargeLabel, extraCharge);
  }

  const gst = Number(saleData.gst || saleData.gstAmount || 0);
  if (gst > 0) {
    const gstLabel = gstNo ? `GST (${gstNo}):` : "GST (9%):";
    text += totalLine(gstLabel, gst);
  }

  text += "[L]------------------------------------------------\n";

  const payMode = (saleData.payMode || saleData.paymentMode || saleData.PaymentMode || "CASH").toUpperCase();
  const discountAmt = (discountInfo && discountInfo.applied) ? Number(discountInfo.amount || 0) : 0;
  const total = subtotal + serviceCharge + extraCharge + gst - discountAmt;
  const totalStr2 = `${symbol}${total.toFixed(2)}`;
  text += "[L]" + payMode + totalStr2.padStart(40 - payMode.length) + "\n";
  text += "[L]------------------------------------------------\n";

  // ── Big Total & Payment Status ──────────────────────────────────────────────
  text += `[R]<font size='big'><B>TOTAL: ${symbol}${total.toFixed(2)}</B></font>\n`;
  text += "[C]================================================\n";
  text += "[C]<B>THANK YOU! COME AGAIN!</B>\n";
  text += "[C]SMART-POS BY UNIPROSG\n";
  text += "\n\n";
  return text;
}

function formatKOTThermalText(data, itemsForPrinter, type) {
  const title =
    type.includes("KDS")
      ? (type.includes("ADDITIONAL") ? "ADDITIONAL KDS" : "KDS PRINT")
      : type === "REPRINT"
        ? "REPRINT"
        : type === "ADDITIONAL"
          ? "ADDITIONAL"
          : "NEW ORDER";
  const tableNo = data.tableNo || "N/A";
  const waiter = data.waiterName || "Staff";
  const orderNo = data.orderNo || data.orderId || "";
  const kitchenName = data.kitchenName || "";

  const now = new Date();
  const kotDateStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(now);
  const kotTimeStr = formatToSingaporeTime(now, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let text = `[C]<B>${title}</B>\n`;
  text += `[C]${kotDateStr} ${kotTimeStr}\n`;
  text += "[L]--------------------------------\n";
  if (tableNo === "KIOSK-IN" || tableNo === "KIOSK" || tableNo === "TAKEAWAY") {
    text += `[C]<font size='big'>ORDER TYPE: KIOSK</font>\n`;
  } else {
    text += `[C]<font size='big'>KIOSK: ${tableNo}</font>\n`;
  }
  text += "[L]--------------------------------\n";
  text += "[L]QTY  ITEM\n";
  text += "[L]--------------------------------\n";

  const renderThermalItem = (item) => {
    const qtyNum = item.quantity || item.qty || item.Quantity || 1;
    const itemName = item.name || item.Name || item.DishName || item.ProductName || "";
    const lines = itemName.split("\n");
    let t = "";
    lines.forEach((line, idx) => {
      if (idx === 0) {
        t += `[L]<font size='big'>[${qtyNum}] ${line}</font>\n`;
      } else {
        t += `[L]<font size='big'>    ${line}</font>\n`;
      }
    });

    const songName = item.songName || item.SongName || "";
    if (songName) t += `[L]    [SONG]: ${songName}\n`;

    const isTw = !!(
      item.isTakeaway ||
      item.IsTakeaway ||
      item.isTakeAway ||
      item.IsTakeAway
    );
    if (isTw) t += `[L]    <B>- Takeaway</B>\n`;

    const modifiers = item.modifiers || (item.ModifiersJSON ? JSON.parse(item.ModifiersJSON) : []);
    if (modifiers && modifiers.length > 0) {
      modifiers.forEach((m) => {
        t += `[L]    <B>+ ${m.ModifierName || m.name}</B>\n`;
      });
    }

    const comboSels = item.comboSelections || (item.ComboDetailsJSON ? (() => { try { return JSON.parse(item.ComboDetailsJSON); } catch { return []; } })() : []);
    if (comboSels && comboSels.length > 0) {
      comboSels.forEach((g) => {
        const comboItems = g.items || g.Items || [];
        if (comboItems.length > 0) {
          comboItems.forEach((opt) => {
            t += `[L]<font size='big'>    -> ${opt.name || opt.Name}</font>\n`;
          });
        }
      });
    }

    const noteText = item.note || item.notes || item.Remarks || item.remarks;
    if (noteText) t += `[L]    * NOTE: ${noteText}\n`;

    return t;
  };

  if (type.includes("KDS")) {
    const kitchenGroups = {};
    itemsForPrinter.forEach((item) => {
      const kName = (
        item.PrinterName ||
        item.KitchenTypeName ||
        item.kitchenTypeName ||
        item.dishGroupName ||
        item.categoryName ||
        "KITCHEN"
      )
        .toUpperCase()
        .trim();
      if (!kitchenGroups[kName]) kitchenGroups[kName] = [];
      kitchenGroups[kName].push(item);
    });

    for (const [kName, groupItems] of Object.entries(kitchenGroups)) {
      text += `\n[L]<B>${kName}</B>\n`;
      text += "[L]--------------------------------\n";
      for (const item of groupItems) {
        text += renderThermalItem(item);
      }
      text += "[L]--------------------------------\n";
    }
  } else {
    for (const item of itemsForPrinter) {
      text += renderThermalItem(item);
    }
    text += "[L]--------------------------------\n";
  }

  const orderNoLast4 = String(orderNo).replace(/\D/g, '').slice(-4) || orderNo;
  text += `[L]Order By: ${waiter}\n`;
  text += `[L]Order #: <font size='big'><B>${orderNoLast4}</B></font>\n`;

  if (kitchenName && kitchenName !== "KDS") {
    text += "[L]--------------------------------\n";
    text += `[C]<font size='big'><B>${kitchenName.toUpperCase()}</B></font>\n`;
  }

  text += "\n\n";
  return text;
}

async function generateAndQueueKOTs(orderId) {
  try {
    const pool = await poolPromise;

    // 1. Load Order Header
    let orderRes = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT TOP 1 h.OrderId, h.OrderNumber, LTRIM(RTRIM(h.Tableno)) as tableNo, h.CreatedBy
        FROM RestaurantOrderCur h
        WHERE (h.OrderNumber = @orderNo OR CAST(h.OrderId AS NVARCHAR(50)) = @orderNo)
      `);

    if (orderRes.recordset.length === 0) {
      orderRes = await pool.request()
        .input("orderNo", sql.NVarChar(50), orderId)
        .query(`
          SELECT TOP 1 s.SettlementID as OrderId, s.BillNo as OrderNumber, LTRIM(RTRIM(s.TableNo)) as tableNo, s.CreatedBy
          FROM SettlementHeader s
          WHERE s.BillNo = @orderNo OR CAST(s.SettlementID AS NVARCHAR(50)) = @orderNo
        `);
    }

    if (orderRes.recordset.length === 0) {
      console.log(`[generateAndQueueKOTs] EARLY EXIT: Order '${orderId}' not found.`);
      return;
    }
    const orderHeader = orderRes.recordset[0];
    console.log(`[generateAndQueueKOTs] Order found: ${orderHeader.OrderNumber} (TableNo: ${orderHeader.tableNo})`);

    // 2. Load Items & Resolve Printer from PrintMaster
    let itemsRes = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT 
          d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, 
          ISNULL(dish.Name, d.DishName) as name, d.Remarks as note, d.ModifiersJSON, d.isTakeAway,
          d.ComboDetailsJSON,
          ISNULL(ckt.KitchenTypeName, cat.CategoryName) as KitchenTypeName,
          pm.PrinterName,
          ISNULL(NULLIF(LTRIM(RTRIM(pm.PrinterIP)), ''), LTRIM(RTRIM(pm.PrinterPath))) as PrinterIP,
          pm.IsActive as IsPrinterEnabled
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
        LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
        LEFT JOIN PrintMaster pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.PrinterType = 2 AND pm.IsActive = 1
        WHERE (h.OrderNumber = @orderNo OR CAST(h.OrderId AS NVARCHAR(50)) = @orderNo)
        AND d.StatusCode IN (1, 2, 3)
      `);

    let items = itemsRes.recordset;
    if (items.length === 0) {
      itemsRes = await pool.request()
        .input("orderNo", sql.NVarChar(50), orderId)
        .query(`
          SELECT 
            d.SettlementItemDetailID as lineItemId, d.DishId as id, d.Qty as qty, 
            ISNULL(dish.Name, d.DishName) as name, NULL as note, NULL as ModifiersJSON, 0 as isTakeAway,
            NULL as ComboDetailsJSON,
            cat.CategoryName as KitchenTypeName,
            pm.PrinterName,
            ISNULL(NULLIF(LTRIM(RTRIM(pm.PrinterIP)), ''), LTRIM(RTRIM(pm.PrinterPath))) as PrinterIP,
            pm.IsActive as IsPrinterEnabled
          FROM SettlementItemDetail d 
          JOIN SettlementHeader s ON d.SettlementID = s.SettlementID 
          LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
          LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
          LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
          LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
          LEFT JOIN PrintMaster pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.PrinterType = 2 AND pm.IsActive = 1
          WHERE s.BillNo = @orderNo
        `);
      items = itemsRes.recordset;
    }

    if (items.length === 0) {
      console.log(`[generateAndQueueKOTs] EARLY EXIT: No active items for order '${orderId}'.`);
      return;
    }

    // 3. Resolve Dynamic Fallback Printer IP from dbo.PrintMaster
    let fallbackKitchenIp = '';
    let fallbackPrinterName = 'Kitchen Printer';
    try {
      const fallbackRes = await pool.request().query(`
        SELECT TOP 1 
          ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP,
          PrinterName 
        FROM PrintMaster 
        WHERE IsActive = 1 
          AND (
            (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
            (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
          )
        ORDER BY CASE WHEN PrinterType = 2 THEN 1 WHEN PrinterType = 1 THEN 2 ELSE 3 END
      `);
      if (fallbackRes.recordset.length > 0 && fallbackRes.recordset[0].PrinterIP) {
        fallbackKitchenIp = fallbackRes.recordset[0].PrinterIP;
        fallbackPrinterName = fallbackRes.recordset[0].PrinterName || 'Kitchen Printer';
      }
    } catch (err) {
      console.error("[generateAndQueueKOTs] Dynamic PrintMaster fallback fetch error:", err.message);
    }

    const printerGroups = {};
    items.forEach(item => {
      if (item.IsPrinterEnabled === 0 || item.IsPrinterEnabled === false) {
        console.log(`[generateAndQueueKOTs] SKIPPED item '${item.name}': IsPrinterEnabled=${item.IsPrinterEnabled}`);
        return;
      }
      const pName = item.PrinterName || fallbackPrinterName;
      let ip = item.PrinterIP;
      if (!ip || ip.trim() === '') {
        ip = fallbackKitchenIp;
      }

      if (!printerGroups[pName]) {
        printerGroups[pName] = {
          printerName: pName,
          printerIp: ip,
          items: []
        };
      }
      printerGroups[pName].items.push(item);
    });

    const groupKeys = Object.keys(printerGroups);
    if (groupKeys.length === 0) {
      console.log(`[generateAndQueueKOTs] EARLY EXIT: All items were skipped (IsPrinterEnabled=0). Nothing to queue.`);
      return;
    }

    // 4. Generate Thermal Content & Insert into PrintJobQueue
    for (const [pName, group] of Object.entries(printerGroups)) {
      let ip = group.printerIp;
      try {
        const orderData = {
          orderId: orderHeader.OrderId,
          orderNo: orderHeader.OrderNumber,
          tableNo: orderHeader.tableNo,
          waiterName: "QR POS",
          kitchenName: group.printerName
        };

        const orderNoLast4 = String(orderHeader.OrderNumber).replace(/\D/g, '').slice(-4) || orderHeader.OrderNumber;
        const dupCheck = await pool.request()
          .input('PrinterName', sql.NVarChar(100), group.printerName)
          .input('SearchText', sql.NVarChar(100), `%Order #: ${orderNoLast4}%`)
          .query(`
            SELECT JobId, Status 
            FROM PrintJobQueue 
            WHERE PrinterName = @PrinterName
              AND Content LIKE @SearchText
          `);

        let kotType = "NEW_ORDER";
        if (dupCheck.recordset.length > 0) {
          kotType = "ADDITIONAL";
        }

        const thermalText = formatKOTThermalText(orderData, group.items, kotType);
        const storeId = "STORE_001";
        const jobId = crypto.randomUUID();

        await pool.request()
          .input('JobId', sql.UniqueIdentifier, jobId)
          .input('StoreId', sql.NVarChar(50), storeId)
          .input('PrinterName', sql.NVarChar(100), group.printerName)
          .input('PrinterIp', sql.NVarChar(100), ip)
          .input('PrinterPort', sql.Int, 9100)
          .input('Content', sql.NVarChar(sql.MAX), thermalText)
          .query(`
            INSERT INTO PrintJobQueue (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn, Attempts)
            VALUES (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE(), 0)
          `);
        console.log(`[generateAndQueueKOTs] KOT job ${jobId} queued for Printer '${group.printerName}' (${ip})`);

      } catch (innerErr) {
        console.error(`[generateAndQueueKOTs] Queue error:`, innerErr.message);
      }
    }

    // 5. Generate KDS backup print (PrinterType = 4) containing all items
    try {
      const kdsPrinterRes = await pool.request()
        .query(`
          SELECT TOP 1 
            ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP, 
            PrinterName 
          FROM PrintMaster 
          WHERE PrinterType = 4 AND IsActive = 1 
            AND (
              (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
              (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
            )
        `);

      if (kdsPrinterRes.recordset.length > 0) {
        const kdsPrinter = kdsPrinterRes.recordset[0];
        const kdsIp = kdsPrinter.PrinterIP;

        const orderData = {
          orderId: orderHeader.OrderId,
          orderNo: orderHeader.OrderNumber,
          tableNo: orderHeader.tableNo,
          waiterName: "QR POS",
          kitchenName: "KDS"
        };

        const kdsOrderNoLast4 = String(orderHeader.OrderNumber).replace(/\D/g, '').slice(-4) || orderHeader.OrderNumber;
        const kdsDupCheck = await pool.request()
          .input('PrinterName', sql.NVarChar(100), kdsPrinter.PrinterName)
          .input('SearchText', sql.NVarChar(100), `%Order #: ${kdsOrderNoLast4}%`)
          .query(`
            SELECT TOP 1 JobId 
            FROM PrintJobQueue 
            WHERE PrinterName = @PrinterName 
              AND Content LIKE @SearchText
          `);

        let kdsKotType = "KDS_PRINT";
        if (kdsDupCheck.recordset.length > 0) {
          kdsKotType = "ADDITIONAL_KDS_PRINT";
        }

        const kdsThermalText = formatKOTThermalText(orderData, items, kdsKotType);
        const storeId = "STORE_001";
        const kdsJobId = crypto.randomUUID();

        await pool.request()
          .input('JobId', sql.UniqueIdentifier, kdsJobId)
          .input('StoreId', sql.NVarChar(50), storeId)
          .input('PrinterName', sql.NVarChar(100), kdsPrinter.PrinterName)
          .input('PrinterIp', sql.NVarChar(100), kdsIp)
          .input('PrinterPort', sql.Int, 9100)
          .input('Content', sql.NVarChar(sql.MAX), kdsThermalText)
          .query(`
            INSERT INTO PrintJobQueue (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn, Attempts)
            VALUES (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE(), 0)
          `);
        console.log(`[generateAndQueueKOTs] Queued KDS job ${kdsJobId} for IP ${kdsIp}`);
      }
    } catch (kdsErr) {
      console.error("[generateAndQueueKOTs] KDS backup print queue error:", kdsErr.message);
    }

  } catch (err) {
    console.error("[generateAndQueueKOTs] Fatal Error:", err.message);
  }
}

async function generateAndQueueReceipt(orderId, paymentMode = 'ONLINE', passedExtraCharge = 0) {
  try {
    const pool = await poolPromise;

    // 1. Get Order Header + Totals (Primary: RestaurantOrderCur, Fallback: SettlementHeader / RestaurantOrder)
    let orderHeaderRes = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT TOP 1 h.OrderId, h.OrderNumber, LTRIM(RTRIM(h.Tableno)) as tableNo, 
               h.TotalAmount, h.ServiceCharge as ServiceChargeAmount, h.TotalTax as GstAmount, 
               h.DiscountAmount, h.DiscountPercentage as DiscountValue,
               sh.PaymodeServiceCharge
        FROM RestaurantOrderCur h
        LEFT JOIN SettlementHeader sh ON h.OrderNumber = sh.BillNo
        WHERE (h.OrderNumber = @orderNo OR CAST(h.OrderId AS NVARCHAR(50)) = @orderNo)
      `);

    if (orderHeaderRes.recordset.length === 0) {
      orderHeaderRes = await pool.request()
        .input("orderNo", sql.NVarChar(50), orderId)
        .query(`
          SELECT TOP 1 s.SettlementID as OrderId, s.BillNo as OrderNumber, LTRIM(RTRIM(s.TableNo)) as tableNo, 
                 s.SysAmount as TotalAmount, 0 as ServiceChargeAmount, 0 as GstAmount, 
                 ISNULL(s.DiscountAmount, 0) as DiscountAmount, 0 as DiscountValue,
                 s.PaymodeServiceCharge
          FROM SettlementHeader s
          WHERE (s.BillNo = @orderNo OR CAST(s.SettlementID AS NVARCHAR(50)) = @orderNo)
        `);
    }

    if (orderHeaderRes.recordset.length === 0) return;
    const orderHeader = orderHeaderRes.recordset[0];

    // Resolve extra charge if not yet stored on orderHeader
    let extraCharge = Number(passedExtraCharge || orderHeader.PaymodeServiceCharge || 0);
    if (extraCharge === 0 && paymentMode) {
      try {
        const pmCheck = await pool.request()
          .input("pm", sql.NVarChar(50), String(paymentMode).trim())
          .query(`SELECT TOP 1 ExtraCharges FROM PAYMODE WHERE UPPER(LTRIM(RTRIM(PayMode))) = UPPER(LTRIM(RTRIM(@pm)))`);
        if (pmCheck.recordset.length > 0 && pmCheck.recordset[0].ExtraCharges > 0) {
          extraCharge = Number(pmCheck.recordset[0].ExtraCharges);
        }
      } catch (e) { }
    }

    // 2. Get Items (Primary: RestaurantOrderDetailCur, Fallback: SettlementItemDetail)
    let itemsRes = await pool.request()
      .input("orderNo", sql.NVarChar(50), orderId)
      .query(`
        SELECT d.Quantity as qty, ISNULL(dish.Name, d.DishName) as name, d.PricePerUnit as price, d.ModifiersJSON, d.isTakeAway, d.ComboDetailsJSON
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        WHERE (h.OrderNumber = @orderNo OR CAST(h.OrderId AS NVARCHAR(50)) = @orderNo) AND d.StatusCode NOT IN (0)
      `);

    let items = itemsRes.recordset.map(item => ({
      ...item,
      modifiers: item.ModifiersJSON ? JSON.parse(item.ModifiersJSON) : []
    }));

    if (items.length === 0) {
      itemsRes = await pool.request()
        .input("orderNo", sql.NVarChar(50), orderId)
        .query(`
          SELECT d.Qty as qty, ISNULL(dish.Name, d.DishName) as name, d.Price as price, NULL as ModifiersJSON, 0 as isTakeAway, NULL as ComboDetailsJSON
          FROM SettlementItemDetail d 
          JOIN SettlementHeader s ON d.SettlementID = s.SettlementID 
          LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
          WHERE s.BillNo = @orderNo
        `);
      items = itemsRes.recordset.map(item => ({
        ...item,
        modifiers: []
      }));
    }

    if (items.length === 0) {
      console.warn(`[generateAndQueueReceipt] No items found for receipt order '${orderId}'`);
      return;
    }

    // 3. Get Company details from CompanySettings
    const companyRes = await pool.request().query("SELECT TOP 1 CompanyName, Address, Phone, Email, GSTNo, CurrencySymbol FROM CompanySettings");
    const companyRow = companyRes.recordset[0] || {};

    const company = {
      name: companyRow.CompanyName || "SMART POS",
      address: companyRow.Address || "",
      gstNo: companyRow.GSTNo || "",
      tel: companyRow.Phone || "",
      email: companyRow.Email || "",
      currencySymbol: companyRow.CurrencySymbol || "$"
    };

    // 4. Determine Printer Type
    const isTakeaway = String(orderHeader.tableNo || "").toUpperCase().startsWith('TW') ||
      String(orderHeader.tableNo || "").toUpperCase() === 'TAKEAWAY';
    const pType = isTakeaway ? 3 : 1;

    // 5. Fetch Printer IP dynamically from PrintMaster
    let printerIp = '';
    let printerName = 'Counter Printer';

    const printerRes = await pool.request()
      .input('PrinterType', sql.Int, pType)
      .query(`
        SELECT TOP 1 
          ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP, 
          PrinterName 
        FROM PrintMaster 
        WHERE PrinterType = @PrinterType AND IsActive = 1 
          AND (
            (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
            (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
          )
      `);

    if (printerRes.recordset.length > 0 && printerRes.recordset[0].PrinterIP) {
      printerIp = printerRes.recordset[0].PrinterIP;
      printerName = printerRes.recordset[0].PrinterName;
    } else {
      // Dynamic fallback to Cashier or any active printer in PrintMaster
      const cashierRes = await pool.request()
        .query(`
          SELECT TOP 1 
            ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP, 
            PrinterName 
          FROM PrintMaster 
          WHERE IsActive = 1 
            AND (
              (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
              (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
            )
          ORDER BY CASE WHEN PrinterType = 1 THEN 1 WHEN PrinterType = 3 THEN 2 ELSE 3 END
        `);
      if (cashierRes.recordset.length > 0 && cashierRes.recordset[0].PrinterIP) {
        printerIp = cashierRes.recordset[0].PrinterIP;
        printerName = cashierRes.recordset[0].PrinterName;
      }
    }

    if (!printerIp) {
      console.warn("[generateAndQueueReceipt] No active printer configured in PrintMaster");
      return;
    }

    // 6. Calculate Subtotal and Format Thermal Text
    const calculatedSubtotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0);
    const serviceChargeAmt = Number(orderHeader.ServiceChargeAmount) || 0;
    const gstAmt = Number(orderHeader.GstAmount) || 0;
    const discountAmt = Number(orderHeader.DiscountAmount) || 0;
    const displayTotal = calculatedSubtotal + serviceChargeAmt + gstAmt - discountAmt + extraCharge;

    const saleData = {
      tableNo: orderHeader.tableNo,
      orderNo: orderHeader.OrderNumber,
      items: items,
      subtotal: calculatedSubtotal,
      serviceCharge: Number(orderHeader.ServiceChargeAmount) || 0,
      extraCharge: extraCharge,
      gst: Number(orderHeader.GstAmount) || 0,
      total: displayTotal,
      payMode: paymentMode,
      paidAmount: displayTotal
    };

    const discountInfo = {
      applied: (orderHeader.DiscountAmount || 0) > 0,
      amount: orderHeader.DiscountAmount || 0,
      type: 'flat',
      value: orderHeader.DiscountValue || orderHeader.DiscountAmount || 0
    };

    const thermalText = formatThermalTextWithDiscount(saleData, company, discountInfo);

    // 7. Insert Print Job Queue
    const jobId = crypto.randomUUID();
    const storeId = "STORE_001";

    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .input('StoreId', sql.NVarChar(50), storeId)
      .input('PrinterName', sql.NVarChar(100), printerName)
      .input('PrinterIp', sql.NVarChar(100), printerIp)
      .input('PrinterPort', sql.Int, 9100)
      .input('Content', sql.NVarChar(sql.MAX), thermalText)
      .query(`
        INSERT INTO PrintJobQueue (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn, Attempts)
        VALUES (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE(), 0)
      `);

    console.log(`[generateAndQueueReceipt] Queued Receipt job ${jobId} for Printer '${printerName}' (${printerIp})`);

  } catch (err) {
    console.error("[generateAndQueueReceipt] Error:", err);
  }
}

async function reprintKOT(orderId) {
  try {
    const pool = await poolPromise;

    const orderRes = await pool.request()
      .input('orderNo', sql.NVarChar(50), orderId)
      .query(`SELECT TOP 1 h.OrderId, h.OrderNumber, LTRIM(RTRIM(h.Tableno)) as tableNo FROM RestaurantOrderCur h WHERE h.OrderNumber = @orderNo`);

    if (orderRes.recordset.length === 0) { console.log(`[reprintKOT] Order not found: ${orderId}`); return; }
    const orderHeader = orderRes.recordset[0];

    const itemsRes = await pool.request()
      .input('orderNo', sql.NVarChar(50), orderId)
      .query(`
        SELECT d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, 
          dish.Name as name, d.Remarks as note, d.ModifiersJSON, d.isTakeAway, d.ComboDetailsJSON,
          ISNULL(ckt.KitchenTypeName, cat.CategoryName) as KitchenTypeName,
          pm.PrinterName,
          ISNULL(NULLIF(LTRIM(RTRIM(pm.PrinterIP)), ''), LTRIM(RTRIM(pm.PrinterPath))) as PrinterIP,
          pm.IsActive as IsPrinterEnabled
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
        LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
        LEFT JOIN PrintMaster pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.PrinterType = 2 AND pm.IsActive = 1
        WHERE h.OrderNumber = @orderNo AND d.StatusCode IN (1, 2)
      `);

    const items = itemsRes.recordset;
    if (items.length === 0) { console.log(`[reprintKOT] No items to reprint for order '${orderId}'.`); return; }

    let fallbackIp = '';
    let fallbackName = 'Kitchen Printer';
    try {
      const fb = await pool.request().query(`
        SELECT TOP 1 
          ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP,
          PrinterName 
        FROM PrintMaster 
        WHERE IsActive = 1 
          AND (
            (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
            (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
          )
        ORDER BY CASE WHEN PrinterType = 2 THEN 1 WHEN PrinterType = 1 THEN 2 ELSE 3 END
      `);
      if (fb.recordset.length > 0 && fb.recordset[0].PrinterIP) {
        fallbackIp = fb.recordset[0].PrinterIP;
        fallbackName = fb.recordset[0].PrinterName || 'Kitchen Printer';
      }
    } catch (_) { }

    const groups = {};
    items.forEach(item => {
      if (item.IsPrinterEnabled === 0 || item.IsPrinterEnabled === false) return;
      const pName = item.PrinterName || fallbackName;
      const ip = item.PrinterIP || fallbackIp;
      if (!ip) return;
      if (!groups[pName]) groups[pName] = { printerName: pName, printerIp: ip, items: [] };
      groups[pName].items.push(item);
    });

    for (const [, group] of Object.entries(groups)) {
      const orderData = { orderId: orderHeader.OrderId, orderNo: orderHeader.OrderNumber, tableNo: orderHeader.tableNo, waiterName: 'QR POS', kitchenName: group.printerName };
      const thermalText = formatKOTThermalText(orderData, group.items, 'REPRINT');
      const jobId = crypto.randomUUID();
      await pool.request()
        .input('JobId', sql.UniqueIdentifier, jobId).input('StoreId', sql.NVarChar(50), 'STORE_001')
        .input('PrinterName', sql.NVarChar(100), group.printerName).input('PrinterIp', sql.NVarChar(100), group.printerIp)
        .input('PrinterPort', sql.Int, 9100).input('Content', sql.NVarChar(sql.MAX), thermalText)
        .query(`INSERT INTO PrintJobQueue (JobId,StoreId,PrinterName,PrinterIp,PrinterPort,Content,Status,CreatedOn,Attempts) VALUES (@JobId,@StoreId,@PrinterName,@PrinterIp,@PrinterPort,@Content,'PENDING',GETDATE(),0)`);
      console.log(`[reprintKOT] Queued REPRINT: Printer='${group.printerName}' IP=${group.printerIp}`);
    }

    try {
      const kdsRes = await pool.request().query(`
        SELECT TOP 1 
          ISNULL(NULLIF(LTRIM(RTRIM(PrinterIP)), ''), LTRIM(RTRIM(PrinterPath))) as PrinterIP, 
          PrinterName 
        FROM PrintMaster 
        WHERE PrinterType = 4 AND IsActive = 1 
          AND (
            (PrinterIP IS NOT NULL AND LTRIM(RTRIM(PrinterIP)) <> '') OR 
            (PrinterPath IS NOT NULL AND LTRIM(RTRIM(PrinterPath)) <> '')
          )
      `);
      if (kdsRes.recordset.length > 0) {
        const kp = kdsRes.recordset[0];
        const orderData = { orderId: orderHeader.OrderId, orderNo: orderHeader.OrderNumber, tableNo: orderHeader.tableNo, waiterName: 'QR POS', kitchenName: 'KDS' };
        const kdsThermal = formatKOTThermalText(orderData, items, 'REPRINT');
        const kdsJobId = crypto.randomUUID();
        await pool.request()
          .input('JobId', sql.UniqueIdentifier, kdsJobId).input('StoreId', sql.NVarChar(50), 'STORE_001')
          .input('PrinterName', sql.NVarChar(100), kp.PrinterName).input('PrinterIp', sql.NVarChar(100), kp.PrinterIP)
          .input('PrinterPort', sql.Int, 9100).input('Content', sql.NVarChar(sql.MAX), kdsThermal)
          .query(`INSERT INTO PrintJobQueue (JobId,StoreId,PrinterName,PrinterIp,PrinterPort,Content,Status,CreatedOn,Attempts) VALUES (@JobId,@StoreId,@PrinterName,@PrinterIp,@PrinterPort,@Content,'PENDING',GETDATE(),0)`);
        console.log(`[reprintKOT] Queued REPRINT KDS: IP=${kp.PrinterIP}`);
      }
    } catch (kdsErr) { console.error('[reprintKOT] KDS reprint error:', kdsErr.message); }

  } catch (err) {
    console.error('[reprintKOT] Error:', err.message);
  }
}

module.exports = {
  generateAndQueueKOTs,
  generateAndQueueReceipt,
  reprintKOT
};
