// backend/routes/guessAvailability.js
import { Router } from "express";
import requireUser from "../middleware/auth.js";
import { db } from "../lib/firestore.js";
import { ensureActiveContestNow } from "../lib/time.js";
import { onlyDigits, normalizeNumber } from "../lib/utils.js";

const r = Router();

r.get("/api/guess-availability", requireUser, async (req, res) => {
  try {
    const userId = String(req.user?.id || "").trim();
    if (!userId) return res.status(401).json({ ok: false });

    // Accept multiple param names (frontend variations)
    const raw = String(req.query.guess || req.query.num || req.query.value || "");
    const digits = onlyDigits(raw).slice(0, 4);

    // ✅ UI-safe: never 400 while user is typing / incomplete
    // Return "available:false" until exactly 4 digits exist (keeps existing UI behavior stable)
    if (digits.length !== 4) {
      return res.json({ ok: true, available: false, contestId: null, guess: null, claimedBySelf: false });
    }

    const guessNorm = normalizeNumber(Number(digits), 4);

    // ✅ UI-safe: if contest can't resolve, fail closed but don't 500/400
    let contest;
    try {
      contest = await ensureActiveContestNow();
    } catch {
      return res.json({ ok: true, available: false, contestId: null, guess: guessNorm, claimedBySelf: false });
    }

    if (!contest?.id) {
      return res.json({ ok: true, available: false, contestId: null, guess: guessNorm, claimedBySelf: false });
    }

    const col = db().collection("entries").doc(String(contest.id)).collection("items");

    // ✅ IMPORTANT: A number is only "claimed" if countedInContest === true
    // (covers PAID confirmed + AMOE mirrored entries)
    const snap = await col
      .where("guess", "==", guessNorm)
      .where("countedInContest", "==", true)
      .get();

    // No counted entries → available
    if (snap.empty) {
      return res.json({
        ok: true,
        contestId: String(contest.id),
        guess: guessNorm,
        available: true,
        claimedBySelf: false,
      });
    }

    // If a counted entry exists, check if it's claimed by the current user.
    // Your schema uses docId = userId for paid entries; AMOE mirrors use random doc ids.
    let claimedBySelf = false;
    let takenByOther = false;

    for (const doc of snap.docs) {
      if (doc.id === userId) {
        claimedBySelf = true;
        continue;
      }
      takenByOther = true;
      break;
    }

    return res.json({
      ok: true,
      contestId: String(contest.id),
      guess: guessNorm,
      available: !takenByOther,
      claimedBySelf,
    });
  } catch (e) {
    // ✅ Don’t break UI with 500 → fail closed with ok:false
    return res.status(200).json({ ok: false, available: false, error: e?.message || "error" });
  }
});

export default r;
