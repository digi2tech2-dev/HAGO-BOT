const express = require("express");
const authRoutes = require("./routes/authRoutes");
const botRoutes = require("./routes/botRoutes");
const internalAuth = require("./middleware/internalAuth");
const { requestId } = require("./middleware/requestId");
const { getLocalReadiness } = require("./config/runtime");
const { isSwaggerEnabled } = require("./config/swagger");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const fs = require("node:fs");
const path = require("node:path");

function loadOpenApiContract() {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../docs/openapi.json"), "utf8"));
}

function createApp({ env = process.env } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (req, res) => res.json({ status: "OK" }));
  app.get("/ready", (req, res) => {
    const readiness = getLocalReadiness({ env, mongoose });
    return res.status(readiness.ready ? 200 : 503).json({ status: readiness.ready ? "READY" : "NOT_READY" });
  });
  if (isSwaggerEnabled(env)) {
    const openapi = loadOpenApiContract();
    app.get("/openapi.json", (req, res) => res.type("application/json").send(openapi));
    app.get("/docs", swaggerUi.setup(openapi, { customSiteTitle: "Hago Adapter API" }));
    app.use("/docs", swaggerUi.serve);
  }
  app.use("/api/auth", internalAuth, authRoutes);
  app.use("/api/bot", internalAuth, botRoutes);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("Unhandled API error", { requestId: req.requestId, error: error?.name || "Error" });
    return res.status(500).json({ status: "ERROR", message: "Unexpected server error." });
  });
  return app;
}

module.exports = createApp;
