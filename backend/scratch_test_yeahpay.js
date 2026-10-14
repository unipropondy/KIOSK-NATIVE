require("dotenv").config({ path: ".env" });
const YeahPayService = require("./utils/yeahpayService");

async function testLiveGateway() {
  console.log("--- TESTING LIVE YEAHPAY WITH CARD+TIMESTAMP ORDER ID ---");
  const testOrderId = `CARD${Date.now()}`;
  console.log("SENDING BIZORDERID:", testOrderId);

  const res = await YeahPayService.sendRequest({
    action: "TRADE.CARD.CONSUME",
    data: {
      paymentRequest: {
        amount: "20.00",
        bizOrderId: testOrderId
      }
    },
    deviceSn: "P30224BSJ0633",
    salt: "HPIZLZA1SY2NTFHAUQ9HRSRJTWDULPUJ",
    appId: "bin38m42efz4ta6f"
  });

  console.log("LIVE GATEWAY RESULT:", JSON.stringify(res, null, 2));
}

testLiveGateway();
