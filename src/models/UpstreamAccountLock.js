const mongoose = require("mongoose");

const UpstreamAccountLockSchema = new mongoose.Schema({
  upstreamAccountDigest: { type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ },
  state: { type: String, enum: ["HELD", "UNKNOWN_HOLD"], required: true },
  ownerTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  connectionId: { type: String, required: true },
  leaseExpiresAt: { type: Date, default: null },
  heldAt: { type: Date, required: true, default: Date.now },
  unknownAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw" });

UpstreamAccountLockSchema.index({ state: 1, leaseExpiresAt: 1 });
UpstreamAccountLockSchema.index({ ownerTransactionId: 1 });

module.exports = mongoose.model("UpstreamAccountLock", UpstreamAccountLockSchema);
