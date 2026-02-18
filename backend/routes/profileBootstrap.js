// backend/routes/profileBootstrap.js
import { Router } from "express";
import { db } from "../lib/firestore.js";
import { ensureActiveContestNow } from "../lib/time.js";

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
      serverTimeMs: Date.now(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load profile data." });
  }
});

export default r;
