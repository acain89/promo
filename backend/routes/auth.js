// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";

import { db } from "../lib/firestore.js";
import { nowMs, parseCookies } from "../lib/utils.js";
import { auditLog } from "../lib/audit.js";
import {
  makeSessionToken,
  readSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/session.js";

const r = express.Router();

/** Frontend expects GET /api/me */
r.get("/api/me", async (req, res) => {
  const cookies = req.cookies || parseCookies(req);
  const token = cookies.sid || ""; // SESSION_COOKIE is "sid" in config
  const sess = readSessionToken(token);
  if (!sess) return res.status(401).json({ error: "Unauthorized." });

  const uSnap = await db().collection("users").doc(sess.uid).get();
  if (!uSnap.exists) return res.status(401).json({ error: "Unauthorized." });

  const u = uSnap.data();
  return res.json({
    ok: true,
    user: { id: sess.uid, email: u.email || null, username: u.username || null },
  });
});

/** Frontend expects POST /api/auth/signup */
r.post("/api/auth/signup", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Missing fields." });
  }

  const existing = await db().collection("users").where("email", "==", email).limit(1).get();
  if (!existing.empty) return res.status(409).json({ error: "Email already in use." });

  const pwHash = await bcrypt.hash(password, 10);

  const userRef = db().collection("users").doc();
  await userRef.set({ username, email, pwHash, createdAt: nowMs() });

  const token = makeSessionToken({
    uid: userRef.id,
    exp: nowMs() + 7 * 24 * 60 * 60 * 1000,
  });

  setSessionCookie(res, token);

  await auditLog("auth_signup", { userId: userRef.id, email });

  return res.json({ ok: true, user: { id: userRef.id, username, email } });
});

/** Frontend expects POST /api/auth/login */
r.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Missing fields." });

  const snap = await db().collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return res.status(401).json({ error: "Invalid credentials." });

  const doc = snap.docs[0];
  const u = doc.data();

  const ok = await bcrypt.compare(password, String(u.pwHash || ""));
  if (!ok) return res.status(401).json({ error: "Invalid credentials." });

  const token = makeSessionToken({
    uid: doc.id,
    exp: nowMs() + 7 * 24 * 60 * 60 * 1000,
  });

  setSessionCookie(res, token);

  await auditLog("auth_login", { userId: doc.id, email });

  return res.json({
    ok: true,
    user: { id: doc.id, username: u.username || null, email: u.email || null },
  });
});

/** Frontend expects POST /api/auth/logout */
r.post("/api/auth/logout", async (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

export default r;
