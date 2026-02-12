// backend/routes/adminUsers.js
import { Router } from "express";

import requireAdmin from "../middleware/admin.js";
import rateLimit from "../middleware/rateLimit.js";
import { db } from "../lib/firestore.js";

const r = Router();

/**
 * POST /api/admin/user-lookup
 * Body: { username: "Postman" }
 * Returns: { ok: true, user: { id, username, email } }
 */
r.post(
  "/api/admin/user-lookup",
  requireAdmin,
  rateLimit({ routeKey: "admin_user_lookup", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const unRaw = String(req.body?.username || "").trim();
      if (!unRaw) return res.status(400).json({ ok: false, error: "Username required." });

      const usernameLower = unRaw.toLowerCase();

      // ✅ IMPORTANT: db is a function in this codebase
      const q = await db()
        .collection("users")
        .where("usernameLower", "==", usernameLower)
        .limit(1)
        .get();

      if (q.empty) {
        return res.json({ ok: false, error: "User not found." });
      }

      const doc = q.docs[0];
      const data = doc.data() || {};

      return res.json({
        ok: true,
        user: {
          id: doc.id,
          username: data.username || unRaw,
          email: data.email || "",
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "Lookup failed." });
    }
  }
);

export default r;
