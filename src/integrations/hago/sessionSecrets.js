const crypto = require("crypto");
const { parseSessionEncryptionKey } = require("../../config/runtime");

const ENVELOPE_PREFIX = "enc:v1";

class SessionSecretCipher {
  constructor(key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Session encryption key must be 32 bytes");
    this.key = key;
  }

  encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENVELOPE_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  decrypt(envelope) {
    try {
      const parts = String(envelope).split(":");
      if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX) throw new Error("invalid envelope");
      const [, , encodedIv, encodedTag, encodedCiphertext] = parts;
      const iv = decodeBase64(encodedIv);
      const tag = decodeBase64(encodedTag);
      const ciphertext = decodeBase64(encodedCiphertext);
      if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid envelope");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Stored Hago session secret could not be decrypted");
    }
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("invalid base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("invalid base64");
  return decoded;
}

function createSessionSecretCipherFromEnv(env = process.env) {
  return new SessionSecretCipher(parseSessionEncryptionKey(env.HAGO_SESSION_ENCRYPTION_KEY));
}

function isEncryptedSessionSecret(value) {
  return typeof value === "string" && value.startsWith(`${ENVELOPE_PREFIX}:`);
}

module.exports = { ENVELOPE_PREFIX, SessionSecretCipher, createSessionSecretCipherFromEnv, isEncryptedSessionSecret };
