const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { isUaasSuccess, parseSetCookies, parseTurnoverWallet, parseTurnoverHistory, parseYmicroUser } = require("../src/integrations/hago/parsers");
const { buildCookieHeader, sessionFromAuthResponse } = require("../src/integrations/hago/session");
const { createUaasClient } = require("../src/integrations/hago/uaas");
const { generateSmsAuthTs, createSmsAuthTsProvider, buildSmsAuthParams } = require("../src/integrations/hago/smsAuth");
const { createUaasSendCodeSigner, createTurnoverSigner, HAGO_CURRENCIES } = require("../src/integrations/hago/signers");
const { createDeviceIdProvider } = require("../src/integrations/hago/deviceId");
const { createTurnoverClient, buildWalletData, buildHistoryData } = require("../src/integrations/hago/turnover");
const { createYmicroClient, buildMetadata, normalizeYmicroId } = require("../src/integrations/hago/ymicro");
const { NOBLE_YMICRO_URL, buildNobleYmicroMetadata, normalizeNobleUid, createNobilityReadOnlyClient } = require("../src/integrations/hago/nobilityClient");
const { isNobilitySenderEnabled, normalizeNobilityOutcome, createNobilityMutationClient } = require("../src/integrations/hago/nobilityMutation");
const { createNobilityPurchaseReadinessClient } = require("../src/integrations/hago/nobilityPurchaseReadiness");
const { buildTransferAccountRequest, parseTransferAccountResponse } = require("../src/integrations/hago/mutation");
const { buildSeqId, selectDiamondTransferCurrency, isControlledMutationSenderEnabled, createFinancialMutationClient } = require("../src/integrations/hago/financial");
const { buildDiamondMutationPreview, buildCrystalMutationPreview, buildNobilityMutationPreview } = require("../src/integrations/hago/mutationPreview");
const { normalizedCrystalBalance, validateCrystalTransferPreflight } = require("../src/integrations/hago/crystalPreflight");
const { NOBLE_RPC, NOBLE_TYPES, BUY_TYPES, NOBLE_STATUSES, buildListAllNobleConfRequest, buildGetUserNobleRequest, buildGetUserGPSubStatusRequest, parseNobleConfig, parseCurrentNoble, decideNoblePurchase, selectNoblePurchase, buildBuyNobleByAgencyPayload, normalizeNobleResponse } = require("../src/integrations/hago/nobility");
const { createTransferReadinessClient, parseAgencyReadiness, parsePermissionReadiness, parsePasswordReadiness, parseWalletReadiness } = require("../src/integrations/hago/transferReadiness");
const internalAuth = require("../src/middleware/internalAuth");
const { createHagoHttpClient, normalizeHttpError } = require("../src/integrations/hago/client");
const hagoService = require("../src/services/hagoService");
const { prepareRechargeMutation } = hagoService;
const { SessionSecretCipher, isEncryptedSessionSecret } = require("../src/integrations/hago/sessionSecrets");
const { encryptSessionForStorage, decryptStoredSession } = require("../src/integrations/hago/session");
const { combineUaasCookie, decryptSsession, deriveBrowserSession, encryptRawBase64, parseSsession, serializeAuthPayload } = require("../src/integrations/hago/sessionDerivation");
const { parseSessionEncryptionKey, validateRuntimeConfig, getControlledMutationConfig, isNobilityEnabled, getLocalReadiness } = require("../src/config/runtime");
const { requestId } = require("../src/middleware/requestId");
const createApp = require("../src/app");
const botController = require("../src/controllers/botController");
const User = require("../src/models/User");
const Transaction = require("../src/models/Transaction");

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const sessionA = { hagoUid: "42", country: "EG", language: "en", cookies: { hagouid: "a", uaasCookie: "one" } };
const sessionKey = Buffer.alloc(32, 7);
const validEnv = {
  MONGO_URI: "mongodb://example.test/hago",
  INTERNAL_API_KEY: "test-internal-key",
  HAGO_SESSION_ENCRYPTION_KEY: sessionKey.toString("base64"),
  PORT: "3000",
  HAGO_REQUEST_TIMEOUT_MS: "10000",
};
const syntheticSmsCode = "1234";
const syntheticSsession = "bgiJfz7y126z6PXBhoP7htEWc57J8ZK/14d4SHuUaNThl/iWzP3eInjPu3aSELw1/tPWqNcZZ5HiC/8J1FzNQuuQgEiRA5IV";
const syntheticSsessionJson = '{"uuid":"synthetic-uuid","sSessionKey":"0123456789abcdefghijklmn"}';
const syntheticAuthJson = '{"uuid":"synthetic-uuid","timestamp":1700000000000}';
const syntheticAuthCiphertext = "Ezc+632jp6//5gs3cTSLjWcojsSFF506o97jiBNV1o2csa/1h0NoQZ6eXJE3FyJgdMBGnh5wyvY=";
const syntheticDerivedCookie = "Ezc%2B632jp6%2F%2F5gs3cTSLjWcojsSFF506o97jiBNV1o2csa%2F1h0NoQZ6eXJE3FyJgdMBGnh5wyvY%3D%2Csynthetic-st";

test("sendCode SHA-256 follows the confirmed URLSearchParams order", () => {
  const signer = createUaasSendCodeSigner({ randomUUID: () => uuid });
  const signed = signer.sign({ phone: "201234567890", countryCode: "20", timestamp: 1700000000123 });
  assert.equal(signed.sign, "35e595f03955e5041fb849b370ad6b0d0a66cd511a8a9f26631d85d148f9a563");
  assert.deepEqual(Object.keys(signed), ["operType", "mobile", "countryCode", "timestamp", "nonstr", "sign", "validType", "app", "appId"]);
});

