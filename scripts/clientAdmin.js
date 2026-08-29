#!/usr/bin/env node
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const Client = require("../src/models/Client");
const ClientApiKey = require("../src/models/ClientApiKey");
const UpstreamAccountLock = require("../src/models/UpstreamAccountLock");
const { parseClientApiKeyPepper, requireNonEmpty } = require("../src/config/runtime");
const { generateClientApiKey } = require("../src/services/clientKeyService");

dotenv.config();

function option(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required`);
  return value;
}

function requireConfirmation(args) {
  if (!args.includes("--confirm")) throw new Error("This operation requires --confirm");
}

function safeClient(client) {
  return { publicId: client.publicId, name: client.name, status: client.status, disabledAt: client.disabledAt, createdAt: client.createdAt, updatedAt: client.updatedAt };
}

function safeKey(key) {
  return { keyId: key.keyId, status: key.status, label: key.label, expiresAt: key.expiresAt, revokedAt: key.revokedAt, lastUsedAt: key.lastUsedAt, createdAt: key.createdAt };
}
function safeUnknownHold(lock) {
  return { transactionId: String(lock.ownerTransactionId), clientId: String(lock.clientId), connectionId: lock.connectionId, heldAt: lock.heldAt, unknownAt: lock.unknownAt };
}

function parseExpiration(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("--expires-at must be a future ISO date");
  return date;
}

async function requireClient(publicId) {
  const client = await Client.findOne({ publicId });
  if (!client) throw new Error("Client not found");
  return client;
}

async function createKey(args, { rotation = false } = {}) {
  const publicId = option(args, "--client", { required: true });
  const label = option(args, "--label") || (rotation ? "rotation" : "production");
  const client = await requireClient(publicId);
  const generated = generateClientApiKey({ pepper: parseClientApiKeyPepper(process.env.CLIENT_API_KEY_PEPPER) });
  const key = await ClientApiKey.create({ clientId: client._id, keyId: generated.keyId, secretDigest: generated.secretDigest, label, expiresAt: parseExpiration(option(args, "--expires-at")) });
  // This is the only CLI output path that includes a generated plaintext key.
  console.log(JSON.stringify({ client: client.publicId, ...safeKey(key), apiKey: generated.fullKey }));
}

async function run(args) {
  const command = args[0];
  if (command === "create-client") {
    const client = await Client.create({ name: option(args, "--name", { required: true }) });
    console.log(JSON.stringify(safeClient(client)));
    return;
  }
  if (command === "list-clients") {
    const clients = await Client.find({}).sort({ createdAt: 1 });
    console.log(JSON.stringify(clients.map(safeClient)));
    return;
  }
  if (command === "disable-client" || command === "enable-client") {
    requireConfirmation(args);
    const client = await requireClient(option(args, "--client", { required: true }));
    const disabled = command === "disable-client";
    client.status = disabled ? "DISABLED" : "ACTIVE";
    client.disabledAt = disabled ? new Date() : null;
    await client.save();
    console.log(JSON.stringify(safeClient(client)));
    return;
  }
  if (command === "create-key") return createKey(args);
  if (command === "rotate-key") return createKey(args, { rotation: true });
  if (command === "list-keys") {
    const client = await requireClient(option(args, "--client", { required: true }));
    const keys = await ClientApiKey.find({ clientId: client._id }).sort({ createdAt: 1 });
    console.log(JSON.stringify({ client: client.publicId, keys: keys.map(safeKey) }));
    return;
  }
  if (command === "disable-key" || command === "revoke-key") {
    requireConfirmation(args);
    const keyId = option(args, "--key", { required: true });
    const key = await ClientApiKey.findOne({ keyId });
    if (!key) throw new Error("Client API key not found");
    key.status = command === "revoke-key" ? "REVOKED" : "DISABLED";
    key.revokedAt = command === "revoke-key" ? new Date() : key.revokedAt;
    await key.save();
    console.log(JSON.stringify(safeKey(key)));
    return;
  }
  if (command === "list-unknown-holds") {
    const holds = await UpstreamAccountLock.find({ state: "UNKNOWN_HOLD" }).sort({ unknownAt: 1 });
    console.log(JSON.stringify(holds.map(safeUnknownHold)));
    return;
  }
  if (command === "release-unknown-hold") {
    requireConfirmation(args);
    const transactionId = option(args, "--transaction", { required: true });
    if (!/^[a-f\d]{24}$/i.test(transactionId)) throw new Error("--transaction must be a transaction id");
    const result = await UpstreamAccountLock.deleteOne({ ownerTransactionId: transactionId, state: "UNKNOWN_HOLD" });
    if (result.deletedCount !== 1) throw new Error("Unknown hold not found for transaction");
    console.log(JSON.stringify({ released: true, transactionId }));
    return;
  }
  throw new Error("Unknown command. Use create-client, list-clients, disable-client, enable-client, create-key, rotate-key, list-keys, disable-key, revoke-key, list-unknown-holds, or release-unknown-hold.");
}

async function main() {
  const mongoUri = requireNonEmpty(process.env, "MONGO_URI");
  // Validate without printing either value before creating a database connection.
  parseClientApiKeyPepper(process.env.CLIENT_API_KEY_PEPPER);
  await mongoose.connect(mongoUri);
  try { await run(process.argv.slice(2)); }
  finally { await mongoose.disconnect(); }
}

if (require.main === module) {
  main().catch(() => { console.error("Client administration command failed"); process.exitCode = 1; });
}

module.exports = { option, requireConfirmation, parseExpiration, safeClient, safeKey, safeUnknownHold, run };
