const crypto = require("crypto");

const SMS_AUTH_IV = Buffer.from("01234567", "utf8");

function requireValue(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

// CONFIRMED: CryptoJS TripleDES/CBC/PKCS7 with the first 24 UTF-8 bytes of
// the lowercase SHA-256 hex string, not the binary SHA-256 digest.
function generateSmsAuthTs({ smsCode, timestamp }) {
  if (smsCode == null || timestamp == null) throw new TypeError("smsCode and timestamp are required");
  const normalizedSmsCode = requireValue(String(smsCode), "smsCode");
  const normalizedTimestamp = requireValue(String(timestamp), "timestamp");
  const otpDigestHex = crypto.createHash("sha256").update(normalizedSmsCode, "utf8").digest("hex");
  const key = Buffer.from(otpDigestHex.slice(0, 24), "utf8");
  const cipher = crypto.createCipheriv("des-ede3-cbc", key, SMS_AUTH_IV);
  cipher.setAutoPadding(true); // CryptoJS PKCS7 compatibility.
  return Buffer.concat([cipher.update(normalizedTimestamp, "utf8"), cipher.final()]).toString("base64");
}

function createSmsAuthTsProvider({ deviceIdProvider } = {}) {
  if (!deviceIdProvider || typeof deviceIdProvider.getDeviceId !== "function") throw new TypeError("deviceIdProvider is required");
  return async ({ smsCode, otp, timestamp, deviceId, ...context }) => {
    const resolvedDeviceId = await deviceIdProvider.getDeviceId({ ...context, deviceId });
    if (!resolvedDeviceId) return { ok: false, kind: "MISSING_DEVICE_ID", message: "A trusted FingerprintJS-compatible deviceId is required for SMS authentication." };
    return { ok: true, ts: generateSmsAuthTs({ smsCode: smsCode ?? otp, timestamp }), deviceId: resolvedDeviceId };
  };
}

// CONFIRMED request shape. `ts` generation is deliberately separate.
function buildSmsAuthParams({ ts, phone, countryCode, deviceId, otp, timestamp }) {
  return {
    ts: requireValue(ts, "ts"),
    mobile: requireValue(phone, "phone"),
    country_code: requireValue(String(countryCode), "countryCode"),
    device_id: requireValue(deviceId, "deviceId"),
    dev_type: "31",
    sms_code: requireValue(otp, "otp"),
    timestamp: String(timestamp),
    app: "hago",
    appId: "ikxd",
  };
}

module.exports = { SMS_AUTH_IV, generateSmsAuthTs, createSmsAuthTsProvider, buildSmsAuthParams };
