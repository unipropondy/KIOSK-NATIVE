const crypto = require("crypto");

function sanitizePem(pemStr, type = "PUBLIC KEY") {
  if (!pemStr || typeof pemStr !== "string") return null;
  let clean = pemStr.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  
  if (/^[0-9a-fA-F]+$/.test(clean)) {
    return null; // Hex modulus, not base64 PEM
  }

  let base64Body = clean
    .replace(/-----BEGIN[\s\S]*?-----/g, "")
    .replace(/-----END[\s\S]*?-----/g, "")
    .replace(/\s+/g, "");
    
  if (!base64Body || base64Body.length < 30) return null;
  
  const formattedBody = base64Body.match(/.{1,64}/g)?.join("\n") || base64Body;
  return `-----BEGIN ${type}-----\n${formattedBody}\n-----END ${type}-----`;
}

function getPemPublicKey(keyInput, exponentDecimal = "65537") {
  if (!keyInput) return null;
  const sanitized = sanitizePem(keyInput, "PUBLIC KEY");
  if (sanitized) return sanitized;
  try {
    const modBuf = Buffer.from(keyInput, "hex");
    const expBuf = Buffer.from(Number(exponentDecimal).toString(16), "hex");

    const encodeLen = (len) => {
      if (len < 128) return Buffer.from([len]);
      const hex = len.toString(16);
      const lenOfLen = Math.ceil(hex.length / 2);
      const buf = Buffer.alloc(1 + lenOfLen);
      buf[0] = 0x80 | lenOfLen;
      buf.write(hex.padStart(lenOfLen * 2, "0"), 1, "hex");
      return buf;
    };

    const modDer = Buffer.concat([
      Buffer.from([0x02]),
      encodeLen(modBuf[0] & 0x80 ? modBuf.length + 1 : modBuf.length),
      modBuf[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), modBuf]) : modBuf
    ]);

    const expDer = Buffer.concat([
      Buffer.from([0x02]),
      encodeLen(expBuf.length),
      expBuf
    ]);

    const seqDer = Buffer.concat([
      Buffer.from([0x30]),
      encodeLen(modDer.length + expDer.length),
      modDer,
      expDer
    ]);

    const bitStrDer = Buffer.concat([
      Buffer.from([0x03]),
      encodeLen(seqDer.length + 1),
      Buffer.from([0x00]),
      seqDer
    ]);

    const rsaOidDer = Buffer.from("300d06092a864886f70d0101010500", "hex");

    const topSeqDer = Buffer.concat([
      Buffer.from([0x30]),
      encodeLen(rsaOidDer.length + bitStrDer.length),
      rsaOidDer,
      bitStrDer
    ]);

    const base64Pem = topSeqDer.toString("base64").match(/.{1,64}/g).join("\n");
    return `-----BEGIN PUBLIC KEY-----\n${base64Pem}\n-----END PUBLIC KEY-----`;
  } catch (e) {
    return null;
  }
}

// Case 1: Base64 RSA key from user
const userKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAknPrvKrUs9vy6+Aef0FznA/6AlAalatfsdG7PyN54GQgxv2PVLg/NIH99cvGhw6m0T7+GCkURQk+Di2UbBNHVpbKlG7pZ+0YR1SyQcF/9vv8va8200DpMl0wOljuz6i75kDsMCR6RvteBHZOwN0vlDm5Uo6D676QMhgliaTVE6hd3D1CXX1CfajoAYa05bCXkr+Qy01pAVmkKvM540kU0kML5N2pkh9UByCvTEKf/G0J7MvgjQzepYf8+009ljSl1pGBuuJJLU9kExIHIbLiPwhBiqprMb0HLFirVIJgEO0o/b4B5F/9jOZtk6dx1jwlxfidWKeIDFIhhItWM2efowIDAQAB";
const pem1 = getPemPublicKey(userKey);
const enc1 = crypto.publicEncrypt({ key: pem1, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("1234567890123456"));
console.log("TEST 1 (User Base64 Key): SUCCESS, len =", enc1.length);

// Case 2: Hex Modulus fallback
const hexKey = "c9402878d233f452f450a85db190a6c6072accac8c754fcccaf4fcbb7e872b2e309207b4b54567a8e26cefeae909a84fdade4ea8653826da18368d25c251753dd13ce034fce55911c3c664b1d3299ab91f09978a1e822218987202abac68c6f4258efbafa0e12ed244092df28d4c8c7c2cd9a8ae54a5429097736d1cf85955713b883de24d97c8c93952169f2b35556a5dfd8f48d76c0b7d6efbb200864099c390de189e298173b3b1594b9e988fc9af428ad0141644fed1944450250d99172086f0c08108d1c1265b8abdc5379adf02136f3b339ffc981c3d3720074369bcf85d10e0709d41cec67e44951345fc84312e5160932092cb1838b2e905603";
const pem2 = getPemPublicKey(hexKey);
const enc2 = crypto.publicEncrypt({ key: pem2, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("1234567890123456"));
console.log("TEST 2 (Hex Modulus Key): SUCCESS, len =", enc2.length);
