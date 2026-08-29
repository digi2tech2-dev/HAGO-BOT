const { normalizeHttpError } = require("./client");
const { buildCookieHeader } = require("./session");
const {
  NOBLE_RPC,
  BUY_TYPES,
  decideNoblePurchase,
  selectNoblePurchase,
  buildBuyNobleByAgencyPayload,
  normalizeNobleResponse,
} = require("./nobility");
const { NOBLE_YMICRO_URL, NOBLE_YMICRO_RUNTIME, buildNobleYmicroMetadata, normalizeNobleUid } = require("./nobilityClient");
const { isNobilityEnabled } = require("../../config/runtime");

function isNobilitySenderEnabled({ idempotencyKey, env = process.env } = {}) {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey || "")) && isNobilityEnabled(env);
}

function legacyDiamondBalance(wallet) {
  const balance = Number(wallet?.balances?.hagoDiamond);
  return Number.isFinite(balance) && balance >= 0 ? balance : null;
}

function normalizeNobilityOutcome(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { outcome: "UNKNOWN", upstreamCode: null };
  const normalized = normalizeNobleResponse(payload);
  if (normalized.outcome === "SUCCESS") return { outcome: "SUCCESS", upstreamCode: null };
  if (normalized.outcome === "REJECTED") return { outcome: "REJECTED", upstreamCode: normalized.code ?? null, knownError: normalized.kind ?? null };
  return { outcome: "UNKNOWN", upstreamCode: normalized.code ?? null };
}

function outcomeFromError(error) {
  const normalized = normalizeHttpError(error);
  return { outcome: "UNKNOWN", upstreamCode: null, timeout: normalized.kind === "TIMEOUT" };
}

function createNobilityMutationClient({ http, uaas, ymicro, nobility, turnover, now = () => Date.now(), runtime = NOBLE_YMICRO_RUNTIME } = {}) {
  if (!http || !uaas || !ymicro || !nobility || !turnover) throw new TypeError("Nobility mutation dependencies are required");

  return {
    async preparePurchase(session, { targetId, nobilityType }) {
      const sessionStatus = await uaas.probeSession(session);
      if (sessionStatus?.status !== "VALID") return { ok: false, kind: "SESSION_REJECTED", message: "A valid Hago session is required before a Nobility purchase." };

      const target = await ymicro.getTargetByVid(session, targetId);
      const buyerUid = normalizeNobleUid(target?.user?.uid);
      if (!target?.ok || buyerUid === null) return { ok: false, kind: "INVALID_TARGET", message: "Hago did not provide a valid target UID." };

      // All mutable inputs are re-fetched immediately before a potential send.
      const [configuration, currentState, walletResult] = await Promise.all([
        nobility.listAllNobleConf(session),
        nobility.getUserNoble(session, buyerUid),
        turnover.getWallet(session),
      ]);
      if (!configuration?.ok) return { ok: false, kind: configuration?.kind || "NOBILITY_CONFIG_UNAVAILABLE", message: "Current Nobility configuration is unavailable." };
      if (!currentState?.ok) return { ok: false, kind: currentState?.kind || "NOBILITY_STATE_UNAVAILABLE", message: "Current Nobility state is unavailable." };
      if (!walletResult?.ok) return { ok: false, kind: walletResult?.kind || "WALLET_UNAVAILABLE", message: "A current Diamond balance is required." };

      const decision = decideNoblePurchase({ selectedNobleType: nobilityType, current: currentState.current });
      if (!decision.ok) return { ok: false, kind: decision.kind, message: "The selected Nobility level is not eligible for purchase." };
      // The browser warns and requires an explicit confirmation for these
      // transitions. This backend route has no caller-controlled confirmation
      // field, so it fails closed instead of bypassing the warning.
      if (decision.requiresConfirmation) return { ok: false, kind: "NOBILITY_CONFIRMATION_REQUIRED", message: "This Nobility change requires explicit confirmation." };

      const selected = selectNoblePurchase(configuration.config, nobilityType, decision.buyType);
      if (!selected || !Number.isFinite(selected.diamond) || selected.diamond <= 0 || selected.turnoverPackId == null || selected.turnoverPackId === "") {
        return { ok: false, kind: "NOBILITY_CONFIG_UNAVAILABLE", message: "The selected Nobility configuration is incomplete." };
      }
      const balance = legacyDiamondBalance(walletResult.wallet);
      if (balance === null) return { ok: false, kind: "NOBILITY_DIAMOND_BALANCE_UNAVAILABLE", message: "A current legacy Diamond balance is required." };
      if (selected.diamond > balance) return { ok: false, kind: "NOBILITY_INSUFFICIENT_DIAMOND", message: "The selected Nobility price exceeds the available legacy Diamond balance." };
      try {
        return {
          ok: true,
          request: buildBuyNobleByAgencyPayload({
            nobleType: selected.type,
            buyType: selected.buyType,
            buyerUid,
            diamond: selected.diamond,
            turnoverPackId: selected.turnoverPackId,
            appName: "hago",
          }),
          buyType: selected.buyType,
        };
      } catch {
        return { ok: false, kind: "NOBILITY_CONFIG_UNAVAILABLE", message: "The selected Nobility configuration could not be prepared." };
      }
    },

    async sendPreparedPurchase(session, request, guard) {
      if (!isNobilitySenderEnabled(guard)) return { outcome: "BLOCKED", attempted: false, upstreamCode: null };
      const cookie = buildCookieHeader(session);
      const metadata = buildNobleYmicroMetadata(session, `${NOBLE_RPC.service}.${NOBLE_RPC.purchaseMethod}`, now(), runtime);
      if (!cookie || !metadata) return { outcome: "UNKNOWN", upstreamCode: null, timeout: false };
      try {
        const response = await http.post(
          NOBLE_YMICRO_URL,
          JSON.stringify({ sequence: Number(metadata.sequence), ...request }),
          { params: metadata.params, headers: { Cookie: cookie, "Content-Type": "text/plain" } },
        );
        return normalizeNobilityOutcome(response?.data);
      } catch (error) {
        return outcomeFromError(error);
      }
    },
  };
}

module.exports = {
  isNobilitySenderEnabled,
  legacyDiamondBalance,
  normalizeNobilityOutcome,
  createNobilityMutationClient,
};
