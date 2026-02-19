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

export function chicagoParts(ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
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
  const parts = dtf.formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
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
    const d = snap.exists ? (snap.data() || {}) : {};

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
      resolvedBy: null,      // "EXACT" | "CLOSEST"
      resolvedSlot: null,    // 1..4
      winner: null,          // snapshot winner for Reveal
      projectedWinner: null, // running best

      // targets state
      targets: {},           // { "1": {...}, "2": {...}, "3": {...}, "4": {...} }
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

export async function ensureActiveContestNow() {
  const cutoffAt = cutoffForEntryMs(nowMs());
  const contest = await ensureContestForCutoff(cutoffAt);

  // NOTE: "contest/current" is fine as a pointer doc if you use it elsewhere.
  await db().collection("contest").doc("current").set(
    {
      contestId: contest.id,
      cutoffAt: contest.cutoffAt,
      endsOn: contest.endsOn,
      mode: contest.mode || "DAILY4",
      updatedAt: nowMs(),
    },
    { merge: true }
  );

  const ref = db().collection("contests").doc(contest.id);

  if (!contest.activatedAt) {
    const t = nowMs();
    await ref.set({ activatedAt: t }, { merge: true });
    return { ...contest, activatedAt: t };
  }

  return contest;
}

export async function getContestForEntryTime(entryMs) {
  const cutoffAt = cutoffForEntryMs(entryMs);
  const contest = await ensureContestForCutoff(cutoffAt);

  await db().collection("contest").doc("current").set(
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
