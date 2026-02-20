// backend/lib/time.js
import { db, admin } from "./firestore.js";
import {
  CHICAGO_TZ,
  CUTOFF_WEEKDAY_SHORT,
  CUTOFF_HOUR_24,
  CUTOFF_MINUTE,
  MODES,
  AMOE_PRIZE_CENTS,
} from "./config.js";
import { nowMs } from "./utils.js";

/* =========================================================
   TIME HELPERS (CHICAGO OFFICIAL TIME)
========================================================= */

// Cache formatter (big perf win vs recreating per call)
const CHICAGO_DTF = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TZ,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function normalizeChicagoParts(out) {
  // Some environments can emit "24" for midnight with hour12:false.
  // Normalize to "00" so numeric comparisons behave.
  if (out && out.hour === "24") out.hour = "00";
  return out;
}

export function chicagoParts(ms) {
  const parts = CHICAGO_DTF.formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return normalizeChicagoParts(out);
}

export function mmddyyyyFromCutoffMs(cutoffMs) {
  const p = chicagoParts(cutoffMs);
  return `${p.month}/${p.day}/${p.year}`;
}

export function contestIdFromCutoffMs(cutoffMs) {
  const p = chicagoParts(cutoffMs);
  return `${p.year}-${p.month}-${p.day}`;
}

function floorToMinute(ms) {
  return Math.floor(ms / 60000) * 60000;
}

/* =========================================================
   CUTOFF LOGIC
   NOTE: Make weekday matching resilient to config casing/format.
========================================================= */

function normWeekdayShort(x) {
  // Accept "Sat", "SAT", "Saturday", " saturday ", etc -> "sat"
  const s = String(x || "").trim().toLowerCase();
  if (!s) return "";
  return s.slice(0, 3);
}

function isCutoffMinute(parts) {
  return (
    normWeekdayShort(parts.weekday) === normWeekdayShort(CUTOFF_WEEKDAY_SHORT) &&
    Number(parts.hour) === Number(CUTOFF_HOUR_24) &&
    Number(parts.minute) === Number(CUTOFF_MINUTE)
  );
}

export function nextChicagoCutoffAfter(startMs) {
  // start searching from the *next* minute
  const start = floorToMinute(startMs) + 60000;
  const maxSteps = 14 * 24 * 60 + 5; // up to 2 weeks of minute scanning

  for (let i = 0; i < maxSteps; i++) {
    const ms = start + i * 60000;
    const p = chicagoParts(ms);
    if (isCutoffMinute(p)) return ms;
  }

  // Fallback: if config mismatch somehow, move ahead one week
  return startMs + 7 * 24 * 60 * 60 * 1000;
}

export function mostRecentChicagoCutoffAtOrBefore(endMs) {
  const end = floorToMinute(endMs);
  const maxSteps = 14 * 24 * 60 + 5;

  for (let i = 0; i < maxSteps; i++) {
    const ms = end - i * 60000;
    const p = chicagoParts(ms);
    if (isCutoffMinute(p)) return ms;
  }

  return endMs - 7 * 24 * 60 * 60 * 1000;
}

export function cutoffForEntryMs(entryMs) {
  return nextChicagoCutoffAfter(entryMs);
}

/* =========================================================
   PUBLIC PRIZE CONFIG (config/public)
   - Admin can set weeklyGuaranteedPrizeCents + weeklyBonusPrizeCents
========================================================= */

const PRIZE_MAX_CENTS = 1_000_000_00; // safety
function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

async function getWeeklyPrizeDefaults() {
  try {
    const snap = await db().collection("config").doc("public").get();
    const d = snap.exists ? snap.data() || {} : {};

    const g = clampInt(d.weeklyGuaranteedPrizeCents, 0, PRIZE_MAX_CENTS);
    const b = clampInt(d.weeklyBonusPrizeCents, 0, PRIZE_MAX_CENTS);

    return {
      guaranteedPrizeCents: g != null ? g : 10000, // $100
      bonusPrizeCents: b != null ? b : 0,
    };
  } catch {
    return { guaranteedPrizeCents: 10000, bonusPrizeCents: 0 };
  }
}

/* =========================================================
   CONTEST INITIALIZATION
========================================================= */

