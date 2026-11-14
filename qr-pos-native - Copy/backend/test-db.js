const sql = require('mssql');
const { poolPromise } = require('./backend/config/db');

async function run() {
  const pool = await poolPromise;
  const res = await pool.request().query('SELECT TOP 10 TableId, TableNumber, TableName, isTakeAway FROM TableMaster');
  console.log(res.recordset);
  process.exit(0);
}
run();
