// backend/routes/adminSim.js
import { Router } from "express";

import requireAdmin from "../middleware/admin.js";
import rateLimit from "../middleware/rateLimit.js";

import { db } from "../lib/firestore.js";
import { auditLog } from "../lib/audit.js";

import { ensureActiveContestNow } from "../lib/time.js";
import { nowMs, absDiff, normalizeNumber, onlyDigits } from "../lib/utils.js";
import { HISTORY_LIMIT } from "../lib/config.js";

const r = Router();

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_UNIQUE_DAILY4 = 10_000;
const MAX_BATCH_DELETE = 400;
const MAX_BATCH_WRITE = 450;

const SIM_MIN_TS_BACK_MS = 72 * 60 * 60 * 1000; // 72 hours

// Safety caps for "simulate checkout"
const MAX_SIM_UNPAID = 10_000;
const MAX_SIM_PAID_MARK = 10_000;

const ENTRY_STATUSES_BLOCKED = new Set(["REFUNDED", "DISPUTED", "EXPIRED"]);

/* =========================================================
   HELPERS (self-contained)
========================================================= */

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

function clampFloat(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function randInt(min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function parse4DigitNumber(raw) {
  const d = onlyDigits(raw);
  if (!d) return null;
  const n = Number(d);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 9999) return null;
  return n;
}

function slotToLabel(slot) {
  switch (Number(slot)) {
    case 1:
      return "Morning";
    case 2:
      return "Day";
    case 3:
      return "Evening";
    case 4:
      return "Night";
    default:
      return "—";
  }
}

function safeUpper(s) {
  return String(s || "").trim().toUpperCase();
}

function isPaidEntryEligible(e) {
  if (!e) return false;
  if (!e.paid) return false;

  const s = safeUpper(e.status);
  if (ENTRY_STATUSES_BLOCKED.has(s)) return false;

  // Prefer countedInContest if present
  if (typeof e.countedInContest === "boolean") return e.countedInContest === true;

  // Back-compat: "QUEUED" should not count
  if (s === "QUEUED") return false;

  return true;
}

function isUnifiedEligible(e) {
  if (!e) return false;
  if (isPaidEntryEligible(e)) return true;

  const src = safeUpper(e.source);
  if (src === "AMOE") return true;
  if (e.isAmoe === true) return true;

  if (typeof e.countedInContest === "boolean") return e.countedInContest === true;

  return false;
}

function makeUniqueDaily4Guesses(count) {
  const n = clampInt(count, 1, MAX_UNIQUE_DAILY4);
  if (n == null) throw new Error(`count must be 1..${MAX_UNIQUE_DAILY4} (unique 4-digit numbers).`);

  const all = Array.from({ length: MAX_UNIQUE_DAILY4 }, (_, i) => normalizeNumber(i, 4));
  shuffleInPlace(all);
  return all.slice(0, n);
}

/**
 * Firestore helper: delete an entire collection in safe batches.
 * Returns number of deleted docs.
 */
async function deleteCollectionInBatches(colRef, batchSize = MAX_BATCH_DELETE) {
  let deleted = 0;

  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    deleted += snap.size;
    if (snap.size < batchSize) break;
  }

  return deleted;
}

/**
 * Safer trimming that avoids query/index pitfalls.
 * - If simOnly=true: only trims sim winners and never touches real winners.
 * - If simOnly=false: trims overall winners collection.
 */
async function trimWinnersHistory({ simOnly = false } = {}) {
  const winnersRef = db().collection("winners");

  // Pull a bounded window; enough to cover your trim use-case safely.
  const snap = await winnersRef.orderBy("resolvedAt", "desc").limit(2000).get();
  const docs = snap.docs;

  const keep = [];
  const deletable = [];

  for (const d of docs) {
    const data = d.data() || {};
    const isSim = data.sim === true;

    if (simOnly) {
      if (!isSim) continue; // ignore real winners entirely
      if (keep.length < HISTORY_LIMIT) keep.push(d);
      else deletable.push(d);
    } else {
      if (keep.length < HISTORY_LIMIT) keep.push(d);
      else deletable.push(d);
    }
  }

  if (!deletable.length) return { trimmed: 0 };

  let trimmed = 0;
  for (let i = 0; i < deletable.length; i += 450) {
    const chunk = deletable.slice(i, i + 450);
    const batch = db().batch();
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
    trimmed += chunk.length;
  }

  return { trimmed };
}

