const crypto = require("crypto");
const LoginChallenge = require("../models/LoginChallenge");
const Transaction = require("../models/Transaction");
const { ClientDataCipher } = require("../security/clientDataSecrets");
const { buildChallengeRecord, normalizePhone, verifyChallengeDeviceBinding } = require("../services/loginChallengeService");
const { upsertConnection } = require("../services/connectionService");
const { consumeRateLimit } = require("../services/mongoRateLimit");
const { acquireUpstreamAccountLock, releaseUpstreamAccountLock, holdUnknownUpstreamAccount } = require("../services/upstreamAccountLock");
const hagoService = require("../services/hagoService");
const { buildDiamondMutationPreview, buildCrystalMutationPreview, buildNobilityMutationPreview } = require("../integrations/hago/mutationPreview");
const { validNobleType } = require("../integrations/hago/nobility");

function bodyError(res, message, code = "INVALID_REQUEST") { return res.status(400).json({ status: "ERROR", code, message }); }
function requireTarget(body) { return typeof body?.targetId === "string" && body.targetId.trim().length > 0 ? body.targetId.trim() : null; }
function normalizedIdempotency(value) { const key = typeof value === "string" ? value.trim() : ""; return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null; }
function nobilityTypeName(type) { return ({ 1: "Knight", 2: "Viscount", 3: "Earl", 4: "Duke" })[validNobleType(type)] || null; }
function readonlyFailure(res, result, fallback) {
  const status = result?.kind === "TIMEOUT" ? 504 : result?.kind === "SESSION_UNAVAILABLE" || result?.kind === "NO_SESSION" ? 409 : 502;
  return res.status(status).json({ status: "ERROR", code: result?.kind || "UPSTREAM_ERROR", message: result?.message || fallback });
}
function publicConnection(connection) { return { connectionId: connection.connectionId, status: connection.status, createdAt: connection.createdAt, updatedAt: connection.updatedAt }; }
function publicTransaction(transaction) {
  return { id: String(transaction._id), serviceType: transaction.serviceType, amount: transaction.serviceType === "NOBILITY" ? undefined : transaction.amount, nobilityType: transaction.nobilityType, status: transaction.status, upstreamStatus: transaction.upstreamStatus, upstreamCode: transaction.upstreamCode ?? null, upstreamTimeout: Boolean(transaction.upstreamTimeout), referenceId: null, createdAt: transaction.createdAt };
}
function fingerprint(intent) { return crypto.createHash("sha256").update(JSON.stringify(intent), "utf8").digest("hex"); }
function sameIntent(existing, hash) { return existing.intentFingerprint === hash; }
function outcomeFromTransfer(outcome) {
  if (outcome?.outcome === "SUCCESS") return { state: "SUCCESS", http: 200 };
  if (["SESSION_PROBLEM", "TRANSFER_LIMIT", "REJECTED"].includes(outcome?.outcome)) return { state: "FAILED", http: 409 };
  return { state: "UNKNOWN", http: outcome?.timeout ? 504 : 502 };
}
function outcomeFromNobility(outcome) {
  if (outcome?.outcome === "SUCCESS" || outcome?.is_ok === true) return { state: "SUCCESS", http: 200 };
  if ([30201, 30500].includes(Number(outcome?.upstreamCode))) return { state: "FAILED", http: 409 };
  return { state: "UNKNOWN", http: outcome?.timeout ? 504 : 502 };
}

function getDataKey() { return require("../config/runtime").validateRuntimeConfig(process.env).clientDataEncryptionKey; }

