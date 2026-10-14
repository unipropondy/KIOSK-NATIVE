const sql = require("mssql");
const { poolPromise } = require("./config/db");

async function cleanup() {
  try {
    const pool = await poolPromise;
    console.log("Cleaning up duplicates from RestaurantOrderDetailCur...");
    
    const res1 = await pool.request().query(`
      WITH CTE AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY OrderId, DishId, CAST(ModifiersJSON AS NVARCHAR(MAX)), StatusCode
          ORDER BY CreatedOn ASC
        ) as rn
        FROM RestaurantOrderDetailCur
      )
      DELETE FROM CTE WHERE rn > 1;
    `);
    console.log("Removed from RestaurantOrderDetailCur:", res1.rowsAffected[0]);

    console.log("Cleaning up duplicates from SettlementItemDetail...");
    const res2 = await pool.request().query(`
      WITH CTE2 AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY SettlementID, DishId, Qty
          ORDER BY OrderDateTime ASC
        ) as rn
        FROM SettlementItemDetail
      )
      DELETE FROM CTE2 WHERE rn > 1;
    `);
    console.log("Removed from SettlementItemDetail:", res2.rowsAffected[0]);

    console.log("Cleanup complete!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

cleanup();
