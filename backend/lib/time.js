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

function msFromParts(days, hours, minutes) {
  return ((days * 24 + hours) * 60 + minutes) * 60000;
}

/* =========================================================
   DEFAULT SCHEDULE
   - Close: Saturday 9:00 AM (cutoffAt)
   - Reopen: Saturday 10:30 PM (startMs)
   - Window is:
       startMs = cutoffAt - 6d 10h 30m
       endMs   = cutoffAt
========================================================= */

const DEFAULT_OPEN_WINDOW_MS = msFromParts(6, 10, 30); // 6d 10h 30m

function defaultStartMsFromCutoff(cutoffAtMs) {
  return Number(cutoffAtMs) - DEFAULT_OPEN_WINDOW_MS;
}

function defaultEndMsFromCutoff(cutoffAtMs) {
  return Number(cutoffAtMs);
}

/* =========================================================
   CUTOFF LOGIC
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
   REGISTRATION WINDOW (DEFAULT + MANUAL OVERRIDE)
========================================================= */

export function getRegistrationWindow(contest) {
  if (!contest) return { startMs: null, endMs: null, source: "none" };

  const manualEnabled = contest.manualWindowEnabled === true;
  const mStart = Number(contest.manualStartMs || 0);
  const mEnd = Number(contest.manualEndMs || 0);

  if (manualEnabled && Number.isFinite(mStart) && Number.isFinite(mEnd) && mStart > 0 && mEnd > mStart) {
    return { startMs: mStart, endMs: mEnd, source: "manual" };
  }

  const cutoffAt = Number(contest.cutoffAt || 0);
  if (!Number.isFinite(cutoffAt) || cutoffAt <= 0) return { startMs: null, endMs: null, source: "none" };

  // IMPORTANT:
  // If startMs/endMs were explicitly written on the contest doc (admin override),
  // use those directly. Otherwise use defaults derived from cutoff.
  const startMs = Number(contest.startMs || 0) || defaultStartMsFromCutoff(cutoffAt);
  const endMs = Number(contest.endMs || 0) || defaultEndMsFromCutoff(cutoffAt);

  return { startMs, endMs, source: contest.startMs || contest.endMs ? "explicit" : "default" };
}

export function isRegistrationOpenAt(contest, atMs) {
  const t = Number(atMs || 0);
  if (!contest) return false;
  if (contest.resolved) return false;

  const { startMs, endMs } = getRegistrationWindow(contest);
  if (!startMs || !endMs) return false;

  return t >= startMs && t < endMs;
}

export async function setManualRegistrationWindow(contestId, startMs, endMs, enabled) {
  const id = String(contestId || "").trim();
  if (!id) throw new Error("Missing contestId.");

  const ref = db().collection("contests").doc(id);

  if (!enabled) {
    await ref.set(
      {
        manualWindowEnabled: false,
        manualStartMs: null,
        manualEndMs: null,
        manualWindowUpdatedAt: nowMs(),
      },
      { merge: true }
    );
    return { ok: true, manualWindowEnabled: false };
  }

  const s = Number(startMs || 0);
  const e = Number(endMs || 0);

  if (!Number.isFinite(s) || !Number.isFinite(e) || s <= 0 || e <= s) {
    throw new Error("Invalid start/end.");
  }

  await ref.set(
    {
      manualWindowEnabled: true,
      manualStartMs: s,
      manualEndMs: e,
      manualWindowUpdatedAt: nowMs(),
    },
    { merge: true }
  );

  return { ok: true, manualWindowEnabled: true, manualStartMs: s, manualEndMs: e };
}

