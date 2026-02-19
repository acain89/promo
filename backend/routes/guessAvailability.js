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
    if (!userId) {
      return res.status(401).json({ ok: false });
    }

    const raw = String(req.query.guess || "").trim();
    const digits = onlyDigits(raw);
    if (digits.length !== 4) {
      return res.status(400).json({ ok: false });
    }

    const guessNorm = normalizeNumber(Number(digits), 4);

    const contest = await ensureActiveContestNow();
    if (!contest?.id) {
      return res.json({ ok: true, available: false });
    }

    const col = db()
      .collection("entries")
      .doc(String(contest.id))
      .collection("items");

    const snap = await col.where("guess", "==", guessNorm).get();

    if (snap.empty) {
      return res.json({
        ok: true,
        available: true,
      });
    }

    // If ANY OTHER user has this guess, it's taken
const taken = snap.docs.some((doc) => {
  const d = doc.data() || {};
  const owner =
    String(d.userId || d.uid || d.ownerId || doc.id || "").trim();

  return owner && owner !== userId;
});

    return res.json({
      ok: true,
      available: !taken,
    });

  } catch {
    return res.status(500).json({ ok: false });
  }
});

export default r;
