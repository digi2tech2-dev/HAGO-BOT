const crypto = require("crypto");

const API_KEY_PREFIX = "hago_live_v1";
const API_KEY_PATTERN = /^hago_live_v1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/;
const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

function requirePepper(pepper) {
  if (!Buffer.isBuffer(pepper) || pepper.length !== 32) throw new Error("Client API key pepper must be 32 bytes");
}

function digestClientApiKeySecret(pepper, secret) {
  requirePepper(pepper);
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Client API key secret is invalid");
  return crypto.createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}

function generateClientApiKey({ pepper, randomBytes = crypto.randomBytes } = {}) {
  requirePepper(pepper);
  const keyId = randomBytes(16).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  if (!/^[A-Za-z0-9_-]{22}$/.test(keyId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Secure client key generation failed");
  return { keyId, secretDigest: digestClientApiKeySecret(pepper, secret), fullKey: `${API_KEY_PREFIX}_${keyId}_${secret}` };
}

function parseClientApiKey(value) {
  if (typeof value !== "string") return null;
  const match = API_KEY_PATTERN.exec(value);
  return match ? { keyId: match[1], secret: match[2] } : null;
}

function verifyDigest(pepper, secret, storedDigest) {
  if (!/^[a-f0-9]{64}$/.test(String(storedDigest))) return false;
  const candidate = Buffer.from(digestClientApiKeySecret(pepper, secret), "hex");
  const stored = Buffer.from(storedDigest, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function createLastUsedTracker({ intervalMs = LAST_USED_INTERVAL_MS, maxEntries = 10000 } = {}) {
  const seen = new Map();
  return { shouldTouch(keyId, now = Date.now()) {
    const last = seen.get(String(keyId));
    if (last && now - last < intervalMs) return false;
    if (seen.size >= maxEntries) seen.clear();
    seen.set(String(keyId), now);
    return true;
  } };
}

function isExpired(expiresAt, now) {
  if (expiresAt == null) return false;
  const value = new Date(expiresAt).getTime();
  return !Number.isFinite(value) || value <= now.getTime();
}

function createClientAuthenticator({ pepper, findKeyById, findClientById, touchKey = async () => {}, now = () => new Date(), lastUsedTracker = createLastUsedTracker() } = {}) {
  requirePepper(pepper);
  if (typeof findKeyById !== "function" || typeof findClientById !== "function") throw new TypeError("Client key repositories are required");
  return { async authenticate(rawKey) {
    const parsed = parseClientApiKey(rawKey);
    if (!parsed) return { ok: false, status: 401 };
    const key = await findKeyById(parsed.keyId);
    if (!key || !verifyDigest(pepper, parsed.secret, key.secretDigest)) return { ok: false, status: 401 };
    if (key.status !== "ACTIVE" || isExpired(key.expiresAt, now())) return { ok: false, status: 401 };
    const client = await findClientById(key.clientId);
    if (!client) return { ok: false, status: 401 };
    if (client.status === "DISABLED") return { ok: false, status: 403 };
    if (client.status !== "ACTIVE") return { ok: false, status: 401 };
    const touchedAt = now();
    if (lastUsedTracker.shouldTouch(key.keyId, touchedAt.getTime())) Promise.resolve(touchKey(key._id, touchedAt)).catch(() => {});
    return { ok: true, auth: Object.freeze({ clientId: String(client._id), clientPublicId: client.publicId, apiKeyId: String(key._id), apiKeyPublicId: key.keyId }) };
  } };
}

module.exports = { API_KEY_PREFIX, API_KEY_PATTERN, digestClientApiKeySecret, generateClientApiKey, parseClientApiKey, verifyDigest, createLastUsedTracker, createClientAuthenticator };
