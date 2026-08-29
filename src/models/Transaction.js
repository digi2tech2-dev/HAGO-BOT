const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
  // V2 records are tenant-owned. Legacy V1 records intentionally remain
  // unassigned until the explicit production migration in Prompt 4.
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: undefined, index: true },
  connectionId: { type: String, default: undefined, index: true },
  agentPhone: { type: String, required: function () { return !this.clientId; }, default: null },
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
  idempotencyKey: { type: String, required: true },
  intentFingerprint: { type: String, required: true },
  upstreamStatus: { type: String, enum: ["NOT_SENT", "SEND_PENDING", "SUCCESS", "FAILED", "UNKNOWN"], default: "NOT_SENT" },
  createdAt: { type: Date, default: Date.now },
});

TransactionSchema.index({ agentPhone: 1, createdAt: -1 });
// Preserve legacy V1 idempotency until V1 retirement; V2 is independently
// scoped by clientId and never collides with another tenant.
// MongoDB partial indexes cannot use `$exists: false`. Equality to null also
// matches legacy records where clientId is absent, while V2 ObjectId values
// are isolated by the separate tenant index below.
TransactionSchema.index({ clientId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { clientId: null, idempotencyKey: { $exists: true } }, name: "legacy_idempotency_key_unique" });
TransactionSchema.index({ clientId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { clientId: { $exists: true }, idempotencyKey: { $exists: true } }, name: "client_idempotency_key_unique" });
TransactionSchema.index({ clientId: 1, connectionId: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
