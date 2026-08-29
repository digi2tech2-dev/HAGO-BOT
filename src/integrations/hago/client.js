const axios = require("axios");

function createHagoHttpClient(http = axios) {
  // The recharge-agent bundle configures a bounded 15-second timeout. An
  // explicit deployment value remains supported after validation at startup.
  const timeout = Number(process.env.HAGO_REQUEST_TIMEOUT_MS || 15000);
  return {
    get(url, options = {}) { return http.get(url, { timeout, ...options }); },
    post(url, data, options = {}) { return http.post(url, data, { timeout, ...options }); },
  };
}

function normalizeHttpError(error) {
  if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
    return { kind: "TIMEOUT", message: "Hago request timed out" };
  }
  if (error?.response) return { kind: "HTTP_ERROR", message: "Hago returned an HTTP error", status: error.response.status };
  return { kind: "NETWORK_ERROR", message: "Unable to reach Hago" };
}

module.exports = { createHagoHttpClient, normalizeHttpError };
