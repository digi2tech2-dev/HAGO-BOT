const { HAGO_APP_ID } = require("./signers");

// CONFIRMED request shape from the recharge-agent bundle. This module never sends it.
function buildTransferAccountRequest({ targetUid, transferAmount, currencyType, useGoldCurrency, seqId }) {
  if (targetUid == null || String(targetUid).trim() === "") throw new TypeError("targetUid is required");
  if (!Number.isFinite(Number(transferAmount)) || Number(transferAmount) <= 0) throw new TypeError("transferAmount must be positive");
  if (!Number.isInteger(Number(currencyType))) throw new TypeError("currencyType is required");
  if (typeof useGoldCurrency !== "boolean") throw new TypeError("useGoldCurrency must be boolean");
  if (typeof seqId !== "string" || seqId.trim() === "") throw new TypeError("seqId is required");
  return {
    appId: HAGO_APP_ID,
    sign: "",
    data: JSON.stringify({ targetUid: String(targetUid), transferAmount: Number(transferAmount), currencyType: Number(currencyType), useGoldCurrency, seqId }),
  };
}

function parseTransferAccountResponse(payload) {
  if (payload?.code === undefined || payload?.code === null || String(payload.code).trim() === "") return { outcome: "UNKNOWN", upstreamCode: null };
  const code = Number(payload?.code);
  if (!Number.isFinite(code)) return { outcome: "UNKNOWN", upstreamCode: null };
  if (code === 1) return { outcome: "SUCCESS", upstreamCode: code };
  if (code === -401) return { outcome: "SESSION_PROBLEM", upstreamCode: code };
  if (code === -76) return { outcome: "TRANSFER_LIMIT", upstreamCode: code };
  // The bundle treats all other numeric values as failures, but does not
  // establish a more specific business meaning for them.
  return { outcome: "REJECTED", upstreamCode: code };
}

module.exports = { buildTransferAccountRequest, parseTransferAccountResponse };
