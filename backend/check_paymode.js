const { poolPromise } = require("./config/db");

async function checkPaymode() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT PayMode, Description, PaymodeImage FROM PAYMODE');
    console.log(result.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkPaymode();
