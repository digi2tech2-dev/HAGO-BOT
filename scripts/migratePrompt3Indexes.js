/*
 * Operator-only Prompt 3 index migration. This script is deliberately dry-run
 * by default and is never imported by the API. Run with --apply only during a
 * scheduled MongoDB maintenance window after a backup has been verified.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Transaction = require("../src/models/Transaction");
const { runPrompt3IndexMigration } = require("../src/services/prompt3IndexMigration");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const result = await runPrompt3IndexMigration({ collection: Transaction.collection, apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
