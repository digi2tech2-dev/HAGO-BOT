const { createHagoHttpClient, normalizeHttpError } = require("./client");
const { isUaasSuccess } = require("./parsers");
const { buildCookieHeader, sessionFromAuthResponse } = require("./session");
const { createUaasSendCodeSigner } = require("./signers");
const { createDeviceIdProvider } = require("./deviceId");
const { buildSmsAuthParams, createSmsAuthTsProvider } = require("./smsAuth");
const { deriveBrowserSession } = require("./sessionDerivation");

const UAAS_BASE_URL = "https://i.ihago.net/uaas/h5";

function createUaasClient({ http = createHagoHttpClient(), sendCodeSigner = createUaasSendCodeSigner(), deviceIdProvider = createDeviceIdProvider(), smsAuthTsProvider, now = Date.now } = {}) {
  const resolvedSmsAuthTsProvider = smsAuthTsProvider || createSmsAuthTsProvider({ deviceIdProvider });
  async function sendOtp(phone, countryCode) {
    let signed;
    try { signed = await sendCodeSigner.sign({ phone, countryCode, timestamp: Date.now() }); }
    catch { return { ok: false, kind: "INVALID_REQUEST", message: "phone and countryCode are required for OTP delivery." }; }
    try {
      const response = await http.get(`${UAAS_BASE_URL}/sendCode`, { params: signed });
      return isUaasSuccess(response.data)
        ? { ok: true }
        : { ok: false, kind: "BUSINESS_ERROR", message: response.data?.result_desc || "Hago rejected the OTP request" };
    } catch (error) { return { ok: false, ...normalizeHttpError(error) }; }
  }

  async function verifyOtp(phone, otp, countryCode, deviceId) {
    const input = { phone, otp, smsCode: otp, countryCode, deviceId, timestamp: now() };
    const provided = await resolvedSmsAuthTsProvider(input);
    if (!provided?.ok) return provided || { ok: false, kind: "BLOCKED", message: "SMS auth parameters are unavailable." };
    let params;
    try {
      params = provided.params || buildSmsAuthParams({ ...input, ...provided, deviceId: provided.deviceId || deviceId });
    } catch { return { ok: false, kind: "INVALID_REQUEST", message: "SMS auth parameters are invalid." }; }
    try {
      const response = await http.get(`${UAAS_BASE_URL}/smsAuth`, { params });
      if (!isUaasSuccess(response.data)) return { ok: false, kind: "BUSINESS_ERROR", message: response.data?.result_desc || "Hago rejected the OTP" };
      const session = sessionFromAuthResponse(response.data, response.headers?.["set-cookie"], {
        // The OTP, OTP digest, s_session, s_t, and sSessionKey stay within
        // this request scope. The derivation module returns final cookies only.
        deriveSession: () => deriveBrowserSession(response.data, { smsCode: otp, timestamp: now() }),
      });
      if (session.status !== "ACTIVE") {
        return { ok: false, kind: "SESSION_ESTABLISHMENT_UNPROVEN", message: "Hago did not provide a complete established session." };
      }
      return { ok: true, session };
    } catch (error) { return { ok: false, ...normalizeHttpError(error) }; }
  }

  async function probeSession(session) {
    const cookie = buildCookieHeader(session);
    if (!cookie) return { status: "REJECTED" };
    try {
      const response = await http.get(`${UAAS_BASE_URL}/getMobile`, { headers: { Cookie: cookie } });
      if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return { status: "UNKNOWN" };
      return isUaasSuccess(response.data) ? { status: "VALID" } : { status: "REJECTED" };
    } catch (error) {
      const normalized = normalizeHttpError(error);
      return normalized.status === 401 || normalized.status === 403 ? { status: "REJECTED" } : { status: "UNKNOWN" };
    }
  }

  return { sendOtp, verifyOtp, probeSession };
}

module.exports = { createUaasClient };
