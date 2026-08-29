const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function otpRateLimit(req, res, next) {
  const key = `${req.ip}:${String(req.body?.phone || "")}`;
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) return res.status(429).json({ status: "ERROR", message: "Too many OTP attempts. Try again later." });
  recent.push(now);
  attempts.set(key, recent);
  return next();
}

module.exports = otpRateLimit;
