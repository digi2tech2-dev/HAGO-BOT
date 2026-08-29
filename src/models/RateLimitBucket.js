const mongoose = require("mongoose");

const RateLimitBucketSchema = new mongoose.Schema({
  scope: { type: String, required: true, maxlength: 64 },
  keyDigest: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, min: 0, default: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, strict: "throw" });

RateLimitBucketSchema.index({ scope: 1, keyDigest: 1, windowStart: 1 }, { unique: true });
RateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RateLimitBucket", RateLimitBucketSchema);
