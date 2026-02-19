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

r.get("/api/guess-availability", requireUser, async (req, res) => {
  try {
    setNoCache(res);

    const userId = String(req.user?.id || "").trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const raw = String(req.query.guess || "").trim();
    const digits = onlyDigits(raw);

    if (digits.length !== 4) {
      return res.status(400).json({ ok: false, error: "guess must be 4 digits." });
    }

    const guessNorm = normalizeNumber(Number(digits), 4);

    const contest = await ensureActiveContestNow();
    if (!contest?.id) {
      return res.status(400).json({ ok: false, error: "Active contest not available." });
    }

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

    const col = db()
      .collection("entries")
      .doc(String(contest.id))
      .collection("items");

    // 🔥 IMPORTANT: remove countedInContest filter from query
    // because missing fields break logic
    const snap = await col.where("guess", "==", guessNorm).limit(20).get();

    if (snap.empty) {
      return res.json({
        ok: true,
        contestId: contest.id,
        guess: guessNorm,
        available: true,
        claimedBy: null,
      });
    }

    // Only block if SOMEONE ELSE has countedInContest === true
    const otherDoc = snap.docs.find((doc) => {
      if (doc.id === userId) return false;
      const d = doc.data() || {};
      return d.countedInContest === true;
    });

    if (!otherDoc) {
      return res.json({
        ok: true,
        contestId: contest.id,
        guess: guessNorm,
        available: true,
        claimedBy: null,
      });
    }

    const e = otherDoc.data() || {};
    const src = String(
      e.source || (e.isAmoe ? "AMOE" : e.paid ? "PAID" : "")
    ).toUpperCase();

    return res.json({
      ok: true,
      contestId: contest.id,
      guess: guessNorm,
      available: false,
      claimedBy: src === "AMOE" ? "AMOE" : "PAID",
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to check availability.",
    });
  }
});

export default r;
