const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/db");
const sharp = require("sharp");

// 🚀 PERFORMANCE CACHE
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function getCached(key) {
  const item = cache.get(key);
  if (item && (Date.now() - item.time < CACHE_TTL)) {
    console.log(`⚡ [MenuCache] Cache HIT: ${key}`);
    return item.data;
  }
  console.log(`⚡ [MenuCache] Cache MISS: ${key}`);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
  console.log(`⚡ [MenuCache] Cache STORED: ${key}`);
}

/* ================= KITCHENS / CATEGORIES ================= */
router.get("/kitchens", async (req, res) => {
  try {
    const cached = getCached("kitchens");
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT cm.CategoryId, cm.CategoryName AS KitchenTypeName, ckt.KitchenTypeCode, cm.SortCode
      FROM CategoryMaster cm
      LEFT JOIN CategoryKitchenType ckt ON cm.CategoryId = ckt.CategoryId
      WHERE cm.IsActive = 1
      AND ISNULL(cm.IsPublished,0) = 0
      ORDER BY cm.SortCode ASC, cm.CategoryName ASC
    `);
    setCache("kitchens", result.recordset);
    res.json(result.recordset);
  } catch (err) {
    console.error("KITCHEN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/dishgroups/all", async (req, res) => {
  try {
    const cacheKey = "dishgroups_all";
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        DishGroupId,
        DishGroupName
      FROM DishGroupMaster
      WHERE IsActive = 1
      AND ISNULL(IsPublished,0) = 0
      ORDER BY DishGroupName ASC
    `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dishgroups/:CategoryId", async (req, res) => {
  try {
    const categoryId = req.params.CategoryId;
    const cacheKey = `dishgroups_${categoryId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("CategoryId", categoryId).query(`
        SELECT DISTINCT
              a.DishGroupId,
              a.DishGroupName,
              a.SortCode
          FROM DishGroupMaster a
          LEFT JOIN DishGroupKitchentype dkt
              ON a.DishGroupId = dkt.DishGroupId
          LEFT JOIN CategoryMaster cm
              ON cm.CategoryId = @CategoryId
          WHERE a.IsActive = 1
          AND ISNULL(a.IsPublished,0) = 0
          AND (
                a.CategoryId = @CategoryId
                OR dkt.KitchenTypeName = cm.CategoryName
          )
          ORDER BY a.SortCode ASC, a.DishGroupName ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= DISHES ================= */
router.get("/dishes/all", async (req, res) => {
  try {
    const cacheKey = "dishes_all";
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.DishId, d.Name, d.DishGroupId, d.currentcost AS Price,
        d.DishCode, d.Description,
        d.Imageid AS Image, CASE WHEN d.Imageid IS NOT NULL THEN 1 ELSE 0 END AS HasImage,
        ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
        ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
        ISNULL(d.IsCombo, 0) AS IsCombo,
        ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
        ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath AS PrinterIP
      FROM DishMaster d
      LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn 
        FROM PrintMaster WHERE IsActive = 1 AND PrinterType = 2
      ) pm ON CAST(ckt.KitchenTypeCode AS INT) = pm.KitchenTypeValue AND pm.rn = 1
      WHERE d.IsActive = 1 AND ISNULL(d.IsPublished,0) = 0 ORDER BY d.Name ASC
    `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get("/dishes/group/:DishGroupId", async (req, res) => {
  try {
    const dishGroupId = req.params.DishGroupId;
    const cacheKey = `dishes_group_${dishGroupId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("DishGroupId", dishGroupId).query(`
      SELECT DISTINCT
              d.DishId,
              d.Name,
              d.DishGroupId,
              d.currentcost AS Price,
              d.DishCode,
              d.Description,
              d.Imageid AS Image,
              CASE WHEN d.Imageid IS NOT NULL THEN 1 ELSE 0 END AS HasImage,
              ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
              ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
              ISNULL(d.IsCombo, 0) AS IsCombo,
              ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
              ISNULL(ckt.KitchenTypeCode, '2') AS KitchenTypeCode,
              ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') AS KitchenTypeName,
              pm.PrinterPath AS PrinterIP
          FROM DishMaster d
 
          LEFT JOIN DishGroupMaster dgm
              ON d.DishGroupId = dgm.DishGroupId
 
          LEFT JOIN CategoryMaster cat
              ON dgm.CategoryId = cat.CategoryId
 
          LEFT JOIN CategoryKitchenType ckt
              ON dgm.CategoryId = ckt.CategoryId
 
          LEFT JOIN DishGroupMapping dmap
              ON d.DishId = dmap.DishId
 
          LEFT JOIN (
              SELECT *,
                    ROW_NUMBER() OVER(
                        PARTITION BY KitchenTypeValue
                        ORDER BY PrinterId
                    ) AS rn
              FROM PrintMaster
              WHERE IsActive = 1
                AND PrinterType = 2
          ) pm
          ON CAST(ckt.KitchenTypeCode AS INT) = pm.KitchenTypeValue
          AND pm.rn = 1
 
          WHERE d.IsActive = 1
          AND ISNULL(d.IsPublished,0) = 0
          AND (
                d.DishGroupId = @DishGroupId
                OR dmap.DishGroupId = @DishGroupId
              )
 
          ORDER BY d.Name ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= IMAGES ================= */
class LRUImageCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.estimatedMemoryBytes = 0;
  }

  has(key) {
    const exists = this.cache.has(key);
    return exists;
  }

  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return null;
    }
    this.hits++;
    const value = this.cache.get(key);
    // Move key to the end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      const oldVal = this.cache.get(key);
      this.estimatedMemoryBytes -= oldVal.length || 0;
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first item in insertion order)
      const oldestKey = this.cache.keys().next().value;
      const oldestValue = this.cache.get(oldestKey);
      this.estimatedMemoryBytes -= oldestValue.length || 0;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, value);
    this.estimatedMemoryBytes += value.length || 0;
  }

  clear() {
    this.cache.clear();
    this.estimatedMemoryBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? ((this.hits / totalRequests) * 100).toFixed(2) + "%" : "0.00%";
    const missRate = totalRequests > 0 ? ((this.misses / totalRequests) * 100).toFixed(2) + "%" : "0.00%";

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      estimatedMemoryMb: (this.estimatedMemoryBytes / 1024 / 1024).toFixed(2) + " MB",
      hits: this.hits,
      misses: this.misses,
      hitRate,
      missRate
    };
  }
}

const imageCache = new LRUImageCache(100);
router.imageCache = imageCache;

router.get("/image/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Serve from cache if available
    const cachedBuffer = imageCache.get(imageId);
    if (cachedBuffer) {
      console.log(`⚡ [ImageCache] Cache HIT: ${imageId}`);
      res.set("Cache-Control", "public, max-age=86400");
      return res.type("image/jpeg").send(cachedBuffer);
    }

    console.log(`⚡ [ImageCache] Cache MISS: ${imageId}`);
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("Imageid", imageId)
      .query(`SELECT ImageData FROM ImageList WHERE Imageid = @Imageid`);

    if (result.recordset.length > 0 && result.recordset[0].ImageData) {
      let buffer = result.recordset[0].ImageData;

      // Compress large images (> 100KB) dynamically to prevent event loop bottlenecks
      if (buffer.length > 100 * 1024) {
        try {
          const startTime = Date.now();
          buffer = await sharp(buffer)
            .resize(400, 400, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          console.log(`⚡ [ImageCache] Compressed image ${imageId} from ${(result.recordset[0].ImageData.length / 1024).toFixed(1)}KB to ${(buffer.length / 1024).toFixed(1)}KB in ${Date.now() - startTime}ms`);
        } catch (compressErr) {
          console.error("⚠️ [ImageCache] Sharp compression failed, serving original image:", compressErr.message);
        }
      }

      imageCache.set(imageId, buffer);
      res.set("Cache-Control", "public, max-age=86400");
      res.type("image/jpeg").send(buffer);
    } else {
      res.status(404).send("Image not found");
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= MODIFIERS ================= */
router.get("/modifiers/:dishId", async (req, res) => {
  try {
    const cacheKey = `modifiers_${req.params.dishId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().input("dishId", req.params.dishId)
      .query(`
        -- 1. Direct Dish Modifiers
        SELECT dm.DishId, dm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishModifier dm 
        INNER JOIN ModifierMaster m ON dm.ModifierId = m.ModifierId
        WHERE dm.DishId = @dishId

        UNION

        -- 2. Dish Group Modifiers
        SELECT @dishId AS DishId, dgm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishMaster d
        INNER JOIN DishGroupModifier dgm ON d.DishGroupId = dgm.DishGroupId
        INNER JOIN ModifierMaster m ON dgm.ModifierId = m.ModifierId
        WHERE d.DishId = @dishId

        UNION

        -- 3. Category Modifiers
        SELECT @dishId AS DishId, cm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishMaster d
        INNER JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
        INNER JOIN CategoryModifier cm ON dg.CategoryId = cm.CategoryId
        INNER JOIN ModifierMaster m ON cm.ModifierId = m.ModifierId
        WHERE d.DishId = @dishId
        
        ORDER BY ModifierName ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/modifiers/group/:DishGroupId", async (req, res) => {
  try {
    const cacheKey = `modifiers_group_${req.params.DishGroupId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().input("DishGroupId", req.params.DishGroupId)
      .query(`
        -- 1. Direct Dish Modifiers for dishes in the group
        SELECT dm.DishId, dm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishModifier dm 
        INNER JOIN ModifierMaster m ON dm.ModifierId = m.ModifierId
        INNER JOIN DishMaster d ON dm.DishId = d.DishId
        WHERE d.DishGroupId = @DishGroupId

        UNION

        -- 2. Dish Group Modifiers for dishes in the group
        SELECT d.DishId, dgm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishMaster d
        INNER JOIN DishGroupModifier dgm ON d.DishGroupId = dgm.DishGroupId
        INNER JOIN ModifierMaster m ON dgm.ModifierId = m.ModifierId
        WHERE d.DishGroupId = @DishGroupId

        UNION

        -- 3. Category Modifiers for dishes in the group
        SELECT d.DishId, cm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
               CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
               ISNULL(m.isOpenModifier, 0) AS isOpenModifier
        FROM DishMaster d
        INNER JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
        INNER JOIN CategoryModifier cm ON dg.CategoryId = cm.CategoryId
        INNER JOIN ModifierMaster m ON cm.ModifierId = m.ModifierId
        WHERE d.DishGroupId = @DishGroupId
        
        ORDER BY ModifierName ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/checksplitdish/:DishId", async (req, res) => {
  try {

    const pool = await poolPromise;

    const result = await pool.request()
      .input("DishId", req.params.DishId)
      .query(`
        SELECT
          DishId,
          ISNULL(IsSplitDish,0) AS IsSplitDish,
            ISNULL(IsGroupDish,0) AS IsGroupDish
        FROM DishMaster
        WHERE DishId = @DishId
      `);

    res.json(result.recordset[0]);

  } catch (err) {
    console.log(err);
    res.status(500).send(err.message);
  }
});

router.get("/splitdishes", async (req, res) => {
  try {

    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        DishId,
        Name,
        CurrentCost as Price,
        songName
      FROM DishMaster
      WHERE IsSplitDish = 1
      AND IsActive = 1
      AND ISNULL(IsGroupDish,0) =0
      ORDER BY Name
    `);

    res.json(result.recordset);

  } catch (err) {
    console.log(err);
    res.status(500).send(err.message);
  }
});

function clearMenuCache() {
  cache.clear();
  console.log("⚡ [MenuCache] Cache INVALIDATION: All menu cache cleared");
  imageCache.clear();
  console.log("⚡ [ImageCache] Cache INVALIDATION: All image cache cleared");
  try {
    const comboRoutes = require("./combo");
    if (comboRoutes && typeof comboRoutes.clearCache === "function") {
      comboRoutes.clearCache();
    }
  } catch (err) {
    console.error("Failed to clear combo cache:", err.message);
  }
}

router.clearMenuCache = clearMenuCache;

router.post("/clear-cache", (req, res) => {
  clearMenuCache();
  res.json({ success: true, message: "Menu and image cache cleared successfully" });
});


/* ================= PAYMODES ================= */
router.get("/paymodes/qrs", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT PayMode, PaymodeImage FROM PAYMODE 
      WHERE PayMode IN ('PAYNOW    ', 'UPI       ')
    `);

    const qrs = {};

    result.recordset.forEach(row => {

      if (row.PayMode.trim() === 'PAYNOW') {
        qrs.paynow = row.PaymodeImage
          ? row.PaymodeImage.toString("base64")
          : "";
      }

      if (row.PayMode.trim() === 'UPI') {
        qrs.upi = row.PaymodeImage
          ? row.PaymodeImage.toString("base64")
          : "";
      }

    });

    res.json(qrs);
  } catch (err) {
    console.error("GET QRS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/paymodes/update-qr", async (req, res) => {
  try {

    const pool = await poolPromise;

    const { payMode, upiId } = req.body;

    let dbPayMode = '';

    if (payMode === 'paynow')
      dbPayMode = 'PAYNOW    ';
    else if (payMode === 'upi')
      dbPayMode = 'UPI       ';
    else
      return res.status(400).json({ error: "Invalid payMode" });

    await pool.request()
      .input("PayMode", dbPayMode)
      .input("Image", Buffer.from(upiId, "base64"))
      .query(`
        UPDATE PAYMODE
        SET PaymodeImage = @Image
        WHERE PayMode = @PayMode
      `);

    res.json({ success: true });

  } catch (err) {

    console.error("UPDATE QR ERROR:", err);

    res.status(500).json({ error: err.message });
  }
});
/* ================= COMPANY SETTINGS ================= */

router.get("/company/settings", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT TOP 1 ServiceChargePercentage,GSTPercentage
      FROM CompanySettings
    `);

    // Safely fetch Enablekotqr and EnableCombo — only if they exist in AppSettings
    let enableKotQr = 0;
    let enableCombo = 0;
    try {
      const colCheck = await pool.request().query(`
        SELECT 
          (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'Enablekotqr') AS cntKot,
          (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableCombo') AS cntCombo
      `);
      let queryCols = [];
      if (colCheck.recordset[0]?.cntKot > 0) queryCols.push("Enablekotqr");
      if (colCheck.recordset[0]?.cntCombo > 0) queryCols.push("EnableCombo");

      if (queryCols.length > 0) {
        const appSettings = await pool.request().query(`
          SELECT TOP 1 ${queryCols.join(", ")} FROM AppSettings
        `);
        if (queryCols.includes("Enablekotqr")) {
          enableKotQr = Number(appSettings.recordset[0]?.Enablekotqr || 0);
        }
        if (queryCols.includes("EnableCombo")) {
          enableCombo = Number(appSettings.recordset[0]?.EnableCombo || 0);
        }
      }
    } catch (e) {
      console.warn("[company/settings] AppSettings check failed:", e.message);
    }

    const data = result.recordset[0] || {
      ServiceChargePercentage: 0,
      GSTPercentage: 0
    };

    data.Enablekotqr = enableKotQr;
    data.EnableCombo = enableCombo;

    res.json(data);

  } catch (err) {
    console.error("COMPANY SETTINGS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= APP SETTINGS ================= */
router.get("/app-settings", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT TOP 1 enablelogin AS EnableLogin
      FROM AppSettings
    `);

    res.json({
      success: true,
      enableLogin: Number(result.recordset[0]?.EnableLogin || 0)
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