test("sendCode nonstr is a UUID v4-shaped browser nonce", () => {
  const signed = createUaasSendCodeSigner().sign({ phone: "201234567890", countryCode: "20", timestamp: 1 });
  assert.match(signed.nonstr, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("UAAS accepts only result_code 00000", () => {
  assert.equal(isUaasSuccess({ result_code: "00000" }), true);
  assert.equal(isUaasSuccess({ result_code: "0" }), false);
});

test("UAAS sends the proven sendCode parameters and handles a business failure", async () => {
  const calls = [];
  const client = createUaasClient({
    http: { get: async (...args) => { calls.push(args); return { data: { result_code: "20102", result_desc: "invalid" } }; } },
    sendCodeSigner: createUaasSendCodeSigner({ randomUUID: () => uuid }),
  });
  const result = await client.sendOtp("201000000000", "20");
  assert.equal(result.kind, "BUSINESS_ERROR");
  assert.equal(calls[0][1].params.appId, "ikxd");
});

test("missing deviceId fails closed before SMS auth HTTP", async () => {
  let called = false;
  const result = await createUaasClient({ http: { get: async () => { called = true; } } }).verifyOtp("201000000000", "1234", "20");
  assert.equal(result.kind, "MISSING_DEVICE_ID");
  assert.equal(called, false);
});

test("SMS auth ts reproduces the exact synthetic CryptoJS compatibility vector", () => {
  assert.equal(generateSmsAuthTs({ smsCode: "1234", timestamp: "1700000000000" }), "QV9JpAQU1lzywnX98ECVyA==");
});

test("SMS auth does not use the binary SHA-256 digest as its 3DES key", () => {
  const binaryDigest = crypto.createHash("sha256").update("1234", "utf8").digest();
  const cipher = crypto.createCipheriv("des-ede3-cbc", binaryDigest.subarray(0, 24), Buffer.from("01234567", "utf8"));
  const wrongTs = Buffer.concat([cipher.update("1700000000000", "utf8"), cipher.final()]).toString("base64");
  assert.notEqual(wrongTs, "QV9JpAQU1lzywnX98ECVyA==");
});

test("SMS provider uses the trusted caller device ID and produces params without HTTP", async () => {
  const provider = createSmsAuthTsProvider({ deviceIdProvider: createDeviceIdProvider() });
  const result = await provider({ smsCode: "1234", timestamp: "1700000000000", deviceId: "fingerprintjs-visitor-id" });
  assert.deepEqual(result, { ok: true, ts: "QV9JpAQU1lzywnX98ECVyA==", deviceId: "fingerprintjs-visitor-id" });
});

test("SMS auth request builder has the confirmed field names and ordering", () => {
  assert.deepEqual(buildSmsAuthParams({ ts: "vector-ts", phone: "201000000000", countryCode: "20", deviceId: "fingerprintjs-visitor-id", otp: "1234", timestamp: 1700000000123 }), {
    ts: "vector-ts", mobile: "201000000000", country_code: "20", device_id: "fingerprintjs-visitor-id", dev_type: "31", sms_code: "1234", timestamp: "1700000000123", app: "hago", appId: "ikxd",
  });
});

test("smsAuth accepts only 00000 and extracts authoritative Set-Cookie values", async () => {
  const calls = [];
  const client = createUaasClient({
    http: { get: async (...args) => { calls.push(args); return { data: { result_code: "00000", h_open_id: "42" }, headers: { "set-cookie": ["hagouid=42; Path=/", "uaasCookie=secret; HttpOnly"] } }; } },
    smsAuthTsProvider: async ({ deviceId }) => ({ ok: true, ts: "vector-ts", deviceId }),
  });
  const result = await client.verifyOtp("201000000000", "1234", "20", "fingerprintjs-visitor-id");
  assert.equal(result.ok, true);
  assert.deepEqual(result.session.cookies, { hagouid: "42", uaasCookie: "secret" });
  assert.deepEqual(calls[0][1].params, buildSmsAuthParams({ ts: "vector-ts", phone: "201000000000", countryCode: "20", deviceId: "fingerprintjs-visitor-id", otp: "1234", timestamp: calls[0][1].params.timestamp }));
});

test("h_open_id remains separate from the authenticated hagouid internal UID", () => {
  const session = sessionFromAuthResponse(
    { h_open_id: "123456789012345678901234567890" },
    ["hagouid=42; Path=/", "uaasCookie=synthetic; HttpOnly"],
  );
  assert.equal(session.hOpenId, "123456789012345678901234567890");
  assert.equal(session.hagoUid, "42");
  assert.notEqual(session.hOpenId, session.hagoUid);
});

test("successful smsAuth without a complete session source fails closed", async () => {
  const client = createUaasClient({
    http: { get: async () => ({ data: { result_code: "00000", h_open_id: "42" }, headers: { "set-cookie": ["hagouid=42; Path=/"] } }) },
    smsAuthTsProvider: async ({ deviceId }) => ({ ok: true, ts: "vector-ts", deviceId }),
  });
  const result = await client.verifyOtp("201000000000", "1234", "20", "fingerprintjs-visitor-id");
  assert.deepEqual(result, { ok: false, kind: "SESSION_ESTABLISHMENT_UNPROVEN", message: "Hago did not provide a complete established session." });
});

test("browser s_session decrypts and parses with the OTP SHA-256 hex material", () => {
  assert.equal(decryptSsession(syntheticSsession, syntheticSmsCode), syntheticSsessionJson);
  assert.deepEqual(parseSsession(syntheticSsession, syntheticSmsCode), {
    uuid: "synthetic-uuid",
    sSessionKey: "0123456789abcdefghijklmn",
  });
});

test("browser session derivation preserves auth JSON order, timestamp, and encoded cookie construction", () => {
  assert.equal(serializeAuthPayload("synthetic-uuid", 1700000000000), syntheticAuthJson);
  assert.equal(encryptRawBase64(syntheticAuthJson, "0123456789abcdefghijklmn"), syntheticAuthCiphertext);
  assert.equal(combineUaasCookie(syntheticAuthCiphertext, "synthetic-st"), syntheticDerivedCookie);
  assert.deepEqual(deriveBrowserSession({ s_session: syntheticSsession, s_t: "synthetic-st" }, {
    smsCode: syntheticSmsCode,
    timestamp: 1700000000000,
  }), {
    hagoUid: "synthetic-uuid",
    cookies: { hagouid: "synthetic-uuid", uaasCookie: syntheticDerivedCookie },
  });
});

test("incomplete Set-Cookie falls back to the confirmed browser session derivation", async () => {
  const client = createUaasClient({
    now: () => 1700000000000,
    http: { get: async () => ({
      data: { result_code: "00000", h_open_id: "account-open-id", s_session: syntheticSsession, s_t: "synthetic-st" },
      headers: { "set-cookie": ["hagouid=partial; Path=/"] },
    }) },
    smsAuthTsProvider: async ({ deviceId }) => ({ ok: true, ts: "vector-ts", deviceId }),
  });
  const result = await client.verifyOtp("201000000000", syntheticSmsCode, "20", "fingerprintjs-visitor-id");
  assert.equal(result.ok, true);
  assert.equal(result.session.source, "DERIVED");
  assert.equal(result.session.hagoUid, "synthetic-uuid");
  assert.equal(result.session.hOpenId, "account-open-id");
  assert.deepEqual(result.session.cookies, { hagouid: "synthetic-uuid", uaasCookie: syntheticDerivedCookie });
});

test("complete Set-Cookie stays preferred and skips browser derivation", () => {
  const { sessionFromAuthResponse } = require("../src/integrations/hago/session");
  const session = sessionFromAuthResponse(
    { h_open_id: "42", s_session: "not-used", s_t: "not-used" },
    ["hagouid=42; Path=/", "uaasCookie=authoritative; HttpOnly"],
    { deriveSession: () => assert.fail("derivation must not run for authoritative cookies") },
  );
  assert.equal(session.source, "SET_COOKIE");
  assert.deepEqual(session.cookies, { hagouid: "42", uaasCookie: "authoritative" });
});

test("invalid browser session material fails closed without secret-bearing errors", () => {
  const otpDigest = crypto.createHash("sha256").update(syntheticSmsCode, "utf8").digest("hex");
  const cases = [
    () => decryptSsession("not-base64", syntheticSmsCode),
    () => decryptSsession(syntheticSsession, "9999"),
    () => parseSsession(encryptRawBase64("not-json", otpDigest), syntheticSmsCode),
    () => parseSsession(encryptRawBase64('{"sSessionKey":"0123456789abcdefghijklmn"}', otpDigest), syntheticSmsCode),
    () => parseSsession(encryptRawBase64('{"uuid":"synthetic-uuid"}', otpDigest), syntheticSmsCode),
    () => parseSsession(encryptRawBase64('{"uuid":"synthetic-uuid","sSessionKey":"short"}', otpDigest), syntheticSmsCode),
  ];
  for (const action of cases) {
    assert.throws(action, (error) => error.code === "INVALID_SESSION_DERIVATION" && !error.message.includes("synthetic"));
  }
});

test("derived session cookies are encrypted before storage and no ephemeral inputs are retained", () => {
  const derived = deriveBrowserSession({ s_session: syntheticSsession, s_t: "synthetic-st" }, {
    smsCode: syntheticSmsCode,
    timestamp: 1700000000000,
  });
  const stored = encryptSessionForStorage(derived.cookies, new SessionSecretCipher(sessionKey));
  assert.equal(stored.hagouid.includes("synthetic-uuid"), false);
  assert.equal(stored.uaasCookie.includes("synthetic-st"), false);
  assert.equal(JSON.stringify(stored).includes(syntheticSmsCode), false);
  assert.equal(JSON.stringify(stored).includes("sSessionKey"), false);
  assert.equal(JSON.stringify(stored).includes("s_session"), false);
  assert.equal(JSON.stringify(stored).includes("s_t"), false);
});

test("DeviceIdProvider accepts only caller-provided stable identifiers", async () => {
  const provider = createDeviceIdProvider();
  assert.equal(await provider.getDeviceId({}), null);
  assert.equal(await provider.getDeviceId({ deviceId: "fingerprintjs-visitor-id" }), "fingerprintjs-visitor-id");
});

test("Set-Cookie extraction retains only the authenticated browser cookies", () => {
  assert.deepEqual(parseSetCookies(["hagouid=account-a; Path=/", "uaasCookie=token-a; HttpOnly", "other=value"]), { hagouid: "account-a", uaasCookie: "token-a" });
  const session = sessionFromAuthResponse({ h_open_id: "42", s_session: "ignored", s_t: "ignored" }, ["hagouid=42", "uaasCookie=cookie"]);
  assert.deepEqual(session.cookies, { hagouid: "42", uaasCookie: "cookie" });
});

test("session secret encryption round-trips and uses distinct random-IV ciphertexts", () => {
  const cipher = new SessionSecretCipher(sessionKey);
  const first = cipher.encrypt("synthetic-session-cookie");
  const second = cipher.encrypt("synthetic-session-cookie");
  assert.notEqual(first, second);
  assert.equal(cipher.decrypt(first), "synthetic-session-cookie");
  assert.equal(isEncryptedSessionSecret(first), true);
});

test("session secret encryption rejects tampering, wrong keys, and malformed envelopes without secret leakage", () => {
  const secret = "synthetic-session-cookie";
  const cipher = new SessionSecretCipher(sessionKey);
  const envelope = cipher.encrypt(secret);
  const parts = envelope.split(":");
  const changeLastCharacter = (value) => `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
  const tamperedCiphertext = [...parts]; tamperedCiphertext[4] = changeLastCharacter(tamperedCiphertext[4]);
  const tamperedTag = [...parts]; tamperedTag[3] = changeLastCharacter(tamperedTag[3]);
  for (const invalid of [tamperedCiphertext.join(":"), tamperedTag.join(":"), "enc:v1:bad"]) {
    assert.throws(() => cipher.decrypt(invalid), (error) => !error.message.includes(secret));
  }
  assert.throws(() => new SessionSecretCipher(Buffer.alloc(32, 8)).decrypt(envelope), /could not be decrypted/);
});

test("new session storage encrypts cookies and transitional plaintext records remain readable", () => {
  const cipher = new SessionSecretCipher(sessionKey);
  const stored = encryptSessionForStorage({ hagouid: "synthetic-user", uaasCookie: "synthetic-cookie" }, cipher);
  assert.equal(stored.hagouid.includes("synthetic-user"), false);
  assert.equal(stored.uaasCookie.includes("synthetic-cookie"), false);
  assert.deepEqual(decryptStoredSession(stored, cipher), { hagouid: "synthetic-user", uaasCookie: "synthetic-cookie" });
  assert.deepEqual(decryptStoredSession({ hagouid: "legacy-user", uaasCookie: "legacy-cookie" }, cipher), { hagouid: "legacy-user", uaasCookie: "legacy-cookie" });
});

test("runtime configuration accepts a 32-byte base64 key and rejects invalid critical values", () => {
  assert.deepEqual(parseSessionEncryptionKey(validEnv.HAGO_SESSION_ENCRYPTION_KEY), sessionKey);
  assert.equal(validateRuntimeConfig(validEnv).hagoRequestTimeoutMs, 10000);
  assert.equal(validateRuntimeConfig({ ...validEnv, HAGO_REQUEST_TIMEOUT_MS: undefined }).hagoRequestTimeoutMs, 15000);
  assert.throws(() => parseSessionEncryptionKey(Buffer.alloc(31).toString("base64")), /HAGO_SESSION_ENCRYPTION_KEY/);
  assert.throws(() => validateRuntimeConfig({ ...validEnv, HAGO_REQUEST_TIMEOUT_MS: "zero" }), /HAGO_REQUEST_TIMEOUT_MS/);
  assert.throws(() => validateRuntimeConfig({ ...validEnv, INTERNAL_API_KEY: "" }), /INTERNAL_API_KEY/);
  assert.deepEqual(getControlledMutationConfig({ ...validEnv, HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" }), { mutationsEnabled: true, controlledMutationMode: true, maxAmount: 5 });
  assert.equal(isNobilityEnabled({ ...validEnv, HAGO_NOBILITY_ENABLED: "true" }), true);
  assert.equal(isNobilityEnabled(validEnv), false);
  assert.throws(() => validateRuntimeConfig({ ...validEnv, HAGO_CONTROLLED_MUTATION_MODE: "true" }), /HAGO_CONTROLLED_MUTATION_MAX_AMOUNT/);
  assert.throws(() => validateRuntimeConfig({ ...validEnv, HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "0" }), /HAGO_CONTROLLED_MUTATION_MAX_AMOUNT/);
});

test("Hago HTTP client defaults to the bundle-confirmed 15-second bounded timeout", async () => {
  const previous = process.env.HAGO_REQUEST_TIMEOUT_MS;
  const calls = [];
  delete process.env.HAGO_REQUEST_TIMEOUT_MS;
  try {
    const client = createHagoHttpClient({ get: async (...args) => { calls.push(args); return { data: {} }; } });
    await client.get("https://example.invalid/local-test");
    assert.equal(calls[0][1].timeout, 15000);
  } finally {
    if (previous === undefined) delete process.env.HAGO_REQUEST_TIMEOUT_MS; else process.env.HAGO_REQUEST_TIMEOUT_MS = previous;
  }
});

test("local readiness requires valid config and a connected Mongo state without Hago calls", () => {
  assert.deepEqual(getLocalReadiness({ env: validEnv, mongoose: { connection: { readyState: 1 } } }), { ready: true, configValid: true, mongoReady: true });
  assert.deepEqual(getLocalReadiness({ env: { ...validEnv, MONGO_URI: "" }, mongoose: { connection: { readyState: 1 } } }), { ready: false, configValid: false, mongoReady: true });
  const routes = createApp()._router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.ok(routes.includes("/health"));
  assert.ok(routes.includes("/ready"));
});

test("recovery Postman collection contains only variable-driven local-safe requests", () => {
  const collection = JSON.parse(fs.readFileSync("postman/Hago_Automation_Recovery.postman_collection.json", "utf8"));
  const names = [];
  const visit = (items) => items.forEach((item) => { names.push(item.name); if (item.item) visit(item.item); });
  visit(collection.item);
  for (const expected of [
    "Health (local liveness only)", "Ready (local dependencies only)", "Send OTP", "Verify OTP (requires a pending OTP request)",
    "Validate stored session", "Transfer readiness (read-only diagnostic)", "Nobility readiness (read-only diagnostic)", "Nobility purchase readiness (read-only final gate)", "Verify target ID", "Get agent profile", "Get wallet", "Get account history", "List local transaction attempts", "Reconcile attempted UNKNOWN transaction (read-only)",
    "Diamond (expected fail-closed)", "Crystal (expected fail-closed)", "Nobility (feature switch disabled by default)",
    "Diamond (controlled one-shot test)", "Crystal (controlled one-shot test)",
  ]) assert.ok(names.includes(expected));
  const values = Object.fromEntries(collection.variable.map(({ key, value }) => [key, value]));
  for (const key of ["baseUrl", "internalApiKey", "agentPhone", "countryCode", "deviceId", "targetId"]) assert.ok(values[key]);
  assert.match(JSON.stringify(collection), /expected fail-closed/);
  assert.match(JSON.stringify(collection), /X-Controlled-Mutation/);
});

test("request IDs preserve safe trusted values and replace unsafe values", () => {
  for (const incoming of ["trusted_123", "bad value"]) {
    const headers = {};
    const req = { get: () => incoming };
    const res = { setHeader: (name, value) => { headers[name] = value; } };
    let nextCalled = false;
    requestId(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(headers["x-request-id"], req.requestId);
    if (incoming === "trusted_123") assert.equal(req.requestId, incoming);
    else assert.match(req.requestId, /^[0-9a-f-]{36}$/i);
  }
});

test("sessions construct isolated cookie headers", () => {
  assert.equal(buildCookieHeader(sessionA), "hagouid=a; uaasCookie=one");
  assert.equal(buildCookieHeader({ hagoUid: "7", cookies: { hagouid: "b", uaasCookie: "two" } }), "hagouid=b; uaasCookie=two");
  assert.equal(buildCookieHeader({ cookies: { hagouid: "partial" } }), null);
});

test("session validation exposes only VALID, REJECTED, or UNKNOWN and never makes a partial-session request", async () => {
  const statusFor = async (response) => createUaasClient({ http: { get: async () => response } }).probeSession(sessionA);
  assert.deepEqual(await statusFor({ data: { result_code: "00000", mobile: "not-returned" } }), { status: "VALID" });
  assert.deepEqual(await statusFor({ data: { result_code: "401" } }), { status: "REJECTED" });
  assert.deepEqual(await statusFor({ data: "not-an-object" }), { status: "UNKNOWN" });
  assert.deepEqual(await createUaasClient({ http: { get: async () => { throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); } } }).probeSession(sessionA), { status: "UNKNOWN" });
  let called = false;
  assert.deepEqual(await createUaasClient({ http: { get: async () => { called = true; } } }).probeSession({ cookies: { hagouid: "partial" } }), { status: "REJECTED" });
  assert.equal(called, false);
});

test("encrypted session decode failures normalize before any read-only upstream boundary", () => {
  const prior = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  const wrongCipher = new SessionSecretCipher(Buffer.alloc(32, 9));
  const user = {
    hagoSession: { hagouid: wrongCipher.encrypt("synthetic-user"), uaasCookie: wrongCipher.encrypt("synthetic-cookie") },
  };
  const result = hagoService._test.resolveSession(user);
  assert.deepEqual(result, { ok: false });
  return hagoService.verifySession(user).then((status) => {
    assert.deepEqual(status, { status: "UNKNOWN" });
  }).finally(() => {
    if (prior === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = prior;
  });
});

test("TurnoverSigner matches the sanitized wallet signing vector", () => {
  const signed = createTurnoverSigner().signData(buildWalletData(sessionA));
  assert.equal(signed.data, '{"version":0,"appId":1802,"cmd":1005,"jsonMsg":{"cmd":1005,"uid":"42","appId":1802,"usedChannel":10000}}');
  assert.equal(signed.sign, "ac4a4985142b65710608799c72d83a1f");
});

test("turnover wallet request is signed and keeps account cookies isolated", async () => {
  const calls = [];
  const client = createTurnoverClient({ http: { get: async (...args) => { calls.push(args); return { data: { code: 200, result: 1, jsonMsg: '{"uid":42,"accountList":[]}' } }; } } });
  const result = await client.getWallet(sessionA);
  assert.equal(result.ok, true);
  assert.equal(calls[0][1].headers.Cookie, "hagouid=a; uaasCookie=one");
  assert.equal(calls[0][1].params.sign, "ac4a4985142b65710608799c72d83a1f");
});

test("wallet parsing normalizes confirmed currencies without relying on account order", () => {
  assert.deepEqual(parseTurnoverWallet({ code: 200, result: 1, jsonMsg: JSON.stringify({ accountList: [
    { currencyType: 1826, amount: 3 }, { currencyType: 1805, amount: 10 }, { currencyType: 1835, amount: 4 }, { currencyType: 1805, amount: 2 }, { currencyType: 9999, amount: 99 },
  ] }) }), {
    balances: { hagoDiamond: 12, hagoDiamondNew: 4, hagoCrystal: 3 },
  });
  assert.deepEqual(parseTurnoverWallet({ code: 200, result: 1, jsonMsg: JSON.stringify({ accountList: [] }) }), {
    balances: { hagoDiamond: null, hagoDiamondNew: null, hagoCrystal: null },
  });
  assert.equal(parseTurnoverWallet({ code: 200, result: 1, jsonMsg: JSON.stringify({ accountList: {} }) }), null);
  assert.equal(parseTurnoverWallet({ code: 200, result: 1, jsonMsg: "not json" }), null);
});

test("only evidence-confirmed Hago currency constants are exported", () => {
  assert.deepEqual(HAGO_CURRENCIES, { HAGO_DIAMOND: 1805, HAGO_CRYSTAL: 1826, HAGO_DIAMOND_NEW: 1835 });
});

test("VID lookup maps infos[0].uid and uses the per-account session", async () => {
  const calls = [];
  const client = createYmicroClient({ now: () => 99, http: { post: async (...args) => { calls.push(args); return { data: { result: { errcode: 0 }, infos: [{ uid: 7, vid: 9, nick: "n" }] } }; } } });
  const result = await client.getTargetByVid(sessionA, "9");
  assert.equal(result.user.uid, "7");
  assert.equal(calls[0][0], "https://api.ihago.net/ymicro/sapi");
  assert.equal(calls[0][2].headers.Cookie, "hagouid=a; uaasCookie=one");
  assert.equal(buildMetadata({ hagoUid: "88" }, 1234).params["hago-seq-id"], "1234");
  assert.equal(parseYmicroUser({ result: { errcode: 0 }, infos: [] }), null);
  assert.equal(normalizeYmicroId("not-a-vid"), null);
  assert.equal(normalizeYmicroId("9"), 9);
  const invalid = await client.getTargetByVid(sessionA, "not-a-vid");
  assert.equal(invalid.kind, "INVALID_REQUEST");
  assert.equal(calls.length, 1);
});

test("agent profile uses the decrypted hagouid internal UID, never a long h_open_id", async () => {
  const longHOpenId = "123456789012345678901234567890";
  const prior = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  try {
    const mappedSession = hagoService._test.getSession({
      hagoUid: longHOpenId,
      hOpenId: longHOpenId,
      hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" },
    });
    assert.equal(mappedSession.hagoUid, "42");
    const calls = [];
    const profileClient = createYmicroClient({ http: { post: async (...args) => {
      calls.push(args);
      return { data: { result: { errcode: 0 }, infos: [{ uid: 42, vid: 99, nick: "synthetic" }] } };
    } } });
    const profile = await profileClient.getUserByUid(mappedSession, mappedSession.hagoUid);
    assert.deepEqual(profile.user, { uid: "42", vid: "99", nick: "synthetic", avatar: undefined, country: undefined });
    assert.equal(calls[0][1].uids[0].uid, 42);
    assert.match(calls[0][2].params["X-Request-Id"], /^42-/);
    const noUser = await createYmicroClient({ http: { post: async () => ({ data: { result: { errcode: 0 }, infos: [] } }) } }).getTargetByVid(sessionA, "99");
    assert.deepEqual(noUser, { ok: false, kind: "BUSINESS_ERROR", message: "Hago returned no matching user" });
    assert.equal((await profileClient.getUserByUid(sessionA, "not-a-uid")).kind, "INVALID_REQUEST");
  } finally {
    if (prior === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = prior;
  }
});

test("Nobility read-only yMicro client uses the captured simple-RPC URL, metadata, text body, and isolated cookies", async () => {
  const calls = [];
  const sequences = [1700000000000, 1700000000001];
  const client = createNobilityReadOnlyClient({
    now: () => sequences.shift(),
    http: { post: async (...args) => {
      calls.push(args);
      if (args[2].params.method === "Noble.ListAllNobleConf") {
        return { data: { info: [{ noble_type: 1, buy_info: { turnover_pack_id: "synthetic-buy", total_rebate_diamond: 20 }, renew_info: { turnover_pack_id: "synthetic-renew", total_rebate_diamond: 10 } }] } };
      }
      return { data: { info: { noble_type: 1, noble_status: 2, remain_seconds: 86400 } } };
    } },
  });
  assert.equal(typeof client.buyNobleByAgency, "undefined");
  const result = await client.getReadiness(sessionA, "42");
  assert.deepEqual(result, { ok: true, nobility: {
    current: { type: 1, status: 2, remainingDays: 1 },
    available: [{ type: 1, name: "Knight", purchaseDiamond: 20, renewDiamond: 10, purchasePackAvailable: true, renewPackAvailable: true }],
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], NOBLE_YMICRO_URL);
  assert.equal(calls[0][1], '{"sequence":1700000000000,"os_type":"android"}');
  assert.equal(calls[1][1], '{"sequence":1700000000001,"uid":42}');
  assert.equal(typeof JSON.parse(calls[0][1]).sequence, "number");
  assert.equal(typeof JSON.parse(calls[1][1]).sequence, "number");
  assert.equal(calls[0][2].headers["Content-Type"], "text/plain");
  assert.equal(calls[0][2].headers.Cookie, "hagouid=a; uaasCookie=one");
  assert.deepEqual(calls[0][2].params, {
    method: "Noble.ListAllNobleConf", sname: "net.ihago.money.api.noble", "hago-app-name": "hago", "X-App-Name": "hago",
    "hago-seq-id": "1700000000000", "X-Request-Id": "42-1700000000000", "X-Lang": "en", "X-App-Ver": "0", "X-OsType": "android",
    "X-Os-Ver": "", "X-App-Channel": "", "X-Reg-Country": "ae", "X-From-Reg-Country": "",
  });
  assert.deepEqual(calls[1][2].params, {
    method: "Noble.GetUserNoble", sname: "net.ihago.money.api.noble", "hago-app-name": "hago", "X-App-Name": "hago",
    "hago-seq-id": "1700000000001", "X-Request-Id": "42-1700000000001", "X-Lang": "en", "X-App-Ver": "0", "X-OsType": "android",
    "X-Os-Ver": "", "X-App-Channel": "", "X-Reg-Country": "ae", "X-From-Reg-Country": "",
  });
  assert.equal(calls[1][2].headers["Content-Type"], "text/plain");
  assert.equal(calls[1][2].headers.Cookie, calls[0][2].headers.Cookie);
  assert.equal(calls.some(([, , options]) => String(options?.params?.method).includes("BuyNobleByAgency")), false);

  const secondCalls = [];
  const otherSession = { hagoUid: "77", cookies: { hagouid: "b", uaasCookie: "two" } };
  await createNobilityReadOnlyClient({ http: { post: async (...args) => { secondCalls.push(args); return { data: { info: [] } }; } } }).listAllNobleConf(otherSession);
  assert.equal(secondCalls[0][2].headers.Cookie, "hagouid=b; uaasCookie=two");
  assert.notEqual(secondCalls[0][2].headers.Cookie, calls[0][2].headers.Cookie);
  assert.deepEqual(buildNobleYmicroMetadata({ hagoUid: "42" }, "Noble.GetUserNoble", 99).params["hago-seq-id"], "99");
});

test("Nobility read-only client normalizes malformed, rejected, and timeout responses without retries", async () => {
  let calls = 0;
  const malformed = await createNobilityReadOnlyClient({ http: { post: async () => { calls += 1; return { data: { info: {} } }; } } }).listAllNobleConf(sessionA);
  assert.equal(malformed.kind, "UNKNOWN");
  assert.equal(calls, 1);
  const expectedDiagnostics = { stage: "GET_USER_NOBLE", upstreamHttpStatus: null, uidWireType: "number", method: "Noble.GetUserNoble" };
  const rejected = await createNobilityReadOnlyClient({ http: { post: async () => ({ data: { result: { errcode: 7 } } }) } }).getUserNoble(sessionA, "42");
  assert.deepEqual(rejected, { ok: false, kind: "REJECTED", message: "Hago rejected the Nobility read-only request", ...expectedDiagnostics });
  const timeout = await createNobilityReadOnlyClient({ http: { post: async () => { const error = new Error("timeout"); error.code = "ECONNABORTED"; throw error; } } }).getUserNoble(sessionA, "42");
  assert.deepEqual(timeout, { ok: false, kind: "TIMEOUT", message: "Hago request timed out", ...expectedDiagnostics });
  const httpError = await createNobilityReadOnlyClient({ http: { post: async () => { const error = new Error("synthetic"); error.response = { status: 418, data: { private: "never returned" } }; throw error; } } }).listAllNobleConf(sessionA);
  assert.deepEqual(httpError, { ok: false, kind: "UPSTREAM_HTTP_FAILURE", message: "Hago returned an upstream HTTP failure", stage: "LIST_NOBLE_CONFIG", upstreamHttpStatus: 418 });
});

test("Nobility GetUserNoble preserves browser numeric UID semantics and rejects unsafe values before HTTP", async () => {
  const resolvedUser = parseYmicroUser({ result: { errcode: 0 }, infos: [{ uid: 42, vid: 9 }] });
  assert.equal(typeof resolvedUser.uid, "string");
  assert.equal(normalizeNobleUid("42"), 42);
  assert.equal(normalizeNobleUid(42), 42);
  assert.equal(normalizeNobleUid("42x"), null);
  assert.equal(normalizeNobleUid("9007199254740992"), null);
  const calls = [];
  const client = createNobilityReadOnlyClient({ now: () => 1700000000002, http: { post: async (...args) => {
    calls.push(args);
    return { data: { info: { noble_type: 0, noble_status: 0, remain_seconds: 0 } } };
  } } });
  await client.getUserNoble(sessionA, resolvedUser.uid);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '{"sequence":1700000000002,"uid":42}');
  assert.equal(typeof JSON.parse(calls[0][1]).uid, "number");
  const invalid = await client.getUserNoble(sessionA, "9007199254740992");
  assert.equal(invalid.kind, "INVALID_REQUEST");
  assert.equal(calls.length, 1);
});

test("history uses bounded signed JSON data in multipart fields", async () => {
  const calls = [];
  const client = createTurnoverClient({ http: { post: async (...args) => { calls.push(args); return { data: { jsonMsg: '{"list":[],"page":1}' } }; } } });
  const query = { page: 1, pagesize: 20, optTypes: [1], vid: "7", currencyTypeList: [1805, 1826], startTime: 1700000000000, endTime: 1700000001000 };
  const result = await client.getHistory(sessionA, query);
  assert.equal(result.ok, true);
  assert.equal(calls[0][1].get("appId"), "1802");
  assert.match(calls[0][0], /\/agencypay\/queryAccountHistory$/);
  assert.deepEqual(result.history, { list: [], page: 1 });
  const signedHistory = JSON.parse(calls[0][1].get("data"));
  assert.deepEqual(signedHistory, { qtype: 2, optTypes: [1], page: 1, pagesize: 20, startTime: 1700000000000, endTime: 1700000001000, vid: "7", currencyTypeList: [1805, 1826] });
  assert.equal(calls[0][1].get("sign"), createTurnoverSigner().signData(signedHistory).sign);
  assert.deepEqual(buildHistoryData({}), { qtype: 2, optTypes: [], page: 1, pagesize: 20 });
  for (const badQuery of [{ pagesize: 101 }, { page: 10001 }, { startTime: 1 }, { startTime: 2, endTime: 1 }, { startTime: 0, endTime: 31 * 24 * 60 * 60 * 1000 + 1 }, { optTypes: ["bad"] }, { vid: "bad" }, { currencyTypeList: {} }]) {
    assert.throws(() => buildHistoryData(badQuery));
  }
  assert.equal(parseTurnoverHistory("invalid"), null);
  assert.equal(parseTurnoverHistory({ jsonMsg: "not-json" }), null);
  assert.equal(parseTurnoverHistory({}), null);
});

test("transfer readiness uses only session, agency, permissions, password-state, and wallet read-only boundaries", async () => {
  const calls = [];
  const client = createTransferReadinessClient({
    uaas: { probeSession: async () => ({ status: "VALID" }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 10, hagoDiamondNew: null, hagoCrystal: 0 } } }) },
    http: { post: async (...args) => {
      calls.push(args);
      if (args[0].includes("query_agency_info")) return { data: { data: { isAgency: true, transferMax: 12, currencyType: 1835 } } };
      if (args[0].endsWith("/permissions")) return { data: { data: { permissions: [{ funcName: "transfer_currency_to_other", status: 7 }, { funcName: "recharge_currency", status: 1 }], whitelistPermissions: [{ funcName: "recharge_crystal", status: 0 }] } } };
      if (args[0].endsWith("/has_psw")) return { data: { code: 1 } };
      assert.fail("unexpected readiness endpoint");
    } },
  });
  const result = await client.getTransferReadiness(sessionA);
  assert.deepEqual(result, { ok: true, readiness: {
    session: "VALID", isAgency: true, hasTransactionPassword: true,
    transferPermission: { present: true, status: 7 }, rechargePermission: { present: true, status: 1 }, crystalWhitelist: { present: true, status: 0 },
    agencyDiamondCurrency: 1835, effectiveTransferCurrency: 1835,
    walletDiamondLegacyAvailable: true, walletDiamondNewAvailable: false, crystalBalanceAvailable: false, transferMax: 12,
  } });
  const agency = calls.find(([url]) => url.includes("query_agency_info"));
  assert.equal(agency[1].get("appId"), "1802");
  assert.equal(agency[1].get("sign"), "");
  assert.equal(agency[1].get("data"), "");
  for (const [url, form] of calls.filter(([url]) => !url.includes("query_agency_info"))) {
    assert.ok(url.endsWith("/permissions") || url.endsWith("/has_psw"));
    assert.equal(form.get("data"), "{}");
    assert.equal(form.get("sign"), createTurnoverSigner().signData({}).sign);
  }
  assert.equal(calls.some(([url]) => /transfer_account|verify_psw|set_pay_psw/.test(url)), false);
});

test("transfer readiness stops after a rejected session and preserves uncertain raw fields as null", async () => {
  let httpCalled = false;
  const client = createTransferReadinessClient({
    uaas: { probeSession: async () => ({ status: "REJECTED" }) },
    turnover: { getWallet: async () => assert.fail("wallet must not run for rejected session") },
    http: { post: async () => { httpCalled = true; } },
  });
  assert.deepEqual(await client.getTransferReadiness(sessionA), { ok: true, readiness: {
    session: "REJECTED", isAgency: null, hasTransactionPassword: null,
    transferPermission: { present: false, status: null }, rechargePermission: { present: false, status: null }, crystalWhitelist: { present: false, status: null },
    agencyDiamondCurrency: null, effectiveTransferCurrency: 1805,
    walletDiamondLegacyAvailable: false, walletDiamondNewAvailable: false, crystalBalanceAvailable: false, transferMax: null,
  } });
  assert.equal(httpCalled, false);
  assert.deepEqual(parseAgencyReadiness({ data: { isAgency: "unknown", transferMax: "no" } }), { isAgency: null, transferMax: null, agencyDiamondCurrency: null });
  assert.deepEqual(parsePermissionReadiness({ data: { permissions: [{ funcName: "transfer_currency_to_other", status: "not-numeric" }] } }).transferPermission, { present: true, status: null });
  assert.equal(parsePasswordReadiness({ code: 0 }), false);
  assert.equal(parsePasswordReadiness({}), null);
  assert.deepEqual(parseWalletReadiness({ balances: { hagoDiamond: 0, hagoDiamondNew: 0, hagoCrystal: null } }), { walletDiamondLegacyAvailable: false, walletDiamondNewAvailable: false, crystalBalanceAvailable: false });
});

test("transfer readiness controller returns only sanitized diagnostic data", async () => {
  const originalUserFindOne = User.findOne;
  const previousKey = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  hagoService._test.setIntegrationForTest({ readiness: { getTransferReadiness: async () => ({ ok: true, readiness: {
    session: "VALID", isAgency: null, hasTransactionPassword: false,
    transferPermission: { present: true, status: 7 }, rechargePermission: { present: false, status: null }, crystalWhitelist: { present: false, status: null },
    agencyDiamondCurrency: 1805, effectiveTransferCurrency: 1805,
    walletDiamondLegacyAvailable: true, walletDiamondNewAvailable: false, crystalBalanceAvailable: false, transferMax: null,
  } }) } });
  const res = { body: undefined, status() { return this; }, json(body) { this.body = body; return body; } };
  try {
    await botController.getTransferReadiness({ body: { agentPhone: "201000000000" } }, res);
    assert.equal(res.body.status, "SUCCESS");
    assert.equal(Object.hasOwn(res.body.readiness, "cookies"), false);
    assert.equal(JSON.stringify(res.body).includes("synthetic-cookie"), false);
    assert.equal(JSON.stringify(res.body).includes("201000000000"), false);
    assert.match(fs.readFileSync("src/routes/botRoutes.js", "utf8"), /transfer-readiness/);
  } finally {
    User.findOne = originalUserFindOne;
    hagoService._test.resetIntegrationForTest();
    if (previousKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previousKey;
  }
});

test("Nobility readiness resolves a VID through the existing boundary and returns only sanitized read-only state", async () => {
  const originalUserFindOne = User.findOne;
  const previousKey = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  let resolvedTarget = false;
  hagoService._test.setIntegrationForTest({
    ymicro: { getTargetByVid: async () => { resolvedTarget = true; return { ok: true, user: { uid: "synthetic-target-uid" } }; } },
    nobility: { getReadiness: async (_session, targetUid) => {
      assert.equal(targetUid, "synthetic-target-uid");
      return { ok: true, nobility: { current: { type: 0, status: 0, remainingDays: null }, available: [] } };
    } },
  });
  const res = { body: undefined, status() { return this; }, json(body) { this.body = body; return body; } };
  try {
    await botController.getNobilityReadiness({ body: { agentPhone: "201000000000", targetId: "9" } }, res);
    assert.equal(res.body.status, "SUCCESS");
    assert.equal(resolvedTarget, true);
    assert.deepEqual(res.body.nobility, { current: { type: 0, status: 0, remainingDays: null }, available: [] });
    assert.equal(JSON.stringify(res.body).includes("201000000000"), false);
    assert.equal(JSON.stringify(res.body).includes("synthetic-target-uid"), false);
    assert.equal(JSON.stringify(res.body).includes("synthetic-cookie"), false);
    assert.match(fs.readFileSync("src/routes/botRoutes.js", "utf8"), /nobility-readiness/);
  } finally {
    User.findOne = originalUserFindOne;
    hagoService._test.resetIntegrationForTest();
    if (previousKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previousKey;
  }
});

test("Nobility readiness failures expose only a safe stage and upstream HTTP status", async () => {
  const originalUserFindOne = User.findOne;
  const previousKey = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  hagoService._test.setIntegrationForTest({
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "synthetic-target-uid" } }) },
    nobility: { getReadiness: async () => ({ ok: false, kind: "UPSTREAM_HTTP_FAILURE", message: "Hago returned an upstream HTTP failure", stage: "GET_USER_NOBLE", upstreamHttpStatus: 599, uidWireType: "number", method: "Noble.GetUserNoble" }) },
  });
  const res = { statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  try {
    await botController.getNobilityReadiness({ body: { agentPhone: "201000000000", targetId: "9" } }, res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { status: "ERROR", message: "Hago returned an upstream HTTP failure", code: "UPSTREAM_HTTP_FAILURE", stage: "GET_USER_NOBLE", upstreamHttpStatus: 599, uidWireType: "number", method: "Noble.GetUserNoble" });
    assert.equal(JSON.stringify(res.body).includes("synthetic-target-uid"), false);
    assert.equal(JSON.stringify(res.body).includes("synthetic-cookie"), false);
    assert.equal(JSON.stringify(res.body).includes("201000000000"), false);
  } finally {
    User.findOne = originalUserFindOne;
    hagoService._test.resetIntegrationForTest();
    if (previousKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previousKey;
  }
});

test("Nobility purchase readiness derives fresh configuration eligibility without a mutation path", async () => {
  let config = [
    { type: 1, name: "synthetic-name", buyInfo: { turnoverPackId: "synthetic-buy-pack", diamond: 20 }, renewInfo: { turnoverPackId: "synthetic-renew-pack", diamond: 10 } },
    { type: 4, buyInfo: { turnoverPackId: "synthetic-duke-pack", diamond: 80 }, renewInfo: { turnoverPackId: "synthetic-duke-renew-pack", diamond: 40 } },
  ];
  let current = { type: 0, status: 1, remainingSeconds: 0 };
  let balance = 30;
  let mutationCalls = 0;
  const client = createNobilityPurchaseReadinessClient({
    uaas: { probeSession: async () => ({ status: "VALID" }) },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "42" } }) },
    nobility: {
      listAllNobleConf: async () => ({ ok: true, config }),
      getUserNoble: async () => ({ ok: true, current }),
      buyNobleByAgency: async () => { mutationCalls += 1; },
    },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: balance } } }) },
  });

  const purchase = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.deepEqual(purchase, { ok: true, readiness: {
    selectedType: 1, selectedName: "Knight", current: { type: 0, status: 1, remainingDays: 0 },
    derivedBuyType: 1, derivedBuyTypeName: "PURCHASE", diamondCost: 20, packAvailable: true,
    wallet: { available: 30, sufficient: true }, lowerTierBlocked: false, confirmationRequired: false,
    technicallyEligible: true, blockReason: null,
  } });

  current = { type: 1, status: 2, remainingSeconds: 86400 };
  const renew = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.equal(renew.readiness.derivedBuyType, BUY_TYPES.RENEW);
  assert.equal(renew.readiness.derivedBuyTypeName, "RENEW");
  assert.equal(renew.readiness.diamondCost, 10);
  assert.equal(renew.readiness.technicallyEligible, true);

  current = { type: 4, status: 2, remainingSeconds: 86400 };
  const lower = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.equal(lower.readiness.lowerTierBlocked, true);
  assert.equal(lower.readiness.technicallyEligible, false);
  assert.equal(lower.readiness.blockReason, "NOBILITY_LOWER_LEVEL");

  current = { type: 1, status: NOBLE_STATUSES.NORMAL, remainingSeconds: 86400 };
  const confirmation = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 4 });
  assert.equal(confirmation.readiness.confirmationRequired, true);
  assert.equal(confirmation.readiness.technicallyEligible, false);
  assert.equal(confirmation.readiness.blockReason, "NOBILITY_CONFIRMATION_REQUIRED");

  current = { type: 0, status: 0, remainingSeconds: 0 };
  balance = 1;
  const insufficient = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.equal(insufficient.readiness.blockReason, "NOBILITY_INSUFFICIENT_DIAMOND");
  assert.equal(insufficient.readiness.wallet.sufficient, false);

  balance = 30;
  config = [{ type: 1, buyInfo: { turnoverPackId: null, diamond: 20 }, renewInfo: { turnoverPackId: "synthetic-renew-pack", diamond: 10 } }];
  const missingPack = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.equal(missingPack.readiness.packAvailable, false);
  assert.equal(missingPack.readiness.blockReason, "NOBILITY_PACK_UNAVAILABLE");

  config = [{ type: 1, buyInfo: { turnoverPackId: "fresh-synthetic-pack", diamond: 25 }, renewInfo: { turnoverPackId: "synthetic-renew-pack", diamond: 10 } }];
  const fresh = await client.getReadiness(sessionA, { targetId: "9", nobilityType: 1 });
  assert.equal(fresh.readiness.diamondCost, 25);
  assert.equal(mutationCalls, 0);
  assert.equal(JSON.stringify(fresh).includes("fresh-synthetic-pack"), false);
  assert.equal(JSON.stringify(fresh).includes("42"), false);
});

test("Nobility purchase readiness controller is numeric-only, sanitized, and creates no mutation intent", async () => {
  const originalUserFindOne = User.findOne;
  const originalTransactionCreate = Transaction.create;
  const previousKey = process.env.HAGO_SESSION_ENCRYPTION_KEY;
  let preparationCalls = 0;
  let senderCalls = 0;
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  Transaction.create = async () => assert.fail("read-only purchase readiness must not create a transaction");
  hagoService._test.setIntegrationForTest({
    nobilityPurchaseReadiness: {
      getReadiness: async (_session, input) => {
        preparationCalls += 1;
        assert.deepEqual(input, { targetId: "9", nobilityType: 1 });
        return { ok: true, readiness: {
          selectedType: 1, selectedName: "Knight", current: { type: 0, status: 0, remainingDays: 0 },
          derivedBuyType: 1, derivedBuyTypeName: "PURCHASE", diamondCost: 20, packAvailable: true,
          wallet: { available: 30, sufficient: true }, lowerTierBlocked: false, confirmationRequired: false,
          technicallyEligible: true, blockReason: null,
        } };
      },
    },
    nobilityMutation: { sendPreparedPurchase: async () => { senderCalls += 1; } },
  });
  const response = () => ({ statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } });
  try {
    const valid = response();
    await botController.getNobilityPurchaseReadiness({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: 1 }, get: () => undefined }, valid);
    assert.equal(valid.statusCode, undefined);
    assert.equal(valid.body.status, "SUCCESS");
    assert.equal(preparationCalls, 1);
    assert.equal(senderCalls, 0);
    const serialized = JSON.stringify(valid.body);
    for (const secret of ["201000000000", "synthetic-cookie", "42", "9"]) assert.equal(serialized.includes(secret), false);
    assert.equal(Object.hasOwn(valid.body.nobilityPurchaseReadiness, "turnoverPackId"), false);

    const stringType = response();
    await botController.getNobilityPurchaseReadiness({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: "1" } }, stringType);
    assert.equal(stringType.statusCode, 400);
    const injected = response();
    await botController.getNobilityPurchaseReadiness({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: 1, diamond: 1, turnover_pack_id: "inject", buy_type: 2, buyer_uid: 42 } }, injected);
    assert.equal(injected.statusCode, 400);
    assert.equal(preparationCalls, 1);
    assert.equal(senderCalls, 0);
    assert.match(fs.readFileSync("src/routes/botRoutes.js", "utf8"), /nobility-purchase-readiness/);
  } finally {
    User.findOne = originalUserFindOne;
    Transaction.create = originalTransactionCreate;
    hagoService._test.resetIntegrationForTest();
    if (previousKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previousKey;
  }
});

test("mutation builder has the proven shape and preserves only confirmed response semantics", () => {
  assert.deepEqual(buildTransferAccountRequest({ targetUid: "7", transferAmount: 10, currencyType: 1805, useGoldCurrency: false, seqId: "42717000000000000" }), { appId: "1802", sign: "", data: '{"targetUid":"7","transferAmount":10,"currencyType":1805,"useGoldCurrency":false,"seqId":"42717000000000000"}' });
  for (const serviceType of ["DIAMOND", "CRYSTAL"]) {
    const success = parseTransferAccountResponse({ code: 1 });
    assert.deepEqual(success, { outcome: "SUCCESS", upstreamCode: 1 }, `${serviceType} uses the confirmed transfer_account success code`);
    const successfulTransaction = {};
    assert.deepEqual(botController._test.applyControlledOutcome(successfulTransaction, success), { status: 200, bodyStatus: "SUCCESS" });
    assert.equal(successfulTransaction.status, "SUCCESS");
    assert.equal(successfulTransaction.upstreamStatus, "SUCCESS");
  }
  assert.deepEqual(parseTransferAccountResponse({ code: -401 }), { outcome: "SESSION_PROBLEM", upstreamCode: -401 });
  assert.deepEqual(parseTransferAccountResponse({ code: -76 }), { outcome: "TRANSFER_LIMIT", upstreamCode: -76 });
  assert.deepEqual(parseTransferAccountResponse({ code: -9 }), { outcome: "REJECTED", upstreamCode: -9 });
  assert.deepEqual(parseTransferAccountResponse({}), { outcome: "UNKNOWN", upstreamCode: null });
  assert.deepEqual(parseTransferAccountResponse({ code: null }), { outcome: "UNKNOWN", upstreamCode: null });
  const rejectedTransaction = {};
  assert.deepEqual(botController._test.applyControlledOutcome(rejectedTransaction, parseTransferAccountResponse({ code: -500 })), { status: 409, bodyStatus: "ERROR", code: "REJECTED" });
  assert.equal(rejectedTransaction.status, "FAILED");
  assert.equal(rejectedTransaction.upstreamStatus, "FAILED");
});

test("local Diamond preview proves browser request type, order, and header parity without HTTP", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => assert.fail("local mutation preview must not make a network request");
  let preview;
  try {
    preview = buildDiamondMutationPreview({ amount: "100", now: () => 1700000000000 });
  } finally {
    global.fetch = originalFetch;
  }
  assert.deepEqual(preview, {
    serviceType: "DIAMOND",
    amountType: "number",
    targetUidType: "string",
    currencyType: null,
    currencyTypeType: "number",
    useGoldCurrency: false,
    useGoldCurrencyType: "boolean",
    seqIdShapeValid: true,
    multipartFieldNames: ["appId", "sign", "data"],
    dataPropertyNames: ["targetUid", "transferAmount", "currencyType", "useGoldCurrency", "seqId"],
    headerNames: ["Cookie", "X-AuthType", "X-App-Name", "X-AppId", "country", "language"],
    cookieNamesPresent: ["hagouid", "uaasCookie"],
  });
  assert.equal(JSON.stringify(preview).includes("preview-"), false);

  const res = { body: undefined, statusCode: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  await botController.previewDiamondMutation({ body: { agentPhone: "201000000000", targetId: "9001", amount: "100" } }, res);
  assert.equal(res.body.amountType, "number");
  assert.equal(res.body.targetUidType, "string");
  assert.equal(res.body.currencyTypeType, "number");
  assert.equal(res.body.useGoldCurrencyType, "boolean");
  assert.deepEqual(res.body.multipartFieldNames, ["appId", "sign", "data"]);
  assert.deepEqual(res.body.dataPropertyNames, ["targetUid", "transferAmount", "currencyType", "useGoldCurrency", "seqId"]);
  assert.equal(res.body.headerNames.includes("Cookie"), true);
  assert.equal(res.body.cookieNamesPresent.includes("hagouid"), true);
  assert.equal(res.body.cookieNamesPresent.includes("uaasCookie"), true);
  assert.equal(JSON.stringify(res.body).includes("201000000000"), false);
  assert.equal(JSON.stringify(res.body).includes("9001"), false);
  assert.match(fs.readFileSync("src/routes/botRoutes.js", "utf8"), /auto-recharge\/diamond\/preview/);
});

test("Nobility enums, config selection, UI decisions, and logical payload are source-confirmed and local only", () => {
  assert.deepEqual(NOBLE_TYPES, { NONE: 0, KNIGHT: 1, VISCOUNT: 2, EARL: 3, DUKE: 4 });
  assert.deepEqual(BUY_TYPES, { NONE: 0, PURCHASE: 1, RENEW: 2 });
  assert.equal(NOBLE_STATUSES.RENEW_PERIOD, 4);
  assert.equal(NOBLE_RPC.package, "net.ihago.money.api.noble");
  assert.equal(NOBLE_RPC.service, "Noble");
  assert.deepEqual(buildListAllNobleConfRequest(), { os_type: "android" });
  assert.deepEqual(buildGetUserNobleRequest(42), { uid: 42 });
  assert.deepEqual(buildGetUserGPSubStatusRequest(42), { fix_uid: 42 });

  const config = parseNobleConfig({ info: [
    { noble_type: 1, buy_info: { turnover_pack_id: "buy-pack", total_rebate_diamond: 10 }, renew_info: { turnover_pack_id: "renew-pack", total_rebate_diamond: 7 } },
  ] });
  assert.deepEqual(config, [{ type: 1, name: null, buyInfo: { turnoverPackId: "buy-pack", diamond: 10 }, renewInfo: { turnoverPackId: "renew-pack", diamond: 7 } }]);
  assert.deepEqual(selectNoblePurchase(config, 1, BUY_TYPES.PURCHASE), { type: 1, buyType: 1, turnoverPackId: "buy-pack", diamond: 10 });
  assert.deepEqual(selectNoblePurchase(config, 1, BUY_TYPES.RENEW), { type: 1, buyType: 2, turnoverPackId: "renew-pack", diamond: 7 });
  assert.deepEqual(parseCurrentNoble({ info: { noble_type: 2, noble_name: "synthetic", noble_status: 3, remain_seconds: 86400 } }), { type: 2, name: "synthetic", status: 3, remainingSeconds: 86400 });

  assert.deepEqual(decideNoblePurchase({ selectedNobleType: 2, current: { type: 2, status: NOBLE_STATUSES.NORMAL } }), { ok: true, buyType: BUY_TYPES.RENEW, requiresConfirmation: false, confirmationReason: null });
  assert.deepEqual(decideNoblePurchase({ selectedNobleType: 3, current: { type: 2, status: NOBLE_STATUSES.NORMAL } }), { ok: true, buyType: BUY_TYPES.PURCHASE, requiresConfirmation: true, confirmationReason: "ACTIVE_NOBLE_CHANGE" });
  assert.equal(decideNoblePurchase({ selectedNobleType: 1, current: { type: 2, status: NOBLE_STATUSES.DUE_SOON } }).kind, "LOWER_NOBLE_ACTIVE");
  assert.equal(decideNoblePurchase({ selectedNobleType: 1, current: { type: 2, status: NOBLE_STATUSES.RENEW_PERIOD } }).kind, "LOWER_NOBLE_RENEW_PERIOD");
  assert.deepEqual(decideNoblePurchase({ selectedNobleType: 3, current: { type: 2, status: NOBLE_STATUSES.EXPIRED }, subscriptions: [{ noble_type: 1, sub_status: 3 }] }), { ok: true, buyType: BUY_TYPES.PURCHASE, requiresConfirmation: true, confirmationReason: "ACTIVE_GOOGLE_PLAY_SUBSCRIPTION" });

  const payload = buildBuyNobleByAgencyPayload({ nobleType: 1, buyType: BUY_TYPES.PURCHASE, buyerUid: "7", diamond: 10, turnoverPackId: "buy-pack", appName: "hago" });
  assert.deepEqual(Object.keys(payload), ["noble_type", "buy_type", "buyer_uid", "diamond", "turnover_pack_id", "app_name"]);
  assert.deepEqual(payload, { noble_type: 1, buy_type: 1, buyer_uid: "7", diamond: 10, turnover_pack_id: "buy-pack", app_name: "hago" });
  assert.deepEqual(normalizeNobleResponse({ is_ok: true }), { outcome: "SUCCESS", code: null });
  assert.deepEqual(normalizeNobleResponse({ code: 30500 }), { outcome: "REJECTED", code: 30500, kind: "BssDiamondNotEnough" });
  assert.deepEqual(normalizeNobleResponse({ code: 30201 }), { outcome: "REJECTED", code: 30201, kind: "BssRenewTimesOverLimit" });
  assert.deepEqual(normalizeNobleResponse({ is_ok: false }), { outcome: "UNKNOWN", code: null, kind: null });

  const successTransaction = {};
  assert.deepEqual(botController._test.applyControlledOutcome(successTransaction, normalizeNobilityOutcome({ is_ok: true })), { status: 200, bodyStatus: "SUCCESS" });
  assert.equal(successTransaction.status, "SUCCESS");
  for (const code of [30201, 30500]) {
    const rejectedTransaction = {};
    assert.deepEqual(botController._test.applyControlledOutcome(rejectedTransaction, normalizeNobilityOutcome({ code })), { status: 409, bodyStatus: "ERROR", code: "REJECTED" });
    assert.equal(rejectedTransaction.status, "FAILED");
  }
  for (const payload of [{ code: 999 }, { is_ok: false }, null]) {
    const unknownTransaction = {};
    assert.deepEqual(botController._test.applyControlledOutcome(unknownTransaction, normalizeNobilityOutcome(payload)), { status: 502, bodyStatus: "ERROR", code: "MUTATION_OUTCOME_UNKNOWN" });
    assert.equal(unknownTransaction.status, "UNKNOWN");
  }
});

test("Nobility preparation derives fresh price, pack, and buy type without caller-controlled financial fields", async () => {
  const calls = [];
  let config = [{ type: 2, buyInfo: { turnoverPackId: "synthetic-buy-pack", diamond: 30 }, renewInfo: { turnoverPackId: "synthetic-renew-pack", diamond: 20 } }];
  const client = createNobilityMutationClient({
    http: { post: async (...args) => { calls.push(args); return { data: { is_ok: true } }; } },
    uaas: { probeSession: async () => ({ status: "VALID" }) },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    nobility: { listAllNobleConf: async () => ({ ok: true, config }), getUserNoble: async () => ({ ok: true, current: { type: 2, status: 5 } }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 40, hagoDiamondNew: 999, hagoCrystal: 999 } } }) },
    now: () => 1700000000000,
  });
  const renew = await client.preparePurchase(sessionA, { targetId: "9", nobilityType: 2 });
  assert.equal(renew.ok, true);
  assert.equal(renew.buyType, BUY_TYPES.RENEW);
  assert.deepEqual(Object.keys(renew.request), ["noble_type", "buy_type", "buyer_uid", "diamond", "turnover_pack_id", "app_name"]);
  assert.deepEqual(renew.request, { noble_type: 2, buy_type: 2, buyer_uid: 7, diamond: 20, turnover_pack_id: "synthetic-renew-pack", app_name: "hago" });
  assert.equal(typeof renew.request.buyer_uid, "number");
  assert.equal(await client.sendPreparedPurchase(sessionA, renew.request, { idempotencyKey: "nobility-renew-key", env: { HAGO_NOBILITY_ENABLED: "true" } }).then((result) => result.outcome), "SUCCESS");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1]).buyer_uid, 7);
  assert.equal(calls[0][2].params.method, "Noble.BuyNobleByAgency");
  assert.equal(calls[0][2].headers["Content-Type"], "text/plain");

  const purchaseClient = createNobilityMutationClient({
    http: { post: async () => assert.fail("preparation must not send") },
    uaas: { probeSession: async () => ({ status: "VALID" }) },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    nobility: { listAllNobleConf: async () => ({ ok: true, config }), getUserNoble: async () => ({ ok: true, current: { type: 0, status: 0 } }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 40 } } }) },
  });
  const purchase = await purchaseClient.preparePurchase(sessionA, { targetId: "9", nobilityType: 2 });
  assert.equal(purchase.buyType, BUY_TYPES.PURCHASE);
  assert.equal(purchase.request.diamond, 30);
  assert.equal(purchase.request.turnover_pack_id, "synthetic-buy-pack");
  config = [{ type: 2, buyInfo: { turnoverPackId: "fresh-synthetic-buy-pack", diamond: 31 }, renewInfo: { turnoverPackId: "fresh-synthetic-renew-pack", diamond: 21 } }];
  const refreshedPurchase = await purchaseClient.preparePurchase(sessionA, { targetId: "9", nobilityType: 2 });
  assert.equal(refreshedPurchase.request.diamond, 31);
  assert.equal(refreshedPurchase.request.turnover_pack_id, "fresh-synthetic-buy-pack");
});

test("Nobility preflight blocks lower levels and insufficient legacy Diamond before a send", async () => {
  let sends = 0;
  const makeClient = ({ current, balance, price = 30 }) => createNobilityMutationClient({
    http: { post: async () => { sends += 1; assert.fail("blocked Nobility preflight must not send"); } },
    uaas: { probeSession: async () => ({ status: "VALID" }) },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    nobility: { listAllNobleConf: async () => ({ ok: true, config: [{ type: 2, buyInfo: { turnoverPackId: "pack", diamond: price }, renewInfo: { turnoverPackId: "renew", diamond: price } }] }), getUserNoble: async () => ({ ok: true, current }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: balance } } }) },
  });
  assert.equal((await makeClient({ current: { type: 3, status: 2 }, balance: 100 }).preparePurchase(sessionA, { targetId: "9", nobilityType: 2 })).kind, "LOWER_NOBLE_ACTIVE");
  assert.equal((await makeClient({ current: { type: 0, status: 0 }, balance: 20 }).preparePurchase(sessionA, { targetId: "9", nobilityType: 2 })).kind, "NOBILITY_INSUFFICIENT_DIAMOND");
  assert.equal(sends, 0);
});

test("Nobility sender uses only the production switch and idempotency key, and never retries ambiguous or unknown responses", async () => {
  const request = { noble_type: 1, buy_type: 1, buyer_uid: 7, diamond: 10, turnover_pack_id: "pack", app_name: "hago" };
  assert.equal(isNobilitySenderEnabled({ idempotencyKey: "nobility-safe-key", env: {} }), false);
  assert.equal(isNobilitySenderEnabled({ idempotencyKey: "short", env: { HAGO_NOBILITY_ENABLED: "true" } }), false);
  assert.equal(isNobilitySenderEnabled({ idempotencyKey: "nobility-safe-key", env: { HAGO_NOBILITY_ENABLED: "true" } }), true);
  let calls = 0;
  const client = createNobilityMutationClient({
    http: { post: async () => { calls += 1; throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); } },
    uaas: {}, ymicro: {}, nobility: {}, turnover: {},
  });
  assert.deepEqual(await client.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-timeout-key", env: { HAGO_NOBILITY_ENABLED: "true" } }), { outcome: "UNKNOWN", upstreamCode: null, timeout: true });
  assert.equal(calls, 1);
  const known = createNobilityMutationClient({ http: { post: async () => ({ data: { code: 30500 } }) }, uaas: {}, ymicro: {}, nobility: {}, turnover: {} });
  assert.equal((await known.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-known-key", env: { HAGO_NOBILITY_ENABLED: "true" } })).outcome, "REJECTED");
  const unknown = createNobilityMutationClient({ http: { post: async () => ({ data: { code: 999 } }) }, uaas: {}, ymicro: {}, nobility: {}, turnover: {} });
  assert.equal((await unknown.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-unknown-key", env: { HAGO_NOBILITY_ENABLED: "true" } })).outcome, "UNKNOWN");
  const malformed = createNobilityMutationClient({ http: { post: async () => ({ data: "invalid" }) }, uaas: {}, ymicro: {}, nobility: {}, turnover: {} });
  assert.equal((await malformed.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-malformed-key", env: { HAGO_NOBILITY_ENABLED: "true" } })).outcome, "UNKNOWN");
  const disabledClient = createNobilityMutationClient({ http: { post: async () => assert.fail("disabled Nobility must not send") }, uaas: {}, ymicro: {}, nobility: {}, turnover: {} });
  const disabled = await disabledClient.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-disabled-key", env: {} });
  assert.deepEqual(disabled, { outcome: "BLOCKED", attempted: false, upstreamCode: null });
  const network = createNobilityMutationClient({ http: { post: async () => { throw new Error("network"); } }, uaas: {}, ymicro: {}, nobility: {}, turnover: {} });
  assert.deepEqual(await network.sendPreparedPurchase(sessionA, request, { idempotencyKey: "nobility-network-key", env: { HAGO_NOBILITY_ENABLED: "true" } }), { outcome: "UNKNOWN", upstreamCode: null, timeout: false });
});

test("Nobility route rejects caller-supplied price, pack, and buy type before any local or upstream action", async () => {
  const res = { statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  await botController.buyNobility({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: 1, diamond: 1, turnover_pack_id: "injected", buy_type: 1, buyerUid: 7 }, get: () => "nobility-safe-key" }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_REQUEST");
});

test("production Nobility intent sends once without a controlled header, replays idempotently, and rejects conflicting keys", async () => {
  const originalUserFindOne = User.findOne;
  const originalTransactionFindOne = Transaction.findOne;
  const originalTransactionCreate = Transaction.create;
  const previous = {
    key: process.env.HAGO_SESSION_ENCRYPTION_KEY,
    enabled: process.env.HAGO_NOBILITY_ENABLED,
  };
  const rows = [];
  let sends = 0;
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  Transaction.findOne = async ({ idempotencyKey }) => rows.find((row) => row.idempotencyKey === idempotencyKey) || null;
  Transaction.create = async (document) => {
    const row = { _id: `nobility-${rows.length + 1}`, createdAt: new Date(0), ...document, save: async () => {} };
    rows.push(row);
    return row;
  };
  hagoService._test.setIntegrationForTest({ nobilityMutation: {
    preparePurchase: async () => ({ ok: true, request: { noble_type: 1, buy_type: 1, buyer_uid: 7, diamond: 10, turnover_pack_id: "pack", app_name: "hago" } }),
    sendPreparedPurchase: async () => { sends += 1; return { outcome: "SUCCESS", upstreamCode: null }; },
  } });
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  delete process.env.HAGO_NOBILITY_ENABLED;
  const request = (targetId = "9", idempotencyKey = "nobility-once-key") => ({ body: { agentPhone: "201000000000", targetId, nobilityType: 1 }, get: (name) => name === "Idempotency-Key" ? idempotencyKey : undefined });
  const response = () => ({ statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } });
  try {
    const disabled = response(); await botController.buyNobility(request("9", "nobility-disabled-key"), disabled);
    assert.equal(disabled.statusCode, 503);
    assert.equal(sends, 0);
    process.env.HAGO_NOBILITY_ENABLED = "true";
    const first = response(); await botController.buyNobility(request(), first);
    assert.equal(first.statusCode, 200);
    assert.equal(rows[1].upstreamStatus, "SUCCESS");
    assert.equal(sends, 1);
    const replay = response(); await botController.buyNobility(request(), replay);
    assert.equal(replay.statusCode, 200);
    assert.equal(rows.length, 2);
    assert.equal(sends, 1);
    const conflict = response(); await botController.buyNobility(request("10"), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(sends, 1);
    const missingKey = response(); await botController.buyNobility({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: 1 }, get: () => undefined }, missingKey);
    assert.equal(missingKey.statusCode, 400);
    assert.equal(sends, 1);
    assert.equal(Object.hasOwn(first.body.transaction, "upstreamCode"), false);
    assert.equal(Object.hasOwn(first.body.transaction, "upstreamTimeout"), false);
  } finally {
    User.findOne = originalUserFindOne;
    Transaction.findOne = originalTransactionFindOne;
    Transaction.create = originalTransactionCreate;
    hagoService._test.resetIntegrationForTest();
    if (previous.key === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previous.key;
    if (previous.enabled === undefined) delete process.env.HAGO_NOBILITY_ENABLED; else process.env.HAGO_NOBILITY_ENABLED = previous.enabled;
  }
});

test("Nobility preview is local-only and never exposes an identifier or calls a network client", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => assert.fail("Nobility preview must not make a network request");
  try {
    assert.deepEqual(buildNobilityMutationPreview({ nobilityType: "Knight", buyType: 2 }), {
      serviceType: "NOBILITY", nobleType: 1, buyType: 2, diamondType: "number", turnoverPackIdType: "config-derived", appName: "hago",
      rpcPackage: "net.ihago.money.api.noble", rpcService: "Noble", rpcMethod: "BuyNobleByAgency",
    });
  } finally {
    global.fetch = originalFetch;
  }
  const res = { body: undefined, status() { return this; }, json(body) { this.body = body; return body; } };
  await botController.previewNobilityMutation({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: "Knight" } }, res);
  assert.equal(res.body.serviceType, "NOBILITY");
  assert.equal(JSON.stringify(res.body).includes("201000000000"), false);
  assert.equal(JSON.stringify(res.body).includes('"9"'), false);
  assert.match(fs.readFileSync("src/routes/botRoutes.js", "utf8"), /auto-recharge\/nobility\/preview/);
});

test("controlled mutation mode requires every explicit guard before any sender is reachable", async () => {
  const disabled = await prepareRechargeMutation({ env: {} });
  assert.equal(disabled.kind, "DISABLED");
  const noMode = await prepareRechargeMutation({ env: { HAGO_MUTATIONS_ENABLED: "true" }, controlledHeader: "true" });
  assert.equal(noMode.kind, "BLOCKED");
  const noHeader = await prepareRechargeMutation({ env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } });
  assert.equal(noHeader.kind, "BLOCKED");
  const ready = await prepareRechargeMutation({ env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" }, controlledHeader: "true" });
  assert.deepEqual(ready, { ok: true, maxAmount: 5 });
  assert.equal(isControlledMutationSenderEnabled({ controlledHeader: "true", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } }), true);
  assert.equal(isControlledMutationSenderEnabled({ controlledHeader: "false", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } }), false);
});

test("financial sender builds the exact controlled multipart payload using agency transfer currency", async () => {
  const calls = [];
  const financial = createFinancialMutationClient({
    now: () => 1700000000000,
    http: { post: async (...args) => {
      calls.push(args);
      if (args[0].includes("query_agency_info")) return { data: { data: { currencyType: 1805 } } };
      if (args[0].includes("/agencypay/permissions")) return { data: { data: { permissions: [{ funcName: "transfer_currency_to_other", status: 0 }] } } };
      return { data: { code: 1 } };
    } },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    turnover: {
      getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 10, hagoDiamondNew: null, hagoCrystal: 3 } } }),
      getHistory: async () => ({ ok: true, history: { list: [] } }),
    },
  });
  const prepared = await financial.prepareTransfer({ ...sessionA, hagoUid: "42" }, { targetId: "9", amount: 3, serviceType: "DIAMOND" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.currencyType, 1805);
  assert.equal(JSON.parse(prepared.request.data).seqId, "4271700000000000");
  assert.equal(buildSeqId("42", "7", 1700000000000), "4271700000000000");
  const controlledGuard = { controlledHeader: "true", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } };
  assert.deepEqual(await financial.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, prepared.request), { outcome: "BLOCKED", upstreamCode: null, attempted: false });
  assert.equal(calls.length, 1);
  assert.deepEqual(await financial.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, prepared.request, controlledGuard), { outcome: "SUCCESS", upstreamCode: 1 });
  assert.match(calls[1][0], /\/agencypay\/transfer_account$/);
  assert.equal(calls[1][1].get("appId"), "1802");
  assert.equal(calls[1][1].get("sign"), "");
  assert.deepEqual(JSON.parse(calls[1][1].get("data")), { targetUid: "7", transferAmount: 3, currencyType: 1805, useGoldCurrency: false, seqId: "4271700000000000" });
  assert.equal(calls[1][2].headers.Cookie, "hagouid=a; uaasCookie=one");
  assert.equal(selectDiamondTransferCurrency({ agencyDiamondCurrency: 1835 }), 1835);
  assert.equal(selectDiamondTransferCurrency({ agencyDiamondCurrency: 9999 }), 1805);
  const crystal = await financial.prepareTransfer({ ...sessionA, hagoUid: "42" }, { targetId: "9", amount: 3, serviceType: "CRYSTAL" });
  assert.equal(crystal.currencyType, 1826);
});

test("Crystal preflight is fixed to 1826 and mirrors only its confirmed browser checks", async () => {
  const calls = [];
  const financial = createFinancialMutationClient({
    now: () => 1700000000000,
    http: { post: async (...args) => {
      calls.push(args);
      if (args[0].includes("query_agency_info")) return { data: { data: { currencyType: 1835, transferMax: 5 } } };
      if (args[0].includes("/agencypay/permissions")) return { data: { data: { permissions: [{ funcName: "transfer_currency_to_other", status: 0 }], whitelistPermissions: [{ funcName: "recharge_crystal", status: 0 }] } } };
      if (args[0].includes("transfer_account")) return { data: { code: 1 } };
      assert.fail("unexpected financial endpoint");
    } },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: null, hagoDiamondNew: null, hagoCrystal: 5 } } }), getHistory: async () => ({ ok: true, history: { list: [] } }) },
  });
  const prepared = await financial.prepareTransfer({ ...sessionA, hagoUid: "42" }, { targetId: "9", amount: 1, serviceType: "CRYSTAL" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.currencyType, HAGO_CURRENCIES.HAGO_CRYSTAL);
  assert.equal(prepared.currencyType, 1826);
  assert.equal(calls.some(([url]) => url.includes("transfer_account")), false);
  assert.equal(prepared.request.data, '{"targetUid":"7","transferAmount":1,"currencyType":1826,"useGoldCurrency":false,"seqId":"4271700000000000"}');
  assert.deepEqual(await financial.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, prepared.request, {
    controlledHeader: "true",
    env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" },
  }), { outcome: "SUCCESS", upstreamCode: 1 });
  assert.equal(calls.filter(([url]) => url.includes("transfer_account")).length, 1);
  const transferCall = calls.find(([url]) => url.includes("transfer_account"));
  assert.deepEqual([...transferCall[1].keys()], ["appId", "sign", "data"]);
  assert.equal(transferCall[2].headers.Cookie, "hagouid=a; uaasCookie=one");
  assert.equal(transferCall[2].headers["X-AuthType"], "3");
  assert.equal(transferCall[2].headers["X-AppId"], "1802");

  const preview = buildCrystalMutationPreview({ amount: "1" });
  assert.deepEqual(preview, {
    serviceType: "CRYSTAL", currencyType: 1826, currencyTypeType: "number", amountType: "number", targetUidType: "string",
    useGoldCurrency: false, useGoldCurrencyType: "boolean", multipartFieldNames: ["appId", "sign", "data"],
    dataPropertyNames: ["targetUid", "transferAmount", "currencyType", "useGoldCurrency", "seqId"],
  });
});

test("Crystal insufficient balance, browser-blocking transfer status, and transfer maximum block before transfer_account", async () => {
  const makeFinancial = ({ crystalBalance, transferStatus = 0, transferMax = 0 }) => {
    const calls = [];
    const client = createFinancialMutationClient({
      http: { post: async (...args) => {
        calls.push(args);
        if (args[0].includes("query_agency_info")) return { data: { data: { transferMax } } };
        if (args[0].includes("/agencypay/permissions")) return { data: { data: { permissions: [{ funcName: "transfer_currency_to_other", status: transferStatus }] } } };
        assert.fail("Crystal preflight must not call transfer_account");
      } },
      ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
      turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoCrystal: crystalBalance } } }), getHistory: async () => ({ ok: true, history: { list: [] } }) },
    });
    return { client, calls };
  };
  for (const options of [{ crystalBalance: 0 }, { crystalBalance: 2 }]) {
    const { client, calls } = makeFinancial(options);
    const result = await client.prepareTransfer(sessionA, { targetId: "9", amount: 3, serviceType: "CRYSTAL" });
    assert.equal(result.kind, "CRYSTAL_INSUFFICIENT_BALANCE");
    assert.equal(calls.some(([url]) => url.includes("transfer_account")), false);
  }
  const permission = makeFinancial({ crystalBalance: 5, transferStatus: 1 });
  assert.equal((await permission.client.prepareTransfer(sessionA, { targetId: "9", amount: 1, serviceType: "CRYSTAL" })).kind, "CRYSTAL_TRANSFER_PERMISSION_REQUIRED");
  const max = makeFinancial({ crystalBalance: 10, transferMax: 5 });
  assert.equal((await max.client.prepareTransfer(sessionA, { targetId: "9", amount: 6, serviceType: "CRYSTAL" })).kind, "CRYSTAL_TRANSFER_MAX");
  assert.equal(normalizedCrystalBalance({ balances: { hagoCrystal: 0 } }), 0);
  assert.equal(normalizedCrystalBalance({ balances: { hagoCrystal: null } }), null);
  assert.equal(validateCrystalTransferPreflight({ amount: 1, wallet: { balances: { hagoCrystal: 5 } }, permissions: { transferPermission: { present: false, status: null } }, agency: { transferMax: null } }).ok, true);
  for (const amount of [0, "1.5", "10000000"]) {
    assert.equal(validateCrystalTransferPreflight({ amount, wallet: { balances: { hagoCrystal: 5 } }, permissions: { transferPermission: { present: true, status: 1 } }, agency: { transferMax: null } }).kind, "INVALID_REQUEST");
  }
});

test("Diamond uses agency currency even when only the legacy wallet balance exists, and enforces the confirmed 1835 minimum", async () => {
  const calls = [];
  const financial = createFinancialMutationClient({
    now: () => 1700000000000,
    http: { post: async (...args) => {
      calls.push(args);
      if (args[0].includes("query_agency_info")) return { data: { data: { currencyType: 1835 } } };
      if (args[0].includes("transfer_account")) return { data: { code: 1 } };
      assert.fail("unexpected financial endpoint");
    } },
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    turnover: {
      getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 1000, hagoDiamondNew: null, hagoCrystal: null } } }),
      getHistory: async () => ({ ok: true, history: { list: [] } }),
    },
  });
  const blocked = await financial.prepareTransfer({ ...sessionA, hagoUid: "42" }, { targetId: "9", amount: 100, serviceType: "DIAMOND" });
  assert.deepEqual(blocked, { ok: false, kind: "DIAMOND_MIN_AMOUNT", message: "The confirmed Diamond New minimum amount is 200." });
  assert.equal(calls.some(([url]) => url.includes("transfer_account")), false);
  assert.equal(botController._test.preflightErrorStatus("DIAMOND_MIN_AMOUNT"), 400);

  const prepared = await financial.prepareTransfer({ ...sessionA, hagoUid: "42" }, { targetId: "9", amount: 200, serviceType: "DIAMOND" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.currencyType, 1835);
  assert.deepEqual(JSON.parse(prepared.request.data), { targetUid: "7", transferAmount: 200, currencyType: 1835, useGoldCurrency: false, seqId: "4271700000000000" });
  assert.deepEqual(await financial.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, prepared.request, {
    controlledHeader: "true",
    env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "200" },
  }), { outcome: "SUCCESS", upstreamCode: 1 });
  assert.equal(calls.filter(([url]) => url.includes("transfer_account")).length, 1);
});

test("financial sender maps confirmed rejection codes and transport ambiguity without retries", async () => {
  const base = {
    ymicro: { getTargetByVid: async () => ({ ok: true, user: { uid: "7" } }) },
    turnover: { getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 1, hagoDiamondNew: null } } }), getHistory: async () => ({ ok: true, history: { list: [] } }) },
  };
  const request = buildTransferAccountRequest({ targetUid: "7", transferAmount: 1, currencyType: 1826, useGoldCurrency: false, seqId: "427" });
  for (const [code, expected] of [[-401, "SESSION_PROBLEM"], [-76, "TRANSFER_LIMIT"], [-2, "REJECTED"]]) {
    const client = createFinancialMutationClient({ ...base, http: { post: async () => ({ data: { code } }) } });
    assert.equal((await client.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, request, { controlledHeader: "true", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } })).outcome, expected);
  }
  let attempts = 0;
  const timeout = Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
  const client = createFinancialMutationClient({ ...base, http: { post: async () => { attempts += 1; throw timeout; } } });
  assert.deepEqual(await client.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, request, { controlledHeader: "true", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } }), { outcome: "UNKNOWN", upstreamCode: null, timeout: true });
  assert.equal(attempts, 1);
  const network = createFinancialMutationClient({ ...base, http: { post: async () => { throw new Error("network"); } } });
  assert.deepEqual(await network.sendPreparedTransfer({ ...sessionA, hagoUid: "42" }, request, { controlledHeader: "true", env: { HAGO_MUTATIONS_ENABLED: "true", HAGO_CONTROLLED_MUTATION_MODE: "true", HAGO_CONTROLLED_MUTATION_MAX_AMOUNT: "5" } }), { outcome: "UNKNOWN", upstreamCode: null, timeout: false });
});

test("local mutation intents deduplicate identical requests, reject conflicts, and never fabricate an upstream reference", async () => {
  const originalUserFindOne = User.findOne;
  const originalTransactionFindOne = Transaction.findOne;
  const originalTransactionCreate = Transaction.create;
  const previousFlag = process.env.HAGO_MUTATIONS_ENABLED;
  const previousControlled = process.env.HAGO_CONTROLLED_MUTATION_MODE;
  const previousMax = process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT;
  const rows = [];
  const fakeAgent = { _id: "agent-id", hagoUid: "42", hagoSession: { hagouid: "enc:v1:bad", uaasCookie: "enc:v1:bad" } };
  User.findOne = () => ({ select: async () => fakeAgent });
  Transaction.findOne = async ({ idempotencyKey }) => rows.find((row) => row.idempotencyKey === idempotencyKey) || null;
  Transaction.create = async (document) => {
    const row = { _id: `local-${rows.length + 1}`, createdAt: new Date(0), ...document, save: async () => {} };
    rows.push(row);
    return row;
  };
  process.env.HAGO_MUTATIONS_ENABLED = "true";
  delete process.env.HAGO_CONTROLLED_MUTATION_MODE;
  delete process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT;
  const makeReq = (amount) => ({ body: { agentPhone: "201000000000", targetId: "9", amount }, get: (name) => name === "Idempotency-Key" ? "same-key" : undefined });
  const makeRes = () => ({ statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } });
  try {
    const first = makeRes(); await botController.rechargeDiamond(makeReq(10), first);
    assert.equal(first.statusCode, 503);
    assert.equal(first.body.transaction.status, "UNKNOWN");
    assert.equal(first.body.transaction.upstreamStatus, "NOT_SENT");
    assert.equal(first.body.transaction.referenceId, null);
    assert.equal(rows.length, 1);
    const replay = makeRes(); await botController.rechargeDiamond(makeReq(10), replay);
    assert.equal(replay.statusCode, 503);
    assert.equal(replay.body.code, "NOT_SENT");
    assert.equal(rows.length, 1);
    const conflict = makeRes(); await botController.rechargeDiamond(makeReq(11), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(rows.length, 1);
  } finally {
    User.findOne = originalUserFindOne;
    Transaction.findOne = originalTransactionFindOne;
    Transaction.create = originalTransactionCreate;
    if (previousFlag === undefined) delete process.env.HAGO_MUTATIONS_ENABLED; else process.env.HAGO_MUTATIONS_ENABLED = previousFlag;
    if (previousControlled === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MODE; else process.env.HAGO_CONTROLLED_MUTATION_MODE = previousControlled;
    if (previousMax === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT; else process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT = previousMax;
  }
});

test("Crystal preflight failure remains NOT_SENT and cannot create SEND_PENDING or a replay", async () => {
  const originalUserFindOne = User.findOne;
  const originalTransactionFindOne = Transaction.findOne;
  const originalTransactionCreate = Transaction.create;
  const previous = {
    enabled: process.env.HAGO_MUTATIONS_ENABLED,
    controlled: process.env.HAGO_CONTROLLED_MUTATION_MODE,
    max: process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT,
    encryptionKey: process.env.HAGO_SESSION_ENCRYPTION_KEY,
  };
  const rows = [];
  let sendCalls = 0;
  User.findOne = () => ({ select: async () => ({ _id: "agent-id", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } }) });
  Transaction.findOne = async ({ idempotencyKey }) => rows.find((row) => row.idempotencyKey === idempotencyKey) || null;
  Transaction.create = async (document) => {
    const row = { _id: `crystal-${rows.length + 1}`, createdAt: new Date(0), ...document, save: async () => {} };
    rows.push(row);
    return row;
  };
  hagoService._test.setIntegrationForTest({ financial: {
    prepareTransfer: async () => ({ ok: false, kind: "CRYSTAL_INSUFFICIENT_BALANCE", message: "safe" }),
    sendPreparedTransfer: async () => { sendCalls += 1; assert.fail("insufficient Crystal must not send"); },
  } });
  process.env.HAGO_MUTATIONS_ENABLED = "true";
  process.env.HAGO_CONTROLLED_MUTATION_MODE = "true";
  process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT = "5";
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  const req = { body: { agentPhone: "201000000000", targetId: "9", amount: 1 }, get: (name) => name === "Idempotency-Key" ? "crystal-balance-key" : name === "X-Controlled-Mutation" ? "true" : undefined };
  const makeRes = () => ({ statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } });
  try {
    const first = makeRes(); await botController.rechargeCrystal(req, first);
    assert.equal(first.statusCode, 400);
    assert.equal(first.body.code, "CRYSTAL_INSUFFICIENT_BALANCE");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "UNKNOWN");
    assert.equal(rows[0].upstreamStatus, "NOT_SENT");
    assert.equal(rows[0].sendAttempts, undefined);
    assert.equal(sendCalls, 0);
    const replay = makeRes(); await botController.rechargeCrystal(req, replay);
    assert.equal(replay.statusCode, 503);
    assert.equal(rows.length, 1);
    assert.equal(sendCalls, 0);
  } finally {
    User.findOne = originalUserFindOne;
    Transaction.findOne = originalTransactionFindOne;
    Transaction.create = originalTransactionCreate;
    hagoService._test.resetIntegrationForTest();
    if (previous.enabled === undefined) delete process.env.HAGO_MUTATIONS_ENABLED; else process.env.HAGO_MUTATIONS_ENABLED = previous.enabled;
    if (previous.controlled === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MODE; else process.env.HAGO_CONTROLLED_MUTATION_MODE = previous.controlled;
    if (previous.max === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT; else process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT = previous.max;
    if (previous.encryptionKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previous.encryptionKey;
  }
});

test("controlled Diamond sends once, enforces the ceiling, and idempotency prevents replay", async () => {
  const originalUserFindOne = User.findOne;
  const originalTransactionFindOne = Transaction.findOne;
  const originalTransactionCreate = Transaction.create;
  const previous = {
    enabled: process.env.HAGO_MUTATIONS_ENABLED,
    controlled: process.env.HAGO_CONTROLLED_MUTATION_MODE,
    max: process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT,
    encryptionKey: process.env.HAGO_SESSION_ENCRYPTION_KEY,
  };
  const rows = [];
  let sendCalls = 0;
  let nextOutcome = { outcome: "SUCCESS", upstreamCode: 1 };
  const fakeAgent = { _id: "agent-id", hagoUid: "42", hagoSession: { hagouid: "42", uaasCookie: "synthetic-cookie" } };
  User.findOne = () => ({ select: async () => fakeAgent });
  Transaction.findOne = async ({ idempotencyKey }) => rows.find((row) => row.idempotencyKey === idempotencyKey) || null;
  Transaction.create = async (document) => {
    const row = { _id: `controlled-${rows.length + 1}`, createdAt: new Date(0), ...document, save: async () => {} };
    rows.push(row);
    return row;
  };
  hagoService._test.setIntegrationForTest({ financial: {
    prepareTransfer: async () => ({ ok: true, request: { appId: "1802", sign: "", data: "{}" }, currencyType: 1805 }),
    sendPreparedTransfer: async () => { sendCalls += 1; return nextOutcome; },
  } });
  process.env.HAGO_MUTATIONS_ENABLED = "true";
  process.env.HAGO_CONTROLLED_MUTATION_MODE = "true";
  process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT = "5";
  process.env.HAGO_SESSION_ENCRYPTION_KEY = sessionKey.toString("base64");
  const makeReq = (key, amount, controlled = "true") => ({ body: { agentPhone: "201000000000", targetId: "9", amount }, get: (name) => {
    if (name === "Idempotency-Key") return key;
    if (name === "X-Controlled-Mutation") return controlled;
    return undefined;
  } });
  const makeRes = () => ({ statusCode: undefined, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } });
  try {
    const ceiling = makeRes(); await botController.rechargeDiamond(makeReq("over-ceiling", 6), ceiling);
    assert.equal(ceiling.statusCode, 400);
    assert.equal(ceiling.body.code, "MUTATION_AMOUNT_LIMIT");
    assert.equal(sendCalls, 0);
    const first = makeRes(); await botController.rechargeDiamond(makeReq("one-shot-key", 5), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.transaction.status, "SUCCESS");
    assert.equal(first.body.transaction.upstreamStatus, "SUCCESS");
    assert.equal(first.body.transaction.referenceId, null);
    assert.equal(rows[0].sendAttempts, 1);
    assert.equal(sendCalls, 1);
    const retry = makeRes(); await botController.rechargeDiamond(makeReq("one-shot-key", 5), retry);
    assert.equal(retry.statusCode, 200);
    assert.equal(sendCalls, 1);
    const conflict = makeRes(); await botController.rechargeDiamond(makeReq("one-shot-key", 4), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(sendCalls, 1);
    nextOutcome = { outcome: "UNKNOWN", upstreamCode: null, timeout: true };
    const unknown = makeRes(); await botController.rechargeDiamond(makeReq("unknown-key", 3), unknown);
    assert.equal(unknown.statusCode, 504);
    assert.equal(unknown.body.code, "MUTATION_OUTCOME_UNKNOWN");
    assert.equal(unknown.body.transaction.status, "UNKNOWN");
    assert.equal(unknown.body.transaction.upstreamStatus, "UNKNOWN");
    assert.equal(sendCalls, 2);
    const unknownRetry = makeRes(); await botController.rechargeDiamond(makeReq("unknown-key", 3), unknownRetry);
    assert.equal(unknownRetry.statusCode, 504);
    assert.equal(unknownRetry.body.code, "MUTATION_OUTCOME_UNKNOWN");
    assert.equal(sendCalls, 2);
    const nobility = makeRes(); await botController.buyNobility({ body: { agentPhone: "201000000000", targetId: "9", nobilityType: 1 }, get: (name) => name === "Idempotency-Key" ? "nobility-key" : undefined }, nobility);
    assert.equal(nobility.statusCode, 503);
    assert.equal(nobility.body.transaction.status, "UNKNOWN");
    assert.equal(Object.hasOwn(nobility.body.transaction, "upstreamStatus"), false);
    assert.equal(sendCalls, 2);
  } finally {
    User.findOne = originalUserFindOne;
    Transaction.findOne = originalTransactionFindOne;
    Transaction.create = originalTransactionCreate;
    hagoService._test.resetIntegrationForTest();
    if (previous.enabled === undefined) delete process.env.HAGO_MUTATIONS_ENABLED; else process.env.HAGO_MUTATIONS_ENABLED = previous.enabled;
    if (previous.controlled === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MODE; else process.env.HAGO_CONTROLLED_MUTATION_MODE = previous.controlled;
    if (previous.max === undefined) delete process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT; else process.env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT = previous.max;
    if (previous.encryptionKey === undefined) delete process.env.HAGO_SESSION_ENCRYPTION_KEY; else process.env.HAGO_SESSION_ENCRYPTION_KEY = previous.encryptionKey;
  }
});

test("manual reconciliation is read-only and never changes an unknown outcome", async () => {
  const financial = createFinancialMutationClient({
    http: { post: async () => assert.fail("reconciliation must not send a financial request") },
    ymicro: { getTargetByVid: async () => assert.fail("reconciliation does not resolve a target") },
    turnover: {
      getWallet: async () => ({ ok: true, wallet: { balances: { hagoDiamond: 1, hagoDiamondNew: null, hagoCrystal: null } } }),
      getHistory: async () => ({ ok: true, history: { list: [] } }),
    },
  });
  const result = await financial.reconcileReadOnly({ ...sessionA, hagoUid: "42" });
  assert.deepEqual(result, { status: "UNKNOWN", wallet: { balances: { hagoDiamond: 1, hagoDiamondNew: null, hagoCrystal: null } }, history: { list: [] } });
  assert.equal(fs.readFileSync("src/integrations/hago/financial.js", "utf8").includes("console."), false);
  assert.equal(fs.readFileSync("src/integrations/hago/transferReadiness.js", "utf8").includes("console."), false);
});

test("internal API uses timing-safe authentication and controllers require idempotency keys", () => {
  const prior = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = "expected";
  for (const key of [undefined, "wrong"]) {
    let status;
    internalAuth({ get: () => key }, { status: (value) => { status = value; return { json: () => {} }; } }, () => assert.fail("must not authenticate"));
    assert.equal(status, 401);
  }
  if (prior === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = prior;
  assert.match(fs.readFileSync("src/controllers/botController.js", "utf8"), /Idempotency-Key/);
});

test("timeout and malformed responses normalize without leaking secrets", () => {
  const error = new Error("timeout"); error.code = "ECONNABORTED";
  assert.deepEqual(normalizeHttpError(error), { kind: "TIMEOUT", message: "Hago request timed out" });
  const authSource = fs.readFileSync("src/controllers/authController.js", "utf8");
  assert.equal(/res\.json\([^\n]*uaasCookie/.test(authSource), false);
  assert.equal(/res\.json\([^\n]*deviceId/.test(authSource), false);
  assert.equal(authSource.includes("sms_code"), false);
  assert.equal(authSource.includes("s_session"), false);
  assert.equal(authSource.includes("s_t"), false);
  assert.equal(authSource.includes("sSessionKey"), false);
  assert.equal(authSource.includes("console."), false);
  assert.equal(fs.readFileSync("src/integrations/hago/smsAuth.js", "utf8").includes("console."), false);
  assert.equal(fs.readFileSync("src/integrations/hago/sessionDerivation.js", "utf8").includes("console."), false);
  assert.equal(fs.readFileSync("src/integrations/hago/financial.js", "utf8").includes("console."), false);
});

function localGet(app, path) {
  return new Promise((resolve, reject) => {
    const req = Object.assign(Object.create(app.request), new EventEmitter(), {
      app, method: "GET", url: path, originalUrl: path, baseUrl: "", headers: {}, connection: {},
    });
    const headers = {};
    const res = Object.assign(Object.create(app.response), new EventEmitter(), {
      app, req, statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return headers[String(name).toLowerCase()]; },
      removeHeader(name) { delete headers[String(name).toLowerCase()]; },
      end(chunk = "") { resolve({ status: this.statusCode, headers, body: Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk) }); },
    });
    try {
      app.handle(req, res, (error) => {
        if (error) return reject(error);
        return resolve({ status: 404, headers, body: "" });
      });
    } catch (error) { reject(error); }
  });
}

test("Swagger contract and UI are local-only and follow the documented exposure policy", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => assert.fail("Swagger routes must not call Hago");
  try {
    const development = createApp({ env: { ...validEnv, NODE_ENV: "development" } });
    const contract = await localGet(development, "/openapi.json");
    assert.equal(contract.status, 200);
    assert.equal(JSON.parse(contract.body).openapi, "3.0.3");
    const docs = await localGet(development, "/docs");
    assert.equal(docs.status, 200);
    assert.match(docs.headers["content-type"] || "", /text\/html/);

    const productionDisabled = createApp({ env: { ...validEnv, NODE_ENV: "production" } });
    assert.equal((await localGet(productionDisabled, "/openapi.json")).status, 404);
    assert.equal((await localGet(productionDisabled, "/docs")).status, 404);

    const developmentDisabled = createApp({ env: { ...validEnv, NODE_ENV: "development", SWAGGER_ENABLED: "false" } });
    assert.equal((await localGet(developmentDisabled, "/openapi.json")).status, 404);
    assert.equal((await localGet(developmentDisabled, "/docs")).status, 404);

    const productionEnabled = createApp({ env: { ...validEnv, NODE_ENV: "production", SWAGGER_ENABLED: "true" } });
    assert.equal((await localGet(productionEnabled, "/openapi.json")).status, 200);
    assert.equal((await localGet(productionEnabled, "/docs")).status, 200);
  } finally {
    global.fetch = originalFetch;
  }
});
