require("dotenv").config({ path: ".env" });
const crypto = require("crypto");

console.log("RAW PROCESS.ENV KEY:\n", JSON.stringify(process.env.YEAHPAY_SERVER_PUBLIC_KEY));

function sanitizePem(pemStr, type = "PUBLIC KEY") {
  if (!pemStr || typeof pemStr !== "string") return null;
  let clean = pemStr.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  
  let base64Body = clean
    .replace(/-----BEGIN[\s\S]*?-----/g, "")
    .replace(/-----END[\s\S]*?-----/g, "")
    .replace(/\s+/g, "");
    
  if (!base64Body) return null;
  
  const formattedBody = base64Body.match(/.{1,64}/g)?.join("\n") || base64Body;
  return `-----BEGIN ${type}-----\n${formattedBody}\n-----END ${type}-----`;
}

const cleanPem = sanitizePem(process.env.YEAHPAY_SERVER_PUBLIC_KEY, "PUBLIC KEY");
console.log("CLEAN PEM:\n", cleanPem);

try {
  const enc = crypto.publicEncrypt(
    {
      key: cleanPem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    },
    Buffer.from("1234567890123456")
  );
  console.log("SUCCESS, Encrypted length:", enc.length);
} catch (e) {
  console.error("FAIL:", e);
}
