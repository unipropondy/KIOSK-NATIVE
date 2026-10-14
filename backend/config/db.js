require("dotenv").config();
const sql = require("mssql");

// MSSQL configuration using .env
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_DATABASE,

  options: {
    // encrypt: process.env.DB_ENCRYPT === "true",
    // enableArithAbort: process.env.DB_ARITH_ABORT === "true",
    encrypt: false, // 🔥 IMPORTANT
    trustServerCertificate: true, // 🔥 MUST ADD
    enableArithAbort: true,
  },

  // requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT),
   requestTimeout: 60000,
};

// Create a single connection pool
const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then(pool => {
    console.log("✅ Connected to MSSQL");
    return pool;
  })
  .catch(err => {
    console.error("❌ DB Connection Error: ", err);
    process.exit(1);
  });

module.exports = { sql, poolPromise };