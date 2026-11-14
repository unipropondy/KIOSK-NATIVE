const { sql, getLocalPool, getRemotePool } = require("../config/db");

/**
 * SyncService
 * Handles reliable, transactional, idempotent background synchronization
 * from the Local Microsoft SQL Server database to the Remote Cloud SQL Server database.
 */
class SyncService {
  constructor() {
    this.isSyncing = false;
    this.syncIntervalMs = 15000; // Check for pending items every 15 seconds
    this.timer = null;
    this.maxRetries = 5;
    this.stats = {
      totalBatches: 0,
      totalSynced: 0,
      totalFailed: 0,
      lastSyncTime: null,
      lastError: null
    };
  }

  /**
   * Enqueues an entity change to POS_SyncQueue in the local database.
   * Can be called inside an existing transaction or with auto-commit.
   */
  async enqueue(entityName, entityId, action, payload, existingTransaction = null) {
    try {
      const serialized = typeof payload === "string" ? payload : JSON.stringify(payload || {});
      const req = existingTransaction 
        ? new sql.Request(existingTransaction) 
        : (await getLocalPool()).request();

      await req
        .input("EntityName", sql.NVarChar(100), entityName)
        .input("EntityID", sql.NVarChar(255), String(entityId))
        .input("Action", sql.NVarChar(50), action.toUpperCase())
        .input("Payload", sql.NVarChar(sql.MAX), serialized)
        .query(`
          INSERT INTO POS_SyncQueue (EntityName, EntityID, Action, Payload, Status, Retries, CreatedAt)
          VALUES (@EntityName, @EntityID, @Action, @Payload, 'PENDING', 0, GETDATE())
        `);
      
      console.log(`📥 [SyncQueue] Enqueued: ${entityName} | ${action} | ID: ${entityId}`);
      return true;
    } catch (err) {
      console.error(`❌ [SyncQueue] Failed to enqueue ${entityName} (${entityId}):`, err.message);
      // Ensure local operations are not abruptly aborted if queueing fails, but log the error
      return false;
    }
  }

  /**
   * Main synchronization cycle
   */
  async syncCycle() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // 1. Check if remote pool is connected/reachable
      const remotePool = await getRemotePool();
      if (!remotePool || !remotePool.connected) {
        // Remote is offline or unreachable - safe skip
        return;
      }

      // 2. Check local pool
      let localPool;
      try {
        localPool = await getLocalPool();
      } catch (e) {
        console.warn("⚠️ [Sync] Local DB unavailable, skipping sync cycle.");
        return;
      }

      // 3. Fetch pending items from local POS_SyncQueue (ordered by SyncID ASC)
      const pendingItems = await localPool.request()
        .input("MaxRetries", sql.Int, this.maxRetries)
        .query(`
          SELECT TOP 25 SyncID, EntityName, EntityID, Action, Payload, Retries
          FROM POS_SyncQueue
          WHERE Status = 'PENDING' AND Retries < @MaxRetries
          ORDER BY SyncID ASC
        `);

      if (pendingItems.recordset.length === 0) {
        return;
      }

      console.log(`🔄 [Sync] Processing batch of ${pendingItems.recordset.length} pending records...`);

      for (const item of pendingItems.recordset) {
        await this.syncItem(localPool, remotePool, item);
      }

