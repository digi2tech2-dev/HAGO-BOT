/*
 * Operator-only Prompt 3 index migration. This script is deliberately dry-run
 * by default and is never imported by the API. Run with --apply only during a
 * scheduled MongoDB maintenance window after a backup has been verified.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Transaction = require("../src/models/Transaction");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const collection = Transaction.collection;
  const indexes = await collection.indexes();
  const legacy = indexes.find((index) => index.name === "idempotencyKey_1" && index.unique === true);
  const required = [
    { key: { clientId: 1, idempotencyKey: 1 }, name: "legacy_idempotency_key_unique", unique: true, partialFilterExpression: { clientId: null, idempotencyKey: { $exists: true } } },
    { key: { clientId: 1, idempotencyKey: 1 }, name: "client_idempotency_key_unique", unique: true, partialFilterExpression: { clientId: { $exists: true }, idempotencyKey: { $exists: true } } },
  ];
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ dryRun: true, legacyGlobalIndexPresent: Boolean(legacy), requiredIndexes: required.map((item) => item.name) }));
    return;
  }
  if (legacy) await collection.dropIndex(legacy.name);
  for (const index of required) await collection.createIndex(index.key, { name: index.name, unique: index.unique, partialFilterExpression: index.partialFilterExpression });
  console.log(JSON.stringify({ migrated: true, indexes: required.map((item) => item.name) }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
