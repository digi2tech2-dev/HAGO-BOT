const { createHagoIntegration } = require("../integrations/hago");
const { decryptStoredSession } = require("../integrations/hago/session");

let hago = createHagoIntegration();

function getSession(user) {
  const cookies = decryptStoredSession(user?.hagoSession);
  return {
    // Legacy records may have persisted h_open_id as hagoUid. The decrypted
    // authenticated hagouid is the only accepted internal Hago account UID.
    hagoUid: cookies.hagouid,
    cookies,
    country: user?.hagoCountry || process.env.HAGO_COUNTRY,
    language: user?.hagoLanguage || process.env.HAGO_LANGUAGE || "en",
  };
}

function resolveSession(user) {
  try { return { ok: true, session: getSession(user) }; }
  catch { return { ok: false }; }
}

function unavailableSessionResult() {
  return { ok: false, kind: "SESSION_UNAVAILABLE", message: "An active per-account Hago session is required" };
}

async function withSession(user, operation) {
  const resolved = resolveSession(user);
  return resolved.ok ? operation(resolved.session) : unavailableSessionResult();
}

async function sendOtpApi(phone, countryCode) { return hago.uaas.sendOtp(phone, countryCode); }
async function verifySmsAuthApi(phone, otp, countryCode, deviceId) { return hago.uaas.verifyOtp(phone, otp, countryCode, deviceId); }
async function verifySession(user) {
  const resolved = resolveSession(user);
  return resolved.ok ? hago.uaas.probeSession(resolved.session) : { status: "UNKNOWN" };
}
async function getTargetUidByVid(vid, user) { return withSession(user, (session) => hago.ymicro.getTargetByVid(session, vid)); }
async function getAgentInfoByUid(user) {
  const resolved = resolveSession(user);
  if (!resolved.ok) return unavailableSessionResult();
  const result = await hago.ymicro.getUserByUid(resolved.session, resolved.session.hagoUid);
  return { ...result, accountUid: resolved.session.hagoUid };
}
async function getAgentWalletApi(user) { return withSession(user, (session) => hago.turnover.getWallet(session)); }
async function getAgentHistoryApi(user, query) { return withSession(user, (session) => hago.turnover.getHistory(session, query)); }
async function verifyHagoIdApi(targetId, user) { return getTargetUidByVid(targetId, user); }

function getMutationGate({ controlledHeader, env = process.env } = {}) {
  if (env.HAGO_MUTATIONS_ENABLED !== "true") {
    return { ok: false, kind: "DISABLED", message: "Hago mutations are disabled by configuration; no upstream request was sent." };
  }
  if (env.HAGO_CONTROLLED_MUTATION_MODE !== "true" || controlledHeader !== "true") {
    return { ok: false, kind: "BLOCKED", message: "Hago controlled mutation mode is not active; no upstream request was sent." };
  }
  const maxAmount = Number(env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    return { ok: false, kind: "BLOCKED", message: "Hago controlled mutation configuration is invalid; no upstream request was sent." };
  }
  return { ok: true, maxAmount };
}

// Kept as a narrow guard boundary so default calls remain fail-closed.
async function prepareRechargeMutation(options) {
  return getMutationGate(options);
}

async function prepareControlledRecharge(user, input) {
  return withSession(user, (session) => hago.financial.prepareTransfer(session, input));
}

async function sendControlledRecharge(user, request, guard) {
  return withSession(user, (session) => hago.financial.sendPreparedTransfer(session, request, guard));
}

async function reconcileMutationReadOnly(user, historyQuery) {
  return withSession(user, (session) => hago.financial.reconcileReadOnly(session, historyQuery));
}

async function getTransferReadiness(user) {
  return withSession(user, (session) => hago.readiness.getTransferReadiness(session));
}

async function getNobilityReadiness(user, targetId) {
  return withSession(user, async (session) => {
    const target = await hago.ymicro.getTargetByVid(session, targetId);
    if (!target.ok) {
      const upstreamHttpStatus = Number.isInteger(target?.status) ? target.status : null;
      const { status, ...safeTarget } = target || {};
      return { ...safeTarget, stage: "VID_RESOLUTION", upstreamHttpStatus };
    }
    return hago.nobility.getReadiness(session, target.user.uid);
  });
}

async function getNobilityPurchaseReadiness(user, input) {
  return withSession(user, (session) => hago.nobilityPurchaseReadiness.getReadiness(session, input));
}

async function prepareNobilityPurchase(user, input) {
  return withSession(user, (session) => hago.nobilityMutation.preparePurchase(session, input));
}

async function sendNobilityPurchase(user, request, guard) {
  const resolved = resolveSession(user);
  return resolved.ok
    ? hago.nobilityMutation.sendPreparedPurchase(resolved.session, request, guard)
    : { outcome: "BLOCKED", attempted: false, upstreamCode: null, timeout: false };
}

module.exports = {
  sendOtpApi, verifySmsAuthApi, verifySession, verifyHagoIdApi, getAgentWalletApi, getAgentHistoryApi,
  getTargetUidByVid, getAgentInfoByUid, prepareRechargeMutation, prepareControlledRecharge, sendControlledRecharge, reconcileMutationReadOnly, getTransferReadiness,
  getNobilityReadiness,
  getNobilityPurchaseReadiness,
  prepareNobilityPurchase, sendNobilityPurchase,
  _test: {
    getSession, resolveSession, getMutationGate,
    setIntegrationForTest(integration) { hago = integration; },
    resetIntegrationForTest() { hago = createHagoIntegration(); },
  },
};
