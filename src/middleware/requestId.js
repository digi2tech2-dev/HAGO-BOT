const crypto = require("crypto");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function requestId(req, res, next) {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  return next();
}

module.exports = { requestId, REQUEST_ID_PATTERN };
