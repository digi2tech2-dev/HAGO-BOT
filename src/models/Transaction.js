const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  agentPhone: { type: String, required: true },
  targetId: { type: String, required: true },

  serviceType: {
    type: String,
    enum: ["DIAMOND", "CRYSTAL", "NOBILITY"],
    required: true,
    default: "DIAMOND",
  },

  amount: {
    type: Number,
    required: function () {
      return this.serviceType !== "NOBILITY";
    },
  },

  nobilityType: {
    type: String,
    enum: ["Knight", "Viscount", "Earl", "Duke", null],
    default: null,
  },

  status: {
    type: String,
    enum: ["PENDING", "SUCCESS", "FAILED", "UNKNOWN"],
    default: "PENDING",
  },
  // Reserved for a future verified upstream reference. It is never fabricated locally.
  referenceId: { type: String, default: null },
  errorMessage: { type: String },
  // Numeric business code only; no upstream response body is retained.
  upstreamCode: { type: Number, default: null },
  upstreamTimeout: { type: Boolean, default: false },
  // A send is recorded before the single network attempt. Neither target UID
  // nor seqId is persisted because both are sensitive/ephemeral protocol data.
  sendAttemptedAt: { type: Date, default: null },
  sendAttempts: { type: Number, default: 0, min: 0, max: 1 },
  idempotencyKey: { type: String, required: true, unique: true, sparse: true },
  intentFingerprint: { type: String, required: true },
  upstreamStatus: { type: String, enum: ["NOT_SENT", "SEND_PENDING", "SUCCESS", "FAILED", "UNKNOWN"], default: "NOT_SENT" },
  createdAt: { type: Date, default: Date.now },
});

TransactionSchema.index({ agentPhone: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
