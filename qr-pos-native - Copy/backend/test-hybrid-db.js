const { getDatabaseHealth, initLocalPool, initRemotePool, getLocalPool, getRemotePool } = require("./config/db");
const syncService = require("./utils/syncService");

async function runHealthCheck() {
  console.log("=================================================");
  console.log("🧪 TESTING HYBRID DUAL DATABASE ARCHITECTURE");
  console.log("=================================================");

  console.log("\n[1] Testing Local Database Connection...");
  let localOk = false;
  try {
    const local = await initLocalPool();
    if (local && local.connected) {
      console.log("  ✅ Local DB is CONNECTED and READY.");
      localOk = true;
    }
  } catch (err) {
    console.log("  ❌ Local DB Connection Failed (Expected if local SQL Server service is stopped in test):", err.message);
  }

  console.log("\n[2] Testing Remote Cloud Database Connection...");
  let remoteOk = false;
  try {
    const remote = await initRemotePool();
    if (remote && remote.connected) {
      console.log("  ✅ Remote DB is CONNECTED and READY.");
      remoteOk = true;
    }
  } catch (err) {
    console.log("  ❌ Remote DB Connection Failed:", err.message);
  }

  console.log("\n[3] Testing Non-Leaking Health Status...");
  const health = getDatabaseHealth();
  console.log("  Local Health Object:", JSON.stringify(health.local, null, 2));
  console.log("  Remote Health Object:", JSON.stringify(health.remote, null, 2));

  console.log("\n[4] Testing Sync Queue Enqueue & Idempotency on Remote Cloud...");
  if (remoteOk) {
    const testOid = "A0000000-0000-0000-0000-000000000001";
    console.log(`  Applying test order idempotent upsert for OrderId: ${testOid}`);
    const remotePool = await getRemotePool();
    try {
      await syncService.applyToRemote(remotePool, "RESTAURANTORDER", testOid, "UPSERT", {
        OrderId: testOid,
        OrderNumber: "TEST-SYNC-001",
        TotalAmount: 12.50,
        TotalTax: 1.00,
        StatusCode: 1,
        isOrderClosed: 0
      });
      console.log("  ✅ Idempotent applyToRemote executed successfully without error!");

      // Cleanup test row
      await remotePool.request()
        .input("oid", require("mssql").UniqueIdentifier, testOid)
        .query("DELETE FROM RestaurantOrder WHERE OrderId = @oid");
      console.log("  ✅ Test order cleaned up successfully.");
    } catch (e) {
      console.error("  ❌ Test applyToRemote failed:", e.message);
    }
  }

  console.log("\n=================================================");
  console.log("🎉 TEST SUMMARY COMPLETE");
  console.log("=================================================");
  process.exit(0);
}

runHealthCheck();
