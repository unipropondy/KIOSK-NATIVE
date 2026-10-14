const { poolPromise } = require("./config/db");

async function run() {
  try {
    const pool = await poolPromise;
    const res = await pool.request()
      .input("dishId", "98373187-009C-440F-A196-53A205DCA997")
      .query("SELECT DishId, Name, DishGroupId, currentcost, Description, Imageid FROM DishMaster WHERE DishId = @dishId");
    console.log("Dish matching 98373187-009C-440F-A196-53A205DCA997:", JSON.stringify(res.recordset, null, 2));

    const allDishes = await pool.request().query("SELECT TOP 5 DishId, Name, DishGroupId, currentcost, Description FROM DishMaster WHERE IsActive = 1");
    console.log("Sample active dishes:", JSON.stringify(allDishes.recordset, null, 2));

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();
