const { buildTransferAccountRequest } = require("./mutation");
const { buildTurnoverHeaders, createSignedForm } = require("./turnover");
const { HAGO_CURRENCIES } = require("./signers");
const { NOBLE_RPC, NOBLE_TYPE_BY_NAME, BUY_TYPES } = require("./nobility");

// This is deliberately structural: it never resolves a VID, reads a wallet,
// decrypts a real session, or imports an HTTP client. Synthetic values let us
// expose the exact request contract without disclosing account identifiers.
const PREVIEW_AUTHENTICATED_UID = "preview-authenticated-uid";
const PREVIEW_TARGET_UID = "preview-target-uid";
const PREVIEW_TIMESTAMP = 1700000000000;

function buildDiamondMutationPreview({ amount, now = () => PREVIEW_TIMESTAMP } = {}) {
  const transferAmount = Number(amount);
  if (!Number.isFinite(transferAmount) || transferAmount <= 0) throw new TypeError("transferAmount must be positive");
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp)) throw new TypeError("preview timestamp must be an integer");

  // Currency selection is agency-info-backed and therefore intentionally not
  // run by preview. 1805 is only a synthetic numeric value used to inspect the
  // confirmed transfer-account serialization contract.
  const seqId = `${PREVIEW_AUTHENTICATED_UID}${PREVIEW_TARGET_UID}${timestamp}`;
  const request = buildTransferAccountRequest({
    targetUid: PREVIEW_TARGET_UID,
    transferAmount,
    currencyType: HAGO_CURRENCIES.HAGO_DIAMOND,
    useGoldCurrency: false,
    seqId,
  });
  const data = JSON.parse(request.data);
  const form = createSignedForm(request);
  const headers = buildTurnoverHeaders({
    country: "ZZ",
    language: "en",
    cookies: { hagouid: PREVIEW_AUTHENTICATED_UID, uaasCookie: "preview-uaas-cookie" },
  });

  return {
    serviceType: "DIAMOND",
    amountType: typeof data.transferAmount,
    targetUidType: typeof data.targetUid,
    // A real Diamond currency is selected from the wallet during preflight;
    // preview cannot and must not perform that read-only upstream request.
    currencyType: null,
    currencyTypeType: typeof data.currencyType,
    useGoldCurrency: data.useGoldCurrency,
    useGoldCurrencyType: typeof data.useGoldCurrency,
    seqIdShapeValid: data.seqId === `${PREVIEW_AUTHENTICATED_UID}${PREVIEW_TARGET_UID}${timestamp}`,
    multipartFieldNames: [...form.keys()],
    dataPropertyNames: Object.keys(data),
    headerNames: Object.keys(headers),
    cookieNamesPresent: Object.keys({ hagouid: true, uaasCookie: true }),
  };
}

function buildCrystalMutationPreview({ amount, now = () => PREVIEW_TIMESTAMP } = {}) {
  const transferAmount = Number(amount);
  if (!Number.isFinite(transferAmount) || transferAmount <= 0) throw new TypeError("transferAmount must be positive");
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp)) throw new TypeError("preview timestamp must be an integer");
  const request = buildTransferAccountRequest({
    targetUid: PREVIEW_TARGET_UID,
    transferAmount,
    currencyType: HAGO_CURRENCIES.HAGO_CRYSTAL,
    useGoldCurrency: false,
    seqId: `${PREVIEW_AUTHENTICATED_UID}${PREVIEW_TARGET_UID}${timestamp}`,
  });
  const data = JSON.parse(request.data);
  const form = createSignedForm(request);
  return {
    serviceType: "CRYSTAL",
    currencyType: data.currencyType,
    currencyTypeType: typeof data.currencyType,
    amountType: typeof data.transferAmount,
    targetUidType: typeof data.targetUid,
    useGoldCurrency: data.useGoldCurrency,
    useGoldCurrencyType: typeof data.useGoldCurrency,
    multipartFieldNames: [...form.keys()],
    dataPropertyNames: Object.keys(data),
  };
}

function buildNobilityMutationPreview({ nobilityType, buyType = BUY_TYPES.PURCHASE } = {}) {
  const nobleType = NOBLE_TYPE_BY_NAME[nobilityType] || Number(nobilityType);
  if (!Number.isInteger(nobleType) || nobleType < 1 || nobleType > 4) throw new TypeError("valid nobility type is required");
  if (![BUY_TYPES.PURCHASE, BUY_TYPES.RENEW].includes(Number(buyType))) throw new TypeError("valid Noble buy type is required");
  return {
    serviceType: "NOBILITY",
    nobleType,
    buyType: Number(buyType),
    diamondType: "number",
    turnoverPackIdType: "config-derived",
    appName: "hago",
    rpcPackage: NOBLE_RPC.package,
    rpcService: NOBLE_RPC.service,
    rpcMethod: NOBLE_RPC.purchaseMethod,
  };
}

module.exports = { buildDiamondMutationPreview, buildCrystalMutationPreview, buildNobilityMutationPreview };
