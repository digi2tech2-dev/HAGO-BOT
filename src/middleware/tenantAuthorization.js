const { getOwnedConnection } = require("../services/connectionService");

function requireOwnedConnection({ includeSession = true } = {}) {
  return async (req, res, next) => {
    try {
      const connection = await getOwnedConnection({ clientId: req.auth.clientId, connectionId: req.params.connectionId, includeSession });
      if (!connection) return res.status(404).json({ status: "ERROR", code: "CONNECTION_NOT_FOUND", message: "Connection was not found." });
      req.connection = connection;
      return next();
    } catch (error) { return next(error); }
  };
}

module.exports = { requireOwnedConnection };
