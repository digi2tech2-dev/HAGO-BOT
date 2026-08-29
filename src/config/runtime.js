const crypto = require("crypto");

function requireNonEmpty(env, name) {
  if (typeof env[name] !== "string" || env[name].trim() === "") throw new Error(`${name} is required`);
  return env[name].trim();
}

function parsePositiveInteger(value, name, fallback) {
  const raw = value ?? fallback;
  if (!/^[1-9]\d*$/.test(String(raw))) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parsePositiveAmount(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function getControlledMutationConfig(env = process.env) {
  const mutationsEnabled = env.HAGO_MUTATIONS_ENABLED === "true";
  const controlledMutationMode = env.HAGO_CONTROLLED_MUTATION_MODE === "true";
  // Controlled mode is deliberately invalid without an explicit ceiling, even
  // when the broader mutation flag is off. This prevents an unsafe later flag
  // change from activating an unbounded sender.
  const maxAmount = controlledMutationMode
    ? parsePositiveAmount(env.HAGO_CONTROLLED_MUTATION_MAX_AMOUNT, "HAGO_CONTROLLED_MUTATION_MAX_AMOUNT")
    : null;
  return { mutationsEnabled, controlledMutationMode, maxAmount };
}

function isNobilityEnabled(env = process.env) {
  return env.HAGO_NOBILITY_ENABLED === "true";
}

function parseSessionEncryptionKey(value) {
  const encoded = requireNonEmpty({ HAGO_SESSION_ENCRYPTION_KEY: value }, "HAGO_SESSION_ENCRYPTION_KEY");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("HAGO_SESSION_ENCRYPTION_KEY must be base64-encoded 32-byte key material");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("HAGO_SESSION_ENCRYPTION_KEY must be base64-encoded 32-byte key material");
  return key;
}

function validateRuntimeConfig(env = process.env) {
  const mongoUri = requireNonEmpty(env, "MONGO_URI");
  const internalApiKey = requireNonEmpty(env, "INTERNAL_API_KEY");
  const sessionEncryptionKey = parseSessionEncryptionKey(env.HAGO_SESSION_ENCRYPTION_KEY);
  const controlledMutation = getControlledMutationConfig(env);
  return {
    mongoUri,
    internalApiKey,
    sessionEncryptionKey,
    port: parsePositiveInteger(env.PORT, "PORT", 3000),
    hagoRequestTimeoutMs: parsePositiveInteger(env.HAGO_REQUEST_TIMEOUT_MS, "HAGO_REQUEST_TIMEOUT_MS", 15000),
    ...controlledMutation,
    nobilityEnabled: isNobilityEnabled(env),
  };
}

function getLocalReadiness({ env = process.env, mongoose }) {
  let configValid = false;
  try { validateRuntimeConfig(env); configValid = true; } catch { /* readiness intentionally does not expose configuration details */ }
  const mongoReady = mongoose?.connection?.readyState === 1;
  return { ready: configValid && mongoReady, configValid, mongoReady };
}

module.exports = { parsePositiveInteger, parsePositiveAmount, parseSessionEncryptionKey, getControlledMutationConfig, isNobilityEnabled, validateRuntimeConfig, getLocalReadiness };
