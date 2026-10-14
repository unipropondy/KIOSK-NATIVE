const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../config/db");


// ================= PROMO IMAGE API =================

router.get("/promo-image", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT 
        PromoCode,
        PromoName,
        DiscountType,
        DiscountValue,
        PromoImage
      FROM PromoCodeMaster
      WHERE IsActive = 1
        AND PromoImage IS NOT NULL
      ORDER BY CreatedDate DESC
    `);

    if (result.recordset.length === 0) {
      return res.json({ success: true, promoImages: [] });
    }

    const promoImages = result.recordset.map((promo) => ({
      PromoCode: promo.PromoCode,
      PromoName: promo.PromoName,
      DiscountType: promo.DiscountType,
      DiscountValue: promo.DiscountValue,
      PromoImage: promo.PromoImage
        ? `data:image/jpeg;base64,${promo.PromoImage.toString("base64")}`
        : null,
    })).filter((p) => p.PromoImage !== null);

    console.log(`PROMO IMAGE API: returning ${promoImages.length} images`);

    res.json({ success: true, promoImages });

  } catch (err) {
    console.error("PROMO IMAGE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ✅ LOGIN API
router.post("/login", async (req, res) => {
  try {
    const username = req.body.username?.trim();
    const password = req.body.password?.trim();
    const promoCode = req.body.promoCode?.trim();

    const encodedPassword = Buffer.from(password).toString("base64");

    const pool = await poolPromise;

    const result = await pool.request()
      .input("username", sql.VarChar, username)
      .input("password", sql.VarChar, encodedPassword)
      .input("promoCode", sql.NVarChar, promoCode || "")
      .query(`
  SELECT
    U.*
FROM USERMASTER U
WHERE U.UserName = @username
AND U.UserPassword = @password
AND U.IsDisabled = 0
    
  `);

    if (result.recordset.length > 0) {
      console.log("Login Success:", result.recordset[0].UserName);
    }
    if (result.recordset.length > 0) {
      res.json({
        success: true,
        user: result.recordset[0]
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Invalid Username or Password"
      });
    }

  } catch (err) {
    console.log(err);
    res.status(500).send("Server error");
  }
});

// ✅ SIGNUP API
router.post("/signup", async (req, res) => {
  try {
    const username = req.body.username?.trim();
    const password = req.body.password?.trim();
    const phone = req.body.phone?.trim();
    const encodedPassword = Buffer.from(password).toString("base64");

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }

    const pool = await poolPromise;
    let promoAmount = 0;

    // Check if phone number already exists
    const phoneResult = await pool.request()
      .input("phone", sql.NVarChar, phone)
      .query(`
        SELECT TOP 1 MemberId
        FROM MemberMaster
        WHERE Phone = @phone
      `);

    if (phoneResult.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: "This phone number is already registered. Please use a different phone number."
      });
    }
    // Promo Code Validation
    if (req.body.promoCode && req.body.promoCode.trim() !== "") {

      const promoResult = await pool.request()
        .input("PromoCode", sql.NVarChar, req.body.promoCode.trim())
        .query(`
      SELECT *
      FROM PromoCodeMaster
      WHERE PromoCode = @PromoCode
        AND IsActive = 1
    `);

      if (promoResult.recordset.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid Promo Code"
        });
      }

      const promo = promoResult.recordset[0];

      if (promo) {
        promoAmount = promo.DiscountValue;
      }

      if (
        promo.MaxUsage !== null &&
        promo.UsedCount >= promo.MaxUsage
      ) {
        return res.status(400).json({
          success: false,
          message: "This Promo Code has already been used."
        });
      }
    }

    const userResult = await pool.request()
      .input("username", sql.VarChar, username)
      .query(`
      SELECT
          U.*,
          M.MemberId,
          M.Promocode,
          M.Promoamount,
          (
          CASE
              WHEN M.CreditLimit > 0
                  THEN M.CreditLimit - M.CurrentBalance + ISNULL(M.Promoamount, 0)
              ELSE
                  M.CurrentBalance + ISNULL(M.Promoamount, 0)
          END
      ) AS AvailableCredit
      FROM USERMASTER U
      LEFT JOIN MemberMaster M
          ON M.Name = U.UserName
      WHERE U.UserName = @username
  `);



    if (userResult.recordset.length > 0) {
      return res.status(409).json({ success: false, message: "Username already exists" });
    }

    const newUserId = require("crypto").randomUUID();
    const newUserCode = username.substring(0, 50); // Using username as UserCode (max 50 chars)

    await pool.request()
      .input("userId", sql.UniqueIdentifier, newUserId)
      .input("userCode", sql.VarChar, newUserCode)
      .input("username", sql.VarChar, username)
      .input("password", sql.VarChar, encodedPassword)
      .query(`
        INSERT INTO USERMASTER (UserId, UserCode, UserName, UserPassword, IsDisabled)
        VALUES (@userId, @userCode, @username, @password, 0)
      `);

    const memberId = require("crypto").randomUUID();
    await pool.request()
      .input("memberId", sql.UniqueIdentifier, memberId)
      .input("name", sql.NVarChar, username)
      .input("phone", sql.NVarChar, phone || "")
      .input("email", sql.NVarChar, "")
      .input("creditLimit", sql.Decimal, 0)
      .input("createdAt", sql.DateTime, new Date())
      .input("address", sql.VarChar, "")
      .input("isActive", sql.Bit, 1)
      .input("balance", sql.Decimal, 0)
      .input("currentBalance", sql.Decimal, 0)
      .input("createdBy", sql.UniqueIdentifier, newUserId)
      .input("modifiedBy", sql.UniqueIdentifier, newUserId)
      .input("modifiedDate", sql.DateTime, new Date())
      .input("lowBalanceAlertSent", sql.Bit, 0)
      .input("promoCode", sql.VarChar, req.body.promoCode || "")
      .input("promoAmount", sql.Decimal(18, 2), promoAmount)
      .query(`
        INSERT INTO MemberMaster (MemberId, Name, Phone, Email, CreditLimit, CreatedAt, Address, IsActive, Balance, CurrentBalance, CreatedBy, ModifiedBy, ModifiedDate, LowBalanceAlertSent,Promocode,
        Promoamount)
        VALUES (@memberId, @name, @phone, @email, @creditLimit, @createdAt, @address, @isActive, @balance, @currentBalance, @createdBy, @modifiedBy, @modifiedDate, @lowBalanceAlertSent, @promoCode, @promoAmount)
      `);

    if (req.body.promoCode && req.body.promoCode.trim() !== "") {
      await pool.request()
        .input("PromoCode", sql.NVarChar, req.body.promoCode.trim())
        .query(`
      UPDATE PromoCodeMaster
      SET UsedCount = UsedCount + 1
      WHERE PromoCode = @PromoCode
    `);
    }

    const newUser = await pool.request()
      .input("username", sql.VarChar, username)
      .query(`
      SELECT
          U.*,
          M.MemberId,
          M.Promocode,
          M.Promoamount,
          (
              CASE
                  WHEN M.CreditLimit > 0
                      THEN M.CreditLimit - M.CurrentBalance + ISNULL(M.Promoamount, 0)
                  ELSE
                      M.CurrentBalance + ISNULL(M.Promoamount, 0)
              END
          ) AS AvailableCredit
      FROM USERMASTER U
      LEFT JOIN MemberMaster M
          ON M.Name = U.UserName
      WHERE U.UserName = @username
  `);

    res.json({
      success: true,
      user: newUser.recordset[0]
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