/**
 * NOTE: We write entry docs with deterministic docIds when we can.
 * This makes repeat simulations easier to reason about and prevents accidental duplicates.
 */
async function writeEntriesInBatches({ contestId, items, batchSize = MAX_BATCH_WRITE }) {
  const col = db().collection("entries").doc(contestId).collection("items");

  let written = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batch = db().batch();

    for (const e of chunk) {
      const ref = col.doc(e._docId);
      const { _docId, ...data } = e;
      batch.set(ref, data, { merge: false });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

/**
 * Write or update many docs (merge=true) in batches.
 */
async function mergeDocsInBatches({ colRef, docs, batchSize = MAX_BATCH_WRITE }) {
  let updated = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    const batch = db().batch();

    for (const d of chunk) {
      batch.set(colRef.doc(d.id), d.patch, { merge: true });
    }

    await batch.commit();
    updated += chunk.length;
  }

  return updated;
}

/**
 * Reads N random docs from a collection by loading all doc refs (bounded by 10k).
 * This is fine for simulation; do not use for real production flows.
 */
function sampleIdsFromDocs(docs, sampleN) {
  const n = clampInt(sampleN, 0, docs.length);
  if (n == null) return [];
  if (n === 0) return [];
  const ids = docs.map((d) => d.id);
  shuffleInPlace(ids);
  return ids.slice(0, n);
}

/**
 * Compute eligible/total counts from entries collection.
 */
async function computeCountsForContest(contestId) {
  const col = db().collection("entries").doc(contestId).collection("items");
  const snap = await col.get();

  const total = snap.size;
  let eligible = 0;

  snap.forEach((d) => {
    const e = d.data() || {};
    if (isUnifiedEligible(e)) eligible += 1;
  });

  return { totalEntries: total, eligibleCount: eligible };
}

/* =========================================================
   SIM ENGINE (self-contained)
========================================================= */

async function computeUnifiedBest({ contestId, targetNumber }) {
  const target = parse4DigitNumber(targetNumber);
  if (target == null) throw new Error("Invalid target. Must be 0000–9999.");

  const entriesSnap = await db().collection("entries").doc(contestId).collection("items").get();
  if (entriesSnap.empty) throw new Error("No entries.");

  let eligibleCount = 0;
  let best = null;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    if (!isUnifiedEligible(e)) return;

    eligibleCount += 1;

    const guessNum = parse4DigitNumber(e.guess);
    if (guessNum == null) return;

    const diff = absDiff(guessNum, target);
    const ts = Number(e.timestamp || e.createdAt || 0) || 0;

    // Tie-break: earlier timestamp wins on equal diff
    if (!best || diff < best.diff || (diff === best.diff && ts < best.timestamp)) {
      best = {
        id: doc.id,
        ...e,
        diff,
        timestamp: ts,
        guessNorm: normalizeNumber(guessNum, 4),
        targetNorm: normalizeNumber(target, 4),
        exact: diff === 0,
      };
    }
  });

  if (!best) throw new Error("No eligible entries.");

  return {
    target,
    targetNorm: normalizeNumber(target, 4),
    best,
    eligibleCount,
    totalEntries: entriesSnap.size,
  };
}

/**
 * Resets only the fields simulation touches. (Does not clobber prize config.)
 */
async function resetContestForSim({ contestId }) {
  await db().collection("contests").doc(contestId).set(
    {
      mode: "DAILY4",
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      resolvedSlot: null,
      winner: null,
      targetNumber: null, // legacy

      targets: {},
      projectedWinner: null,
      targetsUpdatedAt: null,
      entryCount: 0,

      resetAt: nowMs(),
      simLastError: null,
    },
    { merge: true }
  );
}

