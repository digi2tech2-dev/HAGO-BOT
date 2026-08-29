const { createHagoHttpClient, normalizeHttpError } = require("./client");
const { buildCookieHeader } = require("./session");
const {
  NOBLE_RPC,
  NOBLE_TYPES,
  buildListAllNobleConfRequest,
  buildGetUserNobleRequest,
  parseNobleConfig,
  parseCurrentNoble,
} = require("./nobility");

const NOBLE_YMICRO_URL = "https://api.ihago.net/ymicro/sapi";

// The simple yMicro transport moves this non-secret metadata into query
// parameters. The bundle's OS-version and channel values are browser-runtime
// values; the backend has no proven replacement, so it preserves the existing
// empty-field encoding rather than inventing either value.
const NOBLE_YMICRO_RUNTIME = Object.freeze({
  appName: "hago",
  language: "en",
  appVersion: "0",
  osType: "android",
  osVersion: "",
  appChannel: "",
  registrationCountry: "ae",
  fromRegistrationCountry: "",
});

function buildNobleYmicroMetadata(session, method, now = Date.now(), runtime = NOBLE_YMICRO_RUNTIME) {
  if (!session?.hagoUid) return null;
  const sequence = String(now);
  return {
    sequence,
    params: {
      method,
      sname: NOBLE_RPC.package,
      "hago-app-name": runtime.appName,
      "X-App-Name": runtime.appName,
      "hago-seq-id": sequence,
      "X-Request-Id": `${session.hagoUid}-${sequence}`,
      "X-Lang": runtime.language,
      "X-App-Ver": runtime.appVersion,
      "X-OsType": runtime.osType,
      "X-Os-Ver": runtime.osVersion,
      "X-App-Channel": runtime.appChannel,
      "X-Reg-Country": runtime.registrationCountry,
      "X-From-Reg-Country": runtime.fromRegistrationCountry,
    },
  };
}

function isRejectedYmicroResponse(payload) {
  const code = payload?.result?.errcode;
  return code !== undefined && code !== null && Number(code) !== 0;
}

function withReadOnlyStage(result, stage, diagnostics = {}) {
  const upstreamHttpStatus = Number.isInteger(result?.status) ? result.status : null;
  const { status, ...safeResult } = result || {};
  return { ...safeResult, stage, upstreamHttpStatus, ...diagnostics };
}

// Uinfo is shared with integrations that preserve identifiers as strings.
// The Noble browser call instead forwards the JSON-number UID unchanged, so
// only this RPC boundary converts a fully validated decimal UID to Number.
function normalizeNobleUid(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const uid = Number(value);
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

function normalizeNobleHttpError(error) {
  const normalized = normalizeHttpError(error);
  if (normalized.kind !== "HTTP_ERROR") return normalized;
  return { kind: "UPSTREAM_HTTP_FAILURE", message: "Hago returned an upstream HTTP failure", status: normalized.status };
}

function nobleName(type) {
  return ({
    [NOBLE_TYPES.KNIGHT]: "Knight",
    [NOBLE_TYPES.VISCOUNT]: "Viscount",
    [NOBLE_TYPES.EARL]: "Earl",
    [NOBLE_TYPES.DUKE]: "Duke",
  })[type] || null;
}

function normalizeNobilityReadiness(config, current) {
  return {
    current: {
      type: current.type,
      status: current.status,
      remainingDays: current.remainingSeconds === null ? null : Math.ceil(current.remainingSeconds / 86400),
    },
    available: config.map((entry) => ({
      type: entry.type,
      name: nobleName(entry.type),
      purchaseDiamond: entry.buyInfo?.diamond ?? null,
      renewDiamond: entry.renewInfo?.diamond ?? null,
      purchasePackAvailable: entry.buyInfo?.turnoverPackId == null ? false : true,
      renewPackAvailable: entry.renewInfo?.turnoverPackId == null ? false : true,
    })),
  };
}

function createNobilityReadOnlyClient({
  http = createHagoHttpClient(),
  now = () => Date.now(),
  runtime = NOBLE_YMICRO_RUNTIME,
} = {}) {
  async function request(session, method, payload) {
    const cookie = buildCookieHeader(session);
    const metadata = buildNobleYmicroMetadata(session, method, now(), runtime);
    if (!cookie || !metadata) {
      return { ok: false, kind: "NO_SESSION", message: "An active per-account Hago session is required" };
    }
    try {
      const response = await http.post(
        NOBLE_YMICRO_URL,
        // The confirmed yMicro middleware injects this same per-RPC sequence
        // into the JSON body before simpleMicro writes the request.
        JSON.stringify({ sequence: Number(metadata.sequence), ...payload }),
        { params: metadata.params, headers: { Cookie: cookie, "Content-Type": "text/plain" } },
      );
      if (isRejectedYmicroResponse(response.data)) {
        return { ok: false, kind: "REJECTED", message: "Hago rejected the Nobility read-only request" };
      }
      return { ok: true, payload: response.data };
    } catch (error) {
      return { ok: false, ...normalizeNobleHttpError(error) };
    }
  }

  return {
    async listAllNobleConf(session) {
      const result = await request(session, `${NOBLE_RPC.service}.${NOBLE_RPC.listMethod}`, buildListAllNobleConfRequest());
      if (!result.ok) return withReadOnlyStage(result, "LIST_NOBLE_CONFIG");
      const config = parseNobleConfig(result.payload);
      return config ? { ok: true, config } : withReadOnlyStage({ ok: false, kind: "UNKNOWN", message: "Hago returned an invalid Nobility configuration response" }, "LIST_NOBLE_CONFIG");
    },
    async getUserNoble(session, targetUid) {
      const nobleUid = normalizeNobleUid(targetUid);
      const diagnostics = { uidWireType: "number", method: `${NOBLE_RPC.service}.${NOBLE_RPC.userMethod}` };
      if (nobleUid === null) {
        return withReadOnlyStage({ ok: false, kind: "INVALID_REQUEST", message: "A valid Hago target is required" }, "GET_USER_NOBLE");
      }
      let payload;
      try { payload = buildGetUserNobleRequest(nobleUid); }
      catch { return withReadOnlyStage({ ok: false, kind: "INVALID_REQUEST", message: "A valid Hago target is required" }, "GET_USER_NOBLE"); }
      const result = await request(session, `${NOBLE_RPC.service}.${NOBLE_RPC.userMethod}`, payload);
      if (!result.ok) return withReadOnlyStage(result, "GET_USER_NOBLE", diagnostics);
      const current = parseCurrentNoble(result.payload);
      return current ? { ok: true, current } : withReadOnlyStage({ ok: false, kind: "UNKNOWN", message: "Hago returned an invalid Nobility state response" }, "GET_USER_NOBLE", diagnostics);
    },
    async getReadiness(session, targetUid) {
      const [configuration, state] = await Promise.all([
        this.listAllNobleConf(session),
        this.getUserNoble(session, targetUid),
      ]);
      if (!configuration.ok) return configuration;
      if (!state.ok) return state;
      return { ok: true, nobility: normalizeNobilityReadiness(configuration.config, state.current) };
    },
  };
}

module.exports = {
  NOBLE_YMICRO_URL,
  NOBLE_YMICRO_RUNTIME,
  buildNobleYmicroMetadata,
  withReadOnlyStage,
  normalizeNobleUid,
  normalizeNobilityReadiness,
  createNobilityReadOnlyClient,
};
