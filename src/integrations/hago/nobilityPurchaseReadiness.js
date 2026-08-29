const { BUY_TYPES, NOBLE_TYPES, decideNoblePurchase, selectNoblePurchase, validNobleType } = require("./nobility");

const NOBLE_NAMES = Object.freeze({
  [NOBLE_TYPES.KNIGHT]: "Knight",
  [NOBLE_TYPES.VISCOUNT]: "Viscount",
  [NOBLE_TYPES.EARL]: "Earl",
  [NOBLE_TYPES.DUKE]: "Duke",
});

function nobleTypeName(type) {
  return NOBLE_NAMES[type] || null;
}

function remainingDays(remainingSeconds) {
  return Number.isFinite(Number(remainingSeconds)) ? Math.ceil(Number(remainingSeconds) / 86400) : null;
}

function legacyDiamondBalance(wallet) {
  const balance = Number(wallet?.balances?.hagoDiamond);
  return Number.isFinite(balance) && balance >= 0 ? balance : null;
}

function currentNobleSummary(current = {}) {
  return {
    type: Number.isInteger(Number(current.type)) ? Number(current.type) : null,
    status: Number.isInteger(Number(current.status)) ? Number(current.status) : null,
    remainingDays: remainingDays(current.remainingSeconds),
  };
}

function buildReadiness({ selectedType, current, config, wallet }) {
  const selectedName = nobleTypeName(selectedType);
  const currentSummary = currentNobleSummary(current);
  const decision = decideNoblePurchase({ selectedNobleType: selectedType, current });
  const base = {
    selectedType,
    selectedName,
    current: currentSummary,
    derivedBuyType: decision.ok ? decision.buyType : null,
    derivedBuyTypeName: decision.ok ? decision.buyType === BUY_TYPES.RENEW ? "RENEW" : "PURCHASE" : null,
    diamondCost: null,
    packAvailable: false,
    wallet: { available: legacyDiamondBalance(wallet), sufficient: false },
    lowerTierBlocked: false,
    confirmationRequired: false,
    technicallyEligible: false,
    blockReason: null,
  };

  if (!selectedName) return { ...base, blockReason: "INVALID_NOBLE_TYPE" };
  if (!decision.ok) {
    return {
      ...base,
      lowerTierBlocked: String(decision.kind || "").startsWith("LOWER_NOBLE_"),
      blockReason: String(decision.kind || "").startsWith("LOWER_NOBLE_") ? "NOBILITY_LOWER_LEVEL" : "NOBILITY_SELECTION_UNAVAILABLE",
    };
  }

  const selected = selectNoblePurchase(config, selectedType, decision.buyType);
  if (!selected) return { ...base, blockReason: "NOBILITY_CONFIG_UNAVAILABLE" };
  const packAvailable = selected.turnoverPackId !== null && selected.turnoverPackId !== undefined && String(selected.turnoverPackId) !== "";
  const diamondCost = Number.isFinite(selected.diamond) && selected.diamond > 0 ? selected.diamond : null;
  const walletAvailable = legacyDiamondBalance(wallet);
  const sufficient = diamondCost !== null && walletAvailable !== null && walletAvailable >= diamondCost;
  const enriched = {
    ...base,
    diamondCost,
    packAvailable,
    wallet: { available: walletAvailable, sufficient },
  };
  if (!packAvailable) return { ...enriched, blockReason: "NOBILITY_PACK_UNAVAILABLE" };
  if (diamondCost === null) return { ...enriched, blockReason: "NOBILITY_INVALID_PRICE" };
  if (decision.requiresConfirmation) return { ...enriched, confirmationRequired: true, blockReason: "NOBILITY_CONFIRMATION_REQUIRED" };
  if (!sufficient) return { ...enriched, blockReason: "NOBILITY_INSUFFICIENT_DIAMOND" };
  return { ...enriched, technicallyEligible: true };
}

function createNobilityPurchaseReadinessClient({ uaas, ymicro, nobility, turnover } = {}) {
  if (!uaas || !ymicro || !nobility || !turnover) throw new TypeError("Nobility purchase readiness dependencies are required");
  return {
    async getReadiness(session, { targetId, nobilityType } = {}) {
      const selectedType = validNobleType(nobilityType);
      if (!selectedType) return { ok: false, kind: "INVALID_REQUEST", message: "A valid Nobility type is required." };

      const sessionStatus = await uaas.probeSession(session);
      if (sessionStatus?.status !== "VALID") return { ok: false, kind: "SESSION_REJECTED", message: "A valid Hago session is required." };

      const target = await ymicro.getTargetByVid(session, targetId);
      if (!target?.ok || target?.user?.uid == null) {
        return { ok: false, kind: target?.kind || "INVALID_TARGET", message: target?.message || "Hago did not provide a target UID.", stage: "VID_RESOLUTION" };
      }

      const [configuration, state, walletResult] = await Promise.all([
        nobility.listAllNobleConf(session),
        nobility.getUserNoble(session, target.user.uid),
        turnover.getWallet(session),
      ]);
      if (!configuration?.ok) return { ...configuration, stage: configuration?.stage || "LIST_NOBLE_CONFIG" };
      if (!state?.ok) return { ...state, stage: state?.stage || "GET_USER_NOBLE" };
      if (!walletResult?.ok) return { ok: false, kind: walletResult?.kind || "WALLET_UNAVAILABLE", message: "A current legacy Diamond balance is unavailable.", stage: "WALLET" };

      return { ok: true, readiness: buildReadiness({ selectedType, current: state.current, config: configuration.config, wallet: walletResult.wallet }) };
    },
  };
}

module.exports = {
  nobleTypeName,
  legacyDiamondBalance,
  currentNobleSummary,
  buildReadiness,
  createNobilityPurchaseReadinessClient,
};