/**
 * Resolves contest in a way consistent with your 4-target flow:
 * - Locks up to 4 targets
 * - Keeps projectedWinner best-so-far
 * - Marks contest resolved at the end (exact or not)
 * - Writes a winner record (sim: true) if projectedWinner exists
 */
async function resolveContestWithRandomTargets({ contestId }) {
  const contestRef = db().collection("contests").doc(contestId);
  const targetsOut = {};

  for (let slot = 1; slot <= 4; slot++) {
    const targetRaw = normalizeNumber(randInt(0, 9999), 4);
    const r0 = await computeUnifiedBest({ contestId, targetNumber: targetRaw });

    const drawLabel = slotToLabel(slot);
    const playedAt = nowMs();

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(contestRef);
      if (!snap.exists) throw new Error("Contest missing.");
      const c = snap.data() || {};
      if (c.resolved) return;

      const targets = c.targets && typeof c.targets === "object" ? c.targets : {};
      const slotKey = String(slot);
      if (targets[slotKey]?.locked) return;

      const curProj = c.projectedWinner || null;
      const curDiff = curProj ? Number(curProj.diff ?? 1e9) : 1e9;
      const curTs = curProj ? Number(curProj.entryTimestamp ?? 9e15) : 9e15;

      const nextDiff = Number(r0.best.diff);
      const nextTs = Number(r0.best.timestamp);

      const beats = nextDiff < curDiff || (nextDiff === curDiff && nextTs < curTs);

      const projectedWinner = beats
        ? {
            winnerUN: r0.best.username || r0.best.winnerUN || "—",
            winnerUserId: r0.best.userId || null,
            source: safeUpper(r0.best.source || (r0.best.paid ? "PAID" : "AMOE") || "") || null,

            guess: r0.best.guessNorm,
            diff: r0.best.diff,
            exact: !!r0.best.exact,

            target: r0.best.targetNorm,
            drawLabel,
            playedAt,

            entryTimestamp: r0.best.timestamp,
            updatedAt: nowMs(),
          }
        : curProj;

      const nextTargets = { ...targets };
      nextTargets[slotKey] = {
        target: r0.targetNorm,
        drawLabel,
        playedAt,
        locked: true,
        submittedAt: nowMs(),
      };

      const patch = {
        mode: "DAILY4",
        targets: nextTargets,
        projectedWinner: projectedWinner || null,
        targetsUpdatedAt: nowMs(),
      };

      // Exact hit ends immediately
      if (r0.best.exact) {
        patch.resolved = true;
        patch.resolvedAt = nowMs();
        patch.resolvedBy = "EXACT";
        patch.resolvedSlot = slot;

        // legacy
        patch.targetNumber = r0.targetNorm;

        // snapshot preferred for Reveal
        patch.winner = projectedWinner || null;
      }

      tx.set(contestRef, patch, { merge: true });
    });

    targetsOut[String(slot)] = { target: r0.targetNorm, drawLabel, exactHit: !!r0.best.exact };
    if (r0.best.exact) break;
  }

  // Ensure resolved even if no exact
  const snap2 = await contestRef.get();
  const c2 = snap2.exists ? snap2.data() || {} : {};

  if (!c2.resolved) {
    await contestRef.set(
      {
        resolved: true,
        resolvedAt: nowMs(),
        resolvedBy: "CLOSEST",
        resolvedSlot: 4, // because sim ran all 4 without exact

        winner: c2.projectedWinner || null,

        // legacy best-effort
        targetNumber: c2.projectedWinner?.target ?? c2.targetNumber ?? null,
      },
      { merge: true }
    );
  } else {
    // If it ended early on exact inside the loop, ensure legacy targetNumber aligns to winner target
    await contestRef.set(
      {
        resolvedBy: c2.resolvedBy || "EXACT",
        resolvedSlot: c2.resolvedSlot ?? null,
        winner: c2.winner || c2.projectedWinner || null,
        targetNumber: c2.winner?.target ?? c2.projectedWinner?.target ?? c2.targetNumber ?? null,
      },
      { merge: true }
    );
  }

  // Winner record from projectedWinner / winner snapshot
  const snap3 = await contestRef.get();
  const c3 = snap3.exists ? snap3.data() || {} : {};
  const proj = c3.winner || c3.projectedWinner || null;

  let winner = null;
  if (proj) {
    const guaranteed = Number(c3.guaranteedPrizeCents || 0);
    const bonus = Number(c3.bonusPrizeCents || 0);
    const finalPrize = Number(c3.finalPrizeCents || 0) || guaranteed + bonus;

    const counts = await computeCountsForContest(contestId);

    winner = {
      contestId,
      endsOn: c3.endsOn || null,
      mode: "DAILY4",

      // how it ended
      resolvedBy: c3.resolvedBy || (proj.exact ? "EXACT" : "CLOSEST"),
      resolvedSlot: Number(c3.resolvedSlot || 4),

      // winning draw info (best so far overall)
      target: proj.target || null,
      drawLabel: proj.drawLabel || null,
      playedAt: proj.playedAt || null,

      // winner
      winnerUN: proj.winnerUN || "—",
      winnerUserId: proj.winnerUserId || null,
      source: proj.source || null,
      guess: proj.guess || null,
      diff: Number(proj.diff ?? 0),
      exact: !!proj.exact,
      entryTimestamp: Number(proj.entryTimestamp ?? 0),

      // payouts
      guaranteedPrizeCents: guaranteed,
      bonusPrizeCents: bonus,
      finalPrizeCents: finalPrize,

      // metadata
      resolvedAt: nowMs(),
      eligibleCount: counts.eligibleCount,
      totalEntries: counts.totalEntries,
      sim: true,
    };

    await db().collection("winners").add(winner);
  }

  return { targetsOut, winner };
}

