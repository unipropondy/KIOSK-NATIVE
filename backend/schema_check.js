const sql = require("mssql");
require("dotenv").config();
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_DATABASE,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 60000
};
(async () => {
  const pool = await sql.connect(config);
  const tables = ["SettlementHeader","RestaurantOrderDetailCur","RestaurantOrderCur","RestaurantInvoiceCur","SettlementItemDetail","DateEntry"];
  for (const table of tables) {
    const q = "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + table + "' ORDER BY ORDINAL_POSITION";
    const result = await pool.request().query(q);
    console.log("TABLE:", table);
    console.log(result.recordset.map(r => `${r.COLUMN_NAME} (${r.DATA_TYPE}${r.IS_NULLABLE === "YES" ? ", nullable" : ""})`).join("\n") || "NO COLUMNS");
    console.log("---");
  }
  await pool.close();
})().catch(err => { console.error(err); process.exit(1); });
