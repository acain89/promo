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

export function nextChicagoCutoffAfter(startMs) {
  const start = floorToMinute(startMs) + 60000;
  const maxSteps = 14 * 24 * 60 + 5;
  for (let i = 0; i < maxSteps; i++) {
    const ms = start + i * 60000;
    const p = chicagoParts(ms);
    if (
      p.weekday === CUTOFF_WEEKDAY_SHORT &&
      Number(p.hour) === CUTOFF_HOUR_24 &&
      Number(p.minute) === CUTOFF_MINUTE
    ) {
      return ms;
    }
  }
  return startMs + 7 * 24 * 60 * 60 * 1000;
}

export function mostRecentChicagoCutoffAtOrBefore(endMs) {
  const end = floorToMinute(endMs);
  const maxSteps = 14 * 24 * 60 + 5;
  for (let i = 0; i < maxSteps; i++) {
    const ms = end - i * 60000;
    const p = chicagoParts(ms);
    if (
      p.weekday === CUTOFF_WEEKDAY_SHORT &&
      Number(p.hour) === CUTOFF_HOUR_24 &&
      Number(p.minute) === CUTOFF_MINUTE
    ) {
      return ms;
    }
  }
  return endMs - 7 * 24 * 60 * 60 * 1000;
}

export function cutoffForEntryMs(entryMs) {
  return nextChicagoCutoffAfter(entryMs);
}

export async function ensureContestForCutoff(cutoffAtMs) {
  const contestId = contestIdFromCutoffMs(cutoffAtMs);
  const endsOn = mmddyyyyFromCutoffMs(cutoffAtMs);

  const contestRef = db().collection("contests").doc(contestId);
  const snap = await contestRef.get();

  if (!snap.exists) {
    await contestRef.set({
      id: contestId,
      mode: "PICK3",
      cutoffAt: cutoffAtMs,
      endsOn,
      resolved: false,
      resolvedAt: null,
      entryCount: 0,
      targetNumber: null,
      prizeCents: 0,
      activatedAt: null,
      createdAt: nowMs(),
    });

    return {
      id: contestId,
      mode: "PICK3",
      cutoffAt: cutoffAtMs,
      endsOn,
      resolved: false,
      entryCount: 0,
      prizeCents: 0,
      activatedAt: null,
    };
  }

  const c = snap.data();
  if (!c.cutoffAt || Number(c.cutoffAt) !== Number(cutoffAtMs) || !c.endsOn) {
    await contestRef.update({ cutoffAt: cutoffAtMs, endsOn });
    return { ...c, cutoffAt: cutoffAtMs, endsOn };
  }

  return c;
}

export async function ensureActiveContestNow() {
  const cutoffAt = cutoffForEntryMs(nowMs());
  const contest = await ensureContestForCutoff(cutoffAt);

  await db().collection("contest").doc("current").set(
    {
      contestId: contest.id,
      cutoffAt: contest.cutoffAt,
      endsOn: contest.endsOn,
      mode: contest.mode || "PICK3",
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
      mode: contest.mode || "PICK3",
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
    mode: contest.mode || "PICK3",
    cutoffAt: contest.cutoffAt ?? null,
    endsOn: contest.endsOn ?? null,
    resolved: !!contest.resolved,
    resolvedAt: contest.resolvedAt ?? null,
    targetNumber: contest.targetNumber ?? null,
    entryCount: Number(contest.entryCount || 0),
    prizeCents: Number(contest.prizeCents || 0),
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
