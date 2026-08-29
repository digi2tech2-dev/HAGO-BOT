const { buildTransferAccountRequest, parseTransferAccountResponse } = require("./mutation");
const { buildTurnoverHeaders, createSignedForm, TURNOVER_BASE_URL } = require("./turnover");
const { HAGO_APP_ID, HAGO_CURRENCIES, createTurnoverSigner } = require("./signers");
const { normalizeHttpError } = require("./client");
const { getControlledMutationConfig } = require("../../config/runtime");
const { parseAgencyReadiness, parsePermissionReadiness, effectiveTransferCurrency } = require("./transferReadiness");
const { validateCrystalTransferPreflight } = require("./crystalPreflight");

function isControlledMutationSenderEnabled({ controlledHeader, env = process.env } = {}) {
  if (controlledHeader !== "true") return false;
  try {
    const config = getControlledMutationConfig(env);
    return config.mutationsEnabled && config.controlledMutationMode && Number.isFinite(config.maxAmount) && config.maxAmount > 0;
  } catch {
    return false;
  }
}

function buildSeqId(currentAuthenticatedUid, targetUid, unixMillis) {
  if (!currentAuthenticatedUid || !targetUid || !Number.isSafeInteger(Number(unixMillis))) throw new TypeError("valid transfer sequence inputs are required");
  return `${String(currentAuthenticatedUid)}${String(targetUid)}${String(unixMillis)}`;
}

function selectDiamondTransferCurrency(agencyReadiness) {
  return effectiveTransferCurrency(agencyReadiness?.agencyDiamondCurrency);
}

function transferOutcomeFromError(error) {
  const parsed = parseTransferAccountResponse(error?.response?.data);
  if (parsed.outcome !== "UNKNOWN") return parsed;
  const normalized = normalizeHttpError(error);
  // A transport failure after a send starts is always ambiguous. There is no
  // retry path here because the remote service may already have processed it.
  return { outcome: "UNKNOWN", upstreamCode: null, timeout: normalized.kind === "TIMEOUT" };
}

function createFinancialMutationClient({ http, ymicro, turnover, baseUrl = TURNOVER_BASE_URL, now = () => Date.now() } = {}) {
  if (!http || !ymicro || !turnover) throw new TypeError("financial mutation dependencies are required");

  async function getAgencyReadiness(session) {
    const headers = buildTurnoverHeaders(session);
    if (!headers || !session?.hagoUid) return null;
    const country = String(session.country || process.env.HAGO_COUNTRY || "").toUpperCase();
    const form = createSignedForm({ appId: HAGO_APP_ID, sign: "", data: "" });
    try {
      const response = await http.post(`${baseUrl}/agencypay/query_agency_info?uid=${encodeURIComponent(session.hagoUid)}&country=${encodeURIComponent(country)}`, form, { headers: { ...headers, country } });
      return parseAgencyReadiness(response?.data);
    } catch {
      // The bundle falls back to the default Diamond currency when agency
      // information is absent, rather than selecting a wallet account type.
      return null;
    }
  }

  async function getCrystalPreflight(session) {
    const headers = buildTurnoverHeaders(session);
    if (!headers) return { wallet: null, permissions: null, agency: null };
    const signer = createTurnoverSigner();
    const signed = signer.signData({});
    const permissionForm = createSignedForm({ appId: HAGO_APP_ID, sign: signed.sign, data: signed.data });
    const permissions = http.post(`${baseUrl}/agencypay/permissions`, permissionForm, { headers })
      .then((response) => parsePermissionReadiness(response?.data))
      .catch(() => null);
    const agency = getAgencyReadiness(session);
    const wallet = turnover.getWallet(session).then((result) => result?.ok ? result.wallet : null).catch(() => null);
    const [resolvedPermissions, resolvedAgency, resolvedWallet] = await Promise.all([permissions, agency, wallet]);
    return { permissions: resolvedPermissions, agency: resolvedAgency, wallet: resolvedWallet };
  }

  return {
    async prepareTransfer(session, { targetId, amount, serviceType }) {
      const target = await ymicro.getTargetByVid(session, targetId);
      if (!target?.ok || !target.user?.uid) return target?.ok === false ? target : { ok: false, kind: "INVALID_TARGET", message: "Hago did not provide a target UID." };

      let currencyType;
      if (serviceType === "CRYSTAL") {
        const preflight = validateCrystalTransferPreflight({
          amount,
          ...(await getCrystalPreflight(session)),
        });
        if (!preflight.ok) return preflight;
        // Crystal is fixed by the bundle and must never inherit Diamond's
        // agency-currency selection or Diamond-New minimum.
        currencyType = HAGO_CURRENCIES.HAGO_CRYSTAL;
      } else if (serviceType === "DIAMOND") {
        const agencyReadiness = await getAgencyReadiness(session);
        currencyType = selectDiamondTransferCurrency(agencyReadiness);
        if (currencyType === HAGO_CURRENCIES.HAGO_DIAMOND_NEW && Number(amount) < 200) {
          return { ok: false, kind: "DIAMOND_MIN_AMOUNT", message: "The confirmed Diamond New minimum amount is 200." };
        }
      } else {
        return { ok: false, kind: "UNSUPPORTED_MUTATION", message: "This mutation type is not enabled." };
      }

      try {
        const targetUid = String(target.user.uid);
        const seqId = buildSeqId(session.hagoUid, targetUid, now());
        // `false` is the already-confirmed transfer-account bundle value for
        // this Diamond/Crystal flow. No alternate flag behavior is inferred.
        const request = buildTransferAccountRequest({ targetUid, transferAmount: amount, currencyType, useGoldCurrency: false, seqId });
        return { ok: true, request, currencyType };
      } catch {
        return { ok: false, kind: "INVALID_TRANSFER", message: "The controlled transfer request could not be constructed." };
      }
    },

    async sendPreparedTransfer(session, request, guard) {
      // This check duplicates the controller guard so no direct caller can
      // reach the financial HTTP boundary without all controlled-mode gates.
      if (!isControlledMutationSenderEnabled(guard)) return { outcome: "BLOCKED", upstreamCode: null, attempted: false };
      const headers = buildTurnoverHeaders(session);
      if (!headers) return { outcome: "UNKNOWN", upstreamCode: null, timeout: false };
      const form = createSignedForm(request);
      try {
        const response = await http.post(`${baseUrl}/agencypay/transfer_account`, form, { headers });
        return parseTransferAccountResponse(response?.data);
      } catch (error) {
        return transferOutcomeFromError(error);
      }
    },

    async reconcileReadOnly(session, historyQuery = {}) {
      const [wallet, history] = await Promise.all([turnover.getWallet(session), turnover.getHistory(session, historyQuery)]);
      // Account history has no confirmed transaction-reference correlation, so
      // this helper intentionally never changes a local mutation outcome.
      return {
        status: "UNKNOWN",
        wallet: wallet?.ok ? wallet.wallet : null,
        history: history?.ok ? history.history : null,
      };
    },
  };
}

module.exports = { buildSeqId, selectDiamondTransferCurrency, transferOutcomeFromError, isControlledMutationSenderEnabled, createFinancialMutationClient };
