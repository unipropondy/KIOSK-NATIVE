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

app.get("/", (req, res) => {
  res.send("POS Backend Running");
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
const { poolPromise } = require("./config/db");
let lastDishChecksum = null;

async function checkDishChecksum() {
  try {
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
    console.error("⚠️ Error in checkDishChecksum:", err.message);
  }
}

// Start checking 5 seconds after server start, then run every 5 seconds
setTimeout(() => {
  setInterval(checkDishChecksum, 5000);
}, 5000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});