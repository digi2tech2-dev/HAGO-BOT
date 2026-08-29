const RateLimitBucket = require("../models/RateLimitBucket");
const { digestProtectedLookup } = require("../security/clientDataSecrets");

async function consumeRateLimit({ scope, subject, dataKey, limit, windowMs, now = new Date() }) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error("Invalid rate limit configuration");
  const timestamp = new Date(now).getTime();
  const windowStart = new Date(Math.floor(timestamp / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const keyDigest = digestProtectedLookup(dataKey, `rate:${scope}`, subject);
  const bucket = await RateLimitBucket.findOneAndUpdate(
    { scope, keyDigest, windowStart },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return { allowed: bucket.count <= limit, retryAfterMs: Math.max(0, expiresAt.getTime() - timestamp) };
}

module.exports = { consumeRateLimit };
