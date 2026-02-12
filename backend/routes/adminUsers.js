// backend/routes/adminUsers.js
import { Router } from "express";
import requireAdmin from "../middleware/admin.js";
import { db } from "../lib/firestore.js";

const r = Router();

/**
 * POST /api/admin/user-lookup
 * body: { username }
 */
r.post("/api/admin/user-lookup", requireAdmin, async (req, res) => {
  try {
    const raw = String(req.body?.username || "").trim();
    if (!raw) return res.status(400).json({ ok: false, error: "Username required." });

    const usernameLower = raw.toLowerCase();

    const snap = await db
      .collection("users")
      .where("usernameLower", "==", usernameLower)
      .limit(1)
      .get();

    if (snap.empty) return res.json({ ok: false, error: "User not found." });

    const doc = snap.docs[0];
    const data = doc.data() || {};

    return res.json({
      ok: true,
      user: {
        uid: doc.id,
        username: data.username || raw,
        email: data.email || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Lookup failed." });
  }
});

export default r;
