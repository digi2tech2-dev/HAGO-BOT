/*
 * Operator-only Prompt 3 index migration. This script is deliberately dry-run
 * by default and is never imported by the API. Run with --apply only during a
 * scheduled MongoDB maintenance window after a backup has been verified.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runPrompt3IndexMigration } = require("../src/services/prompt3IndexMigration");

// Do not import/compile Transaction here. Its schema has normal application
// indexes, and this operator tool must not let Mongoose create any index in
// dry-run mode. The production collection name is Mongoose's default plural
// form for Transaction and is intentionally accessed as a raw collection.
const TRANSACTION_COLLECTION = "transactions";

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  const collection = mongoose.connection.db.collection(TRANSACTION_COLLECTION);
  const result = await runPrompt3IndexMigration({ collection, apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
