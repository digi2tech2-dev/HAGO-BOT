const crypto = require("crypto");

// CONFIRMED from the web-login bundle's Ui/Wx helpers: CryptoJS TripleDES,
// CBC, PKCS7, UTF-8 key material, a fixed eight-byte IV, and raw Base64.
const SESSION_IV = Buffer.from("01234567", "utf8");
const TRIPLE_DES_CIPHER = "des-ede3-cbc";

function invalidSessionDerivation() {
  const error = new Error("Hago session derivation data is invalid.");
  error.code = "INVALID_SESSION_DERIVATION";
  return error;
}

function firstTripleDesKeyBytes(keyMaterial) {
  if (typeof keyMaterial !== "string") throw invalidSessionDerivation();
  const bytes = Buffer.from(keyMaterial, "utf8");
  // CryptoJS TripleDES consumes its first six 32-bit words (24 bytes).
  if (bytes.length < 24) throw invalidSessionDerivation();
  return bytes.subarray(0, 24);
}

function decodeRawBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw invalidSessionDerivation();
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) throw invalidSessionDerivation();
  return bytes;
}

function encryptRawBase64(plaintext, keyMaterial) {
  if (typeof plaintext !== "string") throw invalidSessionDerivation();
  try {
    const cipher = crypto.createCipheriv(TRIPLE_DES_CIPHER, firstTripleDesKeyBytes(keyMaterial), SESSION_IV);
    cipher.setAutoPadding(true); // Node PKCS7 compatibility with CryptoJS.
    return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  } catch {
    throw invalidSessionDerivation();
  }
}

function decryptRawBase64(ciphertext, keyMaterial) {
  try {
    const decipher = crypto.createDecipheriv(TRIPLE_DES_CIPHER, firstTripleDesKeyBytes(keyMaterial), SESSION_IV);
    decipher.setAutoPadding(true); // Node PKCS7 compatibility with CryptoJS.
    return Buffer.concat([decipher.update(decodeRawBase64(ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    throw invalidSessionDerivation();
  }
}

function otpDigestHex(smsCode) {
  if (smsCode == null) throw invalidSessionDerivation();
  return crypto.createHash("sha256").update(String(smsCode), "utf8").digest("hex");
}

function decryptSsession(sSession, smsCode) {
  return decryptRawBase64(sSession, otpDigestHex(smsCode));
}

function parseSsession(sSession, smsCode) {
  let parsed;
  try {
    parsed = JSON.parse(decryptSsession(sSession, smsCode));
  } catch {
    throw invalidSessionDerivation();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || typeof parsed.uuid !== "string" || parsed.uuid.length === 0
    || typeof parsed.sSessionKey !== "string" || parsed.sSessionKey.length === 0) {
    throw invalidSessionDerivation();
  }
  firstTripleDesKeyBytes(parsed.sSessionKey);
  return { uuid: parsed.uuid, sSessionKey: parsed.sSessionKey };
}

function serializeAuthPayload(uuid, timestamp) {
  if (typeof uuid !== "string" || uuid.length === 0 || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw invalidSessionDerivation();
  }
  // Property order is the confirmed JSON.stringify({ uuid, timestamp }) order.
  return JSON.stringify({ uuid, timestamp });
}

function combineUaasCookie(authCiphertext, sT) {
  if (typeof authCiphertext !== "string" || authCiphertext.length === 0 || typeof sT !== "string" || sT.length === 0) {
    throw invalidSessionDerivation();
  }
  // The bundle's ow helper encodes `${ciphertext},${s_t}`. Its immediate
  // decode before cookie writing is cancelled by the cookie writer's own
  // encodeURIComponent, leaving this exact Cookie-header representation.
  return encodeURIComponent(`${authCiphertext},${sT}`);
}

function deriveBrowserSession(payload, { smsCode, timestamp } = {}) {
  if (!payload || typeof payload !== "object" || typeof payload.s_t !== "string" || payload.s_t.length === 0) {
    throw invalidSessionDerivation();
  }
  const { uuid, sSessionKey } = parseSsession(payload.s_session, smsCode);
  const authPayload = serializeAuthPayload(uuid, timestamp);
  const authCiphertext = encryptRawBase64(authPayload, sSessionKey);
  return {
    hagoUid: uuid,
    cookies: {
      hagouid: uuid,
      uaasCookie: combineUaasCookie(authCiphertext, payload.s_t),
    },
  };
}

module.exports = {
  SESSION_IV,
  combineUaasCookie,
  decryptSsession,
  deriveBrowserSession,
  encryptRawBase64,
  parseSsession,
  serializeAuthPayload,
};
