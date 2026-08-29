const { HAGO_CURRENCIES } = require("./signers");

function normalizedCrystalBalance(wallet) {
  const rawBalance = wallet?.balances?.hagoCrystal;
  if (rawBalance === null || rawBalance === undefined || rawBalance === "") return null;
  const balance = Number(rawBalance);
  return Number.isFinite(balance) ? balance : null;
}

// CONFIRMED browser-submit checks for Crystal. The bundle's unfortunately
// named transferPermission computed value is true unless the matching entry
// has status === 1; the submit predicate allows true and blocks false.
// `recharge_crystal` controls Crystal support/visibility, not this predicate.
function validateCrystalTransferPreflight({ amount, wallet, permissions, agency } = {}) {
  // CONFIRMED: Crystal's dedicated AmountField strips non-digits and accepts
  // only [1-9][0-9]{0,6}; unlike Diamond it receives no overridden maxLen.
  const amountText = String(amount ?? "").trim();
  if (!/^[1-9][0-9]{0,6}$/.test(amountText)) {
    return { ok: false, kind: "INVALID_REQUEST", message: "A positive whole-number Crystal amount of up to seven digits is required." };
  }
  const transferAmount = Number(amountText);

  const permission = permissions?.transferPermission;
  if (permission?.present && permission.status === 1) {
    return { ok: false, kind: "CRYSTAL_TRANSFER_PERMISSION_REQUIRED", message: "Crystal transfer is not available for this account." };
  }

  const balance = normalizedCrystalBalance(wallet);
  if (balance === null) {
    return { ok: false, kind: "CRYSTAL_BALANCE_UNAVAILABLE", message: "A current Crystal balance is required before a controlled transfer." };
  }
  if (transferAmount > balance) {
    return { ok: false, kind: "CRYSTAL_INSUFFICIENT_BALANCE", message: "The requested Crystal amount exceeds the available balance." };
  }

  const transferMax = Number(agency?.transferMax);
  if (Number.isFinite(transferMax) && transferMax > 0 && transferAmount > transferMax) {
    return { ok: false, kind: "CRYSTAL_TRANSFER_MAX", message: "The requested Crystal amount exceeds the transfer maximum." };
  }

  return {
    ok: true,
    currencyType: HAGO_CURRENCIES.HAGO_CRYSTAL,
    transferAmount,
    balance,
    transferMax: Number.isFinite(transferMax) ? transferMax : null,
  };
}

module.exports = { normalizedCrystalBalance, validateCrystalTransferPreflight };
