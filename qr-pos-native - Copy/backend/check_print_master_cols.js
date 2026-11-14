const sql = require('mssql');
const { poolPromise } = require('./config/db');

async function run() {
  const pool = await poolPromise;
  const res = await pool.request().query("SELECT TOP 1 IsActive, IsEnabled FROM PrintMaster");
  console.log(res.recordset);
  process.exit(0);
}
run();
