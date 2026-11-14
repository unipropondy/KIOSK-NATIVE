const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Pass io object to req so routers can emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors());
app.use(express.json());

const posRoutes = require("./routes/posRoutes");

app.use("/api", posRoutes);

const orderRoutes = require("./routes/order");

app.use("/api/order", orderRoutes);

const salesRoutes = require("./routes/sales");
app.use("/api/sales", salesRoutes);

const printJobsRoutes = require("./routes/printJobs");
app.use("/api/print-jobs", printJobsRoutes);

const comboRoutes = require("./routes/combo");
app.use("/api/combo", comboRoutes);

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const yeahpayRoutes = require("./routes/yeahpayRoutes");
app.use("/api/yeahpay", yeahpayRoutes);

// 🌐 Hybrid Database & Sync Status Monitoring Endpoint
const { getDatabaseHealth, initLocalPool, initRemotePool, poolPromise } = require("./config/db");
const syncService = require("./utils/syncService");

app.get("/api/db-status", async (req, res) => {
  const dbHealth = getDatabaseHealth();
  const syncStatus = await syncService.getStatus();
  res.json({
    status: dbHealth.local.connected ? "HEALTHY" : "LOCAL_UNAVAILABLE",
    databases: dbHealth,
    sync: syncStatus,
    timestamp: new Date().toISOString()
  });
});

// Trigger manual sync cycle
app.post("/api/sync/trigger", async (req, res) => {
  try {
    await syncService.syncCycle();
    const status = await syncService.getStatus();
    res.json({ success: true, message: "Sync cycle initiated", sync: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("POS Backend Running (Hybrid Dual Database Mode)");
});

const PORT = process.env.PORT || 3000;

// Expose io on app so routes can use app.get("io") for room-targeted emissions
app.set("io", io);

io.on("connection", (socket) => {
  console.log("🔌 New Socket.IO Client Connected:", socket.id);

  // Client sends { tableId } to subscribe to a table-specific room
  socket.on("join_table", ({ tableId } = {}) => {
    if (tableId) {
      const room = `table:${String(tableId).toLowerCase().trim()}`;
      socket.join(room);
      console.log(`📡 Socket ${socket.id} joined room: ${room}`);
    }
  });

  socket.on("leave_table", ({ tableId } = {}) => {
    if (tableId) {
      const room = `table:${String(tableId).toLowerCase().trim()}`;
      socket.leave(room);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔌 Socket.IO Client Disconnected:", socket.id);
  });
});

// 🔄 Auto-detect Database Dish Updates and Invalidate Cache
let lastDishChecksum = null;

async function checkDishChecksum() {
  try {
    const { getDatabaseHealth } = require("./config/db");
    if (!getDatabaseHealth().local.connected) {
      return; // Skip checksum check when local DB is not connected
    }
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT CHECKSUM_AGG(BINARY_CHECKSUM(DishId, Name, currentcost, IsActive, IsSoldOut)) AS ChecksumVal
      FROM DishMaster
    `);
    const currentChecksum = result.recordset[0]?.ChecksumVal;
    
    if (lastDishChecksum !== null && lastDishChecksum !== currentChecksum) {
      console.log(`🔄 DishMaster changed (checksum: ${lastDishChecksum} -> ${currentChecksum}). Invalidating cache and notifying clients...`);
      // Clear posRoutes cache
      posRoutes.clearMenuCache();
      // Emit socket event to all clients
      io.emit("menu_updated");
    }
    lastDishChecksum = currentChecksum;
  } catch (err) {
    // Non-fatal if menu check fails intermittently
  }
}

// Start checking 5 seconds after server start, then run every 5 seconds
setTimeout(() => {
  setInterval(checkDishChecksum, 5000);
}, 5000);

// 🚀 Graceful startup: Validate databases and start sync service
async function startServer() {
  console.log("=========================================");
  console.log("🔄 Starting POS Hybrid Dual Database System");
  console.log("=========================================");

  // 1. Check Local DB
  try {
    await initLocalPool();
    console.log("✅ Local Database: OPERATIONAL (Ready for offline/local transactions)");
  } catch (err) {
    console.error("❌ CRITICAL: Local Database is NOT accessible! Normal billing cannot operate locally.");
    console.error("   Details:", err.message);
  }

  // 2. Check Remote DB (Non-blocking)
  try {
    const remote = await initRemotePool();
    if (remote) {
      console.log("✅ Remote Database: CONNECTED (Sync target available)");
    } else {
      console.warn("⚠️ Remote Database: OFFLINE / UNREACHABLE (Operating in Local Offline Mode)");
    }
  } catch (err) {
    console.warn("⚠️ Remote Database: OFFLINE / UNREACHABLE (Operating in Local Offline Mode)");
  }

  // 3. Start background sync service
  syncService.start();

  server.listen(PORT, () => {
    console.log(`🚀 POS Server running on port ${PORT}`);
  });
}

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log("\n🛑 Gracefully shutting down...");
  syncService.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Gracefully terminating...");
  syncService.stop();
  process.exit(0);
});

startServer();