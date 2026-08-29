const crypto = require("crypto");

const ENVELOPE_PREFIX = "client:v1";

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Client data encryption key must be 32 bytes");
}

function decodeBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("invalid envelope");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("invalid envelope");
  return decoded;
}

class ClientDataCipher {
  constructor(key) { requireKey(key); this.key = key; }
  encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    return `${ENVELOPE_PREFIX}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
  }
  decrypt(envelope) {
    try {
      const parts = String(envelope).split(":");
      if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX) throw new Error("invalid envelope");
      const iv = decodeBase64(parts[2]); const tag = decodeBase64(parts[3]); const ciphertext = decodeBase64(parts[4]);
      if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch { throw new Error("Protected client data could not be decrypted"); }
  }
}

function digestProtectedLookup(key, purpose, value) {
  requireKey(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error("lookup value is required");
  return crypto.createHmac("sha256", key).update(`${purpose}\u0000${value.trim()}`, "utf8").digest("hex");
}

function safeDigestEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left)) || !/^[a-f0-9]{64}$/.test(String(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

module.exports = { ENVELOPE_PREFIX, ClientDataCipher, digestProtectedLookup, safeDigestEqual };
