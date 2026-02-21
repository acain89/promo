// backend/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

import { db } from "../lib/firestore.js";
import { nowMs, parseCookies } from "../lib/utils.js";
import { auditLog } from "../lib/audit.js";

import rateLimit from "../middleware/rateLimit.js";

import {
  makeSessionToken,
  readSessionToken,
  setSessionCookie,
  clearSessionCookie,
  makeResetToken,
  readResetToken,
} from "../lib/session.js";

import { SESSION_COOKIE, SESSION_TTL_MS, RESET_TTL_MS, NODE_ENV } from "../lib/config.js";

const r = express.Router();

function cleanUsername(s) {
  return String(s || "").trim();
}
function cleanEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function okUsername(un) {
  // simple + safe: 2–24 chars, letters/numbers/_ only
  return /^[a-zA-Z0-9_]{2,24}$/.test(un);
}

function okPassword(pw) {
  return String(pw || "").length >= 8;
}

/* =========================================================
   EMAIL (SMTP) — PASSWORD RESET
========================================================= */

function getFrontendUrl() {
  // Prefer env, but fallback to a sane default for local dev.
  const u = String(process.env.FRONTEND_URL || "").trim();
  return u ? u.replace(/\/+$/, "") : "http://localhost:5173";
}

function smtpEnabled() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function makeTransport() {
  // Create on demand to avoid startup crashes if env isn’t set.
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST || ""),
    port: Number.isFinite(port) ? port : 587,
    secure: port === 465, // true for 465, false for 587/STARTTLS
    auth: {
      user: String(process.env.SMTP_USER || ""),
      pass: String(process.env.SMTP_PASS || ""),
    },
  });
}

async function sendResetEmail({ toEmail, resetUrl }) {
  if (!smtpEnabled()) return { ok: false, reason: "SMTP not configured" };

  const transporter = makeTransport();

  const from = String(process.env.SMTP_FROM || "").trim();
  const subject = "Reset your drawnfray password";
  const text = `You requested a password reset for drawnfray.

Reset your password here:
${resetUrl}

This link expires in ${Math.round(RESET_TTL_MS / 60000)} minutes.
If you didn’t request this, you can ignore this email.`;

  const html = `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.45;">
    <h2 style="margin:0 0 10px;">Reset your drawnfray password</h2>
    <p style="margin:0 0 10px;">You requested a password reset.</p>
    <p style="margin:0 0 14px;">
      <a href="${resetUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;border:1px solid #ccc;">
        Reset Password
      </a>
    </p>
    <p style="margin:0 0 10px;color:#666;font-size:13px;">
      This link expires in ${Math.round(RESET_TTL_MS / 60000)} minutes.
      If you didn’t request this, you can ignore this email.
    </p>
    <p style="margin:0;color:#666;font-size:12px;">If the button doesn’t work, copy/paste this link:</p>
    <p style="margin:6px 0 0;font-size:12px;word-break:break-all;">${resetUrl}</p>
  </div>`;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });

  return { ok: true };
}

/** Frontend expects GET /api/me */
r.get("/api/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const cookies = req.cookies || parseCookies(req);
  const token = String(cookies[SESSION_COOKIE] || "").trim();
  const sess = readSessionToken(token);
  if (!sess) return res.status(401).json({ error: "Unauthorized." });

  const uSnap = await db().collection("users").doc(sess.uid).get();
  if (!uSnap.exists) return res.status(401).json({ error: "Unauthorized." });

  const u = uSnap.data() || {};
  return res.json({
    ok: true,
    user: { id: sess.uid, email: u.email || null, username: u.username || null },
  });
});

/** Frontend expects POST /api/auth/signup */
r.post(
  "/api/auth/signup",
  rateLimit({ routeKey: "signup", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    // Support both {username,email,password} and legacy {un,email,pw}
    const username = cleanUsername(req.body?.username ?? req.body?.un);
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password ?? req.body?.pw ?? "");

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing fields." });
    }

    if (!okUsername(username)) {
      return res.status(400).json({ error: "Invalid username." });
    }

    if (!email.includes("@")) {
      return res.status(400).json({ error: "Invalid email." });
    }

    if (!okPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    // enforce unique email + username
    const [byEmail, byUN] = await Promise.all([
      db().collection("users").where("email", "==", email).limit(1).get(),
      db().collection("users").where("usernameLower", "==", username.toLowerCase()).limit(1).get(),
    ]);

    if (!byEmail.empty) return res.status(409).json({ error: "Email already in use." });
    if (!byUN.empty) return res.status(409).json({ error: "Username already in use." });

    const pwHash = await bcrypt.hash(password, 10);

    const userRef = db().collection("users").doc();
    await userRef.set({
      username,
      usernameLower: username.toLowerCase(),
      email,
      pwHash,
      createdAt: nowMs(),
    });

    const token = makeSessionToken({
      uid: userRef.id,
      exp: nowMs() + SESSION_TTL_MS,
    });

    // ✅ prefer (req,res,token) so cookie flags are correct behind proxy
    setSessionCookie(req, res, token);

    await auditLog("auth_signup", { userId: userRef.id }, req);

    return res.json({ ok: true, user: { id: userRef.id, username, email } });
  }
);

