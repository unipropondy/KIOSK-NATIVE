const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const sql = require("mssql");

/**
 * Hybrid Dual Database Configuration
 * Manages separate connection pools for Local and Remote SQL Server instances.
 */

// Local Database Configuration (Local-first billing & operational transactions)
const localConfig = {
  user: process.env.LOCAL_DB_USER || process.env.DB_USER,
  password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD,
  server: (process.env.LOCAL_DB_SERVER || "localhost").replace(/\\/g, "\\\\"),
  port: process.env.LOCAL_DB_PORT ? parseInt(process.env.LOCAL_DB_PORT, 10) : 1433,
  database: process.env.LOCAL_DB_NAME || process.env.DB_NAME || "UCSPONDY_HYBRID",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  connectionTimeout: 5000,
  requestTimeout: 60000,
  pool: {
    max: 15,
    min: 1,
    idleTimeoutMillis: 30000
  }
};

// Remote Database Configuration (Centralized reporting & synchronization target)
const remoteConfig = {
  user: process.env.REMOTE_DB_USER || process.env.DB_USER,
  password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
  server: process.env.REMOTE_DB_SERVER || process.env.DB_SERVER || "myerpcloud.dyndns.org",
  port: process.env.REMOTE_DB_PORT ? parseInt(process.env.REMOTE_DB_PORT, 10) : 9199,
  database: process.env.REMOTE_DB_NAME || process.env.DB_NAME || "UCSPONDY_HYBRID",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  connectionTimeout: 8000,
  requestTimeout: 60000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let localPool = null;
let remotePool = null;

let localStatus = { connected: false, error: null, lastChecked: null };
let remoteStatus = { connected: false, error: null, lastChecked: null };

let lastLocalLogTime = 0;

/**
 * Initializes and connects to the Local Database Pool
 */
async function initLocalPool() {
  try {
    if (localPool && localPool.connected) {
      return localPool;
    }
    const pool = new sql.ConnectionPool(localConfig);
    pool.on("error", (err) => {
      localStatus = { connected: false, error: err.message, lastChecked: new Date() };
    });
    localPool = await pool.connect();
    localStatus = { connected: true, error: null, lastChecked: new Date() };
    console.log(`✅ [Local DB] Connected successfully to ${localConfig.server}:${localConfig.port}/${localConfig.database}`);
    return localPool;
  } catch (err) {
    localStatus = { connected: false, error: err.message, lastChecked: new Date() };
    const now = Date.now();
    if (now - lastLocalLogTime > 30000) {
      console.error("❌ [Local DB] Connection Failed:", err.message);
      lastLocalLogTime = now;
    }
    throw err;
  }
}

/**
 * Initializes and connects to the Remote Database Pool
 */
async function initRemotePool() {
  try {
    if (remotePool && remotePool.connected) {
      return remotePool;
    }
    const pool = new sql.ConnectionPool(remoteConfig);
    pool.on("error", (err) => {
      console.warn("⚠️ [Remote DB Pool Error]:", err.message);
      remoteStatus = { connected: false, error: err.message, lastChecked: new Date() };
    });
    remotePool = await pool.connect();
    remoteStatus = { connected: true, error: null, lastChecked: new Date() };
    console.log(`✅ [Remote DB] Connected successfully to ${remoteConfig.server}:${remoteConfig.port}/${remoteConfig.database}`);
    return remotePool;
  } catch (err) {
    remoteStatus = { connected: false, error: err.message, lastChecked: new Date() };
    console.warn("⚠️ [Remote DB] Connection Unavailable (offline/network issue):", err.message);
    return null;
  }
}

/**
 * Get Local Pool
 */
async function getLocalPool() {
  if (localPool && localPool.connected) return localPool;
  return await initLocalPool();
}

/**
 * Get Remote Pool (Safe: returns null if remote is unreachable)
 */
async function getRemotePool() {
  if (remotePool && remotePool.connected) return remotePool;
  return await initRemotePool();
}

/**
 * Legacy poolPromise compatibility:
 * Points to the operational local database pool as required by local-first architecture.
 * If local pool fails, reports clearly instead of silently switching.
 */
let lazyPoolPromise = null;
function getPoolPromise() {
  if (!lazyPoolPromise) {
    lazyPoolPromise = getLocalPool().catch(err => {
      console.error("❌ [DB Initialization] Local Database is critical and unavailable.");
      lazyPoolPromise = null; // allow retry
      throw err;
    });
  }
  return lazyPoolPromise;
}

// Support both `await poolPromise` and direct call
const poolPromise = {
  then(onFulfilled, onRejected) {
    return getPoolPromise().then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return getPoolPromise().catch(onRejected);
  }
};

/**
 * Returns health status of both database instances (without sensitive credentials)
 */
function getDatabaseHealth() {
  return {
    local: {
      server: localConfig.server,
      port: localConfig.port,
      database: localConfig.database,
      user: localConfig.user,
      connected: localStatus.connected,
      error: localStatus.error,
      lastChecked: localStatus.lastChecked
    },
    remote: {
      server: remoteConfig.server,
      port: remoteConfig.port,
      database: remoteConfig.database,
      user: remoteConfig.user,
      connected: remoteStatus.connected,
      error: remoteStatus.error,
      lastChecked: remoteStatus.lastChecked
    }
  };
}

module.exports = {
  sql,
  poolPromise,
  getLocalPool,
  getRemotePool,
  initLocalPool,
  initRemotePool,
  getDatabaseHealth,
  localConfig,
  remoteConfig
};