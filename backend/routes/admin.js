// backend/routes/admin.js
import { Router } from "express";
import Stripe from "stripe";

import requireAdmin, { signAdminToken } from "../middleware/admin.js";
import rateLimit from "../middleware/rateLimit.js";

import { db, admin } from "../lib/firestore.js";
import { auditLog } from "../lib/audit.js";

import {
  ADMIN_CODE,
  ADMIN_TOKEN_SECRET,
  TOKEN_TTL_SECONDS,
  HISTORY_LIMIT,
  AMOE_TARGET_COUNT,
  AMOE_PRIZE_CENTS,
  MODES,
  STRIPE_SECRET_KEY,
} from "../lib/config.js";

import {
  onlyDigits,
  normalizeNumber,
  absDiff,
  nowMs,
} from "../lib/utils.js";

import {
  ensureActiveContestNow,
  getContestForEntryTime,
  mostRecentChicagoCutoffAtOrBefore,
  contestIdFromCutoffMs,
  getOrInitAmoeState,
} from "../lib/time.js";

const r = Router();

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

/* =========================================================
   HELPERS
========================================================= */

async function getPaidContestByIdOrLast(contestIdMaybe) {
  let id = String(contestIdMaybe || "").trim();
  if (!id) {
    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    id = contestIdFromCutoffMs(lastCutoff);
  }
  const ref = db().collection("contests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "No such contest.", contestId: id };
  return { ok: true, contest: snap.data() };
}

function isPaidEntryEligible(e) {
  if (!e) return false;
  if (!e.paid) return false;
  const s = String(e.status || "").toUpperCase();
  if (s === "REFUNDED" || s === "DISPUTED" || s === "EXPIRED") return false;
  return true;
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

      if (!ADMIN_TOKEN_SECRET) return res.status(500).json({ error: "ADMIN_TOKEN_SECRET not configured." });
      if (c !== ADMIN_CODE) return res.status(401).json({ error: "Unauthorized." });

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
   ADMIN — COMBINED STATE (PAID + AMOE)
========================================================= */

r.post("/api/admin/state", requireAdmin, async (req, res) => {
  try {
    const active = await ensureActiveContestNow();

    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    const lastId = contestIdFromCutoffMs(lastCutoff);

    const lastSnap = await db().collection("contests").doc(lastId).get();
    const lastContest = lastSnap.exists ? lastSnap.data() : null;

    const { state: amoeState } = await getOrInitAmoeState();

    // queued for active contest (paid but not activated at payment time)
    let queuedCount = 0;
    let queuedPrizeCents = 0;

    const activeEntriesSnap = await db().collection("entries").doc(active.id).collection("items").get();
    activeEntriesSnap.forEach((d) => {
      const e = d.data();
      if (e && e.paid && String(e.status || "").toUpperCase() === "QUEUED") {
        queuedCount += 1;
        queuedPrizeCents += 355;
      }
    });

    return res.json({
      ok: true,
      serverNow: nowMs(),
      activeContest: {
        ok: true,
        serverNow: nowMs(),
        id: active.id || null,
        mode: active.mode || "PICK3",
        cutoffAt: active.cutoffAt ?? null,
        endsOn: active.endsOn ?? null,
        resolved: !!active.resolved,
        resolvedAt: active.resolvedAt ?? null,
        targetNumber: active.targetNumber ?? null,
        entryCount: Number(active.entryCount || 0),
        prizeCents: Number(active.prizeCents || 0),
        activatedAt: active.activatedAt ?? null,
      },
      lastContest: lastContest
        ? {
            id: lastContest.id || lastId,
            mode: lastContest.mode || "PICK3",
            cutoffAt: lastContest.cutoffAt ?? null,
            endsOn: lastContest.endsOn ?? null,
            resolved: !!lastContest.resolved,
            resolvedAt: lastContest.resolvedAt ?? null,
            targetNumber: lastContest.targetNumber ?? null,
            entryCount: Number(lastContest.entryCount || 0),
            prizeCents: Number(lastContest.prizeCents || 0),
            activatedAt: lastContest.activatedAt ?? null,
          }
        : null,
      paid: {
        queuedCount,
        queuedPrizeCents,
      },
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
});

/* =========================================================
   ADMIN — MODE (PAID)
========================================================= */

r.post("/api/admin/mode", requireAdmin, async (req, res) => {
  try {
    const { mode } = req.body || {};
    const m = String(mode || "").toUpperCase();
    if (!MODES[m]) return res.status(400).json({ error: "Invalid mode." });

    const contest = await ensureActiveContestNow();
    await db().collection("contests").doc(contest.id).update({ mode: m });

    await auditLog("admin_mode", { contestId: contest.id, mode: m }, req);

    return res.json({ ok: true, mode: m, contestId: contest.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to set mode." });
  }
});

/* =========================================================
   ADMIN — PAID PREVIEW + RESOLVE
========================================================= */

async function computePaidWinner({ contestId, targetNumber }) {
  const contestRef = db().collection("contests").doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) throw new Error("No such contest.");

  const contest = contestSnap.data();
  const mode = MODES[contest.mode] || MODES.PICK3;

  const target = Number(onlyDigits(targetNumber));
  if (Number.isNaN(target) || target < mode.min || target > mode.max) throw new Error("Invalid target.");

  const entriesSnap = await db().collection("entries").doc(contestId).collection("items").get();
  if (entriesSnap.empty) throw new Error("No entries.");

  let eligibleCount = 0;
  let winner = null;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    if (!isPaidEntryEligible(e)) return;
    eligibleCount += 1;

    const diff = absDiff(e.guess, target);
    if (!winner || diff < winner.diff || (diff === winner.diff && Number(e.timestamp) < Number(winner.timestamp))) {
      winner = { ...e, diff };
    }
  });

  if (!winner) throw new Error("No eligible paid entries.");

  return {
    contest,
    mode,
    targetNorm: normalizeNumber(target, mode.digits),
    winner,
    eligibleCount,
    totalEntries: entriesSnap.size,
  };
}

r.post("/api/admin/paid/preview", requireAdmin, async (req, res) => {
  try {
    const { targetNumber, contestId } = req.body || {};
    const id = String(contestId || "").trim() || contestIdFromCutoffMs(mostRecentChicagoCutoffAtOrBefore(nowMs()));

    const r0 = await computePaidWinner({ contestId: id, targetNumber });

    return res.json({
      ok: true,
      contestId: id,
      endsOn: r0.contest.endsOn || null,
      mode: r0.contest.mode || "PICK3",
      target: r0.targetNorm,
      eligibleCount: r0.eligibleCount,
      totalEntries: r0.totalEntries,
      winnerUN: r0.winner.username,
      winnerUserId: r0.winner.userId || null,
      guess: r0.winner.guess,
      diff: r0.winner.diff,
      entryTimestamp: r0.winner.timestamp,
      prizeCents: Number(r0.contest.prizeCents || 0),
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Preview failed." });
  }
});

r.post("/api/admin/resolve", requireAdmin, async (req, res) => {
  try {
    const { targetNumber, contestId } = req.body || {};

    let id = String(contestId || "").trim();
    if (!id) {
      const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
      id = contestIdFromCutoffMs(lastCutoff);
    }

    const contestRef = db().collection("contests").doc(id);
    const contestSnap = await contestRef.get();
    if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

    const contest = contestSnap.data();
    if (contest.resolved) return res.status(400).json({ error: "Already resolved." });

    const r0 = await computePaidWinner({ contestId: id, targetNumber });

    const prizeCents = Number(contest.prizeCents || 0);

    const record = {
      contestId: contest.id,
      endsOn: contest.endsOn || null,
      mode: contest.mode,
      target: r0.targetNorm,
      winnerUN: r0.winner.username,
      winnerUserId: r0.winner.userId || null,
      guess: r0.winner.guess,
      diff: r0.winner.diff,
      prizeCents,
      resolvedAt: nowMs(),
      entryTimestamp: r0.winner.timestamp,
      eligibleCount: r0.eligibleCount,
      totalEntries: r0.totalEntries,
    };

    await db().collection("winners").add(record);

    // cap history
    const winnersSnap = await db().collection("winners").orderBy("resolvedAt", "desc").get();
    const batch = db().batch();
    winnersSnap.docs.slice(HISTORY_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await contestRef.update({
      resolved: true,
      resolvedAt: record.resolvedAt,
      targetNumber: record.target,
    });

    await auditLog("admin_resolve_paid", { contestId: contest.id, target: record.target, prizeCents }, req);

    return res.json(record);
  } catch (e) {
    return res.status(400).json({ error: e.message || "Failed to post results." });
  }
});

/* =========================================================
   ADMIN — PAID ACTIVATE (SUNDAY ACTION)
========================================================= */

r.post("/api/admin/paid/activate", requireAdmin, async (req, res) => {
  try {
    const contest = await getContestForEntryTime(nowMs()); // next cutoff contest
    const contestRef = db().collection("contests").doc(contest.id);
    const snap = await contestRef.get();
    if (!snap.exists) return res.status(400).json({ error: "Contest missing." });

    const c = snap.data();

    if (c.resolved) return res.status(400).json({ error: "Cannot activate a resolved contest." });
    if (c.activatedAt) {
      return res.json({ ok: true, contestId: contest.id, activatedAt: c.activatedAt });
    }

    const entriesSnap = await db().collection("entries").doc(contest.id).collection("items").get();
    let paidCount = 0;

    entriesSnap.forEach((d) => {
      const e = d.data();
      if (e && e.paid && isPaidEntryEligible(e)) paidCount += 1;
    });

    const patch = {
      activatedAt: nowMs(),
      entryCount: paidCount,
      prizeCents: paidCount * 355,
    };

    await contestRef.set(patch, { merge: true });

    // Convert QUEUED → PAID
    const batch = db().batch();
    entriesSnap.docs.forEach((d) => {
      const e = d.data();
      if (e && e.paid && String(e.status || "").toUpperCase() === "QUEUED") {
        batch.update(d.ref, { status: "PAID", activatedAt: nowMs() });
      }
    });
    await batch.commit();

    await auditLog("admin_paid_activate", { contestId: contest.id, paidCount }, req);

    return res.json({
      ok: true,
      contestId: contest.id,
      activatedAt: patch.activatedAt,
      entryCount: paidCount,
      prizeCents: patch.prizeCents,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to activate contest." });
  }
});

/**
 * Legacy endpoint used by older Admin UI.
 * Interpreted as: reset next contest ONLY if it has no entries.
 */
r.post("/api/admin/reset", requireAdmin, async (req, res) => {
  try {
    const contest = await getContestForEntryTime(nowMs());
    const snap = await db().collection("contests").doc(contest.id).get();
    if (!snap.exists) return res.json({ ok: true });

    const c = snap.data();
    if (c.entryCount && Number(c.entryCount) > 0) {
      return res.status(400).json({ error: "Cannot reset an active contest with entries." });
    }

    await db().collection("contests").doc(contest.id).set(
      {
        id: contest.id,
        mode: "PICK3",
        cutoffAt: contest.cutoffAt,
        endsOn: contest.endsOn,
        resolved: false,
        resolvedAt: null,
        entryCount: 0,
        targetNumber: null,
        prizeCents: 0,
        activatedAt: null,
        resetAt: nowMs(),
      },
      { merge: true }
    );

    await auditLog("admin_reset", { contestId: contest.id }, req);

    return res.json({ ok: true, contestId: contest.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to reset." });
  }
});

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

r.post("/api/admin/amoe/add", requireAdmin, async (req, res) => {
  try {
    const { name, email, address, guess, receivedAt } = req.body || {};

    const nm = cleanName(name);
    const em = cleanEmail(email);
    const addr = cleanAddr(address);

    if (nm.length < 2) return res.status(400).json({ error: "Name required." });
    if (!em.includes("@")) return res.status(400).json({ error: "Valid email required." });
    if (addr.length < 6) return res.status(400).json({ error: "Address required." });

    const digits = MODES.PICK3.digits;
    const n = Number(onlyDigits(guess));
    if (Number.isNaN(n) || n < 0 || n > 999) return res.status(400).json({ error: "Invalid AMOE number." });

    const recv = receivedAt ? Number(receivedAt) : nowMs();
    const { ref: stateRef, state } = await getOrInitAmoeState();

    const status = String(state.status || "COLLECTING");
    if (status === "RESOLVED") return res.status(400).json({ error: "AMOE cycle is resolved. Reset cycle to start again." });
    if (status === "READY") return res.status(400).json({ error: "AMOE is ready to resolve. Do not add more entries." });

    const cycleId = Number(state.cycleId || 1);

    const dupeSnap = await db()
      .collection("amoeEntries")
      .doc(String(cycleId))
      .collection("items")
      .where("emailLower", "==", em)
      .limit(1)
      .get();

    if (!dupeSnap.empty) {
      return res.status(400).json({ error: "An AMOE entry already exists for this email in the current cycle." });
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
        guess: normalizeNumber(n, digits),
        receivedAt: recv,
        timestamp: recv,
        createdAt: nowMs(),
      });

    const nextCount = Number(state.count || 0) + 1;
    const nextStatus = nextCount >= AMOE_TARGET_COUNT ? "READY" : "COLLECTING";

    const patch = {
      count: nextCount,
      status: nextStatus,
      updatedAt: nowMs(),
      prizeCents: Number(state.prizeCents || AMOE_PRIZE_CENTS),
    };

    if (nextStatus === "READY" && !state.reachedAt) patch.reachedAt = nowMs();

    await stateRef.set(patch, { merge: true });

    await auditLog(
      "admin_amoe_add",
      { cycleId, entryId: entryDoc.id, email: em, guess: normalizeNumber(n, digits), count: nextCount, status: nextStatus },
      req
    );

    return res.json({ ok: true, cycleId, entryId: entryDoc.id, count: nextCount, status: nextStatus });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to add AMOE entry." });
  }
});

async function computeAmoeWinner({ targetNumber }) {
  const { ref: stateRef, state } = await getOrInitAmoeState();
  const status = String(state.status || "COLLECTING");
  if (status !== "READY") throw new Error("AMOE is not ready to resolve yet.");

  const cycleId = Number(state.cycleId || 1);

  const target = Number(onlyDigits(targetNumber));
  if (Number.isNaN(target) || target < 0 || target > 999) throw new Error("Invalid target.");

  const entriesSnap = await db().collection("amoeEntries").doc(String(cycleId)).collection("items").get();
  if (entriesSnap.empty) throw new Error("No AMOE entries.");

  let winner = null;
  let count = 0;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    count += 1;

    const diff = absDiff(e.guess, target);
    if (!winner || diff < winner.diff || (diff === winner.diff && Number(e.timestamp) < Number(winner.timestamp))) {
      winner = { id: doc.id, ...e, diff };
    }
  });

  if (!winner) throw new Error("No AMOE winner computed.");

  return { stateRef, state, cycleId, targetNorm: normalizeNumber(target, 3), winner, count };
}

r.post("/api/admin/amoe/preview", requireAdmin, async (req, res) => {
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
});

r.post("/api/admin/amoe/resolve", requireAdmin, async (req, res) => {
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

    const winnersSnap = await db().collection("amoeWinners").orderBy("resolvedAt", "desc").get();
    const batch = db().batch();
    winnersSnap.docs.slice(HISTORY_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await r0.stateRef.set(
      {
        status: "RESOLVED",
        resolvedAt: record.resolvedAt,
        targetNumber: record.target,
        updatedAt: nowMs(),
      },
      { merge: true }
    );

    await auditLog("admin_amoe_resolve", { cycleId: r0.cycleId, target: record.target, prizeCents: record.prizeCents }, req);

    return res.json({ ok: true, ...record });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Failed to resolve AMOE." });
  }
});

r.post("/api/admin/amoe/reset-cycle", requireAdmin, async (req, res) => {
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
});

/* =========================================================
   ADMIN — EXPORTS (PAID + AMOE)
========================================================= */

r.post("/api/admin/export/paid", requireAdmin, async (req, res) => {
  try {
    const { contestId } = req.body || {};
    const id = String(contestId || "").trim() || contestIdFromCutoffMs(mostRecentChicagoCutoffAtOrBefore(nowMs()));

    const contestSnap = await db().collection("contests").doc(id).get();
    if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

    const contest = contestSnap.data();

    const entriesSnap = await db().collection("entries").doc(id).collection("items").get();
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const winnerSnap = await db()
      .collection("winners")
      .where("contestId", "==", id)
      .orderBy("resolvedAt", "desc")
      .limit(1)
      .get();

    const winner = winnerSnap.empty ? null : { id: winnerSnap.docs[0].id, ...winnerSnap.docs[0].data() };

    const payload = {
      kind: "PAID_EXPORT",
      exportedAt: nowMs(),
      contest: {
        id: contest.id || id,
        endsOn: contest.endsOn ?? null,
        cutoffAt: contest.cutoffAt ?? null,
        mode: contest.mode ?? "PICK3",
        activatedAt: contest.activatedAt ?? null,
        resolved: !!contest.resolved,
        resolvedAt: contest.resolvedAt ?? null,
        targetNumber: contest.targetNumber ?? null,
        entryCount: Number(contest.entryCount || 0),
        prizeCents: Number(contest.prizeCents || 0),
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
});

r.post("/api/admin/export/amoe", requireAdmin, async (req, res) => {
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
});

export default r;