/** Frontend expects POST /api/auth/login
 * Accepts username OR email.
 */
r.post(
  "/api/auth/login",
  rateLimit({ routeKey: "login", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const identifierRaw = String(req.body?.username ?? req.body?.un ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? req.body?.pw ?? "");

    if (!identifierRaw || !password) {
      return res.status(400).json({ error: "Missing fields." });
    }

    const isEmail = identifierRaw.includes("@");
    const identifier = isEmail ? cleanEmail(identifierRaw) : cleanUsername(identifierRaw);

    // If it's not an email, enforce username format
    if (!isEmail && !okUsername(identifier)) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const q = db().collection("users");
    const snap = isEmail
      ? await q.where("email", "==", identifier).limit(1).get()
      : await q.where("usernameLower", "==", identifier.toLowerCase()).limit(1).get();

    if (snap.empty) return res.status(401).json({ error: "Invalid credentials." });

    const doc = snap.docs[0];
    const u = doc.data() || {};

    const hash = String(u.pwHash || u.passwordHash || "");
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials." });

    const token = makeSessionToken({
      uid: doc.id,
      exp: nowMs() + SESSION_TTL_MS,
    });

    setSessionCookie(req, res, token);

    await auditLog("auth_login", { userId: doc.id }, req);

    return res.json({
      ok: true,
      user: { id: doc.id, username: u.username || null, email: u.email || null },
    });
  }
);

/** Frontend expects POST /api/auth/logout */
r.post("/api/auth/logout", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  clearSessionCookie(req, res);
  return res.json({ ok: true });
});

/* =========================================================
   PASSWORD RESET
   - Join.jsx calls POST /api/auth/forgot
   - Reset.jsx calls POST /api/auth/reset with { token, newPassword }
========================================================= */

/** POST /api/auth/forgot { email } -> always returns ok (no enumeration)
 * ✅ Now actually sends the email reset link.
 */
r.post(
  "/api/auth/forgot",
  rateLimit({ routeKey: "forgot", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const email = cleanEmail(req.body?.email);
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Enter a valid email." });
    }

    const frontend = getFrontendUrl();

    // Always respond ok (avoid enumeration)
    let devResetUrl = null;

    try {
      const snap = await db().collection("users").where("email", "==", email).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        const userId = doc.id;

        const token = makeResetToken({
          uid: userId,
          exp: nowMs() + RESET_TTL_MS,
        });

        const resetUrl = `${frontend}/reset?token=${encodeURIComponent(token)}`;
        devResetUrl = resetUrl;

        await db().collection("passwordResets").doc(userId).set(
          {
            createdAt: nowMs(),
            exp: nowMs() + RESET_TTL_MS,
            tokenHint: token.slice(0, 12),
            usedAt: null,
          },
          { merge: true }
        );

        // ✅ send email (best-effort)
        try {
          const sent = await sendResetEmail({ toEmail: email, resetUrl });
          await auditLog(
            "auth_forgot_issued",
            { userId, email, sent: !!sent?.ok, reason: sent?.ok ? null : sent?.reason || "unknown" },
            req
          );
        } catch (mailErr) {
          await auditLog(
            "auth_forgot_email_failed",
            { userId, email, error: String(mailErr?.message || mailErr || "mail_failed") },
            req
          );
        }
      }
    } catch {
      // swallow to prevent enumeration / timing differences
    }

    // In non-production, return the link to speed up testing.
    if (String(NODE_ENV || "").toLowerCase() !== "production") {
      return res.json({ ok: true, devResetUrl });
    }

    return res.json({ ok: true });
  }
);

/** POST /api/auth/reset */
r.post(
  "/api/auth/reset",
  rateLimit({ routeKey: "reset", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.newPassword ?? req.body?.password ?? "");

    if (!token) return res.status(400).json({ error: "Missing token." });
    if (!okPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const payload = readResetToken(token);
    if (!payload?.uid) return res.status(400).json({ error: "Invalid or expired token." });

    const userId = String(payload.uid);

    // ensure reset record exists and not used
    const ref = db().collection("passwordResets").doc(userId);
    const snap = await ref.get();

    if (!snap.exists) return res.status(400).json({ error: "Invalid or expired token." });

    const rec = snap.data() || {};
    if (rec.usedAt) return res.status(400).json({ error: "Reset link already used." });
    if (rec.exp && nowMs() > Number(rec.exp)) return res.status(400).json({ error: "Reset link expired." });

    const pwHash = await bcrypt.hash(password, 10);

    await db().runTransaction(async (tx) => {
      tx.update(db().collection("users").doc(userId), { pwHash, pwUpdatedAt: nowMs() });
      tx.set(ref, { usedAt: nowMs() }, { merge: true });
    });

    await auditLog("auth_reset_success", { userId }, req);

    // Log them in after reset
    const sessToken = makeSessionToken({
      uid: userId,
      exp: nowMs() + SESSION_TTL_MS,
    });

    setSessionCookie(req, res, sessToken);

    return res.json({ ok: true });
  }
);

export default r;