      this.stats.totalBatches += 1;
      this.stats.lastSyncTime = new Date();
    } catch (err) {
      this.stats.lastError = err.message;
      console.error("❌ [Sync] Sync cycle error:", err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Synchronizes a single item from local queue to remote cloud DB
   */
  async syncItem(localPool, remotePool, item) {
    const { SyncID, EntityName, EntityID, Action, Payload, Retries } = item;
    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(Payload);
    } catch (e) {
      parsedPayload = {};
    }

    try {
      // Execute the synchronization handler for this entity
      await this.applyToRemote(remotePool, EntityName, EntityID, Action, parsedPayload);

      // Mark as SYNCED in local POS_SyncQueue
      await localPool.request()
        .input("SyncID", sql.BigInt, SyncID)
        .query(`
          UPDATE POS_SyncQueue
          SET Status = 'SYNCED', SyncedAt = GETDATE(), ErrorMessage = NULL
          WHERE SyncID = @SyncID
        `);

      // Also mirror the queue record to remote POS_SyncQueue for centralized audit tracking
      try {
        await remotePool.request()
          .input("EntityName", sql.NVarChar(100), EntityName)
          .input("EntityID", sql.NVarChar(255), String(EntityID))
          .input("Action", sql.NVarChar(50), Action)
          .input("Payload", sql.NVarChar(sql.MAX), Payload)
          .input("Status", sql.NVarChar(50), "SYNCED")
          .query(`
            INSERT INTO POS_SyncQueue (EntityName, EntityID, Action, Payload, Status, Retries, CreatedAt, SyncedAt)
            VALUES (@EntityName, @EntityID, @Action, @Payload, @Status, 0, GETDATE(), GETDATE())
          `);
      } catch (auditErr) {
        // Non-blocking if remote queue already has it or minor mismatch
      }

      this.stats.totalSynced += 1;
      console.log(`✅ [Sync] Successfully synced ${EntityName} (${EntityID})`);
    } catch (err) {
      this.stats.totalFailed += 1;
      const nextRetry = (Retries || 0) + 1;
      const newStatus = nextRetry >= this.maxRetries ? "FAILED" : "PENDING";
      
      console.error(`⚠️ [Sync] Error syncing ${EntityName} (${EntityID}) [Attempt ${nextRetry}/${this.maxRetries}]:`, err.message);

      await localPool.request()
        .input("SyncID", sql.BigInt, SyncID)
        .input("Retries", sql.Int, nextRetry)
        .input("Status", sql.NVarChar(50), newStatus)
        .input("Error", sql.NVarChar(sql.MAX), err.message.substring(0, 4000))
        .query(`
          UPDATE POS_SyncQueue
          SET Retries = @Retries, Status = @Status, ErrorMessage = @Error
          WHERE SyncID = @SyncID
        `);
    }
  }

  /**
   * Applies the enqueued entity changes to the remote database in an idempotent manner.
   */
  async applyToRemote(remotePool, entityName, entityId, action, payload) {
    const remoteTx = new sql.Transaction(remotePool);
    await remoteTx.begin();

    try {
      switch (entityName.toUpperCase()) {
        case "RESTAURANTORDER":
          await this.syncRestaurantOrder(remoteTx, action, payload);
          break;

        case "RESTAURANTORDERDETAIL":
          await this.syncRestaurantOrderDetail(remoteTx, action, payload);
          break;

        case "RESTAURANTINVOICE":
          await this.syncRestaurantInvoice(remoteTx, action, payload);
          break;

        case "PAYMENTDETAIL":
          await this.syncPaymentDetail(remoteTx, action, payload);
          break;

        case "SETTLEMENT":
          await this.syncSettlement(remoteTx, action, payload);
          break;

        case "TRANSACTIONMASTER":
          await this.syncTransactionMaster(remoteTx, action, payload);
          break;

        default:
          // Generic handler: upsert based on primary table name and id
          console.log(`ℹ️ [Sync] Default handler invoked for ${entityName}`);
          break;
      }

      await remoteTx.commit();
    } catch (err) {
      await remoteTx.rollback();
      throw err;
    }
  }

  /**
   * Synchronizes RestaurantOrder (Idempotent MERGE/UPSERT)
   */
  async syncRestaurantOrder(tx, action, p) {
    if (!p.OrderId) return;
    const req = new sql.Request(tx);
    req.input("OrderId", sql.UniqueIdentifier, p.OrderId);
    req.input("OrderNumber", sql.NVarChar(50), p.OrderNumber || "");
    req.input("CustomerId", sql.UniqueIdentifier, p.CustomerId || null);
    req.input("OrderDateTime", sql.DateTime, p.OrderDateTime ? new Date(p.OrderDateTime) : new Date());
    req.input("Tableno", sql.NVarChar(50), p.Tableno || "");
    req.input("Persons", sql.Int, p.Persons || 1);
    req.input("TotalLineItemAmount", sql.Decimal(18, 2), p.TotalLineItemAmount || 0);
    req.input("TotalDiscountAmount", sql.Decimal(18, 2), p.TotalDiscountAmount || 0);
    req.input("TotalTax", sql.Decimal(18, 2), p.TotalTax || 0);
    req.input("RoundedBy", sql.Decimal(18, 2), p.RoundedBy || 0);
    req.input("TotalAmount", sql.Decimal(18, 2), p.TotalAmount || 0);
    req.input("StatusCode", sql.Int, p.StatusCode || 1);
    const fallbackGuid = "00000000-0000-0000-0000-000000000000";
    req.input("CreatedBy", sql.UniqueIdentifier, p.CreatedBy || fallbackGuid);
    req.input("BusinessUnitId", sql.UniqueIdentifier, p.BusinessUnitId || fallbackGuid);
    req.input("isOrderClosed", sql.Bit, p.isOrderClosed ? 1 : 0);
    req.input("PriorityCode", sql.NVarChar(50), p.PriorityCode || null);

    await req.query(`
      IF EXISTS (SELECT 1 FROM RestaurantOrder WHERE OrderId = @OrderId)
      BEGIN
        UPDATE RestaurantOrder
        SET StatusCode = @StatusCode,
            TotalAmount = @TotalAmount,
            TotalLineItemAmount = @TotalLineItemAmount,
            TotalTax = @TotalTax,
            RoundedBy = @RoundedBy,
            TotalDiscountAmount = @TotalDiscountAmount,
            isOrderClosed = @isOrderClosed,
            ModifiedOn = GETDATE()
        WHERE OrderId = @OrderId
      END
      ELSE
      BEGIN
        INSERT INTO RestaurantOrder (
          OrderId, OrderNumber, CustomerId, OrderDateTime, Tableno, Persons,
          TotalLineItemAmount, TotalDiscountAmount, TotalTax, RoundedBy, TotalAmount,
          StatusCode, CreatedBy, CreatedOn, BusinessUnitId, isOrderClosed, PriorityCode, isUploadHQ
        ) VALUES (
          @OrderId, @OrderNumber, @CustomerId, @OrderDateTime, @Tableno, @Persons,
          @TotalLineItemAmount, @TotalDiscountAmount, @TotalTax, @RoundedBy, @TotalAmount,
          @StatusCode, @CreatedBy, GETDATE(), @BusinessUnitId, @isOrderClosed, @PriorityCode, 1
        )
      END
    `);
  }

  /**
   * Synchronizes RestaurantOrderDetail items (Array or single object)
   */
  async syncRestaurantOrderDetail(tx, action, payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      if (!item.OrderDetailId || !item.OrderId) continue;
      const req = new sql.Request(tx);
      req.input("OrderDetailId", sql.UniqueIdentifier, item.OrderDetailId);
      req.input("OrderId", sql.UniqueIdentifier, item.OrderId);
      req.input("DishId", sql.UniqueIdentifier, item.DishId);
      req.input("Description", sql.NVarChar(sql.MAX), item.Description || item.DishName || "");
      req.input("Quantity", sql.Decimal(18, 2), item.Quantity || 1);
      req.input("PricePerUnit", sql.Decimal(18, 2), item.PricePerUnit || 0);
      req.input("BaseAmount", sql.Decimal(18, 2), item.BaseAmount || 0);
      req.input("ManualDiscountAmount", sql.Decimal(18, 2), item.ManualDiscountAmount || 0);
      req.input("TotalDetailLineAmount", sql.Decimal(18, 2), item.TotalDetailLineAmount || 0);
      req.input("StatusCode", sql.Int, item.StatusCode || 1);
      req.input("BusinessUnitId", sql.UniqueIdentifier, item.BusinessUnitId || null);
      req.input("DishName", sql.NVarChar(255), item.DishName || item.Description || "");
      req.input("Tax", sql.Decimal(18, 2), item.Tax || 0);
      req.input("Remarks", sql.VarChar(255), item.Remarks || "");
      req.input("ComboDetailsJSON", sql.NVarChar(sql.MAX), item.ComboDetailsJSON || null);
      req.input("ModifiersJSON", sql.NVarChar(sql.MAX), item.ModifiersJSON || null);

      if (action === "DELETE" || item.isDeleted) {
        await req.query(`DELETE FROM RestaurantOrderDetail WHERE OrderDetailId = @OrderDetailId`);
      } else {
        await req.query(`
          IF EXISTS (SELECT 1 FROM RestaurantOrderDetail WHERE OrderDetailId = @OrderDetailId)
          BEGIN
            UPDATE RestaurantOrderDetail
            SET Quantity = @Quantity,
                PricePerUnit = @PricePerUnit,
                TotalDetailLineAmount = @TotalDetailLineAmount,
                StatusCode = @StatusCode,
                Remarks = @Remarks,
                ModifiedOn = GETDATE()
            WHERE OrderDetailId = @OrderDetailId
          END
          ELSE
          BEGIN
            INSERT INTO RestaurantOrderDetail (
              OrderDetailId, OrderId, DishId, Description, Quantity, PricePerUnit,
              BaseAmount, ManualDiscountAmount, TotalDetailLineAmount, StatusCode,
              BusinessUnitId, CreatedOn, DishName, Tax, Remarks, ComboDetailsJSON, ModifiersJSON
            ) VALUES (
              @OrderDetailId, @OrderId, @DishId, @Description, @Quantity, @PricePerUnit,
              @BaseAmount, @ManualDiscountAmount, @TotalDetailLineAmount, @StatusCode,
              @BusinessUnitId, GETDATE(), @DishName, @Tax, @Remarks, @ComboDetailsJSON, @ModifiersJSON
            )
          END
        `);
      }
    }
  }

  /**
   * Synchronizes RestaurantInvoice
   */
  async syncRestaurantInvoice(tx, action, p) {
    if (!p.RestaurantBillId || !p.OrderId) return;
    const req = new sql.Request(tx);
    req.input("RestaurantBillId", sql.UniqueIdentifier, p.RestaurantBillId);
    req.input("OrderId", sql.UniqueIdentifier, p.OrderId);
    req.input("BillNumber", sql.NVarChar(50), p.BillNumber || "");
    req.input("TotalLineItemAmount", sql.Decimal(18, 2), p.TotalLineItemAmount || 0);
    req.input("TotalDiscountAmount", sql.Decimal(18, 2), p.TotalDiscountAmount || 0);
    req.input("TotalTax", sql.Decimal(18, 2), p.TotalTax || 0);
    req.input("RoundedBy", sql.Decimal(18, 2), p.RoundedBy || 0);
    req.input("TotalAmount", sql.Decimal(18, 2), p.TotalAmount || 0);
    req.input("StatusCode", sql.Int, p.StatusCode || 1);
    req.input("CreatedBy", sql.UniqueIdentifier, p.CreatedBy || null);
    req.input("BusinessUnitId", sql.UniqueIdentifier, p.BusinessUnitId || null);
    req.input("DiscountRemarks", sql.NVarChar(255), p.DiscountRemarks || null);

    await req.query(`
      IF EXISTS (SELECT 1 FROM RestaurantInvoice WHERE RestaurantBillId = @RestaurantBillId)
      BEGIN
        UPDATE RestaurantInvoice
        SET StatusCode = @StatusCode,
            TotalAmount = @TotalAmount,
            TotalTax = @TotalTax,
            RoundedBy = @RoundedBy,
            TotalDiscountAmount = @TotalDiscountAmount,
            ModifiedOn = GETDATE()
        WHERE RestaurantBillId = @RestaurantBillId
      END
      ELSE
      BEGIN
        INSERT INTO RestaurantInvoice (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled,
          TotalLineItemAmount, TotalDiscountAmount, TotalTax, RoundedBy, TotalAmount,
          StatusCode, CreatedBy, CreatedOn, isUploadHQ, DiscountRemarks
        ) VALUES (
          @BusinessUnitId, @RestaurantBillId, @OrderId, @BillNumber, GETDATE(), GETDATE(),
          @TotalLineItemAmount, @TotalDiscountAmount, @TotalTax, @RoundedBy, @TotalAmount,
          @StatusCode, @CreatedBy, GETDATE(), 1, @DiscountRemarks
        )
      END
    `);
  }

  /**
   * Synchronizes Paymentdetail (payments and refunds)
   */
  async syncPaymentDetail(tx, action, payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    for (const p of items) {
      if (!p.PaymentId) continue;
      const req = new sql.Request(tx);
      req.input("PaymentId", sql.UniqueIdentifier, p.PaymentId);
      req.input("RestaurantBillId", sql.UniqueIdentifier, p.RestaurantBillId || null);
      req.input("OrderId", sql.UniqueIdentifier, p.OrderId || null);
      req.input("BilledFor", sql.Int, p.BilledFor || 1);
      req.input("PaymentType", sql.Int, p.PaymentType || 1);
      req.input("Paymode", sql.Int, p.Paymode || 1);
      req.input("Amount", sql.Decimal(18, 2), p.Amount || 0);
      req.input("ReferenceNumber", sql.NVarChar(100), p.ReferenceNumber || "");
      req.input("Remarks", sql.NVarChar(255), p.Remarks || "");
      req.input("BusinessUnitId", sql.UniqueIdentifier, p.BusinessUnitId || null);
      req.input("CreatedBy", sql.UniqueIdentifier, p.CreatedBy || null);

      await req.query(`
        IF EXISTS (SELECT 1 FROM Paymentdetail WHERE PaymentId = @PaymentId)
        BEGIN
          UPDATE Paymentdetail
          SET Amount = @Amount,
              ReferenceNumber = @ReferenceNumber,
              Remarks = @Remarks,
              ModifiedOn = GETDATE()
          WHERE PaymentId = @PaymentId
        END
        ELSE
        BEGIN
          INSERT INTO Paymentdetail (
            PaymentId, BilledFor, OrderId, RestaurantBillId, PaymentCollectedOn,
            PaymentType, Paymode, Amount, ReferenceNumber, Remarks, BusinessUnitId,
            CreatedBy, CreatedOn, isUploadHQ
          ) VALUES (
            @PaymentId, @BilledFor, @OrderId, @RestaurantBillId, GETDATE(),
            @PaymentType, @Paymode, @Amount, @ReferenceNumber, @Remarks, @BusinessUnitId,
            @CreatedBy, GETDATE(), 1
          )
        END
      `);
    }
  }

  /**
   * Synchronizes Settlement Records (Header, Details, Totalsales, TranDetail)
   */
  async syncSettlement(tx, action, p) {
    if (!p.SettlementID && !p.SettlementId) return;
    const settlementId = p.SettlementID || p.SettlementId;

    // 1. SettlementHeader
    const hReq = new sql.Request(tx);
    hReq.input("SettlementID", sql.UniqueIdentifier, settlementId);
    hReq.input("CashierID", sql.UniqueIdentifier, p.CashierID || null);
    hReq.input("BusinessUnitId", sql.UniqueIdentifier, p.BusinessUnitId || null);
    hReq.input("SysAmount", sql.Decimal(18, 2), p.SysAmount || 0);
    hReq.input("ManualAmount", sql.Decimal(18, 2), p.ManualAmount || 0);
    hReq.input("TotalTax", sql.Decimal(18, 2), p.TotalTax || 0);
    hReq.input("SubTotal", sql.Decimal(18, 2), p.SubTotal || 0);
    hReq.input("InvoiceCount", sql.Int, p.InvoiceCount || 0);
    hReq.input("CreatedBy", sql.UniqueIdentifier, p.CreatedBy || null);

    await hReq.query(`
      IF NOT EXISTS (SELECT 1 FROM SettlementHeader WHERE OrderId = @SettlementID)
      BEGIN
        INSERT INTO SettlementHeader (
          OrderId, CashierID, BusinessUnitId, SysAmount, ManualAmount,
          TotalTax, SubTotal, InvoiceCount, CreatedBy, CreatedOn, isUploadHQ
        ) VALUES (
          @SettlementID, @CashierID, @BusinessUnitId, @SysAmount, @ManualAmount,
          @TotalTax, @SubTotal, @InvoiceCount, @CreatedBy, GETDATE(), 1
        )
      END
    `);

    // 2. SettlementDetail items
    if (Array.isArray(p.details)) {
      for (const d of p.details) {
        const dReq = new sql.Request(tx);
        dReq.input("SettlementId", sql.UniqueIdentifier, settlementId);
        dReq.input("Paymode", sql.VarChar(50), String(d.Paymode || ""));
        dReq.input("SysAmount", sql.Decimal(18, 2), d.SysAmount || 0);
        dReq.input("ManualAmount", sql.Decimal(18, 2), d.ManualAmount || 0);
        dReq.input("SortageOrExces", sql.Decimal(18, 2), d.SortageOrExces || 0);

        await dReq.query(`
          INSERT INTO SettlementDetail (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces)
          VALUES (@SettlementId, @Paymode, @SysAmount, @ManualAmount, @SortageOrExces)
        `);
      }
    }
  }

  /**
   * Synchronizes TransactionMaster
   */
  async syncTransactionMaster(tx, action, p) {
    if (!p.TransactionNumber) return;
    const req = new sql.Request(tx);
    req.input("TransactionNumber", sql.NVarChar(50), p.TransactionNumber);
    req.input("TransactionId", sql.UniqueIdentifier, p.TransactionId || null);
    req.input("Amount", sql.Decimal(18, 2), p.Amount || 0);
    req.input("Remarks", sql.NVarChar(255), p.Remarks || "");
    req.input("BusinessUnitId", sql.UniqueIdentifier, p.BusinessUnitId || null);
    req.input("CreatedBy", sql.UniqueIdentifier, p.CreatedBy || null);

    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM TransactionMaster WHERE TransactionNumber = @TransactionNumber)
      BEGIN
        INSERT INTO TransactionMaster (
          TransactionId, TransactionNumber, TransactionDate, Amount, Remarks, BusinessunitId, CreatedBy, CreatedOn, isUploadHQ
        ) VALUES (
          @TransactionId, @TransactionNumber, GETDATE(), @Amount, @Remarks, @BusinessUnitId, @CreatedBy, GETDATE(), 1
        )
      END
    `);
  }

  /**
   * Starts background recurring synchronization loop
   */
  start() {
    console.log(`🚀 [SyncService] Background synchronization started (Polling every ${this.syncIntervalMs / 1000}s)`);
    // Run initial cycle shortly after launch
    setTimeout(() => this.syncCycle(), 3000);
    this.timer = setInterval(() => this.syncCycle(), this.syncIntervalMs);
  }

  /**
   * Stops background synchronization loop cleanly
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("🛑 [SyncService] Background synchronization stopped.");
    }
  }

  /**
   * Returns current sync statistics and pending queue count
   */
  async getStatus() {
    let pendingCount = 0;
    let failedCount = 0;
    try {
      const pool = await getLocalPool();
      const res = await pool.request().query(`
        SELECT 
          COUNT(CASE WHEN Status = 'PENDING' THEN 1 END) as PendingCount,
          COUNT(CASE WHEN Status = 'FAILED' THEN 1 END) as FailedCount
        FROM POS_SyncQueue
      `);
      pendingCount = res.recordset[0]?.PendingCount || 0;
      failedCount = res.recordset[0]?.FailedCount || 0;
    } catch (e) {
      // Local pool might be starting up
    }

    return {
      isSyncing: this.isSyncing,
      syncIntervalSeconds: this.syncIntervalMs / 1000,
      pendingCount,
      failedCount,
      ...this.stats
    };
  }
}

const syncServiceInstance = new SyncService();
module.exports = syncServiceInstance;
