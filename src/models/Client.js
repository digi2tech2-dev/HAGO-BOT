const crypto = require("crypto");
const mongoose = require("mongoose");

function createClientPublicId() {
  return `cli_${crypto.randomBytes(16).toString("base64url")}`;
}

function safeText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

const ClientMetadataSchema = new mongoose.Schema({
  environment: { type: String, trim: true, maxlength: 32, validate: { validator: (value) => value == null || safeText(value, 32), message: "metadata.environment is invalid" } },
  externalReference: { type: String, trim: true, maxlength: 128, validate: { validator: (value) => value == null || safeText(value, 128), message: "metadata.externalReference is invalid" } },
}, { _id: false, strict: "throw" });

const ClientSchema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true, immutable: true, default: createClientPublicId, match: /^cli_[A-Za-z0-9_-]{22}$/ },
  name: { type: String, required: true, trim: true, maxlength: 120, validate: { validator: (value) => safeText(value, 120), message: "client name is invalid" } },
  status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE", required: true },
  disabledAt: { type: Date, default: null },
  metadata: { type: ClientMetadataSchema, default: undefined },
}, { timestamps: true, strict: "throw" });

ClientSchema.index({ status: 1 });

module.exports = mongoose.model("Client", ClientSchema);
module.exports.createClientPublicId = createClientPublicId;
