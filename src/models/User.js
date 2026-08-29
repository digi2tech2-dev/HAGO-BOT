const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  // Internal Hago account UID: always derived from the authenticated hagouid cookie.
  hagoUid: { type: String },
  // Separate UAAS response identifier; it is never used as a yMicro UID.
  hOpenId: { type: String },
  // Read-only turnover headers; caller-provided locale is not derived from phone country code.
  hagoCountry: { type: String },
  hagoLanguage: { type: String },
  // Legacy fields are retained for existing records but never used for authentication.
  userToken: { type: String, select: false },
  cookies: { type: String, select: false },
  hagoSession: {
    hagouid: { type: String, select: false },
    uaasCookie: { type: String, select: false },
  },
  sessionStatus: { type: String, enum: ["ACTIVE", "INCOMPLETE", "REQUIRE_RELOGIN", "REJECTED", "UNKNOWN"], default: "INCOMPLETE" },
  lastValidatedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", UserSchema);
