const express = require("express");
const router = express.Router();
const YeahPayService = require("../utils/yeahpayService");

/**
 * 💳 YeahPay Cloud Payment Gateway Routes
 */

// POST /api/yeahpay/card-payment
router.post("/card-payment", async (req, res) => {
  try {
    const { amount, deviceSn, salt, bizOrderId } = req.body;
    console.log("💳 YeahPay Card Payment Request:", { amount, deviceSn });

    const result = await YeahPayService.processCardPayment({
      amount,
      deviceSn,
      salt,
      bizOrderId
    });

    res.json(result);
  } catch (error) {
    console.error("Card Payment Error:", error);
    res.status(500).json({ success: false, code: -1, msg: error.message });
  }
});

// POST /api/yeahpay/paynow-payment
router.post("/paynow-payment", async (req, res) => {
  try {
    const { amount, deviceSn, salt, bizOrderId } = req.body;
    console.log("📱 YeahPay PayNow Payment Request:", { amount, deviceSn });

    const result = await YeahPayService.processPayNowPayment({
      amount,
      deviceSn,
      salt,
      bizOrderId
    });

    res.json(result);
  } catch (error) {
    console.error("PayNow Payment Error:", error);
    res.status(500).json({ success: false, code: -1, msg: error.message });
  }
});

// POST /api/yeahpay/pay (Unified Kiosk Endpoint)
router.post("/pay", async (req, res) => {
  try {
    const { amount, bizOrderId, action, payWay, deviceSn, salt } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: amount"
      });
    }

    const result = await YeahPayService.processPayment({
      amount,
      bizOrderId,
      action: action || (payWay === "PAYNOW" ? "TRADE.QRCODE.PayNowPay" : "TRADE.CARD.CONSUME"),
      payWay,
      deviceSn,
      salt
    });

    res.json(result);
  } catch (err) {
    console.error("Error in /api/yeahpay/pay:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/yeahpay/query
router.post("/query", async (req, res) => {
  try {
    const { bizOrderId, deviceSn, salt } = req.body;

    if (!bizOrderId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: bizOrderId"
      });
    }

    const result = await YeahPayService.queryOrder({
      bizOrderId,
      deviceSn,
      salt
    });

    res.json(result);
  } catch (err) {
    console.error("Error in /api/yeahpay/query:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/yeahpay/cancel
router.post("/cancel", async (req, res) => {
  try {
    const { deviceSn, salt } = req.body;
    const result = await YeahPayService.cancelOperation({ deviceSn, salt });
    res.json(result);
  } catch (err) {
    console.error("Error in /api/yeahpay/cancel:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/yeahpay/config
router.get("/config", (req, res) => {
  res.json({
    enabled: true,
    name: "YeahPay Cloud POS (Thermal Buddy)",
    mockMode: process.env.YEAHPAY_MOCK_MODE === "true",
    appId: process.env.YEAHPAY_APP_ID || "bin38m42efz4ta6f",
    deviceSn: process.env.YEAHPAY_DEVICE_SN || "P30224BSJ0633",
    syncUrl: "https://business.yeahpay.sg/acceptance/acceptance-mis-pos/sync"
  });
});

module.exports = router;
