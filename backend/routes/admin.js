// backend/routes/admin.js
import { Router } from "express";

import requireAdmin, { signAdminToken } from "../middleware/admin.js";
import rateLimit from "../middleware/rateLimit.js";

import { db } from "../lib/firestore.js";
import { auditLog } from "../lib/audit.js";

import {
  ADMIN_CODE,
  ADMIN_TOKEN_SECRET,
  TOKEN_TTL_SECONDS,
  HISTORY_LIMIT,
  AMOE_TARGET_COUNT,
  AMOE_PRIZE_CENTS,
} from "../lib/config.js";

import { onlyDigits, normalizeNumber, absDiff, nowMs } from "../lib/utils.js";

import {
  ensureActiveContestNow,
  mostRecentChicagoCutoffAtOrBefore,
  contestIdFromCutoffMs,
  getOrInitAmoeState,
} from "../lib/time.js";

const r = Router();

/* =========================================================
   HELPERS
========================================================= */

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/**
 * Parse a money-ish input as DOLLARS -> CENTS.
 * Accepts:
 * - 100      => $100.00 -> 10000
 * - 100.50   => $100.50 -> 10050
 * - "$100.50" => 10050
 *
 * NOTE: This function intentionally treats integers as dollars (not cents),
 * since these are admin-facing inputs.
 */
function parseMoneyToCents(input) {
  const raw = String(input ?? "").trim();
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;

  // disallow multiple decimals
  if ((cleaned.match(/\./g) || []).length > 1) return null;

  const f = Number(cleaned);
  if (!Number.isFinite(f)) return null;
  if (f < 0) return null;

  return Math.round(f * 100);
}

/**
 * Entries eligible for counting.
 * Source of truth: countedInContest === true.
 * (This is what prevents "paid but not counted" or any legacy junk from claiming numbers.)
 */
function isPaidEntryEligible(e) {
  if (!e) return false;
  if (!e.paid) return false;

  const s = String(e.status || "").toUpperCase();
  if (s === "REFUNDED" || s === "DISPUTED" || s === "EXPIRED") return false;

  if (typeof e.countedInContest === "boolean") {
    return e.countedInContest === true;
  }

  // Back-compat fallback (should be rare once everything writes countedInContest)
  if (s === "QUEUED") return false;
  return true;
}

/**
 * Unified eligibility:
 * - paid entries that qualify (paid + countedInContest true)
 * - AMOE entries mirrored into the contest pool MUST ALSO be countedInContest true
 */
function isUnifiedEligible(e) {
  if (!e) return false;

  if (isPaidEntryEligible(e)) return true;

  const isAmoe =
    String(e.source || "").toUpperCase() === "AMOE" ||
    e.isAmoe === true ||
    String(e.status || "").toUpperCase() === "AMOE";

  if (isAmoe) return e.countedInContest === true;

  return false;
}