export async function ensureContestForCutoff(cutoffAtMs) {
  const contestId = contestIdFromCutoffMs(cutoffAtMs);
  const endsOn = mmddyyyyFromCutoffMs(cutoffAtMs);

  const contestRef = db().collection("contests").doc(contestId);
  const snap = await contestRef.get();

  if (!snap.exists) {
    const { guaranteedPrizeCents, bonusPrizeCents } = await getWeeklyPrizeDefaults();
    const finalPrizeCents = Number(guaranteedPrizeCents || 0) + Number(bonusPrizeCents || 0);

    await contestRef.set({
      id: contestId,
      mode: "DAILY4",

      cutoffAt: cutoffAtMs,
      endsOn,

      resolved: false,
      resolvedAt: null,

      // end semantics (4-target flow)
      resolvedBy: null, // "EXACT" | "CLOSEST"
      resolvedSlot: null, // 1..4
      winner: null, // snapshot winner for Reveal
      projectedWinner: null, // running best

      // targets state
      targets: {}, // { "1": {...}, "2": {...}, "3": {...}, "4": {...} }
      targetsUpdatedAt: null,

      // legacy compatibility
      targetNumber: null,

      entryCount: 0,

      guaranteedPrizeCents,
      bonusPrizeCents,
      finalPrizeCents,

      prizeUpdatedAt: nowMs(),

      // legacy / unused fields (kept if older clients expect them)
      drawResults: [],
      winnerId: null,

      activatedAt: null,
      createdAt: nowMs(),
    });

    return {
      id: contestId,
      mode: "DAILY4",
      cutoffAt: cutoffAtMs,
      endsOn,
      resolved: false,
      resolvedAt: null,
      entryCount: 0,
      guaranteedPrizeCents,
      bonusPrizeCents,
      finalPrizeCents,
      activatedAt: null,
    };
  }

  return snap.data();
}

/**
 * ✅ Active contest selection:
 * - Use the most-recent cutoff's contest while it is NOT resolved (this is the current live cycle).
 * - Only switch to the next cutoff's contest once the last one is resolved.
 *
 * This prevents "drifting" into a future contest and fixes "Contest unavailable" during a live cycle.
 */
export async function ensureActiveContestNow() {
  const now = nowMs();

  // 1) Prefer the most-recent cutoff contest (current cycle) if it's not resolved
  const lastCutoff = mostRecentChicagoCutoffAtOrBefore(now);
  const lastContest = await ensureContestForCutoff(lastCutoff);

  if (lastContest && !lastContest.resolved) {
    await db()
      .collection("contest")
      .doc("current")
      .set(
        {
          contestId: lastContest.id,
          cutoffAt: lastContest.cutoffAt,
          endsOn: lastContest.endsOn,
          mode: lastContest.mode || "DAILY4",
          updatedAt: now,
        },
        { merge: true }
      );

    if (!lastContest.activatedAt) {
      await db().collection("contests").doc(lastContest.id).set({ activatedAt: now }, { merge: true });
      return { ...lastContest, activatedAt: now };
    }

    return lastContest;
  }

  // 2) Otherwise, move to the next cutoff contest
  const nextCutoff = nextChicagoCutoffAfter(now);
  const nextContest = await ensureContestForCutoff(nextCutoff);

  await db()
    .collection("contest")
    .doc("current")
    .set(
      {
        contestId: nextContest.id,
        cutoffAt: nextContest.cutoffAt,
        endsOn: nextContest.endsOn,
        mode: nextContest.mode || "DAILY4",
        updatedAt: now,
      },
      { merge: true }
    );

  if (!nextContest.activatedAt) {
    await db().collection("contests").doc(nextContest.id).set({ activatedAt: now }, { merge: true });
    return { ...nextContest, activatedAt: now };
  }

  return nextContest;
}

export async function getContestForEntryTime(entryMs) {
  const cutoffAt = cutoffForEntryMs(entryMs);
  const contest = await ensureContestForCutoff(cutoffAt);

  await db()
    .collection("contest")
    .doc("current")
    .set(
      {
        contestId: contest.id,
        cutoffAt: contest.cutoffAt,
        endsOn: contest.endsOn,
        mode: contest.mode || "DAILY4",
        updatedAt: nowMs(),
      },
      { merge: true }
    );

  return contest;
}

export function safeContestForClient(contest) {
  if (!contest) return { serverNow: nowMs(), ok: false };

  return {
    ok: true,
    serverNow: nowMs(),
    id: contest.id || null,
    mode: contest.mode || "DAILY4",
    cutoffAt: contest.cutoffAt ?? null,
    endsOn: contest.endsOn ?? null,
    resolved: !!contest.resolved,
    resolvedAt: contest.resolvedAt ?? null,
    entryCount: Number(contest.entryCount || 0),
    guaranteedPrizeCents: Number(contest.guaranteedPrizeCents || 0),
    bonusPrizeCents: Number(contest.bonusPrizeCents || 0),
    finalPrizeCents: Number(contest.finalPrizeCents || 0),
    activatedAt: contest.activatedAt ?? null,
  };
}

/* =========================================================
   AMOE STATE INIT (UNCHANGED STRUCTURE)
========================================================= */

export async function getOrInitAmoeState() {
  const ref = db().collection("amoe").doc("state");
  const snap = await ref.get();
  if (snap.exists) return { ref, state: snap.data() };

  const init = {
    cycleId: 1,
    status: "COLLECTING",
    count: 0,
    reachedAt: null,
    resolvedAt: null,
    targetNumber: null,
    prizeCents: AMOE_PRIZE_CENTS,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };

  await ref.set(init);
  return { ref, state: init };
}

export { MODES, admin };