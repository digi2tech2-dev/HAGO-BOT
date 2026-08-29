const { ClientDataCipher, digestProtectedLookup, safeDigestEqual } = require("../security/clientDataSecrets");
const { createChallengeId } = require("../models/LoginChallenge");

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const PHONE_PATTERN = /^\+?\d{8,18}$/;

function normalizePhone(phone) {
  const normalized = typeof phone === "string" ? phone.trim() : "";
  return PHONE_PATTERN.test(normalized) ? normalized : null;
}

function buildChallengeRecord({ clientId, phone, countryCode, deviceId, country = null, language = null, dataKey, now = () => Date.now(), challengeId = createChallengeId(), status = "OTP_SENT" } = {}) {
  const normalizedPhone = normalizePhone(phone);
  if (!clientId || !normalizedPhone || !/^\d{1,4}$/.test(String(countryCode || "")) || typeof deviceId !== "string" || deviceId.trim().length < 8 || deviceId.trim().length > 256) throw new Error("Invalid LoginChallenge input");
  const current = Number(now());
  if (!Number.isSafeInteger(current)) throw new Error("Invalid challenge clock");
  const cipher = new ClientDataCipher(dataKey);
  if (!['REQUESTING', 'OTP_SENT'].includes(status)) throw new Error("Invalid initial LoginChallenge status");
  return { clientId, challengeId, phoneEncrypted: cipher.encrypt(normalizedPhone), phoneLookupDigest: digestProtectedLookup(dataKey, "phone", normalizedPhone), countryCode: String(countryCode), deviceBindingDigest: digestProtectedLookup(dataKey, "device", deviceId), country: country || null, language: language || null, status, expiresAt: new Date(current + CHALLENGE_TTL_MS), verifyAttempts: 0 };
}

function isOwnedActiveChallenge(challenge, { clientId, now = new Date() } = {}) {
  return Boolean(challenge && String(challenge.clientId) === String(clientId) && challenge.status === "OTP_SENT" && new Date(challenge.expiresAt).getTime() > new Date(now).getTime());
}

function verifyChallengeDeviceBinding(challenge, deviceId, dataKey) {
  if (!challenge || typeof deviceId !== "string") return false;
  try { return safeDigestEqual(challenge.deviceBindingDigest, digestProtectedLookup(dataKey, "device", deviceId)); }
  catch { return false; }
}

module.exports = { CHALLENGE_TTL_MS, normalizePhone, buildChallengeRecord, isOwnedActiveChallenge, verifyChallengeDeviceBinding };
