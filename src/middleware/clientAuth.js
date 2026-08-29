const Client = require("../models/Client");
const ClientApiKey = require("../models/ClientApiKey");
const { parseClientApiKeyPepper } = require("../config/runtime");
const { createClientAuthenticator } = require("../services/clientKeyService");

function createMongoAuthenticator(env = process.env) {
  return createClientAuthenticator({
    pepper: parseClientApiKeyPepper(env.CLIENT_API_KEY_PEPPER),
    findKeyById: (keyId) => ClientApiKey.findOne({ keyId }).select("+secretDigest").lean(),
    findClientById: (clientId) => Client.findOne({ _id: clientId }).lean(),
    touchKey: (id, at) => ClientApiKey.updateOne({ _id: id, status: "ACTIVE" }, { $set: { lastUsedAt: at } }),
  });
}

function createClientAuthMiddleware({ authenticator, env = process.env } = {}) {
  const activeAuthenticator = authenticator || createMongoAuthenticator(env);
  return async (req, res, next) => {
    try {
      const result = await activeAuthenticator.authenticate(req.get("x-client-api-key"));
      if (!result.ok) return res.status(result.status).json({ status: "ERROR", message: result.status === 403 ? "Client access is disabled." : "Client API authentication is invalid." });
      req.auth = result.auth;
      return next();
    } catch { return res.status(401).json({ status: "ERROR", message: "Client API authentication is invalid." }); }
  };
}

module.exports = { createMongoAuthenticator, createClientAuthMiddleware };
