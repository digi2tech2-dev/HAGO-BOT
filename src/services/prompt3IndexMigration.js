const TARGET_INDEXES = [
  {
    key: { clientId: 1, idempotencyKey: 1 },
    options: {
      name: "legacy_idempotency_key_unique",
      unique: true,
      partialFilterExpression: { clientId: null, idempotencyKey: { $exists: true } },
    },
  },
  {
    key: { clientId: 1, idempotencyKey: 1 },
    options: {
      name: "client_idempotency_key_unique",
      unique: true,
      partialFilterExpression: { clientId: { $exists: true }, idempotencyKey: { $exists: true } },
    },
  },
];

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isHistoricalGlobalIdempotencyIndex(index) {
  return index.unique === true
    && sameValue(index.key, { idempotencyKey: 1 })
    && !index.partialFilterExpression;
}

function isRedundantNonUniqueSparseIdempotencyIndex(index) {
  // Match the exact index that Mongoose created from the former field-level
  // `sparse: true` declaration. Do not remove another operator-created index
  // merely because it happens to use the same name.
  return index.name === "idempotencyKey_1"
    && index.unique !== true
    && index.sparse === true
    && sameValue(index.key, { idempotencyKey: 1 })
    && !index.partialFilterExpression
    && !index.collation
    && !index.expireAfterSeconds
    && !index.hidden;
}

function targetIndexState(indexes, target) {
  const existing = indexes.find((index) => index.name === target.options.name);
  if (!existing) return "MISSING";
  return existing.unique === target.options.unique
    && sameValue(existing.key, target.key)
    && sameValue(existing.partialFilterExpression || null, target.options.partialFilterExpression || null)
    ? "READY"
    : "CONFLICT";
}

async function findDuplicateGroups(collection) {
  const [legacy, tenant] = await Promise.all([
    collection.aggregate([
      { $match: { clientId: null, idempotencyKey: { $exists: true } } },
      { $group: { _id: "$idempotencyKey", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).toArray(),
    collection.aggregate([
      { $match: { clientId: { $exists: true }, idempotencyKey: { $exists: true } } },
      { $group: { _id: { clientId: "$clientId", idempotencyKey: "$idempotencyKey" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).toArray(),
  ]);
  return { legacy: legacy.length, tenant: tenant.length };
}

async function inspectPrompt3Indexes(collection) {
  const indexes = await collection.indexes();
  const historical = indexes.filter(isHistoricalGlobalIdempotencyIndex);
  const redundant = indexes.filter(isRedundantNonUniqueSparseIdempotencyIndex);
  const targets = TARGET_INDEXES.map((target) => ({ target, name: target.options.name, state: targetIndexState(indexes, target) }));
  return { indexes, historical, redundant, targets };
}

async function runPrompt3IndexMigration({ collection, apply = false }) {
  const inspection = await inspectPrompt3Indexes(collection);
  const conflicts = inspection.targets.filter((target) => target.state === "CONFLICT");
  if (conflicts.length) throw new Error(`Conflicting target index definition: ${conflicts.map((target) => target.name).join(", ")}`);
  if (inspection.historical.length > 1) throw new Error("Multiple historical global idempotency indexes found; manual review is required");
  if (inspection.redundant.length > 1) throw new Error("Multiple redundant sparse idempotency indexes found; manual review is required");

  const duplicates = await findDuplicateGroups(collection);
  if (duplicates.legacy || duplicates.tenant) throw new Error("Duplicate idempotency records detected; migration was not applied");

  const missing = inspection.targets.filter((target) => target.state === "MISSING");
  const plan = {
    dryRun: !apply,
    historicalGlobalIndex: inspection.historical[0]?.name || null,
    redundantSparseIndex: inspection.redundant[0]?.name || null,
    createIndexes: missing.map((target) => target.name),
    duplicates,
  };
  if (!apply) return plan;

  // This is the only destructive operation. It follows duplicate preflight
  // and must run in the documented maintenance window.
  if (inspection.historical[0]) await collection.dropIndex(inspection.historical[0].name);
  if (inspection.redundant[0]) await collection.dropIndex(inspection.redundant[0].name);
  for (const target of missing) await collection.createIndex(target.target.key, target.target.options);
  return { ...plan, dryRun: false, migrated: Boolean(inspection.historical[0] || inspection.redundant[0] || missing.length) };
}

module.exports = { TARGET_INDEXES, inspectPrompt3Indexes, findDuplicateGroups, runPrompt3IndexMigration, isRedundantNonUniqueSparseIdempotencyIndex };