exports.sendOtp = async (req, res, next) => {
  let challenge;
  try {
    const { phone, countryCode, deviceId, country, language } = req.body || {};
    if (!normalizePhone(phone) || !/^\d{1,4}$/.test(String(countryCode || "")) || typeof deviceId !== "string" || deviceId.trim().length < 8 || deviceId.trim().length > 256) return bodyError(res, "phone, countryCode, and a stable deviceId are required.");
    const dataKey = getDataKey();
    const limit = await consumeRateLimit({ scope: "v2-otp-send", subject: `${req.auth.clientId}:${phone}`, dataKey, limit: 5, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return res.status(429).json({ status: "ERROR", code: "OTP_RATE_LIMITED", message: "Too many OTP requests." });
    const record = buildChallengeRecord({ clientId: req.auth.clientId, phone, countryCode, deviceId, country, language, dataKey, status: "REQUESTING" });
    challenge = await LoginChallenge.create(record);
    const upstream = await hagoService.sendOtpApi(phone, String(countryCode));
    if (!upstream?.ok) {
      await LoginChallenge.updateOne({ _id: challenge._id, clientId: req.auth.clientId, status: "REQUESTING" }, { $set: { status: "FAILED" } });
      return readonlyFailure(res, upstream, "Unable to send OTP.");
    }
    const activated = await LoginChallenge.findOneAndUpdate({ _id: challenge._id, clientId: req.auth.clientId, status: "REQUESTING", expiresAt: { $gt: new Date() } }, { $set: { status: "OTP_SENT" } }, { new: true });
    if (!activated) return res.status(409).json({ status: "ERROR", code: "CHALLENGE_UNAVAILABLE", message: "Login challenge is unavailable." });
    return res.status(202).json({ status: "OTP_SENT", challengeId: activated.challengeId, expiresAt: activated.expiresAt });
  } catch (error) {
    if (challenge?._id) {
      try { await LoginChallenge.updateOne({ _id: challenge._id, clientId: req.auth.clientId, status: "REQUESTING" }, { $set: { status: "FAILED" } }); } catch { /* original safe error path wins */ }
    }
    return next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const { otp, deviceId } = req.body || {};
    const { challengeId } = req.params;
    if (!/^chl_[A-Za-z0-9_-]{22}$/.test(String(challengeId)) || typeof otp !== "string" || otp.trim().length < 1 || otp.length > 16 || typeof deviceId !== "string") return bodyError(res, "challengeId, OTP, and deviceId are required.");
    const dataKey = getDataKey();
    const limit = await consumeRateLimit({ scope: "v2-otp-verify", subject: `${req.auth.clientId}:${challengeId}`, dataKey, limit: 8, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return res.status(429).json({ status: "ERROR", code: "OTP_RATE_LIMITED", message: "Too many OTP verification attempts." });
    const candidate = await LoginChallenge.findOne({ clientId: req.auth.clientId, challengeId, status: "OTP_SENT", expiresAt: { $gt: new Date() } }).select("+phoneEncrypted +deviceBindingDigest");
    if (!candidate || !verifyChallengeDeviceBinding(candidate, deviceId, dataKey)) return res.status(409).json({ status: "ERROR", code: "CHALLENGE_UNAVAILABLE", message: "Login challenge is unavailable." });
    const challenge = await LoginChallenge.findOneAndUpdate({ _id: candidate._id, clientId: req.auth.clientId, status: "OTP_SENT", expiresAt: { $gt: new Date() }, verifyAttempts: { $lt: 10 } }, { $set: { status: "VERIFYING" }, $inc: { verifyAttempts: 1 } }, { new: true }).select("+phoneEncrypted +deviceBindingDigest");
    if (!challenge) return res.status(409).json({ status: "ERROR", code: "CHALLENGE_ALREADY_CLAIMED", message: "Login challenge is unavailable." });
    const phone = new ClientDataCipher(dataKey).decrypt(challenge.phoneEncrypted);
    const upstream = await hagoService.verifySmsAuthApi(phone, otp, challenge.countryCode, deviceId);
    if (!upstream?.ok || !upstream?.session?.cookies?.hagouid || !upstream?.session?.cookies?.uaasCookie) {
      await LoginChallenge.updateOne({ _id: challenge._id, clientId: req.auth.clientId, status: "VERIFYING" }, { $set: { status: "FAILED" } });
      return readonlyFailure(res, upstream, "OTP verification failed.");
    }
    const connection = await upsertConnection({ clientId: req.auth.clientId, phone, countryCode: challenge.countryCode, deviceId, session: upstream.session, dataKey, country: challenge.country, language: challenge.language });
    await LoginChallenge.updateOne({ _id: challenge._id, clientId: req.auth.clientId, status: "VERIFYING" }, { $set: { status: "CONSUMED", consumedAt: new Date() } });
    return res.json({ status: "SUCCESS", connection: publicConnection(connection) });
  } catch (error) { return next(error); }
};

exports.validateSession = async (req, res, next) => {
  try {
    const result = await hagoService.verifySession(req.connection);
    await req.connection.constructor.updateOne({ _id: req.connection._id, clientId: req.auth.clientId }, { $set: { status: result.status === "VALID" ? "ACTIVE" : result.status, lastValidatedAt: new Date() } });
    return res.json({ status: "SUCCESS", session: { status: result.status } });
  } catch (error) { return next(error); }
};

exports.verifyId = async (req, res, next) => { try { const targetId = requireTarget(req.body); if (!targetId) return bodyError(res, "targetId is required."); const result = await hagoService.verifyHagoIdApi(targetId, req.connection); return result.ok ? res.json({ status: "SUCCESS", userInfo: result.user }) : readonlyFailure(res, result, "Unable to resolve Hago ID."); } catch (error) { return next(error); } };
exports.agentProfile = async (req, res, next) => { try { const result = await hagoService.getAgentInfoByUid(req.connection); return result.ok ? res.json({ status: "SUCCESS", agentProfile: result.user }) : readonlyFailure(res, result, "Unable to retrieve profile."); } catch (error) { return next(error); } };
exports.wallet = async (req, res, next) => { try { const result = await hagoService.getAgentWalletApi(req.connection); return result.ok ? res.json({ status: "SUCCESS", wallet: result.wallet }) : readonlyFailure(res, result, "Unable to retrieve wallet."); } catch (error) { return next(error); } };
exports.history = async (req, res, next) => { try { const result = await hagoService.getAgentHistoryApi(req.connection, req.body || {}); return result.ok ? res.json({ status: "SUCCESS", history: result.history }) : readonlyFailure(res, result, "Unable to retrieve history."); } catch (error) { return next(error); } };
exports.transferReadiness = async (req, res, next) => { try { const result = await hagoService.getTransferReadiness(req.connection); return result.ok ? res.json({ status: "SUCCESS", readiness: result.readiness }) : readonlyFailure(res, result, "Unable to retrieve transfer readiness."); } catch (error) { return next(error); } };
exports.nobilityReadiness = async (req, res, next) => { try { const targetId = requireTarget(req.body); if (!targetId) return bodyError(res, "targetId is required."); const result = await hagoService.getNobilityReadiness(req.connection, targetId); return result.ok ? res.json({ status: "SUCCESS", nobility: result.nobility }) : readonlyFailure(res, result, "Unable to retrieve Nobility readiness."); } catch (error) { return next(error); } };
exports.nobilityPurchaseReadiness = async (req, res, next) => { try { const targetId = requireTarget(req.body); const type = req.body?.nobilityType; if (!targetId || typeof type !== "number" || !validNobleType(type)) return bodyError(res, "targetId and a numeric nobilityType are required."); const result = await hagoService.getNobilityPurchaseReadiness(req.connection, { targetId, nobilityType: type }); return result.ok ? res.json({ status: "SUCCESS", nobilityPurchaseReadiness: result.readiness }) : readonlyFailure(res, result, "Unable to retrieve Nobility purchase readiness."); } catch (error) { return next(error); } };

exports.previewDiamond = (req, res) => { const amount = Number(req.body?.amount); return Number.isFinite(amount) && amount > 0 ? res.json(buildDiamondMutationPreview({ amount })) : bodyError(res, "A positive amount is required."); };
exports.previewCrystal = (req, res) => { const amount = Number(req.body?.amount); return Number.isFinite(amount) && amount > 0 ? res.json(buildCrystalMutationPreview({ amount })) : bodyError(res, "A positive amount is required."); };
exports.previewNobility = (req, res) => { const type = req.body?.nobilityType; return typeof type === "number" && validNobleType(type) ? res.json(buildNobilityMutationPreview({ nobilityType: type })) : bodyError(res, "A numeric nobilityType is required."); };

async function persistV2Intent({ req, serviceType, amount, nobilityType }) {
  const targetId = requireTarget(req.body); const idempotencyKey = normalizedIdempotency(req.get("Idempotency-Key"));
  if (!targetId || !idempotencyKey || (serviceType !== "NOBILITY" && (!Number.isFinite(Number(amount)) || Number(amount) <= 0))) return { error: { message: "targetId, amount where applicable, and a valid Idempotency-Key are required." } };
  const persistedNobilityType = serviceType === "NOBILITY" ? nobilityTypeName(nobilityType) : null;
  if (serviceType === "NOBILITY" && !persistedNobilityType) return { error: { message: "A numeric nobilityType is required." } };
  const intent = { connectionId: req.connection.connectionId, targetId, serviceType, amount: serviceType === "NOBILITY" ? 0 : Number(amount), nobilityType: serviceType === "NOBILITY" ? nobilityType : null };
  const intentFingerprint = fingerprint(intent);
  const existing = await Transaction.findOne({ clientId: req.auth.clientId, idempotencyKey });
  if (existing) return { existing, match: sameIntent(existing, intentFingerprint) };
  try { return { intent, intentFingerprint, transaction: await Transaction.create({ targetId, serviceType, amount: intent.amount, nobilityType: persistedNobilityType, clientId: req.auth.clientId, connectionId: req.connection.connectionId, idempotencyKey, intentFingerprint, status: "PENDING", upstreamStatus: "NOT_SENT", referenceId: null }) }; }
  catch (error) { if (error?.code !== 11000) throw error; const concurrent = await Transaction.findOne({ clientId: req.auth.clientId, idempotencyKey }); return { existing: concurrent, match: concurrent && sameIntent(concurrent, intentFingerprint) }; }
}

function existingResponse(res, existing, match) { if (!match) return res.status(409).json({ status: "ERROR", code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key conflicts with an existing intent." }); const status = existing.upstreamStatus === "SUCCESS" ? 200 : existing.upstreamStatus === "SEND_PENDING" ? 202 : existing.upstreamStatus === "FAILED" ? 409 : existing.upstreamStatus === "UNKNOWN" ? 502 : 503; return res.status(status).json({ status: existing.upstreamStatus === "SUCCESS" ? "SUCCESS" : "ERROR", transaction: publicTransaction(existing) }); }

async function financialMutation(req, res, serviceType) {
  const nobility = serviceType === "NOBILITY";
  const type = nobility ? req.body?.nobilityType : null;
  if (nobility && (typeof type !== "number" || !validNobleType(type))) return bodyError(res, "A numeric nobilityType is required.");
  const persisted = await persistV2Intent({ req, serviceType, amount: req.body?.amount, nobilityType: type });
  if (persisted.error) return bodyError(res, persisted.error.message);
  if (persisted.existing) return existingResponse(res, persisted.existing, persisted.match);
  const transaction = persisted.transaction;
  let prepared;
  if (nobility) {
    if (process.env.HAGO_NOBILITY_ENABLED !== "true") { transaction.status = "UNKNOWN"; transaction.upstreamStatus = "NOT_SENT"; await transaction.save(); return res.status(503).json({ status: "ERROR", code: "DISABLED", transaction: publicTransaction(transaction) }); }
    prepared = await hagoService.prepareNobilityPurchase(req.connection, { targetId: persisted.intent.targetId, nobilityType: type });
  } else {
    const gate = await hagoService.prepareRechargeMutation({ controlledHeader: req.get("X-Controlled-Mutation") });
    if (!gate.ok || persisted.intent.amount > gate.maxAmount) { transaction.status = "UNKNOWN"; transaction.upstreamStatus = "NOT_SENT"; await transaction.save(); return res.status(503).json({ status: "ERROR", code: gate.kind || "BLOCKED", transaction: publicTransaction(transaction) }); }
    prepared = await hagoService.prepareControlledRecharge(req.connection, { targetId: persisted.intent.targetId, amount: persisted.intent.amount, serviceType });
  }
  if (!prepared?.ok) { transaction.status = "UNKNOWN"; transaction.upstreamStatus = "NOT_SENT"; transaction.errorMessage = prepared?.kind || "PRECONDITION_FAILED"; await transaction.save(); return res.status(400).json({ status: "ERROR", code: transaction.errorMessage, transaction: publicTransaction(transaction) }); }
  const lock = await acquireUpstreamAccountLock({ upstreamAccountDigest: req.connection.upstreamAccountDigest, ownerTransactionId: transaction._id, clientId: req.auth.clientId, connectionId: req.connection.connectionId });
  if (!lock.ok) { transaction.status = "UNKNOWN"; transaction.upstreamStatus = "NOT_SENT"; transaction.errorMessage = lock.kind; await transaction.save(); return res.status(409).json({ status: "ERROR", code: lock.kind, transaction: publicTransaction(transaction) }); }
  transaction.upstreamStatus = "SEND_PENDING"; transaction.sendAttempts = 1; transaction.sendAttemptedAt = new Date(); await transaction.save();
  const outcome = nobility ? await hagoService.sendNobilityPurchase(req.connection, prepared.request, {}) : await hagoService.sendControlledRecharge(req.connection, prepared.request, { controlledHeader: req.get("X-Controlled-Mutation") });
  const normalized = nobility ? outcomeFromNobility(outcome) : outcomeFromTransfer(outcome);
  transaction.status = normalized.state; transaction.upstreamStatus = normalized.state; transaction.upstreamTimeout = Boolean(outcome?.timeout); transaction.upstreamCode = Number.isFinite(Number(outcome?.upstreamCode)) ? Number(outcome.upstreamCode) : null; transaction.referenceId = null;
  if (normalized.state === "UNKNOWN") await holdUnknownUpstreamAccount({ upstreamAccountDigest: req.connection.upstreamAccountDigest, ownerTransactionId: transaction._id, clientId: req.auth.clientId, connectionId: req.connection.connectionId }); else await releaseUpstreamAccountLock({ upstreamAccountDigest: req.connection.upstreamAccountDigest, ownerTransactionId: transaction._id });
  await transaction.save();
  return res.status(normalized.http).json({ status: normalized.state === "SUCCESS" ? "SUCCESS" : "ERROR", ...(normalized.state === "UNKNOWN" ? { code: "MUTATION_OUTCOME_UNKNOWN", message: "Outcome is uncertain. Do not retry." } : {}), transaction: publicTransaction(transaction) });
}

exports.rechargeDiamond = (req, res, next) => financialMutation(req, res, "DIAMOND").catch(next);
exports.rechargeCrystal = (req, res, next) => financialMutation(req, res, "CRYSTAL").catch(next);
exports.buyNobility = (req, res, next) => financialMutation(req, res, "NOBILITY").catch(next);
exports.transactions = async (req, res, next) => { try { const transactions = await Transaction.find({ clientId: req.auth.clientId, connectionId: req.connection.connectionId }).sort({ createdAt: -1 }).limit(100); return res.json({ status: "SUCCESS", transactions: transactions.map(publicTransaction) }); } catch (error) { return next(error); } };
exports.reconcile = async (req, res, next) => { try { const id = req.body?.transactionId; if (!/^[a-f\d]{24}$/i.test(String(id))) return bodyError(res, "transactionId is required."); const transaction = await Transaction.findOne({ _id: id, clientId: req.auth.clientId, connectionId: req.connection.connectionId }); if (!transaction) return res.status(404).json({ status: "ERROR", code: "TRANSACTION_NOT_FOUND", message: "Transaction was not found." }); const result = await hagoService.reconcileMutationReadOnly(req.connection, req.body?.history || {}); return result.ok ? res.json({ status: "SUCCESS", transaction: publicTransaction(transaction), reconciliation: { status: "MANUAL_REVIEW_REQUIRED", history: result.history } }) : readonlyFailure(res, result, "Unable to reconcile transaction."); } catch (error) { return next(error); } };

module.exports._test = { outcomeFromTransfer, outcomeFromNobility, normalizedIdempotency, fingerprint, publicTransaction };
