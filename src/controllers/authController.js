const { sendOtpApi, verifySmsAuthApi } = require("../services/hagoService");
const User = require("../models/User");
const { encryptSessionForStorage } = require("../integrations/hago/session");

const pendingOtps = new Map();
const OTP_TTL_MS = 10 * 60 * 1000;
const PHONE_PATTERN = /^\+?\d{8,18}$/;
const OTP_PATTERN = /^\d{4,8}$/;

function validPhone(phone) { return typeof phone === "string" && PHONE_PATTERN.test(phone.trim()); }

exports.sendOtp = async (req, res) => {
  const phone = req.body?.phone?.trim();
  const countryCode = String(req.body?.countryCode || "").trim();
  if (!validPhone(phone) || !/^\d{1,4}$/.test(countryCode)) return res.status(400).json({ status: "ERROR", message: "A valid phone number and countryCode are required." });
  const result = await sendOtpApi(phone, countryCode);
  if (!result.ok) return res.status(result.kind === "BLOCKED" ? 503 : 400).json({ status: "ERROR", message: result.message, code: result.kind });
  pendingOtps.set(phone, { expiresAt: Date.now() + OTP_TTL_MS, countryCode });
  return res.json({ status: "SUCCESS", message: "OTP request accepted." });
};

exports.verifyOtp = async (req, res) => {
  const phone = req.body?.phone?.trim();
  const otp = req.body?.otp?.trim();
  const deviceId = req.body?.deviceId;
  const country = typeof req.body?.country === "string" ? req.body.country.trim().toUpperCase() : undefined;
  const language = typeof req.body?.language === "string" ? req.body.language.trim() : undefined;
  if (!validPhone(phone) || !OTP_PATTERN.test(otp || "")) return res.status(400).json({ status: "ERROR", message: "A valid phone number and OTP are required." });
  if ((country && !/^[A-Z]{2}$/.test(country)) || (language && !/^[a-z]{2,10}(?:-[A-Za-z0-9]+)?$/.test(language))) return res.status(400).json({ status: "ERROR", message: "country or language format is invalid." });
  const pending = pendingOtps.get(phone);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingOtps.delete(phone);
    return res.status(400).json({ status: "ERROR", message: "No active OTP request exists for this phone." });
  }
  const result = await verifySmsAuthApi(phone, otp, pending.countryCode, deviceId);
  if (!result.ok) return res.status(["BLOCKED", "MISSING_DEVICE_ID", "SESSION_ESTABLISHMENT_UNPROVEN"].includes(result.kind) ? 503 : 400).json({ status: "ERROR", message: result.message, code: result.kind });
  if (!result.session.hagoUid || !result.session.cookies.hagouid || !result.session.cookies.uaasCookie) {
    return res.status(502).json({ status: "ERROR", message: "Hago login response did not contain a complete authenticated session.", code: "INCOMPLETE_SESSION" });
  }
  await User.findOneAndUpdate(
    { phone },
    { hagoUid: result.session.hagoUid, ...(result.session.hOpenId ? { hOpenId: result.session.hOpenId } : {}), hagoSession: encryptSessionForStorage(result.session.cookies), ...(country ? { hagoCountry: country } : {}), ...(language ? { hagoLanguage: language } : {}), sessionStatus: result.session.status, lastValidatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  pendingOtps.delete(phone);
  return res.json({ status: "SUCCESS", message: "Hago session stored.", hagoUid: result.session.hagoUid });
};

module.exports._test = { validPhone, pendingOtps };
