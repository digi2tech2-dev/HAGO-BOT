const crypto = require("crypto");

function internalAuth(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  const supplied = req.get("x-internal-api-key");
  if (!expected || !supplied) return res.status(401).json({ status: "ERROR", message: "Internal API authentication is required." });
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ status: "ERROR", message: "Internal API authentication is invalid." });
  }
  return next();
}

module.exports = internalAuth;