/* =========================================================
   ROUTE: Admin Simulate Contest Cycle
   - Seeds unique guesses into entries/<contestId>/items
   - Optionally resets first
   - Optionally includes AMOE
   - Optionally resolves via 4-target engine + winner record
   - Can optionally "seed only" (autoResolve=false)
========================================================= */

r.post(
  "/api/admin/simulate-cycle",
  requireAdmin,
  rateLimit({ routeKey: "admin_simulate_cycle", limit: 8, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const {
        count = 200,
        resetFirst = true,
        includeAmoe = true,
        paidRatio = 0.85,
        autoResolve = true,

        // extra knobs:
        includeDisqualified = false, // if true, also creates some REFUNDED/DISPUTED/EXPIRED/QUEUED rows
        disqualifiedRatio = 0.02, // portion of seeded rows flagged as ineligible (only if includeDisqualified)

        // ensure countedInContest present on eligible ones:
        forceCountedFlag = true,
      } = req.body || {};

      const n = clampInt(count, 1, MAX_UNIQUE_DAILY4);
      if (n == null) throw new Error(`count must be 1..${MAX_UNIQUE_DAILY4}.`);

      const pr = clampFloat(paidRatio, 0, 1);
      if (pr == null) throw new Error("paidRatio must be 0..1.");

      const dq = clampFloat(disqualifiedRatio, 0, 0.5);
      if (dq == null) throw new Error("disqualifiedRatio must be 0..0.5.");

      const active = await ensureActiveContestNow();
      if (!active?.id) throw new Error("Active contest not available.");
      const contestId = active.id;

      let deletedBefore = 0;

      if (resetFirst) {
        const entriesCol = db().collection("entries").doc(contestId).collection("items");
        deletedBefore = await deleteCollectionInBatches(entriesCol, MAX_BATCH_DELETE);
        await resetContestForSim({ contestId });
      }

      const guesses = makeUniqueDaily4Guesses(n);

      const now = nowMs();
      const paidCount = Math.round(n * pr);

      // If includeAmoe=false, everything is paid (or at least "not AMOE")
      const items = guesses.map((guess, i) => {
        const isPaid = includeAmoe ? i < paidCount : true;
        const isA = includeAmoe ? !isPaid : false;

        const username = isPaid
          ? `SimP${String(i + 1).padStart(4, "0")}`
          : `SimA${String(i + 1).padStart(4, "0")}`;

        const ts = now - randInt(0, SIM_MIN_TS_BACK_MS);

        const base = {
          _docId: `sim_${contestId}_${now}_${i}_${Math.random().toString(16).slice(2)}`,
          username,
          usernameLower: username.toLowerCase(),
          guess,
          timestamp: ts,
          createdAt: ts,

          paid: !!isPaid,
          status: isPaid ? "PAID" : "AMOE",
          source: isA ? "AMOE" : "PAID",
          isAmoe: isA,

          userId: null,
          sim: true,
          simRunAt: now,
        };

        if (forceCountedFlag) base.countedInContest = true;

        return base;
      });

      // Optionally poison a small portion with disqualifying statuses + flags to cover edge cases
      if (includeDisqualified && items.length > 0) {
        const dqCount = clampInt(Math.round(items.length * dq), 0, Math.min(250, items.length));
        const k = dqCount == null ? 0 : dqCount;

        const idxs = Array.from({ length: items.length }, (_, i) => i);
        shuffleInPlace(idxs);

        const bad = ["REFUNDED", "DISPUTED", "EXPIRED", "QUEUED"];
        for (let j = 0; j < k; j++) {
          const it = items[idxs[j]];
          const s = bad[j % bad.length];
          it.status = s;

          // these variations ensure eligibility logic is robust:
          if (s === "QUEUED") {
            it.paid = true;
            it.source = "PAID";
            it.isAmoe = false;
            it.countedInContest = false;
          } else {
            it.paid = true; // still "paid" but disqualified by status
            it.source = "PAID";
            it.isAmoe = false;
            it.countedInContest = false;
          }
        }
      }

      shuffleInPlace(items);

      const created = await writeEntriesInBatches({ contestId, items, batchSize: MAX_BATCH_WRITE });

      // Set entryCount to ELIGIBLE count (not just docs created)
      const counts = await computeCountsForContest(contestId);

      await db().collection("contests").doc(contestId).set(
        {
          entryCount: counts.eligibleCount,
          mode: "DAILY4",
          simLastRunAt: nowMs(),
          simLastRunCount: created,
          simLastRunEligibleCount: counts.eligibleCount,
          simLastRunTotalEntries: counts.totalEntries,
          simLastRunType: "seed",
          simLastError: null,
        },
        { merge: true }
      );

      const out = {
        ok: true,
        contestId,
        deletedBefore,
        created,
        eligibleCount: counts.eligibleCount,
        totalEntries: counts.totalEntries,
        paidCountApprox: includeAmoe ? paidCount : created,
        amoeCountApprox: includeAmoe ? created - paidCount : 0,
        resolved: false,
        targets: null,
        winner: null,
      };

      if (!autoResolve) {
        await auditLog("admin_simulate_cycle_seed_only", { contestId, created, eligibleCount: counts.eligibleCount }, req);
        return res.json(out);
      }

      const { targetsOut, winner } = await resolveContestWithRandomTargets({ contestId });
      await trimWinnersHistory({ simOnly: true });

      await db().collection("contests").doc(contestId).set(
        {
          simLastRunAt: nowMs(),
          simLastRunCount: created,
          simLastRunType: "seed+resolve",
        },
        { merge: true }
      );

      await auditLog("admin_simulate_cycle", { contestId, created, winnerUN: winner?.winnerUN || null }, req);

      return res.json({
        ...out,
        resolved: true,
        targets: targetsOut,
        winner,
      });
    } catch (e) {
      // best-effort record for debugging in admin/state
      try {
        const active = await ensureActiveContestNow();
        if (active?.id) {
          await db().collection("contests").doc(active.id).set(
            { simLastError: String(e?.message || e), simLastErrorAt: nowMs() },
            { merge: true }
          );
        }
      } catch {}

      return res.status(400).json({ ok: false, error: e.message || "Simulation failed." });
    }
  }
);

