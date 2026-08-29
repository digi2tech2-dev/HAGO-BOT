const crypto = require("crypto");

const HAGO_APP_ID = "1802";
const HAGO_CURRENCIES = Object.freeze({
  HAGO_DIAMOND: 1805,
  HAGO_CRYSTAL: 1826,
  HAGO_DIAMOND_NEW: 1835,
});

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function md5Hex(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex");
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

// CONFIRMED: the web-login bundle signs this exact URLSearchParams ordering.
function createUaasSendCodeSigner({ randomUUID = crypto.randomUUID } = {}) {
  return {
    sign({ phone, countryCode, timestamp = Date.now(), nonstr = randomUUID() }) {
      const mobile = requireString(phone, "phone");
      const normalizedCountryCode = requireString(String(countryCode), "countryCode");
      const normalizedTimestamp = String(timestamp);
      const normalizedNonstr = requireString(nonstr, "nonstr");
      const canonical = new URLSearchParams();
      canonical.append("nonstr", normalizedNonstr);
      canonical.append("timestamp", normalizedTimestamp);
      canonical.append("mobile", mobile);
      canonical.append("operType", "0");
      canonical.append("countryCode", normalizedCountryCode);
      return {
        operType: "0",
        mobile,
        countryCode: normalizedCountryCode,
        timestamp: normalizedTimestamp,
        nonstr: normalizedNonstr,
        sign: sha256Hex(canonical.toString()),
        validType: "1",
        app: "hago",
        appId: "ikxd",
      };
    },
  };
}

// CONFIRMED: recharge-agent uses MD5("turnover" + JSON.stringify(data)).
function createTurnoverSigner() {
  return {
    signData(data) {
      const serialized = JSON.stringify(data);
      if (serialized === undefined) throw new TypeError("data must be JSON serializable");
      return { data: serialized, sign: md5Hex(`turnover${serialized}`) };
    },
  };
}

module.exports = {
  HAGO_APP_ID,
  HAGO_CURRENCIES,
  createUaasSendCodeSigner,
  createTurnoverSigner,
  sha256Hex,
  md5Hex,
};
