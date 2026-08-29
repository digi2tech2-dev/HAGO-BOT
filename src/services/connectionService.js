const Connection = require("../models/Connection");
const { ClientDataCipher, digestProtectedLookup } = require("../security/clientDataSecrets");
const { encryptSessionForStorage } = require("../integrations/hago/session");

function makeConnectionValues({ clientId, phone, countryCode, deviceId, session, dataKey, country = null, language = null }) {
  if (!session?.cookies?.hagouid || !session?.cookies?.uaasCookie) throw new Error("Complete Hago session is required");
  const cipher = new ClientDataCipher(dataKey);
  return {
    clientId,
    phoneEncrypted: cipher.encrypt(phone),
    phoneLookupDigest: digestProtectedLookup(dataKey, "phone", phone),
    upstreamAccountDigest: digestProtectedLookup(dataKey, "hago-account", String(session.cookies.hagouid)),
    hagoSession: encryptSessionForStorage({ hagouid: session.cookies.hagouid, uaasCookie: session.cookies.uaasCookie }),
    hagoCountry: country || null,
    hagoLanguage: language || null,
    status: "ACTIVE",
    lastValidatedAt: new Date(),
  };
}

async function upsertConnection(input) {
  const values = makeConnectionValues(input);
  return Connection.findOneAndUpdate(
    { clientId: values.clientId, phoneLookupDigest: values.phoneLookupDigest },
    { $set: values },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function getOwnedConnection({ clientId, connectionId, includeSession = false }) {
  if (typeof connectionId !== "string" || !/^con_[A-Za-z0-9_-]{22}$/.test(connectionId)) return null;
  const query = Connection.findOne({ clientId, connectionId });
  return includeSession ? query.select("+hagoSession +upstreamAccountDigest") : query;
}

module.exports = { makeConnectionValues, upsertConnection, getOwnedConnection };
