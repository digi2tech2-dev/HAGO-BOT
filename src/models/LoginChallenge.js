const crypto = require("crypto");
const mongoose = require("mongoose");

function createChallengeId() {
  return `chl_${crypto.randomBytes(16).toString("base64url")}`;
}

function redactSensitiveFields(_doc, value) {
  delete value.phoneEncrypted;
  delete value.phoneLookupDigest;
  delete value.deviceBindingDigest;
  return value;
}

const LoginChallengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true, immutable: true, default: createChallengeId, match: /^chl_[A-Za-z0-9_-]{22}$/ },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
  phoneEncrypted: { type: String, required: true, select: false },
  phoneLookupDigest: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  countryCode: { type: String, required: true, match: /^\d{1,4}$/ },
  deviceBindingDigest: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
  country: { type: String, default: null, match: /^[A-Z]{2}$/ },
  language: { type: String, default: null, match: /^[a-z]{2,10}(?:-[A-Za-z0-9]+)?$/ },
  status: { type: String, enum: ["REQUESTING", "OTP_SENT", "VERIFYING", "CONSUMED", "FAILED"], default: "OTP_SENT", required: true },
  expiresAt: { type: Date, required: true },
  verifyAttempts: { type: Number, default: 0, min: 0, max: 10 },
  consumedAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw", toJSON: { transform: redactSensitiveFields }, toObject: { transform: redactSensitiveFields } });

LoginChallengeSchema.index({ clientId: 1, challengeId: 1 }, { unique: true });
LoginChallengeSchema.index({ clientId: 1, phoneLookupDigest: 1, createdAt: -1 });
LoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("LoginChallenge", LoginChallengeSchema);
module.exports.createChallengeId = createChallengeId;
