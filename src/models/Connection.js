const crypto = require("crypto");
const mongoose = require("mongoose");

function createConnectionId() {
  return `con_${crypto.randomBytes(16).toString("base64url")}`;
}

function redactConnection(_doc, value) {
  delete value.phoneEncrypted;
  delete value.phoneLookupDigest;
  delete value.upstreamAccountDigest;
  delete value.hagoSession;
  return value;
}

const ConnectionSchema = new mongoose.Schema({
  connectionId: { type: String, required: true, unique: true, immutable: true, default: createConnectionId, match: /^con_[A-Za-z0-9_-]{22}$/ },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, immutable: true, index: true },
  phoneEncrypted: { type: String, required: true, select: false },
  phoneLookupDigest: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  upstreamAccountDigest: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  // Session material remains encrypted using the existing Hago session cipher.
  hagoSession: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  hagoCountry: { type: String, default: null },
  hagoLanguage: { type: String, default: null },
  status: { type: String, enum: ["ACTIVE", "REJECTED", "UNKNOWN", "DISABLED"], default: "ACTIVE", required: true },
  lastValidatedAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw", toJSON: { transform: redactConnection }, toObject: { transform: redactConnection } });

ConnectionSchema.index({ clientId: 1, connectionId: 1 }, { unique: true });
ConnectionSchema.index({ clientId: 1, phoneLookupDigest: 1 }, { unique: true });
ConnectionSchema.index({ upstreamAccountDigest: 1, status: 1 });

module.exports = mongoose.model("Connection", ConnectionSchema);
module.exports.createConnectionId = createConnectionId;
