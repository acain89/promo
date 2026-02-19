// backend/routes/guessAvailability.js
import { Router } from "express";

import requireUser from "../middleware/auth.js";
import { db } from "../lib/firestore.js";
import { ensureActiveContestNow } from "../lib/time.js";
import { onlyDigits, normalizeNumber } from "../lib/utils.js";

const r = Router();

function setNoCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

/**
 * GET /api/guess-availability?guess=0000
 *
 * Returns:
 *  { ok: true, contestId, guess, available: boolean, claimedBy: "PAID"|"AMOE"|null }
 *
 * Claim definition (MATCHES checkoutConfirm):
 * - A number is "claimed" ONLY if there exists an entry belonging to SOMEONE ELSE
 *   in the active contest with:
 *     guess == normalizedGuess AND countedInContest === true
 *   (covers PAID-confirmed + AMOE-inserted entries)
 *
 * Notes:
 * - Protected (requireUser) so random traffic can’t scrape availability.
 * - UI hint only; true enforcement still happens in checkoutConfirm transaction.
 */
r.get("/api/guess-availability", requireUser, async (req, res) => {
  try {
    setNoCache(res);

    const userId = String(req.user?.id || "").trim();
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized." });

    const raw = String(req.query.guess || "").trim();
    const d = onlyDigits(raw);
    if (d.length !== 4) {
      return res.status(400).json({ ok: false, error: "guess must be 4 digits." });
    }

    const guessNorm = normalizeNumber(Number(d), 4);

    const contest = await ensureActiveContestNow();
    if (!contest?.id) {
      return res.status(400).json({ ok: false, error: "Active contest not available." });
    }

    // If contest is resolved, availability is effectively closed.
    if (contest.resolved) {
      return res.json({
        ok: true,
        contestId: contest.id,
        guess: guessNorm,
        available: false,
        claimedBy: null,
        contestResolved: true,
      });
    }

    const col = db().collection("entries").doc(String(contest.id)).collection("items");

    // Pull a couple matches so we can ignore "self" and still detect "other"
    const snap = await col
      .where("guess", "==", guessNorm)
      .where("countedInContest", "==", true)
      .limit(5)
      .get();

    if (snap.empty) {
      return res.json({
        ok: true,
        contestId: contest.id,
        guess: guessNorm,
        available: true,
        claimedBy: null,
      });
    }

    // MATCH checkoutConfirm: claimed only if someone else has it
    const otherDoc = snap.docs.find((doc) => doc.id !== userId);

    if (!otherDoc) {
      // Only claimant is the current user (or duplicates are all self) -> available
      return res.json({
        ok: true,
        contestId: contest.id,
        guess: guessNorm,
        available: true,
        claimedBy: null,
      });
    }

    const e = otherDoc.data() || {};
    const src = String(e.source || (e.isAmoe ? "AMOE" : e.paid ? "PAID" : "") || "").toUpperCase();

    return res.json({
      ok: true,
      contestId: contest.id,
      guess: guessNorm,
      available: false,
      claimedBy: src === "AMOE" ? "AMOE" : "PAID",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to check availability." });
  }
});

export default r;