async function getContestByIdOrLast(contestIdMaybe) {
  let id = String(contestIdMaybe || "").trim();
  if (!id) {
    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    id = contestIdFromCutoffMs(lastCutoff);
  }
  const ref = db().collection("contests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "No such contest.", contestId: id };
  return { ok: true, contestId: id, contest: { id: snap.id, ...(snap.data() || {}) } };
}

function pickContestIdOrLast(contestIdMaybe) {
  const id0 = String(contestIdMaybe || "").trim();
  if (id0) return id0;
  return contestIdFromCutoffMs(mostRecentChicagoCutoffAtOrBefore(nowMs()));
}

function parse4DigitNumber(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 4) return null; // ✅ enforce EXACT 4 digits (0000–9999)
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

/**
 * Firestore helper: delete an entire collection in safe batches.
 * Returns number of deleted docs.
 */
async function deleteCollectionInBatches(colRef, batchSize = 400) {
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
 * Firestore helper: delete a QUERY result set in safe batches.
 * Returns number of deleted docs.
 */
async function deleteQueryInBatches(query, batchSize = 400) {
  let deleted = 0;

  while (true) {
    const snap = await query.limit(batchSize).get();
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
 * Trim a collection by resolvedAt desc, keep newest HISTORY_LIMIT.
 * Uses a bounded query so we don’t scan the whole collection.
 */
async function trimByResolvedAt(collectionName, keep = HISTORY_LIMIT) {
  const cap = Math.max(0, Number(keep || 0));
  // Fetch only enough to know what to delete (keep + up to 300 extra)
  const snap = await db()
    .collection(collectionName)
    .orderBy("resolvedAt", "desc")
    .limit(cap + 300)
    .get();

  if (snap.empty) return 0;

  const extra = snap.docs.slice(cap);
  if (!extra.length) return 0;

  const batch = db().batch();
  extra.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return extra.length;
}

/* =========================================================
   STATS — LIFETIME "TOTAL PAID OUT" (MANUAL)
   ✅ Source of truth for Landing: config/public.totalPaidOutCents
   ✅ Keep legacy mirror: stats/global.totalPaidCents
========================================================= */

const TOTAL_PAID_CAP_CENTS = 10_000_000_00; // $10,000,000.00

const PUBLIC_CFG_REF = () => db().collection("config").doc("public");
const GLOBAL_STATS_REF = () => db().collection("stats").doc("global");

function safeCents(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function getTotalPaidCents() {
  try {
    const pubSnap = await PUBLIC_CFG_REF().get();
    if (pubSnap.exists) {
      const d = pubSnap.data() || {};
      const v = safeCents(d.totalPaidOutCents);
      if (v >= 0) return v;
    }
  } catch {}

  try {
    const snap = await GLOBAL_STATS_REF().get();
    if (!snap.exists) return 0;
    const d = snap.data() || {};
    return safeCents(d.totalPaidCents);
  } catch {
    return 0;
  }
}

async function addToTotalPaidCents(addCents) {
  const inc = clampInt(addCents, 0, TOTAL_PAID_CAP_CENTS);
  if (inc == null) throw new Error("Invalid addCents.");
  if (!inc) return await getTotalPaidCents();

  const pubRef = PUBLIC_CFG_REF();
  const statsRef = GLOBAL_STATS_REF();

  await db().runTransaction(async (tx) => {
    const pubSnap = await tx.get(pubRef);
    const statsSnap = await tx.get(statsRef);

    const pubCur = pubSnap.exists ? safeCents((pubSnap.data() || {}).totalPaidOutCents) : 0;
    const statsCur = statsSnap.exists ? safeCents((statsSnap.data() || {}).totalPaidCents) : 0;

    const base = pubSnap.exists ? pubCur : statsCur;
    const next = Math.min(TOTAL_PAID_CAP_CENTS, base + inc);

    tx.set(pubRef, { totalPaidOutCents: next, updatedAt: nowMs() }, { merge: true });
    tx.set(statsRef, { totalPaidCents: next, updatedAt: nowMs() }, { merge: true });
  });

  return await getTotalPaidCents();
}

async function setTotalPaidCentsAbsolute(totalCents) {
  const v = clampInt(totalCents, 0, TOTAL_PAID_CAP_CENTS);
  if (v == null) throw new Error("Invalid totalPaidCents.");

  const pubRef = PUBLIC_CFG_REF();
  const statsRef = GLOBAL_STATS_REF();

  const batch = db().batch();
  batch.set(pubRef, { totalPaidOutCents: v, updatedAt: nowMs() }, { merge: true });
  batch.set(statsRef, { totalPaidCents: v, updatedAt: nowMs() }, { merge: true });
  await batch.commit();

  return v;
}

/* =========================================================
   ADMIN — PRIZE CONFIG (WEEKLY GUARANTEED + BONUS)
========================================================= */

const PRIZE_MAX_CENTS = 1_000_000_00; // $1,000,000.00 cap safety

async function getPrizeConfig() {
  const ref = db().collection("config").doc("public");
  const snap = await ref.get();
  const d = snap.exists ? snap.data() || {} : {};

  const guaranteed = clampInt(d.weeklyGuaranteedPrizeCents, 0, PRIZE_MAX_CENTS);
  const bonus = clampInt(d.weeklyBonusPrizeCents, 0, PRIZE_MAX_CENTS);

  return {
    weeklyGuaranteedPrizeCents: guaranteed != null ? guaranteed : 10000,
    weeklyBonusPrizeCents: bonus != null ? bonus : 0,
  };
}

async function setPrizeConfig({ weeklyGuaranteedPrizeCents, weeklyBonusPrizeCents }) {
  const g = clampInt(parseMoneyToCents(weeklyGuaranteedPrizeCents), 0, PRIZE_MAX_CENTS);
  const b = clampInt(parseMoneyToCents(weeklyBonusPrizeCents), 0, PRIZE_MAX_CENTS);

  if (g == null) throw new Error("Invalid guaranteed prize.");
  if (b == null) throw new Error("Invalid bonus prize.");

  const ref = db().collection("config").doc("public");
  await ref.set(
    {
      weeklyGuaranteedPrizeCents: g,
      weeklyBonusPrizeCents: b,
      updatedAt: nowMs(),
    },
    { merge: true }
  );

  // Apply to active contest immediately (best-effort)
  try {
    const active = await ensureActiveContestNow();
    if (active?.id) {
      const contestRef = db().collection("contests").doc(active.id);
      await contestRef.set(
        {
          guaranteedPrizeCents: g,
          bonusPrizeCents: b,
          finalPrizeCents: g + b,
          prizeUpdatedAt: nowMs(),
          mode: "DAILY4",
        },
        { merge: true }
      );
    }
  } catch {}

  return { weeklyGuaranteedPrizeCents: g, weeklyBonusPrizeCents: b };
}

/* =========================================================
   ADMIN — LOGIN (CODE -> TOKEN)
========================================================= */

r.post(
  "/api/admin/login",
  rateLimit({ routeKey: "admin_login", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { code } = req.body || {};
      const c = String(code || "").trim();

      if (!ADMIN_TOKEN_SECRET) {
        return res.status(500).json({ error: "ADMIN_TOKEN_SECRET not configured." });
      }

      // ✅ compare normalized values (prevents whitespace mismatch / number-vs-string surprises)
      if (c !== String(ADMIN_CODE || "").trim()) return res.status(401).json({ error: "Unauthorized." });

      const now = nowMs();
      const token = signAdminToken({
        v: 1,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS * 1000,
      });

      await auditLog("admin_login", { ok: true }, req);

      return res.json({ token, expiresInSeconds: TOKEN_TTL_SECONDS });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Admin login failed." });
    }
  }
);

/* =========================================================
   ADMIN — STATS (LIFETIME PAID OUT)
========================================================= */

r.post(
  "/api/admin/stats/get",
  requireAdmin,
  rateLimit({ routeKey: "admin_stats_get", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const totalPaidCents = await getTotalPaidCents();
      return res.json({ ok: true, totalPaidCents });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to load stats." });
    }
  }
);

r.post(
  "/api/admin/stats/total-paid/add",
  requireAdmin,
  rateLimit({ routeKey: "admin_total_paid_add", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { addCents } = req.body || {};
      const inc = clampInt(addCents, 0, TOTAL_PAID_CAP_CENTS);
      if (inc == null) throw new Error("Invalid addCents.");

      const next = await addToTotalPaidCents(inc);

      await auditLog("admin_total_paid_add", { addCents: inc, totalPaidCents: next }, req);

      return res.json({ ok: true, totalPaidCents: next });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to update total paid." });
    }
  }
);

r.post(
  "/api/admin/stats/total-paid/set",
  requireAdmin,
  rateLimit({ routeKey: "admin_total_paid_set", limit: 10, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { totalPaidCents } = req.body || {};
      const v = await setTotalPaidCentsAbsolute(totalPaidCents);

      await auditLog("admin_total_paid_set", { totalPaidCents: v }, req);

      return res.json({ ok: true, totalPaidCents: v });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to set total paid." });
    }
  }
);

/* =========================================================
   ADMIN — PRIZE CONFIG (GET/SET)
========================================================= */

r.post(
  "/api/admin/prize-config/get",
  requireAdmin,
  rateLimit({ routeKey: "admin_prize_get", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const cfg = await getPrizeConfig();
      return res.json({ ok: true, ...cfg });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to load prize config." });
    }
  }
);

r.post(
  "/api/admin/prize-config/set",
  requireAdmin,
  rateLimit({ routeKey: "admin_prize_set", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { weeklyGuaranteedPrizeCents, weeklyBonusPrizeCents } = req.body || {};
      const v = await setPrizeConfig({ weeklyGuaranteedPrizeCents, weeklyBonusPrizeCents });

      await auditLog("admin_prize_config_set", v, req);

      let activePatch = null;
      try {
        const active = await ensureActiveContestNow();
        if (active?.id) {
          const snap = await db().collection("contests").doc(active.id).get();
          if (snap.exists) {
            const c = snap.data() || {};
            activePatch = {
              contestId: active.id,
              guaranteedPrizeCents: Number(c.guaranteedPrizeCents || 0),
              bonusPrizeCents: Number(c.bonusPrizeCents || 0),
              finalPrizeCents: Number(c.finalPrizeCents || 0),
              entryCount: Number(c.entryCount || 0),
              activatedAt: c.activatedAt ?? null,
              resolved: !!c.resolved,
            };
          }
        }
      } catch {}

      return res.json({ ok: true, ...v, active: activePatch });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to set prize config." });
    }
  }
);

/* =========================================================
   ADMIN — COMBINED STATE (ACTIVE CONTEST + AMOE STATE)
========================================================= */

r.post(
  "/api/admin/state",
  requireAdmin,
  rateLimit({ routeKey: "admin_state", limit: 60, windowMs: 5 * 60 * 1000 }),
  async (req, res) => {
    try {
      const active = await ensureActiveContestNow();
      if (!active || !active.id) {
        return res.status(500).json({ error: "Active contest not available." });
      }

      // Ensure Daily4-only (best-effort)
      try {
        if (String(active.mode || "").toUpperCase() !== "DAILY4") {
          await db().collection("contests").doc(active.id).set({ mode: "DAILY4" }, { merge: true });
          active.mode = "DAILY4";
        }
      } catch {}

      const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
      const lastId = contestIdFromCutoffMs(lastCutoff);

      const lastSnap = await db().collection("contests").doc(lastId).get();
      const lastContest = lastSnap.exists ? lastSnap.data() : null;

      const { state: amoeState } = await getOrInitAmoeState();

      const totalPaidCents = await getTotalPaidCents();
      const prizeCfg = await getPrizeConfig();

      const activeGuaranteed = Number(active.guaranteedPrizeCents || prizeCfg.weeklyGuaranteedPrizeCents || 0);
      const activeBonus = Number(active.bonusPrizeCents || prizeCfg.weeklyBonusPrizeCents || 0);
      const activeFinal = Number(active.finalPrizeCents || 0) || activeGuaranteed + activeBonus;

      const lastGuaranteed = Number(lastContest?.guaranteedPrizeCents || 0);
      const lastBonus = Number(lastContest?.bonusPrizeCents || 0);
      const lastFinal = Number(lastContest?.finalPrizeCents || 0) || lastGuaranteed + lastBonus;

      const targets = active.targets || {};
      const projected = active.projectedWinner || null;

      return res.json({
        ok: true,
        serverNow: nowMs(),

        stats: { totalPaidCents },

        config: {
          weeklyGuaranteedPrizeCents: prizeCfg.weeklyGuaranteedPrizeCents,
          weeklyBonusPrizeCents: prizeCfg.weeklyBonusPrizeCents,
        },

        activeContest: {
          id: active.id || null,
          mode: "DAILY4",
          cutoffAt: active.cutoffAt ?? null,
          endsOn: active.endsOn ?? null,
          resolved: !!active.resolved,
          resolvedAt: active.resolvedAt ?? null,

          // legacy (kept for compatibility)
          targetNumber: active.targetNumber ?? null,

          // new 4-target flow
          targets,
          projectedWinner: projected,

          entryCount: Number(active.entryCount || 0),
          guaranteedPrizeCents: activeGuaranteed,
          bonusPrizeCents: activeBonus,
          finalPrizeCents: activeFinal,
          activatedAt: active.activatedAt ?? null,
        },

        lastContest: lastContest
          ? {
              id: lastContest.id || lastId,
              mode: "DAILY4",
              cutoffAt: lastContest.cutoffAt ?? null,
              endsOn: lastContest.endsOn ?? null,
              resolved: !!lastContest.resolved,
              resolvedAt: lastContest.resolvedAt ?? null,
              targetNumber: lastContest.targetNumber ?? null,
              entryCount: Number(lastContest.entryCount || 0),
              guaranteedPrizeCents: lastGuaranteed,
              bonusPrizeCents: lastBonus,
              finalPrizeCents: lastFinal,
              activatedAt: lastContest.activatedAt ?? null,
            }
          : null,

        amoe: {
          cycleId: amoeState.cycleId ?? 1,
          status: amoeState.status || "COLLECTING",
          count: Number(amoeState.count || 0),
          reachedAt: amoeState.reachedAt ?? null,
          resolvedAt: amoeState.resolvedAt ?? null,
          targetNumber: amoeState.targetNumber ?? null,
          prizeCents: Number(amoeState.prizeCents || AMOE_PRIZE_CENTS),
          targetCount: AMOE_TARGET_COUNT,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to load admin state." });
    }
  }
);

/* =========================================================
   UNIFIED RESOLVE ENGINE (PAID + AMOE)
   - 4-digit targets only
   - Tie-break: same diff -> earlier timestamp wins
   - Exact match: resolves contest early
   - Otherwise: updates projectedWinner (best so far)
========================================================= */

async function computeUnifiedBest({ contestId, targetNumber }) {
  const target = parse4DigitNumber(targetNumber);
  if (target == null) throw new Error("Invalid target. Must be exactly 4 digits (0000–9999).");

  const entriesSnap = await db().collection("entries").doc(contestId).collection("items").get();
  if (entriesSnap.empty) throw new Error("No entries.");

  let totalEntries = entriesSnap.size;
  let eligibleCount = 0;
  let best = null;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    if (!isUnifiedEligible(e)) return;

    const guessNum = parse4DigitNumber(e.guess);
    if (guessNum == null) return;

    eligibleCount += 1;

    const diff = absDiff(guessNum, target);
    const ts = Number(e.timestamp || e.createdAt || 0) || 0;

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
    totalEntries,
  };
}

r.post(
  "/api/admin/targets/submit",
  requireAdmin,
  rateLimit({ routeKey: "admin_targets_submit", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { contestId, slot, targetNumber } = req.body || {};
      const id = pickContestIdOrLast(contestId);

      const s = clampInt(slot, 1, 4);
      if (s == null) throw new Error("Invalid slot. Must be 1–4.");

      // Compute best OUTSIDE the transaction (avoid non-tx reads inside tx callback)
      const r0 = await computeUnifiedBest({ contestId: id, targetNumber });

      const contestRef = db().collection("contests").doc(id);

      const result = await db().runTransaction(async (tx) => {
        const contestSnap = await tx.get(contestRef);
        if (!contestSnap.exists) throw new Error("No such contest.");

        const contest = contestSnap.data() || {};
        if (contest.resolved) throw new Error("Already resolved.");

        const targets = contest.targets && typeof contest.targets === "object" ? contest.targets : {};
        const slotKey = String(s);
        if (targets[slotKey]?.locked) throw new Error("That target slot is already locked.");

        const drawLabel = slotToLabel(s);
        const playedAt = nowMs();

        const curProj = contest.projectedWinner || null;
        const curDiff = curProj ? Number(curProj.diff ?? curProj.dft ?? 1e9) : 1e9;
        const curTs = curProj ? Number(curProj.entryTimestamp ?? curProj.timestamp ?? 9e15) : 9e15;

        const nextDiff = Number(r0.best.diff);
        const nextTs = Number(r0.best.timestamp);

        const beatsProjected = nextDiff < curDiff || (nextDiff === curDiff && nextTs < curTs);

        const projectedWinner = beatsProjected
          ? {
              winnerUN: r0.best.username || r0.best.winnerUN || r0.best.name || r0.best.email || "—",
              winnerUserId: r0.best.userId || null,
              source: String(r0.best.source || (r0.best.paid ? "PAID" : "AMOE") || "").toUpperCase() || null,

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

        const exactHit = !!r0.best.exact;
        const finalizeByClosest = !exactHit && s === 4;

        const patch = {
          mode: "DAILY4",
          targets: nextTargets,
          projectedWinner: projectedWinner || null,
          targetsUpdatedAt: nowMs(),
        };

        if (exactHit || finalizeByClosest) {
          patch.resolved = true;
          patch.resolvedAt = nowMs();
          patch.resolvedBy = exactHit ? "EXACT" : "CLOSEST";
          patch.resolvedSlot = s;

          // legacy
          patch.targetNumber = exactHit ? r0.targetNorm : projectedWinner?.target ?? r0.targetNorm;

          // snapshot
          patch.winner = projectedWinner || null;
        }

        tx.set(contestRef, patch, { merge: true });

        return {
          contestId: id,
          slot: s,
          drawLabel,
          playedAt,
          target: r0.targetNorm,
          exactHit,

          finalized: exactHit || finalizeByClosest,
          finalizedBy: exactHit ? "EXACT" : finalizeByClosest ? "CLOSEST" : null,
          finalizedSlot: exactHit || finalizeByClosest ? s : null,

          best: {
            winnerUN: r0.best.username || r0.best.name || r0.best.email || "—",
            winnerUserId: r0.best.userId || null,
            source: String(r0.best.source || (r0.best.paid ? "PAID" : "AMOE") || "").toUpperCase() || null,
            guess: r0.best.guessNorm,
            diff: r0.best.diff,
            entryTimestamp: r0.best.timestamp,
          },
          projectedWinner: projectedWinner || null,
          eligibleCount: r0.eligibleCount,
          totalEntries: r0.totalEntries,
        };
      });

      if (result.finalized) {
        const contestSnap = await db().collection("contests").doc(result.contestId).get();
        const contest = contestSnap.exists ? contestSnap.data() || {} : {};

        const guaranteed = Number(contest.guaranteedPrizeCents || 0);
        const bonus = Number(contest.bonusPrizeCents || 0);
        const finalPrize = Number(contest.finalPrizeCents || 0) || guaranteed + bonus;

        const proj = contest.winner || contest.projectedWinner || result.projectedWinner || null;
        if (!proj) throw new Error("No winner could be determined.");

        const record = {
          contestId: result.contestId,
          endsOn: contest.endsOn || null,
          mode: "DAILY4",

          resolvedBy: contest.resolvedBy || result.finalizedBy || (result.exactHit ? "EXACT" : "CLOSEST"),
          resolvedSlot: Number(contest.resolvedSlot || result.finalizedSlot || result.slot),

          target: proj.target || null,
          drawLabel: proj.drawLabel || null,
          playedAt: proj.playedAt || null,

          winnerUN: proj.winnerUN || "—",
          winnerUserId: proj.winnerUserId || null,
          source: proj.source || null,
          guess: proj.guess || null,
          diff: Number(proj.diff ?? 0),
          exact: !!proj.exact,
          entryTimestamp: Number(proj.entryTimestamp ?? 0),

          guaranteedPrizeCents: guaranteed,
          bonusPrizeCents: bonus,
          finalPrizeCents: finalPrize,

          resolvedAt: nowMs(),
          eligibleCount: result.eligibleCount,
          totalEntries: result.totalEntries,
        };

        await db().collection("winners").add(record);
        await trimByResolvedAt("winners", HISTORY_LIMIT);

        await auditLog(
          "admin_targets_finalize",
          {
            contestId: result.contestId,
            slot: result.slot,
            finalizedBy: record.resolvedBy,
            winnerUN: record.winnerUN,
            target: record.target,
            diff: record.diff,
          },
          req
        );

        return res.json({ ok: true, ...result, winnerRecord: record });
      }

      await auditLog(
        "admin_targets_submit",
        { contestId: result.contestId, slot: result.slot, target: result.target, exactHit: false },
        req
      );

      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Target submit failed." });
    }
  }
);

/* =========================================================
   ADMIN — RESET (WIPE PAID + AMOE ENTRIES)
   ✅ SIM FEATURE REMOVED: no sim-only wipe route remains
========================================================= */

r.post(
  "/api/admin/reset-all",
  requireAdmin,
  rateLimit({ routeKey: "admin_reset_all", limit: 5, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { contestId } = req.body || {};

      // ALWAYS reset the active contest unless an explicit id is provided
      const active = await ensureActiveContestNow();
      const id = String(contestId || active?.id || "").trim();
      if (!id) return res.status(500).json({ ok: false, error: "Active contest not available." });

      const contestRef = db().collection("contests").doc(id);
      const contestSnap = await contestRef.get();
      if (!contestSnap.exists) return res.status(400).json({ ok: false, error: "No such contest." });

      const entriesCol = db().collection("entries").doc(id).collection("items");
      const deletedContestEntries = await deleteCollectionInBatches(entriesCol, 400);

      // ALSO wipe winner docs for this contest so Reveal doesn’t keep showing old results
      const winnersQuery = db().collection("winners").where("contestId", "==", id);
      const deletedWinnerRecords = await deleteQueryInBatches(winnersQuery, 400);

      const { ref: stateRef, state } = await getOrInitAmoeState();
      const curCycleId = Number(state.cycleId || 1);
      const amoeCol = db().collection("amoeEntries").doc(String(curCycleId)).collection("items");
      const deletedAmoeEntries = await deleteCollectionInBatches(amoeCol, 400);

      await contestRef.set(
        {
          mode: "DAILY4",

          resolved: false,
          resolvedAt: null,

          // new 4-target flow fields
          resolvedBy: null,
          resolvedSlot: null,
          winner: null,

          // legacy
          targetNumber: null,

          targets: {},
          projectedWinner: null,
          targetsUpdatedAt: null,

          entryCount: 0,
          resetAt: nowMs(),
        },
        { merge: true }
      );

      const nextCycle = curCycleId + 1;
      await stateRef.set(
        {
          cycleId: nextCycle,
          status: "COLLECTING",
          count: 0,
          reachedAt: null,
          resolvedAt: null,
          targetNumber: null,
          prizeCents: AMOE_PRIZE_CENTS,
          updatedAt: nowMs(),
        },
        { merge: true }
      );

      await auditLog(
        "admin_reset_all",
        {
          contestId: id,
          deletedContestEntries,
          deletedWinnerRecords,
          deletedAmoeEntries,
          amoePrevCycleId: curCycleId,
          amoeNextCycleId: nextCycle,
        },
        req
      );

      return res.json({
        ok: true,
        contestId: id,
        deletedContestEntries,
        deletedWinnerRecords,
        deletedAmoeEntries,
        amoePrevCycleId: curCycleId,
        amoeNextCycleId: nextCycle,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || "Reset failed." });
    }
  }
);

/* =========================================================
   ADMIN — PAID PREVIEW + RESOLVE (LEGACY)
========================================================= */

async function computePaidWinner({ contestId, targetNumber }) {
  const contestRef = db().collection("contests").doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) throw new Error("No such contest.");

  const contest = contestSnap.data() || {};

  const target = parse4DigitNumber(targetNumber);
  if (target == null) throw new Error("Invalid target.");

  const entriesSnap = await db().collection("entries").doc(contestId).collection("items").get();
  if (entriesSnap.empty) throw new Error("No entries.");

  let eligibleCount = 0;
  let winner = null;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    if (!isPaidEntryEligible(e)) return;

    const guessNum = parse4DigitNumber(e.guess);
    if (guessNum == null) return;

    eligibleCount += 1;

    const diff = absDiff(guessNum, target);
    const ts = Number(e.timestamp || e.createdAt || 0) || 0;

    if (!winner || diff < winner.diff || (diff === winner.diff && ts < Number(winner.timestamp || 0))) {
      winner = { ...e, diff, timestamp: ts };
    }
  });

  if (!winner) throw new Error("No eligible paid entries.");

  return {
    contest,
    targetNorm: normalizeNumber(target, 4),
    winner,
    eligibleCount,
    totalEntries: entriesSnap.size,
  };
}

r.post(
  "/api/admin/paid/preview",
  requireAdmin,
  rateLimit({ routeKey: "admin_paid_preview", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { targetNumber, contestId } = req.body || {};
      const id = pickContestIdOrLast(contestId);

      const r0 = await computePaidWinner({ contestId: id, targetNumber });

      const guaranteed = Number(r0.contest.guaranteedPrizeCents || 0);
      const bonus = Number(r0.contest.bonusPrizeCents || 0);
      const finalPrize = Number(r0.contest.finalPrizeCents || 0) || guaranteed + bonus;

      return res.json({
        ok: true,
        contestId: id,
        endsOn: r0.contest.endsOn || null,
        mode: "DAILY4",
        target: r0.targetNorm,
        eligibleCount: r0.eligibleCount,
        totalEntries: r0.totalEntries,
        winnerUN: r0.winner.username,
        winnerUserId: r0.winner.userId || null,
        guess: r0.winner.guess,
        diff: r0.winner.diff,
        entryTimestamp: r0.winner.timestamp,
        guaranteedPrizeCents: guaranteed,
        bonusPrizeCents: bonus,
        finalPrizeCents: finalPrize,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Preview failed." });
    }
  }
);

r.post(
  "/api/admin/resolve",
  requireAdmin,
  rateLimit({ routeKey: "admin_resolve_paid", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { targetNumber, contestId } = req.body || {};
      const id = pickContestIdOrLast(contestId);

      const contestRef = db().collection("contests").doc(id);
      const contestSnap = await contestRef.get();
      if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

      const contest = contestSnap.data() || {};
      if (contest.resolved) return res.status(400).json({ error: "Already resolved." });

      const r0 = await computePaidWinner({ contestId: id, targetNumber });

      const guaranteed = Number(contest.guaranteedPrizeCents || 0);
      const bonus = Number(contest.bonusPrizeCents || 0);
      const finalPrize = Number(contest.finalPrizeCents || 0) || guaranteed + bonus;

      const record = {
        contestId: contest.id || id,
        endsOn: contest.endsOn || null,
        mode: "DAILY4",
        target: r0.targetNorm,
        winnerUN: r0.winner.username,
        winnerUserId: r0.winner.userId || null,
        guess: r0.winner.guess,
        diff: r0.winner.diff,
        exact: Number(r0.winner.diff) === 0,
        guaranteedPrizeCents: guaranteed,
        bonusPrizeCents: bonus,
        finalPrizeCents: finalPrize,
        resolvedAt: nowMs(),
        entryTimestamp: r0.winner.timestamp,
        eligibleCount: r0.eligibleCount,
        totalEntries: r0.totalEntries,
      };

      await db().collection("winners").add(record);
      await trimByResolvedAt("winners", HISTORY_LIMIT);

      await contestRef.set(
        {
          mode: "DAILY4",
          resolved: true,
          resolvedAt: record.resolvedAt,
          targetNumber: record.target,
          guaranteedPrizeCents: guaranteed,
          bonusPrizeCents: bonus,
          finalPrizeCents: finalPrize,
        },
        { merge: true }
      );

      await auditLog(
        "admin_resolve_paid",
        { contestId: contest.id || id, target: record.target, finalPrizeCents: finalPrize },
        req
      );

      return res.json({ ok: true, ...record });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to post results." });
    }
  }
);

/* =========================================================
   ADMIN — AMOE CONTROLS
========================================================= */

function cleanEmail(s) {
  return String(s || "").trim().toLowerCase();
}
function cleanName(s) {
  return String(s || "").trim();
}
function cleanAddr(s) {
  return String(s || "").trim();
}

r.post(
  "/api/admin/amoe/add",
  requireAdmin,
  rateLimit({ routeKey: "admin_amoe_add", limit: 120, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { name, email, address, guess, receivedAt } = req.body || {};

      const nm = cleanName(name);
      const em = cleanEmail(email);
      const addr = cleanAddr(address);

      if (nm.length < 2) return res.status(400).json({ error: "Name required." });
      if (!em.includes("@")) return res.status(400).json({ error: "Valid email required." });
      if (addr.length < 6) return res.status(400).json({ error: "Address required." });

      const n = parse4DigitNumber(guess);
      if (n == null) return res.status(400).json({ error: "Invalid AMOE number. Must be 0000–9999." });

      const recv = receivedAt ? Number(receivedAt) : nowMs();
      const { ref: stateRef, state } = await getOrInitAmoeState();

      const status = String(state.status || "COLLECTING");
      if (status === "RESOLVED") {
        return res.status(400).json({ error: "AMOE cycle is resolved. Reset cycle to start again." });
      }

      const cycleId = Number(state.cycleId || 1);

      const dupeSnap = await db()
        .collection("amoeEntries")
        .doc(String(cycleId))
        .collection("items")
        .where("emailLower", "==", em)
        .limit(1)
        .get();

      if (!dupeSnap.empty) {
        return res.status(400).json({
          error: "An AMOE entry already exists for this email in the current cycle.",
        });
      }

      const entryDoc = await db()
        .collection("amoeEntries")
        .doc(String(cycleId))
        .collection("items")
        .add({
          name: nm,
          email: em,
          emailLower: em,
          address: addr,
          guess: normalizeNumber(n, 4),
          receivedAt: recv,
          timestamp: recv,
          createdAt: nowMs(),
        });

      // Mirror into ACTIVE contest pool (this is what makes it “claim” a number)
      const active = await ensureActiveContestNow();
      if (active?.id) {
        await db()
          .collection("entries")
          .doc(active.id)
          .collection("items")
          .add({
            paid: false,
            status: "AMOE",
            source: "AMOE",
            isAmoe: true,
            countedInContest: true,

            name: nm,
            email: em,
            address: addr,

            username: nm,
            guess: normalizeNumber(n, 4),

            timestamp: recv,
            createdAt: nowMs(),
            amoeCycleId: cycleId,
            amoeEntryId: entryDoc.id,
          });
      }

      const nextCount = Number(state.count || 0) + 1;

      const patch = {
        count: nextCount,
        status: "COLLECTING",
        updatedAt: nowMs(),
        prizeCents: Number(state.prizeCents || AMOE_PRIZE_CENTS),
      };

      await stateRef.set(patch, { merge: true });

      await auditLog(
        "admin_amoe_add",
        { cycleId, entryId: entryDoc.id, email: em, guess: normalizeNumber(n, 4), count: nextCount },
        req
      );

      return res.json({
        ok: true,
        cycleId,
        entryId: entryDoc.id,
        count: nextCount,
        status: "COLLECTING",
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to add AMOE entry." });
    }
  }
);

async function computeAmoeWinner({ targetNumber }) {
  const { ref: stateRef, state } = await getOrInitAmoeState();
  const cycleId = Number(state.cycleId || 1);

  const target = parse4DigitNumber(targetNumber);
  if (target == null) throw new Error("Invalid target. Must be 0000–9999.");

  const entriesSnap = await db().collection("amoeEntries").doc(String(cycleId)).collection("items").get();
  if (entriesSnap.empty) throw new Error("No AMOE entries.");

  let winner = null;
  let count = 0;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    count += 1;

    const guessNum = parse4DigitNumber(e.guess);
    if (guessNum == null) return;

    const diff = absDiff(guessNum, target);
    const ts = Number(e.timestamp || 0) || 0;

    if (!winner || diff < winner.diff || (diff === winner.diff && ts < Number(winner.timestamp || 0))) {
      winner = { id: doc.id, ...e, diff, timestamp: ts };
    }
  });

  if (!winner) throw new Error("No AMOE winner computed.");

  return { stateRef, state, cycleId, targetNorm: normalizeNumber(target, 4), winner, count };
}

r.post(
  "/api/admin/amoe/preview",
  requireAdmin,
  rateLimit({ routeKey: "admin_amoe_preview", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { targetNumber } = req.body || {};
      const r0 = await computeAmoeWinner({ targetNumber });

      return res.json({
        ok: true,
        cycleId: r0.cycleId,
        target: r0.targetNorm,
        entryCount: r0.count,
        prizeCents: Number(r0.state.prizeCents || AMOE_PRIZE_CENTS),
        winnerName: r0.winner.name,
        winnerEmail: r0.winner.email,
        guess: r0.winner.guess,
        diff: r0.winner.diff,
        entryTimestamp: r0.winner.timestamp,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message || "AMOE preview failed." });
    }
  }
);

r.post(
  "/api/admin/amoe/resolve",
  requireAdmin,
  rateLimit({ routeKey: "admin_amoe_resolve", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { targetNumber } = req.body || {};
      const r0 = await computeAmoeWinner({ targetNumber });

      const record = {
        cycleId: r0.cycleId,
        target: r0.targetNorm,
        prizeCents: Number(r0.state.prizeCents || AMOE_PRIZE_CENTS),
        winnerName: r0.winner.name,
        winnerEmail: r0.winner.email,
        winnerAddress: r0.winner.address,
        guess: r0.winner.guess,
        diff: r0.winner.diff,
        entryTimestamp: r0.winner.timestamp,
        resolvedAt: nowMs(),
        entryCount: r0.count,
      };

      await db().collection("amoeWinners").add(record);
      await trimByResolvedAt("amoeWinners", HISTORY_LIMIT);

      await r0.stateRef.set(
        {
          status: "RESOLVED",
          resolvedAt: record.resolvedAt,
          targetNumber: record.target,
          updatedAt: nowMs(),
        },
        { merge: true }
      );

      await auditLog(
        "admin_amoe_resolve",
        { cycleId: r0.cycleId, target: record.target, prizeCents: record.prizeCents },
        req
      );

      return res.json({ ok: true, ...record });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to resolve AMOE." });
    }
  }
);

r.post(
  "/api/admin/amoe/reset-cycle",
  requireAdmin,
  rateLimit({ routeKey: "admin_amoe_reset_cycle", limit: 10, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { ref: stateRef, state } = await getOrInitAmoeState();
      const nextCycle = Number(state.cycleId || 1) + 1;

      await stateRef.set(
        {
          cycleId: nextCycle,
          status: "COLLECTING",
          count: 0,
          reachedAt: null,
          resolvedAt: null,
          targetNumber: null,
          prizeCents: AMOE_PRIZE_CENTS,
          updatedAt: nowMs(),
        },
        { merge: true }
      );

      await auditLog("admin_amoe_reset_cycle", { cycleId: nextCycle }, req);

      return res.json({ ok: true, cycleId: nextCycle });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to reset AMOE cycle." });
    }
  }
);

/* =========================================================
   ADMIN — EXPORTS (PAID + AMOE)
========================================================= */

r.post(
  "/api/admin/export/paid",
  requireAdmin,
  rateLimit({ routeKey: "admin_export_paid", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { contestId } = req.body || {};
      const id = pickContestIdOrLast(contestId);

      const contestSnap = await db().collection("contests").doc(id).get();
      if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

      const contest = contestSnap.data() || {};

      const entriesSnap = await db().collection("entries").doc(id).collection("items").get();
      const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const winnerSnap = await db()
        .collection("winners")
        .where("contestId", "==", id)
        .orderBy("resolvedAt", "desc")
        .limit(1)
        .get();

      const winner = winnerSnap.empty ? null : { id: winnerSnap.docs[0].id, ...winnerSnap.docs[0].data() };

      const guaranteed = Number(contest.guaranteedPrizeCents || 0);
      const bonus = Number(contest.bonusPrizeCents || 0);
      const finalPrize = Number(contest.finalPrizeCents || 0) || guaranteed + bonus;

      const payload = {
        kind: "PAID_EXPORT",
        exportedAt: nowMs(),
        contest: {
          id: contest.id || id,
          endsOn: contest.endsOn ?? null,
          cutoffAt: contest.cutoffAt ?? null,
          mode: "DAILY4",
          activatedAt: contest.activatedAt ?? null,
          resolved: !!contest.resolved,
          resolvedAt: contest.resolvedAt ?? null,
          targetNumber: contest.targetNumber ?? null,
          targets: contest.targets ?? {},
          projectedWinner: contest.projectedWinner ?? null,
          winner: contest.winner ?? null,
          resolvedBy: contest.resolvedBy ?? null,
          resolvedSlot: contest.resolvedSlot ?? null,
          entryCount: Number(contest.entryCount || 0),
          guaranteedPrizeCents: guaranteed,
          bonusPrizeCents: bonus,
          finalPrizeCents: finalPrize,
        },
        winner,
        entriesCountTotal: entries.length,
        entries,
      };

      await auditLog("admin_export_paid", { contestId: id, entries: entries.length }, req);

      return res.json({ ok: true, payload });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Export failed." });
    }
  }
);

r.post(
  "/api/admin/export/amoe",
  requireAdmin,
  rateLimit({ routeKey: "admin_export_amoe", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const { cycleId } = req.body || {};
      const { state } = await getOrInitAmoeState();
      const cid = cycleId ? String(cycleId) : String(state.cycleId || 1);

      const entriesSnap = await db().collection("amoeEntries").doc(cid).collection("items").get();
      const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const winnerSnap = await db()
        .collection("amoeWinners")
        .where("cycleId", "==", Number(cid))
        .orderBy("resolvedAt", "desc")
        .limit(1)
        .get();

      const winner = winnerSnap.empty ? null : { id: winnerSnap.docs[0].id, ...winnerSnap.docs[0].data() };

      const payload = {
        kind: "AMOE_EXPORT",
        exportedAt: nowMs(),
        cycleId: Number(cid),
        state: {
          cycleId: Number(state.cycleId || 1),
          status: state.status || "COLLECTING",
          count: Number(state.count || 0),
          reachedAt: state.reachedAt ?? null,
          resolvedAt: state.resolvedAt ?? null,
          targetNumber: state.targetNumber ?? null,
          prizeCents: Number(state.prizeCents || AMOE_PRIZE_CENTS),
          targetCount: AMOE_TARGET_COUNT,
        },
        winner,
        entriesCountTotal: entries.length,
        entries,
      };

      await auditLog("admin_export_amoe", { cycleId: Number(cid), entries: entries.length }, req);

      return res.json({ ok: true, payload });
    } catch (e) {
      return res.status(500).json({ error: e.message || "AMOE export failed." });
    }
  }
);

export default r;