/* =========================================================
   ROUTE: Admin Simulate Checkout Flow (high-coverage)
   Purpose: exercise the same *data states* your real Stripe flow produces:
   - unpaid "QUEUED"/"PENDING" entries
   - then "paid=true" + status becomes PAID
   - supports "cancelled" scenario (no changes)
   - supports "already paid" idempotency scenario
   NOTE: This does NOT call Stripe; it simulates state transitions in Firestore.
========================================================= */

r.post(
  "/api/admin/simulate-checkout",
  requireAdmin,
  rateLimit({ routeKey: "admin_simulate_checkout", limit: 12, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const {
        // how many entries to create as unpaid
        seedUnpaid = 50,
        // then how many of those to mark as paid
        markPaid = 25,
        // unpaid status label to emulate your system (QUEUED is common)
        unpaidStatus = "QUEUED", // QUEUED | PENDING | UNPAID
        // if true, do NOT mark paid (represents user cancelling checkout)
        cancelOnly = false,
        // if true, attempt to "pay again" for docs already marked paid (should be idempotent)
        runAlreadyPaid = false,
      } = req.body || {};

      const su = clampInt(seedUnpaid, 0, MAX_SIM_UNPAID);
      if (su == null) throw new Error(`seedUnpaid must be 0..${MAX_SIM_UNPAID}.`);

      const mp = clampInt(markPaid, 0, MAX_SIM_PAID_MARK);
      if (mp == null) throw new Error(`markPaid must be 0..${MAX_SIM_PAID_MARK}.`);

      const us = safeUpper(unpaidStatus);
      if (!["QUEUED", "PENDING", "UNPAID"].includes(us)) {
        throw new Error("unpaidStatus must be QUEUED, PENDING, or UNPAID.");
      }

      const active = await ensureActiveContestNow();
      if (!active?.id) throw new Error("Active contest not available.");
      const contestId = active.id;

      const now = nowMs();

      // Seed unpaid
      if (su > 0) {
        const guesses = makeUniqueDaily4Guesses(Math.min(su, MAX_UNIQUE_DAILY4));

        const items = guesses.map((guess, i) => {
          const username = `SimQ${String(i + 1).padStart(4, "0")}`;
          const ts = now - randInt(0, SIM_MIN_TS_BACK_MS);

          const docId = `simq_${contestId}_${now}_${i}_${Math.random().toString(16).slice(2)}`;

          return {
            _docId: docId,
            username,
            usernameLower: username.toLowerCase(),
            guess,
            timestamp: ts,
            createdAt: ts,

            paid: false,
            status: us,
            countedInContest: false, // typical for queued/unpaid
            source: "PAID",
            isAmoe: false,

            sim: true,
            simRunAt: now,
          };
        });

        shuffleInPlace(items);
        await writeEntriesInBatches({ contestId, items, batchSize: MAX_BATCH_WRITE });
      }

      // Load seeded docs (and optionally choose other docs if user already has data)
      const col = db().collection("entries").doc(contestId).collection("items");
      const snap = await col.where("sim", "==", true).orderBy("createdAt", "desc").limit(10_000).get();

      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));

      // Choose docs to mark paid: prefer those that are unpaid (paid=false)
      const unpaidDocs = docs.filter((d) => !d.data.paid);
      const toPayIds = sampleIdsFromDocs(unpaidDocs, Math.min(mp, unpaidDocs.length));

      let markedPaid = 0;
      let alreadyPaidTouched = 0;

      if (!cancelOnly && toPayIds.length > 0) {
        const patches = toPayIds.map((id) => ({
          id,
          patch: {
            paid: true,
            status: "PAID",
            countedInContest: true,
            paidAt: nowMs(),
            updatedAt: nowMs(),

            // This is where your real flow would have stripe fields:
            // stripeSessionId: "sim_...",
            // paymentIntentId: "sim_...",
            simPaid: true,
          },
        }));

        markedPaid = await mergeDocsInBatches({ colRef: col, docs: patches, batchSize: MAX_BATCH_WRITE });
      }

      // "Already paid" test: attempt to "pay" docs already marked paid. Should be idempotent.
      if (runAlreadyPaid) {
        const paidDocs = docs.filter((d) => !!d.data.paid);
        const ids = sampleIdsFromDocs(paidDocs, Math.min(25, paidDocs.length));
        if (ids.length) {
          const patches = ids.map((id) => ({
            id,
            patch: {
              // do not change guess, etc. Just touch updatedAt to represent confirm being called again.
              updatedAt: nowMs(),
              simAlreadyPaidConfirm: true,
            },
          }));
          alreadyPaidTouched = await mergeDocsInBatches({ colRef: col, docs: patches, batchSize: MAX_BATCH_WRITE });
        }
      }

      // Update contest entryCount based on eligible entries (paid+countedInContest OR AMOE rules)
      const counts = await computeCountsForContest(contestId);

      await db().collection("contests").doc(contestId).set(
        {
          entryCount: counts.eligibleCount,
          simLastCheckoutRunAt: nowMs(),
          simLastCheckout: {
            seedUnpaid: su,
            markPaidRequested: mp,
            markedPaid,
            cancelOnly: !!cancelOnly,
            runAlreadyPaid: !!runAlreadyPaid,
            alreadyPaidTouched,
            unpaidStatus: us,
          },
        },
        { merge: true }
      );

      await auditLog(
        "admin_simulate_checkout",
        { contestId, seedUnpaid: su, markedPaid, cancelOnly: !!cancelOnly, alreadyPaidTouched },
        req
      );

      return res.json({
        ok: true,
        contestId,
        seededUnpaid: su,
        markedPaid,
        cancelOnly: !!cancelOnly,
        runAlreadyPaid: !!runAlreadyPaid,
        alreadyPaidTouched,
        contestEntryCountSetTo: counts.eligibleCount,
        eligibleCount: counts.eligibleCount,
        totalEntries: counts.totalEntries,
      });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || "Sim checkout failed." });
    }
  }
);

