// backend/routes/profileBootstrap.js
import { Router } from "express";
import { db } from "../lib/firestore.js";
import { ensureActiveContestNow } from "../lib/time.js";
import { onlyDigits, normalizeNumber, nowMs } from "../lib/utils.js";
import { MODES } from "../lib/config.js";

const r = Router();

/**
 * GET /api/profile-bootstrap
 * Protected (mounted under requireUser)
 * Returns: { ok, user, contest, entry, serverTimeMs }
 */
r.get("/api/profile-bootstrap", async (req, res) => {
  try {
    const userId = req?.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized." });

    // Contest (authoritative, consistent with the rest of the app)
    const contest = await ensureActiveContestNow();

    // User doc
    let user = { id: userId, username: "", email: "", phone: "" };
    try {
      const uSnap = await db().collection("users").doc(userId).get();
      if (uSnap.exists) {
        const u = uSnap.data() || {};
        user = {
          id: userId,
          username: String(u.username || ""),
          email: String(u.email || ""),
          phone: String(u.phone || ""),
        };
      }
    } catch {
      // keep minimal user
    }

    // Entry doc (for current contest)
    let entry = null;
    try {
      if (contest?.id) {
        const eSnap = await db()
          .collection("entries")
          .doc(String(contest.id))
          .collection("items")
          .doc(userId)
          .get();

        if (eSnap.exists) entry = eSnap.data() || null;
      }
    } catch {
      entry = null;
    }

    return res.json({
      ok: true,
      user,
      contest: contest || null,
      entry,
      serverTimeMs: nowMs(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load profile data." });
  }
});

/**
 * GET /api/guess-availability?guess=1234
 * Protected (mounted under requireUser)
 *
 * A number is "claimed" if an entry exists for the active contest where:
 * - guess == normalizedGuess
 * - countedInContest === true
 *
 * Returns:
 * {
 *   ok: true,
 *   contestId,
 *   guess,             // normalized
 *   available: boolean,
 *   claimedBySelf: boolean
 * }
 */
r.get("/api/guess-availability", async (req, res) => {
  try {
    const userId = req?.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized." });

    const contest = await ensureActiveContestNow();
    if (!contest?.id || contest.resolved) {
      return res.status(400).json({ ok: false, error: "Contest unavailable." });
    }

    const raw = String(req.query?.guess || "").trim();
    const digitsOnly = onlyDigits(raw);

    const mode = MODES.DAILY4 || MODES[contest.mode] || MODES.PICK3;
    if (digitsOnly.length !== Number(mode.digits)) {
      return res.json({
        ok: true,
        contestId: String(contest.id),
        guess: null,
        available: false,
        claimedBySelf: false,
        error: `Enter a ${mode.digits}-digit number.`,
      });
    }

    const n = Number(digitsOnly);
    if (!Number.isFinite(n) || n < mode.min || n > mode.max) {
      return res.json({
        ok: true,
        contestId: String(contest.id),
        guess: null,
        available: false,
        claimedBySelf: false,
        error: "Invalid number.",
      });
    }

    const guessNorm = normalizeNumber(n, mode.digits);

    // Check if someone has already CLAIMED this number (paid OR AMOE mirrored)
    // NOTE: This query may require an index depending on your Firestore rules/console.
    const snap = await db()
      .collection("entries")
      .doc(String(contest.id))
      .collection("items")
      .where("guess", "==", guessNorm)
      .where("countedInContest", "==", true)
      .limit(2)
      .get();

    if (snap.empty) {
      return res.json({
        ok: true,
        contestId: String(contest.id),
        guess: guessNorm,
        available: true,
        claimedBySelf: false,
      });
    }

    // If the only claimant is you, it’s “available” (because it’s yours)
    const docs = snap.docs;
    const onlySelf = docs.every((d) => d.id === String(userId));

    return res.json({
      ok: true,
      contestId: String(contest.id),
      guess: guessNorm,
      available: !!onlySelf,
      claimedBySelf: !!onlySelf,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Availability check failed." });
  }
});

export default r;
