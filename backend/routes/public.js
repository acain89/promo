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

function setNoCache(res) {
  // prevent browser/proxy caching for live state endpoints (timer/state)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

// 1000-cell map is always 000–999 indexing (last 3 digits).
function norm3ToIndex(raw) {
  const d = onlyDigits(raw);
  if (!d) return null;
  const last3 = d.slice(-3);
  const n = Number(last3);
  if (!Number.isFinite(n) || n < 0 || n > 999) return null;
  return n;
}

function padN(rawOrNum, digits) {
  const d = onlyDigits(rawOrNum);
  if (!d) return null;
  return d.slice(-digits).padStart(digits, "0");
}

/**
 * Entries eligible for counting.
 * Prefer authoritative "countedInContest" when present.
 */
function isPaidEntryEligible(e) {
  if (!e) return false;
  if (!e.paid) return false;

  const s = String(e.status || "").toUpperCase();
  if (s === "REFUNDED" || s === "DISPUTED" || s === "EXPIRED") return false;

  if (typeof e.countedInContest === "boolean") {
    return e.countedInContest === true;
  }

  // Back-compat behavior:
  if (s === "QUEUED") return false;
  return true;
}

/* =========================================================
   PUBLIC — CONTEST STATE (ACTIVE CONTEST) — DAILY4 ONLY
========================================================= */

r.get("/api/contest", async (req, res) => {
  try {
    setNoCache(res);

    const contest = await ensureActiveContestNow();
    if (!contest) return res.json({ ok: false, serverNow: nowMs() });

    const entryCount = Number(contest.entryCount || 0);

    const guaranteedPrizeCents = Number(contest.guaranteedPrizeCents || 0);
    const bonusPrizeCents = Number(contest.bonusPrizeCents || 0);
    const finalPrizeCents =
      Number(contest.finalPrizeCents || 0) || guaranteedPrizeCents + bonusPrizeCents;

    // Landing headline text (lets Admin change copy without a frontend deploy)
    const prizeHeadline =
      String(contest.prizeHeadline || contest.headline || "").trim() ||
      "$100 guaranteed + bonus";

    return res.json({
      ok: true,
      serverNow: nowMs(),

      paymentsEnabled: paymentsEnabled(),

      id: contest.id || null,
      mode: "DAILY4",
      cutoffAt: contest.cutoffAt ?? null,
      endsOn: contest.endsOn ?? null,
      resolved: !!contest.resolved,
      resolvedAt: contest.resolvedAt ?? null,

      entryCount,
      playerCount: entryCount,

      guaranteedPrizeCents,
      bonusPrizeCents,
      finalPrizeCents,

      prizeHeadline,

      activatedAt: contest.activatedAt ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load contest." });
  }
});

/* =========================================================
   PUBLIC — ROUND SUMMARY (POST-GAME PICK MAP)
   Auth required. Only available AFTER contest is resolved.
   Returns 1000-count array: counts[0..999]
========================================================= */

r.get("/api/round-summary", requireUser, async (req, res) => {
  try {
    setNoCache(res);

    const contestId = String(req.query.contestId || "").trim();
    if (!contestId) return res.status(400).json({ error: "contestId required." });

    const contestSnap = await db().collection("contests").doc(contestId).get();
    if (!contestSnap.exists) return res.status(404).json({ error: "No such contest." });

    const contest = contestSnap.data() || {};

    // Do not expose pick distribution before results are posted.
    if (!contest.resolved) {
      return res.status(403).json({ error: "Round summary is available after results are posted." });
    }

    const digits = 4; // DAILY4 ONLY
    const counts = Array.from({ length: 1000 }, () => 0);

    const entriesSnap = await db().collection("entries").doc(contestId).collection("items").get();
    entriesSnap.forEach((d) => {
      const e = d.data() || {};
      if (!isPaidEntryEligible(e)) return;
      const idx = norm3ToIndex(e.guess);
      if (idx == null) return;
      counts[idx] += 1;
    });

    const winnerSnap = await db()
      .collection("winners")
      .where("contestId", "==", contestId)
      .orderBy("resolvedAt", "desc")
      .limit(1)
      .get();

    const winner = winnerSnap.empty ? null : winnerSnap.docs[0].data();

    const targetNumber = contest.targetNumber ? padN(contest.targetNumber, digits) : null;

    return res.json({
      ok: true,
      contestId,
      digits,
      targetNumber,
      winnerGuess: winner?.guess ? padN(winner.guess, digits) : null,
      counts,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load round summary." });
  }
});

/* =========================================================
   PUBLIC — WINNERS LIST (PAID)
========================================================= */

r.get("/api/winners", async (req, res) => {
  try {
    setNoCache(res);
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
    setNoCache(res);
    const HISTORY_LIMIT = 52;
    const snap = await db().collection("amoeWinners").orderBy("resolvedAt", "desc").limit(HISTORY_LIMIT).get();
    return res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch AMOE winners." });
  }
});

/* =========================================================
   PUBLIC — REVEAL STATE (MOST RECENT PAID CONTEST + AMOE)
========================================================= */

r.get("/api/reveal-state", async (req, res) => {
  try {
    setNoCache(res);

    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    const paidId = contestIdFromCutoffMs(lastCutoff);

    const paidSnap = await db().collection("contests").doc(paidId).get();
    const paid = paidSnap.exists ? paidSnap.data() : null;

    // IMPORTANT: pull winner for THIS contest (not just latest overall)
    const paidWinnerSnap = await db()
      .collection("winners")
      .where("contestId", "==", paidId)
      .orderBy("resolvedAt", "desc")
      .limit(1)
      .get();

    const paidWinner = paidWinnerSnap.empty
      ? null
      : { id: paidWinnerSnap.docs[0].id, ...paidWinnerSnap.docs[0].data() };

    const amoeStateSnap = await db().collection("amoe").doc("state").get();
    const amoeState = amoeStateSnap.exists ? amoeStateSnap.data() : null;

    const amoeWinnerSnap = await db().collection("amoeWinners").orderBy("resolvedAt", "desc").limit(1).get();
    const amoeWinner = amoeWinnerSnap.empty
      ? null
      : { id: amoeWinnerSnap.docs[0].id, ...amoeWinnerSnap.docs[0].data() };

    const paidGuaranteed = Number(paid?.guaranteedPrizeCents || 0);
    const paidBonus = Number(paid?.bonusPrizeCents || 0);
    const paidFinal = Number(paid?.finalPrizeCents || 0) || paidGuaranteed + paidBonus;

    return res.json({
      ok: true,
      serverNow: nowMs(),
      paymentsEnabled: paymentsEnabled(),

      paid: paid
        ? {
            id: paid.id || paidId,
            mode: "DAILY4",
            cutoffAt: paid.cutoffAt ?? null,
            endsOn: paid.endsOn ?? null,
            resolved: !!paid.resolved,
            resolvedAt: paid.resolvedAt ?? null,
            targetNumber: paid.targetNumber ?? null,

            guaranteedPrizeCents: paidGuaranteed,
            bonusPrizeCents: paidBonus,
            finalPrizeCents: paidFinal,

            prizeHeadline:
              String(paid.prizeHeadline || paid.headline || "").trim() || "$100 guaranteed + bonus",
          }
        : {
            id: paidId,
            mode: "DAILY4",
            cutoffAt: lastCutoff,
            endsOn: mmddyyyyFromCutoffMs(lastCutoff),
            resolved: false,
            resolvedAt: null,
            targetNumber: null,

            guaranteedPrizeCents: 0,
            bonusPrizeCents: 0,
            finalPrizeCents: 0,

            prizeHeadline: "$100 guaranteed + bonus",
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
========================================================= */

r.get("/api/my-entry", requireUser, async (req, res) => {
  try {
    setNoCache(res);

    const qContestId = String(req.query.contestId || "").trim();

    let contestId = "";
    let contestEndsOn = null;
    let contestActivatedAt = null;

    if (qContestId) {
      const cSnap = await db().collection("contests").doc(qContestId).get();
      if (!cSnap.exists) return res.status(404).json({ ok: false, error: "No such contest." });

      const c = cSnap.data() || {};
      contestId = qContestId;
      contestEndsOn = c.endsOn ?? null;
      contestActivatedAt = c.activatedAt ?? null;
    } else {
      const contest = await ensureActiveContestNow();
      if (!contest || !contest.id) return res.json({ ok: false });

      contestId = contest.id;
      contestEndsOn = contest.endsOn || null;
      contestActivatedAt = contest.activatedAt ?? null;
    }

    const doc = await db().collection("entries").doc(contestId).collection("items").doc(req.user.id).get();

    if (!doc.exists) {
      return res.json({
        ok: false,
        contestEndsOn,
        contestId,
        contestActivatedAt,
      });
    }

    const e = doc.data() || {};
    return res.json({
      ok: true,
      contestEndsOn,
      contestId,
      contestActivatedAt,
      entry: {
        username: e.username,
        guess: e.guess,
        timestamp: e.timestamp,
        type: e.type,
        paid: !!e.paid,
        status: e.status || null,
        countedInContest: typeof e.countedInContest === "boolean" ? e.countedInContest : undefined,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch entry." });
  }
});

/* =========================================================
   ENTRY (AMOE) — PUBLIC SELF-SERVE DISABLED (MAIL-IN ONLY)
========================================================= */

r.post("/api/entry", (req, res) => {
  setNoCache(res);
  return res.status(403).json({
    error: "AMOE is mail-in only. Mail-in entries are processed per the Official Rules.",
  });
});

export default r;
