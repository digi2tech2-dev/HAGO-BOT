const { parseTurnoverWallet, parseTurnoverHistory } = require("./parsers");
const { createHagoHttpClient, normalizeHttpError } = require("./client");
const { buildCookieHeader } = require("./session");
const { HAGO_APP_ID, createTurnoverSigner } = require("./signers");

const TURNOVER_BASE_URL = process.env.HAGO_TURNOVER_BASE_URL || "https://db-turnover.ihago.net";
const DEFAULT_HISTORY_PAGE = 1;
const DEFAULT_HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGE = 10000;
const MAX_HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_FILTER_ITEMS = 50;
const MAX_HISTORY_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

function buildTurnoverHeaders(session, extra = {}) {
  const cookie = buildCookieHeader(session);
  if (!cookie) return null;
  const country = session?.country || process.env.HAGO_COUNTRY || "";
  const language = session?.language || process.env.HAGO_LANGUAGE || "en";
  return {
    Cookie: cookie,
    "X-AuthType": "3",
    "X-App-Name": "hago",
    "X-AppId": HAGO_APP_ID,
    country: String(country).toUpperCase(),
    language: String(language),
    ...extra,
  };
}

function buildWalletData(session) {
  const uid = session?.hagoUid || session?.cookies?.hagouid;
  if (!uid) return null;
  return {
    version: 0,
    appId: Number(HAGO_APP_ID),
    cmd: 1005,
    jsonMsg: { cmd: 1005, uid: String(uid), appId: Number(HAGO_APP_ID), usedChannel: 10000 },
  };
}

function createSignedForm(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
  return form;
}

function buildHistoryData(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new TypeError("history query must be an object");
  const allowed = ["qtype", "optTypes", "page", "pagesize", "startTime", "endTime", "vid", "currencyTypeList"];
  const data = { qtype: 2, optTypes: [], page: DEFAULT_HISTORY_PAGE, pagesize: DEFAULT_HISTORY_PAGE_SIZE };
  for (const key of allowed) if (query[key] !== undefined) data[key] = query[key];
  if (!Number.isInteger(Number(data.qtype)) || !Array.isArray(data.optTypes)) throw new TypeError("invalid history query");
  if (!validIntegerArray(data.optTypes, MAX_HISTORY_FILTER_ITEMS)) throw new TypeError("invalid optTypes");
  if (!Number.isInteger(Number(data.page)) || Number(data.page) < 1 || Number(data.page) > MAX_HISTORY_PAGE) throw new TypeError("invalid history page");
  if (!Number.isInteger(Number(data.pagesize)) || Number(data.pagesize) < 1 || Number(data.pagesize) > MAX_HISTORY_PAGE_SIZE) throw new TypeError("invalid history pagesize");
  if ((data.startTime === undefined) !== (data.endTime === undefined)) throw new TypeError("startTime and endTime must be supplied together");
  if (data.startTime !== undefined && (!validTimestamp(data.startTime) || !validTimestamp(data.endTime) || Number(data.endTime) < Number(data.startTime) || Number(data.endTime) - Number(data.startTime) > MAX_HISTORY_RANGE_MS)) throw new TypeError("invalid history time range");
  if (data.vid !== undefined && !validPositiveInteger(data.vid)) throw new TypeError("invalid history vid");
  if (data.currencyTypeList !== undefined && !validIntegerArray(data.currencyTypeList, MAX_HISTORY_FILTER_ITEMS)) throw new TypeError("invalid currencyTypeList");
  data.page = Number(data.page);
  data.pagesize = Number(data.pagesize);
  if (data.startTime !== undefined) {
    data.startTime = Number(data.startTime);
    data.endTime = Number(data.endTime);
  }
  if (data.vid !== undefined) data.vid = String(data.vid);
  if (data.currencyTypeList !== undefined) data.currencyTypeList = data.currencyTypeList.map(Number);
  data.optTypes = data.optTypes.map(Number);
  data.qtype = Number(data.qtype);
  return data;
}

function validPositiveInteger(value) {
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validTimestamp(value) {
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function validIntegerArray(values, maxLength) {
  return Array.isArray(values) && values.length <= maxLength && values.every(validPositiveInteger);
}

function createTurnoverClient({ http = createHagoHttpClient(), signer = createTurnoverSigner(), baseUrl = TURNOVER_BASE_URL } = {}) {
  return {
    async getWallet(session) {
      const headers = buildTurnoverHeaders(session);
      const data = buildWalletData(session);
      if (!headers || !data) return { ok: false, kind: "NO_SESSION", message: "An active per-account Hago session is required" };
      const signed = signer.signData(data);
      try {
        const response = await http.get(`${baseUrl}/query/${HAGO_APP_ID}/1005`, { params: signed, headers });
        const wallet = parseTurnoverWallet(response.data);
        return wallet ? { ok: true, wallet } : { ok: false, kind: "MALFORMED_RESPONSE", message: "Hago returned an invalid wallet response" };
      } catch (error) { return { ok: false, ...normalizeHttpError(error) }; }
    },
    async getHistory(session, query = {}) {
      const headers = buildTurnoverHeaders(session);
      if (!headers) return { ok: false, kind: "NO_SESSION", message: "An active per-account Hago session is required" };
      let data;
      try { data = buildHistoryData(query); }
      catch (error) { return { ok: false, kind: "INVALID_REQUEST", message: error.message }; }
      const signed = signer.signData(data);
      const form = createSignedForm({ appId: HAGO_APP_ID, sign: signed.sign, data: signed.data });
      try {
        const response = await http.post(`${baseUrl}/agencypay/queryAccountHistory`, form, { headers });
        const history = parseTurnoverHistory(response.data);
        return history
          ? { ok: true, history }
          : { ok: false, kind: "MALFORMED_RESPONSE", message: "Hago returned an invalid account history response" };
      } catch (error) { return { ok: false, ...normalizeHttpError(error) }; }
    },
    normalizeWallet(payload) { return parseTurnoverWallet(payload); },
  };
}

module.exports = {
  createTurnoverClient, buildTurnoverHeaders, buildWalletData, buildHistoryData, createSignedForm, TURNOVER_BASE_URL,
  DEFAULT_HISTORY_PAGE, DEFAULT_HISTORY_PAGE_SIZE, MAX_HISTORY_PAGE, MAX_HISTORY_PAGE_SIZE, MAX_HISTORY_RANGE_MS,
};