/* =========================================================
   PUBLIC PRIZE CONFIG (config/public)
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

  const defaultStartMs = defaultStartMsFromCutoff(cutoffAtMs);
  const defaultEndMs = defaultEndMsFromCutoff(cutoffAtMs);

  if (!snap.exists) {
    const { guaranteedPrizeCents, bonusPrizeCents } = await getWeeklyPrizeDefaults();
    const finalPrizeCents = Number(guaranteedPrizeCents || 0) + Number(bonusPrizeCents || 0);

    await contestRef.set({
      id: contestId,
      mode: "DAILY4",

      cutoffAt: cutoffAtMs,
      endsOn,

      // defaults
      startMs: defaultStartMs,
      endMs: defaultEndMs,

      // manual override fields (off by default)
      manualWindowEnabled: false,
      manualStartMs: null,
      manualEndMs: null,
      manualWindowUpdatedAt: null,

      resolved: false,
      resolvedAt: null,

      resolvedBy: null,
      resolvedSlot: null,
      winner: null,
      projectedWinner: null,

      targets: {},
      targetsUpdatedAt: null,

      targetNumber: null,

      entryCount: 0,

      guaranteedPrizeCents,
      bonusPrizeCents,
      finalPrizeCents,

      prizeUpdatedAt: nowMs(),

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
      startMs: defaultStartMs,
      endMs: defaultEndMs,
      resolved: false,
      resolvedAt: null,
      entryCount: 0,
      guaranteedPrizeCents,
      bonusPrizeCents,
      finalPrizeCents,
      activatedAt: null,
    };
  }

  // If contest exists, ensure startMs/endMs are present (do not overwrite explicit admin changes)
  const existing = snap.data() || {};
  const patch = {};
  if (!existing.startMs) patch.startMs = defaultStartMs;
  if (!existing.endMs) patch.endMs = defaultEndMs;

  if (Object.keys(patch).length) {
    await contestRef.set(patch, { merge: true });
    return { ...existing, ...patch };
  }

  return existing;
}

/* =========================================================
   ACTIVE CONTEST SELECTION (FIXED)
   ✅ Correct for your weekly flow:
   - Prefer contest/current ONLY if it is still active.
   - Otherwise: active contest is the one for the NEXT cutoff after now.
========================================================= */

const CURRENT_REF = () => db().collection("contest").doc("current");

// A contest is "still active" if:
// - not resolved
// - and it has an endMs/cutoffAt that is still in the future (with a small grace)
function isContestStillActive(contest, atMs) {
  if (!contest) return false;
  if (contest.resolved) return false;

  const t = Number(atMs || 0);
  const end = Number(contest.endMs || contest.cutoffAt || 0);

  // If we somehow have no end, don’t trust it.
  if (!Number.isFinite(end) || end <= 0) return false;

  // 2 minute grace for clock skew / race-y saves
  return t < end + 2 * 60 * 1000;
}

export async function ensureActiveContestNow() {
  const now = nowMs();

  // 0) If contest/current exists and points to a STILL-ACTIVE contest, use it.
  try {
    const curSnap = await CURRENT_REF().get();
    if (curSnap.exists) {
      const cur = curSnap.data() || {};
      const curId = String(cur.contestId || "").trim();

      if (curId) {
        const cSnap = await db().collection("contests").doc(curId).get();

        if (cSnap.exists) {
          const contest = { id: cSnap.id, ...(cSnap.data() || {}) };

          // ✅ NEW: do not trust contest/current if it’s expired or resolved
          if (isContestStillActive(contest, now)) {
            if (!contest.activatedAt) {
              await db().collection("contests").doc(contest.id).set({ activatedAt: now }, { merge: true });
              return { ...contest, activatedAt: now };
            }
            return contest;
          }
        }
      }
    }
  } catch {
    // ignore and fallback
  }

  // 1) Default rule: active contest is the one for the NEXT cutoff after now.
  const nextCutoff = nextChicagoCutoffAfter(now);
  const active = await ensureContestForCutoff(nextCutoff);

  // Persist pointer for consistency across servers/clients.
  await CURRENT_REF().set(
    {
      contestId: active.id,
      cutoffAt: active.cutoffAt,
      endsOn: active.endsOn,
      mode: active.mode || "DAILY4",
      updatedAt: now,
    },
    { merge: true }
  );

  if (!active.activatedAt) {
    await db().collection("contests").doc(active.id).set({ activatedAt: now }, { merge: true });
    return { ...active, activatedAt: now };
  }

  return active;
}

export async function getContestForEntryTime(entryMs) {
  const cutoffAt = cutoffForEntryMs(entryMs);
  const contest = await ensureContestForCutoff(cutoffAt);

  // IMPORTANT:
  // Do NOT write contest/current here. That can cause pointer drift and
  // make the UI “jump” between contests unexpectedly.
  return contest;
}

export function safeContestForClient(contest) {
  if (!contest) return { serverNow: nowMs(), ok: false };

  const win = getRegistrationWindow(contest);

  return {
    ok: true,
    serverNow: nowMs(),
    id: contest.id || null,
    mode: contest.mode || "DAILY4",
    cutoffAt: contest.cutoffAt ?? null,
    endsOn: contest.endsOn ?? null,

    startMs: win.startMs ?? null,
    endMs: win.endMs ?? null,
    windowSource: win.source,

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
   AMOE STATE INIT
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