const UpstreamAccountLock = require("../models/UpstreamAccountLock");

const DEFAULT_LEASE_MS = 45 * 1000;

async function acquireUpstreamAccountLock({ upstreamAccountDigest, ownerTransactionId, clientId, connectionId, now = new Date(), leaseMs = DEFAULT_LEASE_MS }) {
  const current = new Date(now);
  const existing = await UpstreamAccountLock.findOne({ upstreamAccountDigest });
  if (existing?.state === "UNKNOWN_HOLD") return { ok: false, kind: "UNKNOWN_HOLD" };
  if (existing?.state === "HELD" && existing.leaseExpiresAt && existing.leaseExpiresAt > current && String(existing.ownerTransactionId) !== String(ownerTransactionId)) return { ok: false, kind: "LOCKED" };
  let lock;
  try {
    lock = await UpstreamAccountLock.findOneAndUpdate(
      // The predicate itself, rather than the preceding read, is the
      // concurrency boundary. A live HELD lock can only be replaced by its
      // owner or after its lease expires. UNKNOWN_HOLD intentionally has no
      // lease path and is never replaceable by this acquisition operation.
      { upstreamAccountDigest, $or: [
        { state: "HELD", ownerTransactionId },
        { state: "HELD", leaseExpiresAt: { $lte: current } },
        { state: { $exists: false } },
      ] },
      { $set: { state: "HELD", ownerTransactionId, clientId, connectionId, leaseExpiresAt: new Date(current.getTime() + leaseMs), heldAt: current, unknownAt: null } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    lock = await UpstreamAccountLock.findOne({ upstreamAccountDigest });
  }
  if (!lock) return { ok: false, kind: "LOCKED" };
  return String(lock.ownerTransactionId) === String(ownerTransactionId) ? { ok: true, lock } : { ok: false, kind: lock.state === "UNKNOWN_HOLD" ? "UNKNOWN_HOLD" : "LOCKED" };
}

async function releaseUpstreamAccountLock({ upstreamAccountDigest, ownerTransactionId }) {
  await UpstreamAccountLock.deleteOne({ upstreamAccountDigest, ownerTransactionId, state: "HELD" });
}

async function holdUnknownUpstreamAccount({ upstreamAccountDigest, ownerTransactionId, clientId, connectionId }) {
  await UpstreamAccountLock.findOneAndUpdate(
    { upstreamAccountDigest, ownerTransactionId },
    { $set: { state: "UNKNOWN_HOLD", clientId, connectionId, leaseExpiresAt: null, unknownAt: new Date() } },
    { new: true }
  );
}

module.exports = { DEFAULT_LEASE_MS, acquireUpstreamAccountLock, releaseUpstreamAccountLock, holdUnknownUpstreamAccount };
