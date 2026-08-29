const { createHagoHttpClient, normalizeHttpError } = require("./client");
const { buildCookieHeader } = require("./session");
const { parseYmicroUser } = require("./parsers");

function buildMetadata(session, now = Date.now()) {
  const sequence = String(now);
  return {
    sequence,
    params: { method: "Uinfo.GetUinfoByVer", sname: "net.ihago.uinfo.api.uinfo", "hago-app-name": "hago", "X-App-Name": "hago", "hago-seq-id": sequence, "X-Request-Id": `${session.hagoUid}-${sequence}`, "X-Lang": "en", "X-App-Ver": "0", "X-OsType": "android", "X-Reg-Country": "ae", "X-From-Reg-Country": "" },
  };
}

function normalizeYmicroId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createYmicroClient({ http = createHagoHttpClient(), now = () => Date.now() } = {}) {
  async function request(session, method, payload) {
    const cookie = buildCookieHeader(session);
    if (!cookie || !session?.hagoUid) return { ok: false, kind: "NO_SESSION", message: "An active per-account Hago session is required" };
    const metadata = buildMetadata(session, now());
    metadata.params.method = method;
    try {
      const response = await http.post("https://api.ihago.net/ymicro/sapi", { sequence: Number(metadata.sequence), ...payload }, { params: metadata.params, headers: { Cookie: cookie, "Content-Type": "application/json" } });
      const user = parseYmicroUser(response.data);
      return user ? { ok: true, user } : { ok: false, kind: "BUSINESS_ERROR", message: "Hago returned no matching user" };
    } catch (error) { return { ok: false, ...normalizeHttpError(error) }; }
  }
  return {
    getTargetByVid(session, vid) {
      const normalizedVid = normalizeYmicroId(vid);
      return normalizedVid ? request(session, "Uinfo.GetUinfoByVidVer", { vids: [{ vid: normalizedVid }] }) : Promise.resolve({ ok: false, kind: "INVALID_REQUEST", message: "A valid Hago VID is required" });
    },
    getUserByUid(session, uid) {
      const normalizedUid = normalizeYmicroId(uid);
      return normalizedUid ? request(session, "Uinfo.GetUinfoByVer", { uids: [{ uid: normalizedUid, ver: 0 }] }) : Promise.resolve({ ok: false, kind: "INVALID_REQUEST", message: "A valid Hago UID is required" });
    },
  };
}

module.exports = { buildMetadata, createYmicroClient, normalizeYmicroId };
