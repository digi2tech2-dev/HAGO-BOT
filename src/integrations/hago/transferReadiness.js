const { createHagoHttpClient } = require("./client");
const { buildTurnoverHeaders, createSignedForm, TURNOVER_BASE_URL } = require("./turnover");
const { HAGO_APP_ID, HAGO_CURRENCIES, createTurnoverSigner } = require("./signers");

const DEFAULT_DIAMOND_TRANSFER_CURRENCY = HAGO_CURRENCIES.HAGO_DIAMOND;

function emptyReadiness(session = "UNKNOWN") {
  return {
    session,
    isAgency: null,
    hasTransactionPassword: null,
    transferPermission: { present: false, status: null },
    rechargePermission: { present: false, status: null },
    crystalWhitelist: { present: false, status: null },
    agencyDiamondCurrency: null,
    effectiveTransferCurrency: DEFAULT_DIAMOND_TRANSFER_CURRENCY,
    walletDiamondLegacyAvailable: false,
    walletDiamondNewAvailable: false,
    crystalBalanceAvailable: false,
    transferMax: null,
  };
}

function supportedDiamondCurrency(value) {
  const currencyType = Number(value);
  return currencyType === HAGO_CURRENCIES.HAGO_DIAMOND || currencyType === HAGO_CURRENCIES.HAGO_DIAMOND_NEW
    ? currencyType
    : null;
}

function effectiveTransferCurrency(agencyDiamondCurrency) {
  return supportedDiamondCurrency(agencyDiamondCurrency) || DEFAULT_DIAMOND_TRANSFER_CURRENCY;
}

function numericOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function permissionEntry(entries, funcName) {
  const entry = Array.isArray(entries) ? entries.find((item) => item && item.funcName === funcName) : null;
  return entry ? { present: true, status: numericOrNull(entry.status) } : { present: false, status: null };
}

function parseAgencyReadiness(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { isAgency: null, transferMax: null, agencyDiamondCurrency: null };
  return {
    isAgency: typeof data.isAgency === "boolean" ? data.isAgency : null,
    transferMax: numericOrNull(data.transferMax),
    agencyDiamondCurrency: supportedDiamondCurrency(data.currencyType),
  };
}

function parsePermissionReadiness(payload) {
  const data = payload?.data;
  return {
    transferPermission: permissionEntry(data?.permissions, "transfer_currency_to_other"),
    rechargePermission: permissionEntry(data?.permissions, "recharge_currency"),
    crystalWhitelist: permissionEntry(data?.whitelistPermissions, "recharge_crystal"),
  };
}

function parsePasswordReadiness(payload) {
  if (!payload || payload.code === undefined || payload.code === null) return null;
  // Confirmed bundle behavior: only numeric code 1 is treated as present.
  return Number(payload.code) === 1;
}

function parseWalletReadiness(wallet) {
  const balances = wallet?.balances;
  if (!balances || typeof balances !== "object") return { walletDiamondLegacyAvailable: false, walletDiamondNewAvailable: false, crystalBalanceAvailable: false };
  return {
    walletDiamondLegacyAvailable: Number.isFinite(Number(balances.hagoDiamond)) && Number(balances.hagoDiamond) > 0,
    walletDiamondNewAvailable: Number.isFinite(Number(balances.hagoDiamondNew)) && Number(balances.hagoDiamondNew) > 0,
    crystalBalanceAvailable: Number.isFinite(Number(balances.hagoCrystal)) && Number(balances.hagoCrystal) > 0,
  };
}

function createTransferReadinessClient({ http = createHagoHttpClient(), uaas, turnover, signer = createTurnoverSigner(), baseUrl = TURNOVER_BASE_URL } = {}) {
  if (!uaas || !turnover) throw new TypeError("transfer readiness dependencies are required");

  function headersFor(session) {
    return buildTurnoverHeaders(session);
  }

  async function postAgencyInfo(session) {
    const headers = headersFor(session);
    if (!headers || !session?.hagoUid) return null;
    const country = String(session.country || process.env.HAGO_COUNTRY || "").toUpperCase();
    const form = createSignedForm({ appId: HAGO_APP_ID, sign: "", data: "" });
    try {
      const response = await http.post(`${baseUrl}/agencypay/query_agency_info?uid=${encodeURIComponent(session.hagoUid)}&country=${encodeURIComponent(country)}`, form, { headers: { ...headers, country } });
      return parseAgencyReadiness(response?.data);
    } catch { return null; }
  }

  async function postSignedEmpty(session, path, parser) {
    const headers = headersFor(session);
    if (!headers) return null;
    const signed = signer.signData({});
    const form = createSignedForm({ appId: HAGO_APP_ID, sign: signed.sign, data: signed.data });
    try {
      const response = await http.post(`${baseUrl}${path}`, form, { headers });
      return parser(response?.data);
    } catch { return null; }
  }

  return {
    async getTransferReadiness(session) {
      const sessionResult = await uaas.probeSession(session);
      const readiness = emptyReadiness(sessionResult?.status || "UNKNOWN");
      if (readiness.session !== "VALID") return { ok: true, readiness };

      const [agency, permissions, hasTransactionPassword, wallet] = await Promise.all([
        postAgencyInfo(session),
        postSignedEmpty(session, "/agencypay/permissions", parsePermissionReadiness),
        postSignedEmpty(session, "/agencypay/has_psw", parsePasswordReadiness),
        turnover.getWallet(session),
      ]);
      if (agency) {
        Object.assign(readiness, agency);
        readiness.effectiveTransferCurrency = effectiveTransferCurrency(agency.agencyDiamondCurrency);
      }
      if (permissions) Object.assign(readiness, permissions);
      if (hasTransactionPassword !== null) readiness.hasTransactionPassword = hasTransactionPassword;
      if (wallet?.ok) Object.assign(readiness, parseWalletReadiness(wallet.wallet));
      return { ok: true, readiness };
    },
  };
}

module.exports = {
  emptyReadiness, numericOrNull, permissionEntry, parseAgencyReadiness, parsePermissionReadiness, parsePasswordReadiness,
  supportedDiamondCurrency, effectiveTransferCurrency, parseWalletReadiness, createTransferReadinessClient,
};
