const { createSessionSecretCipherFromEnv, isEncryptedSessionSecret } = require("./sessionSecrets");

function encryptSessionForStorage(cookies, cipher = createSessionSecretCipherFromEnv()) {
  return {
    hagouid: cipher.encrypt(cookies.hagouid),
    uaasCookie: cipher.encrypt(cookies.uaasCookie),
  };
}

function decryptStoredSession(cookies, cipher = createSessionSecretCipherFromEnv()) {
  const stored = cookies || {};
  return {
    hagouid: decryptIfNeeded(stored.hagouid, cipher),
    uaasCookie: decryptIfNeeded(stored.uaasCookie, cipher),
  };
}

function decryptIfNeeded(value, cipher) {
  if (!value) return undefined;
  // Transitional read support: existing plaintext records are never re-written unchanged.
  return isEncryptedSessionSecret(value) ? cipher.decrypt(value) : value;
}

function buildCookieHeader(session) {
  const cookies = session?.cookies || session || {};
  if (!hasCompleteCookies(cookies)) return null;
  return `hagouid=${cookies.hagouid}; uaasCookie=${cookies.uaasCookie}`;
}

function hasCompleteCookies(cookies) {
  return Boolean(cookies?.hagouid && cookies?.uaasCookie);
}

function sessionFromAuthResponse(payload, setCookie, { deriveSession } = {}) {
  const { parseSetCookies } = require("./parsers");
  const cookies = parseSetCookies(setCookie);
  // h_open_id is an independent UAAS identity. It must not replace the
  // authenticated Hago account UID carried by the hagouid cookie.
  const hOpenId = payload?.h_open_id ? String(payload.h_open_id) : undefined;
  if (hasCompleteCookies(cookies)) {
    return {
      hagoUid: cookies.hagouid,
      hOpenId,
      cookies,
      source: "SET_COOKIE",
      status: "ACTIVE",
    };
  }

  if (typeof deriveSession === "function") {
    try {
      const derived = deriveSession();
      if (hasCompleteCookies(derived?.cookies)) {
        return {
          hagoUid: derived.cookies.hagouid,
          hOpenId,
          cookies: derived.cookies,
          source: "DERIVED",
          status: "ACTIVE",
        };
      }
    } catch {
      // Derivation failures are deliberately indistinguishable from an
      // incomplete session: neither upstream secret material nor crypto
      // details are surfaced through this boundary.
    }
  }

  return {
    hagoUid: undefined,
    hOpenId,
    cookies,
    status: "INCOMPLETE",
  };
}

module.exports = { buildCookieHeader, sessionFromAuthResponse, encryptSessionForStorage, decryptStoredSession, hasCompleteCookies };
