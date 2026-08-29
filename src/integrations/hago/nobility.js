const NOBLE_RPC = Object.freeze({
  package: "net.ihago.money.api.noble",
  service: "Noble",
  listMethod: "ListAllNobleConf",
  userMethod: "GetUserNoble",
  purchaseMethod: "BuyNobleByAgency",
});

const NOBLE_TYPES = Object.freeze({ NONE: 0, KNIGHT: 1, VISCOUNT: 2, EARL: 3, DUKE: 4 });
const BUY_TYPES = Object.freeze({ NONE: 0, PURCHASE: 1, RENEW: 2 });
const NOBLE_STATUSES = Object.freeze({ NONE: 0, NOT_PURCHASED: 1, NORMAL: 2, DUE_SOON: 3, RENEW_PERIOD: 4, EXPIRED: 5 });
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([2, 3, 4, 7]);
const NOBLE_TYPE_BY_NAME = Object.freeze({ Knight: 1, Viscount: 2, Earl: 3, Duke: 4 });

function validNobleType(value) {
  const type = Number(value);
  return Number.isInteger(type) && type >= NOBLE_TYPES.KNIGHT && type <= NOBLE_TYPES.DUKE ? type : null;
}

function buildListAllNobleConfRequest() {
  return { os_type: "android" };
}

function buildGetUserNobleRequest(targetUid) {
  if (targetUid === null || targetUid === undefined || targetUid === "") throw new TypeError("target UID is required");
  // The bundle forwards the resolved UID value; it does not coerce it here.
  return { uid: targetUid };
}

function buildGetUserGPSubStatusRequest(targetUid) {
  if (targetUid === null || targetUid === undefined || targetUid === "") throw new TypeError("target UID is required");
  return { fix_uid: targetUid };
}

function parseNobleConfig(payload) {
  const info = Array.isArray(payload?.info) ? payload.info : null;
  if (!info) return null;
  return info.map((entry) => {
    const type = validNobleType(entry?.noble_type);
    if (!type) return null;
    return {
      type,
      // The UI labels types locally; it does not depend on a config name.
      name: typeof entry.noble_name === "string" ? entry.noble_name : null,
      buyInfo: parseNoblePack(entry.buy_info),
      renewInfo: parseNoblePack(entry.renew_info),
    };
  }).filter(Boolean);
}

function parseNoblePack(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return null;
  return {
    turnoverPackId: pack.turnover_pack_id ?? null,
    diamond: Number.isFinite(Number(pack.total_rebate_diamond)) ? Number(pack.total_rebate_diamond) : null,
  };
}

function parseCurrentNoble(payload) {
  const info = payload?.info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  return {
    type: Number.isInteger(Number(info.noble_type)) ? Number(info.noble_type) : null,
    name: typeof info.noble_name === "string" ? info.noble_name : null,
    status: Number.isInteger(Number(info.noble_status)) ? Number(info.noble_status) : null,
    remainingSeconds: Number.isFinite(Number(info.remain_seconds)) ? Number(info.remain_seconds) : null,
  };
}

function hasOtherActiveSubscription(subscriptions, selectedNobleType) {
  return Array.isArray(subscriptions) && subscriptions.some((subscription) => (
    Number(subscription?.noble_type) !== Number(selectedNobleType)
    && ACTIVE_SUBSCRIPTION_STATUSES.has(Number(subscription?.sub_status))
  ));
}

// This reports the bundle's UI decision, not an inferred server authorization.
function decideNoblePurchase({ selectedNobleType, current = {}, subscriptions = [] } = {}) {
  const selected = validNobleType(selectedNobleType);
  if (!selected) return { ok: false, kind: "INVALID_NOBLE_TYPE" };
  const currentType = Number.isInteger(Number(current.type)) ? Number(current.type) : NOBLE_TYPES.NONE;
  const currentStatus = Number.isInteger(Number(current.status)) ? Number(current.status) : NOBLE_STATUSES.NONE;
  if (selected < currentType) {
    return {
      ok: false,
      kind: currentStatus === NOBLE_STATUSES.RENEW_PERIOD ? "LOWER_NOBLE_RENEW_PERIOD" : "LOWER_NOBLE_ACTIVE",
    };
  }
  const buyType = selected === currentType ? BUY_TYPES.RENEW : BUY_TYPES.PURCHASE;
  const subscriptionWarning = hasOtherActiveSubscription(subscriptions, selected);
  const changeWarning = (currentStatus === NOBLE_STATUSES.NORMAL || currentStatus === NOBLE_STATUSES.DUE_SOON) && selected !== currentType;
  return {
    ok: true,
    buyType,
    requiresConfirmation: subscriptionWarning || changeWarning,
    confirmationReason: subscriptionWarning ? "ACTIVE_GOOGLE_PLAY_SUBSCRIPTION" : changeWarning ? "ACTIVE_NOBLE_CHANGE" : null,
  };
}

function selectNoblePurchase(config, selectedNobleType, buyType) {
  const type = validNobleType(selectedNobleType);
  const selected = Array.isArray(config) ? config.find((entry) => entry.type === type) : null;
  const pack = buyType === BUY_TYPES.RENEW ? selected?.renewInfo : buyType === BUY_TYPES.PURCHASE ? selected?.buyInfo : null;
  if (!selected || !pack) return null;
  return { type, buyType, turnoverPackId: pack.turnoverPackId, diamond: pack.diamond };
}

// Logical payload only. This module has no HTTP sender.
function buildBuyNobleByAgencyPayload({ nobleType, buyType, buyerUid, diamond, turnoverPackId, appName = "hago" }) {
  const type = validNobleType(nobleType);
  if (!type || ![BUY_TYPES.PURCHASE, BUY_TYPES.RENEW].includes(Number(buyType))) throw new TypeError("valid Noble type and buy type are required");
  if (buyerUid == null || buyerUid === "") throw new TypeError("buyer UID is required");
  if (diamond === null || diamond === undefined) throw new TypeError("config-derived Diamond amount is required");
  if (typeof appName !== "string" || appName.trim() === "") throw new TypeError("app name is required");
  return {
    noble_type: type,
    buy_type: Number(buyType),
    // The bundle forwards these runtime values without coercion.
    buyer_uid: buyerUid,
    diamond,
    turnover_pack_id: turnoverPackId,
    app_name: appName,
  };
}

function normalizeNobleResponse(payload) {
  if (payload?.is_ok === true) return { outcome: "SUCCESS", code: null };
  const code = Number(payload?.code);
  if (code === 30500) return { outcome: "REJECTED", code, kind: "BssDiamondNotEnough" };
  if (code === 30201) return { outcome: "REJECTED", code, kind: "BssRenewTimesOverLimit" };
  // The bundle gives deterministic handling only for these known codes.
  // Any other response is not enough evidence to declare a financial result.
  return { outcome: "UNKNOWN", code: Number.isFinite(code) ? code : null, kind: null };
}

module.exports = {
  NOBLE_RPC, NOBLE_TYPES, BUY_TYPES, NOBLE_STATUSES, ACTIVE_SUBSCRIPTION_STATUSES, NOBLE_TYPE_BY_NAME,
  validNobleType, buildListAllNobleConfRequest, buildGetUserNobleRequest, buildGetUserGPSubStatusRequest,
  parseNobleConfig, parseCurrentNoble, hasOtherActiveSubscription, decideNoblePurchase,
  selectNoblePurchase, buildBuyNobleByAgencyPayload, normalizeNobleResponse,
};
