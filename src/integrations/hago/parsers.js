function isUaasSuccess(payload) {
  return Boolean(payload && String(payload.result_code) === "00000");
}

function parseSetCookies(setCookie = []) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.reduce((cookies, header) => {
    if (typeof header !== "string") return cookies;
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator < 1) return cookies;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name === "hagouid" || name === "uaasCookie") cookies[name] = value;
    return cookies;
  }, {});
}

function parseYmicroUser(payload) {
  const info = payload?.result?.errcode === 0 && Array.isArray(payload.infos)
    ? payload.infos[0]
    : null;
  if (!info || info.uid == null) return null;
  return { uid: String(info.uid), vid: info.vid == null ? undefined : String(info.vid), nick: info.nick, avatar: info.avatar, country: info.country };
}

const WALLET_CURRENCY_FIELDS = Object.freeze({
  1805: "hagoDiamond",
  1826: "hagoCrystal",
  1835: "hagoDiamondNew",
});

function parseTurnoverWallet(payload) {
  if (!payload || payload.code !== 200 || payload.result !== 1) return null;
  let jsonMsg = payload.jsonMsg;
  if (typeof jsonMsg === "string") {
    try { jsonMsg = JSON.parse(jsonMsg); } catch { return null; }
  }
  if (!jsonMsg || typeof jsonMsg !== "object" || Array.isArray(jsonMsg) || !Array.isArray(jsonMsg.accountList)) return null;
  const balances = { hagoDiamond: null, hagoDiamondNew: null, hagoCrystal: null };
  for (const account of jsonMsg.accountList) {
    if (!account || typeof account !== "object" || Array.isArray(account)) continue;
    const field = WALLET_CURRENCY_FIELDS[Number(account.currencyType)];
    const amount = Number(account.amount);
    if (!field || !Number.isFinite(amount)) continue;
    balances[field] = (balances[field] ?? 0) + amount;
  }
  return {
    balances,
  };
}

function parseTurnoverHistory(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.jsonMsg === undefined) return Object.keys(payload).length ? payload : null;
  if (typeof payload.jsonMsg === "object" && payload.jsonMsg && !Array.isArray(payload.jsonMsg)) return payload.jsonMsg;
  if (typeof payload.jsonMsg !== "string") return null;
  try {
    const parsed = JSON.parse(payload.jsonMsg);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { isUaasSuccess, parseSetCookies, parseYmicroUser, parseTurnoverWallet, parseTurnoverHistory, WALLET_CURRENCY_FIELDS };
