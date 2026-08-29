const mongoose = require("mongoose");

function safeLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}

function redactSecret(_doc, value) {
  delete value.secretDigest;
  return value;
}

const ClientApiKeySchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
  keyId: { type: String, required: true, unique: true, immutable: true, match: /^[A-Za-z0-9_-]{22}$/ },
  secretDigest: { type: String, required: true, immutable: true, select: false, match: /^[a-f0-9]{64}$/ },
  status: { type: String, enum: ["ACTIVE", "DISABLED", "REVOKED"], default: "ACTIVE", required: true },
  label: { type: String, required: true, trim: true, maxlength: 64, validate: { validator: safeLabel, message: "key label is invalid" } },
  expiresAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw", toJSON: { transform: redactSecret }, toObject: { transform: redactSecret } });

ClientApiKeySchema.index({ clientId: 1, status: 1 });
ClientApiKeySchema.index({ expiresAt: 1 });

module.exports = mongoose.model("ClientApiKey", ClientApiKeySchema);
