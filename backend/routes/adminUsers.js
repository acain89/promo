// backend/routes/adminUsers.js
import { Router } from "express";

import requireAdmin from "../middleware/admin.js";
import rateLimit from "../middleware/rateLimit.js";
import { db } from "../lib/firestore.js";

const r = Router();

function cleanUsername(raw) {
  return String(raw || "").trim();
}

async function findUserByUsername(unRaw) {
  const usernameLower = unRaw.toLowerCase();

  const q = await db()
    .collection("users")
    .where("usernameLower", "==", usernameLower)
    .limit(1)
    .get();

  if (q.empty) return null;

  const doc = q.docs[0];
  const data = doc.data() || {};
  return { id: doc.id, data };
}

/**
 * POST /api/admin/user-lookup
 * Body: { username: "Postman" }
 * Returns: { ok: true, user: { id, username, email, phone } }
 *
 * This matches what Admin.jsx expects.
 */
r.post(
  "/api/admin/user-lookup",
  requireAdmin,
  rateLimit({ routeKey: "admin_user_lookup", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const unRaw = cleanUsername(req.body?.username);
      if (!unRaw) return res.status(400).json({ ok: false, error: "Username required." });

      const found = await findUserByUsername(unRaw);
      if (!found) return res.json({ ok: false, error: "User not found." });

      const { id, data } = found;

      return res.json({
        ok: true,
        user: {
          id,
          username: data.username || unRaw,
          email: data.email || "",
          phone: data.phone || "",
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "Lookup failed." });
    }
  }
);

/**
 * POST /api/admin/user-lookup-lite
 * Body: { username: "Postman" }
 * Returns: { ok: true, user: { id, username, email } }
 *
 * Kept for back-compat with any older UI calls.
 */
r.post(
  "/api/admin/user-lookup-lite",
  requireAdmin,
  rateLimit({ routeKey: "admin_user_lookup_lite", limit: 60, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      const unRaw = cleanUsername(req.body?.username);
      if (!unRaw) return res.status(400).json({ ok: false, error: "Username required." });

      const found = await findUserByUsername(unRaw);
      if (!found) return res.json({ ok: false, error: "User not found." });

      const { id, data } = found;

      return res.json({
        ok: true,
        user: {
          id,
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