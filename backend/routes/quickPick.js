// backend/routes/quickPick.js
import { Router } from "express";
import { db } from "../lib/firestore.js";
import { ensureActiveContestNow } from "../lib/time.js";
import { normalizeNumber, nowMs } from "../lib/utils.js";

const r = Router();

const MAX_QUICK_PICKS_PER_CONTEST = 10;
const MAX_ATTEMPTS = 600;

function randInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * POST /api/quick-pick
 * Returns: { ok:true, guess:"0123", remaining: 7 }
 *
 * Rules:
 * 1) Max 10 quick picks per user per contest (server enforced)
 * 2) Guess chosen uniformly at random from AVAILABLE numbers
 * 3) Does NOT claim/reserve the number (only returns suggestion)
 *
 * NOTE: This route assumes it is mounted under requireUser in backend/index.js:
 *   app.use(requireUser, quickPickRoutes);
 */
r.post("/api/quick-pick", async (req, res) => {
  try {
    const userId = String(req.user?.id || "").trim();
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized." });

    // If the contest is in dead zone, this will throw -> we return a friendly 403 below.
    const contest = await ensureActiveContestNow();
    const contestId = String(contest?.id || "").trim();
    if (!contestId) return res.status(500).json({ ok: false, error: "Contest unavailable." });

    const picksRef = db()
      .collection("users")
      .doc(userId)
      .collection("contestState")
      .doc(contestId);

    let used = 0;

    // Enforce 10 per contest per user, transaction-safe
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(picksRef);
      const data = snap.exists ? snap.data() : {};
      used = Number(data?.quickPickCount || 0);

      if (used >= MAX_QUICK_PICKS_PER_CONTEST) {
        const err = new Error("QUICK_PICK_LIMIT");
        err.code = "QUICK_PICK_LIMIT";
        throw err;
      }

      tx.set(
        picksRef,
        { quickPickCount: used + 1, updatedAt: nowMs() },
        { merge: true }
      );
    });

    // Random from available: rejection sampling against guessIndex
    let picked = null;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const n = randInt(10000);
      const guess = normalizeNumber(n, 4);

      const idxRef = db()
        .collection("entries")
        .doc(contestId)
        .collection("guessIndex")
        .doc(guess);

      const snap = await idxRef.get();
      if (!snap.exists) {
        picked = guess;
        break;
      }
    }

    if (!picked) {
      // Roll back count so a “no number found” doesn’t consume a pick.
      try {
        await db().runTransaction(async (tx) => {
          const snap = await tx.get(picksRef);
          const data = snap.exists ? snap.data() : {};
          const cur = Number(data?.quickPickCount || 0);
          tx.set(
            picksRef,
            { quickPickCount: Math.max(0, cur - 1), updatedAt: nowMs() },
            { merge: true }
          );
        });
      } catch {
        // ignore rollback failure
      }

      return res.status(409).json({ ok: false, error: "No available numbers right now. Try again." });
    }

    return res.json({
      ok: true,
      guess: picked,
      remaining: Math.max(0, MAX_QUICK_PICKS_PER_CONTEST - (used + 1)),
    });
  } catch (e) {
    if (e?.code === "QUICK_PICK_LIMIT" || String(e?.message || "") === "QUICK_PICK_LIMIT") {
      return res.status(429).json({ ok: false, error: "Quick Pick limit reached for this game (10)." });
    }

    // If ensureActiveContestNow rejects due to dead zone / window, fail friendly.
    // (We don't rely on brittle substring matching.)
    const msg = String(e?.message || "");
    if (msg) {
      // Most of your app already uses “window enforcement” wording.
      // Treat contest-resolution/window failures as 403.
      return res.status(403).json({ ok: false, error: "Entries are closed right now." });
    }

    console.error("quick-pick error:", e);
    return res.status(500).json({ ok: false, error: "Server error." });
  }
});

export default r;