/* =========================================================
   ROUTE: Admin Sim Cleanup (optional)
   - Deletes ONLY sim:true docs from the active contest pool
   - Leaves real player entries untouched
========================================================= */

r.post(
  "/api/admin/sim/cleanup",
  requireAdmin,
  rateLimit({ routeKey: "admin_sim_cleanup", limit: 12, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const active = await ensureActiveContestNow();
      if (!active?.id) throw new Error("Active contest not available.");
      const contestId = active.id;

      const col = db().collection("entries").doc(contestId).collection("items");

      // delete sim:true docs in batches
      let deleted = 0;
      while (true) {
        const snap = await col.where("sim", "==", true).limit(MAX_BATCH_DELETE).get();
        if (snap.empty) break;

        const batch = db().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        deleted += snap.size;
        if (snap.size < MAX_BATCH_DELETE) break;
      }

      const counts = await computeCountsForContest(contestId);

      await db().collection("contests").doc(contestId).set(
        {
          entryCount: counts.eligibleCount,
          simCleanupAt: nowMs(),
          simCleanupDeleted: deleted,
          simCleanupEligibleCount: counts.eligibleCount,
          simCleanupTotalEntries: counts.totalEntries,
        },
        { merge: true }
      );

      await auditLog("admin_sim_cleanup", { contestId, deleted, entryCount: counts.eligibleCount }, req);

      return res.json({
        ok: true,
        contestId,
        deleted,
        entryCount: counts.eligibleCount,
        eligibleCount: counts.eligibleCount,
        totalEntries: counts.totalEntries,
      });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || "Cleanup failed." });
    }
  }
);

export default r;
