
// backend/routes/public.js
import { Router } from "express";

import { db } from "../lib/firestore.js";
import {
  ensureActiveContestNow,
  mostRecentChicagoCutoffAtOrBefore,
  contestIdFromCutoffMs,
  mmddyyyyFromCutoffMs,
} from "../lib/time.js";
import { nowMs } from "../lib/utils.js";
import requireUser from "../middleware/auth.js";
import { STRIPE_SECRET_KEY, NODE_ENV } from "../lib/config.js";

const r = Router();

function paymentsEnabled() {
  // "Enabled" means Stripe is configured AND we're running production cookies/cors rules.
  return NODE_ENV === "production" && !!STRIPE_SECRET_KEY;
}

/* =========================================================
   PUBLIC — CONTEST STATE (ACTIVE CONTEST)
========================================================= */

r.get("/api/contest", async (req, res) => {
  try {
    const contest = await ensureActiveContestNow();
    if (!contest) return res.json({ ok: false, serverNow: nowMs() });

    return res.json({
      ok: true,
      serverNow: nowMs(),

      // Payment gating signal for the frontend
      paymentsEnabled: paymentsEnabled(),

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
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load contest." });
  }
});

/* =========================================================
   PUBLIC — WINNERS LIST (PAID)
========================================================= */

r.get("/api/winners", async (req, res) => {
  try {
    const HISTORY_LIMIT = 52;
    const snap = await db().collection("winners").orderBy("resolvedAt", "desc").limit(HISTORY_LIMIT).get();
    return res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch winners." });
  }
});

/* =========================================================
   PUBLIC — AMOE WINNERS LIST
========================================================= */

r.get("/api/amoe/winners", async (req, res) => {
  try {
    const HISTORY_LIMIT = 52;
    const snap = await db().collection("amoeWinners").orderBy("resolvedAt", "desc").limit(HISTORY_LIMIT).get();
    return res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch AMOE winners." });
  }
});

/* =========================================================
   PUBLIC — REVEAL STATE (MOST RECENT PAID CONTEST + AMOE)
   Returns the most recent paid contest (by last cutoff) + latest winner(s).
========================================================= */

r.get("/api/reveal-state", async (req, res) => {
  try {
    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    const paidId = contestIdFromCutoffMs(lastCutoff);

    const paidSnap = await db().collection("contests").doc(paidId).get();
    const paid = paidSnap.exists ? paidSnap.data() : null;

    const paidWinnerSnap = await db().collection("winners").orderBy("resolvedAt", "desc").limit(1).get();
    const paidWinner = paidWinnerSnap.empty
      ? null
      : { id: paidWinnerSnap.docs[0].id, ...paidWinnerSnap.docs[0].data() };

    const amoeStateSnap = await db().collection("amoe").doc("state").get();
    const amoeState = amoeStateSnap.exists ? amoeStateSnap.data() : null;

    const amoeWinnerSnap = await db().collection("amoeWinners").orderBy("resolvedAt", "desc").limit(1).get();
    const amoeWinner = amoeWinnerSnap.empty
      ? null
      : { id: amoeWinnerSnap.docs[0].id, ...amoeWinnerSnap.docs[0].data() };

    return res.json({
      ok: true,
      serverNow: nowMs(),

      // Optional: expose payment flag here too (helpful for Reveal page)
      paymentsEnabled: paymentsEnabled(),

      paid: paid
        ? {
            id: paid.id || paidId,
            mode: paid.mode || "PICK3",
            cutoffAt: paid.cutoffAt ?? null,
            endsOn: paid.endsOn ?? null,
            resolved: !!paid.resolved,
            resolvedAt: paid.resolvedAt ?? null,
            targetNumber: paid.targetNumber ?? null,
            prizeCents: Number(paid.prizeCents || 0),
          }
        : {
            id: paidId,
            mode: "PICK3",
            cutoffAt: lastCutoff,
            endsOn: mmddyyyyFromCutoffMs(lastCutoff),
            resolved: false,
            resolvedAt: null,
            targetNumber: null,
            prizeCents: 0,
          },
      paidWinner,
      amoe: amoeState
        ? {
            cycleId: amoeState.cycleId ?? 1,
            status: amoeState.status || "COLLECTING",
            count: Number(amoeState.count || 0),
            reachedAt: amoeState.reachedAt ?? null,
            resolvedAt: amoeState.resolvedAt ?? null,
            targetNumber: amoeState.targetNumber ?? null,
            prizeCents: Number(amoeState.prizeCents || 0),
          }
        : {
            cycleId: 1,
            status: "COLLECTING",
            count: 0,
            reachedAt: null,
            resolvedAt: null,
            targetNumber: null,
            prizeCents: 0,
          },
      amoeWinner,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load reveal state." });
  }
});

/* =========================================================
   MY ENTRY — AUTH REQUIRED
   Returns the requesting user's entry for the active contest.
========================================================= */

r.get("/api/my-entry", requireUser, async (req, res) => {
  try {
    const contest = await ensureActiveContestNow();
    if (!contest || !contest.id) return res.json({ ok: false });

    const doc = await db().collection("entries").doc(contest.id).collection("items").doc(req.user.id).get();
    if (!doc.exists) {
      return res.json({
        ok: false,
        contestEndsOn: contest.endsOn || null,
        contestId: contest.id,
        contestActivatedAt: contest.activatedAt ?? null,
      });
    }

    const e = doc.data();
    return res.json({
      ok: true,
      contestEndsOn: contest.endsOn || null,
      contestId: contest.id,
      contestActivatedAt: contest.activatedAt ?? null,
      entry: {
        username: e.username,
        guess: e.guess,
        timestamp: e.timestamp,
        type: e.type,
        paid: !!e.paid,
        status: e.status || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch entry." });
  }
});

/* =========================================================
   ENTRY (AMOE) — PUBLIC SELF-SERVE DISABLED (MAIL-IN ONLY)
   Return 403 to prevent client-side AMOE submissions.
========================================================= */

r.post("/api/entry", (req, res) => {
  return res.status(403).json({
    error: "AMOE is mail-in only. Mail-in entries are processed manually per the Official Rules.",
  });
});

export default r;
