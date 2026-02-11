// backend/lib/session.js
import crypto from "crypto";
import { NODE_ENV, SESSION_COOKIE, SESSION_SECRET, SESSION_TTL_MS } from "./config.js";
import { b64urlJson, b64urlJsonParse, hmacSign, nowMs } from "./utils.js";

function safeEqual(a, b) {
  try {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function setSessionCookie(res, token) {
  const isProd = NODE_ENV === "production";
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

  // Cross-site cookie needed when frontend+backend are on different domains/origins.
  // In prod: Secure + SameSite=None is required for modern browsers.
  if (isProd) {
    cookie.push("Secure");
    cookie.push("SameSite=None");
  } else {
    cookie.push("SameSite=Lax");
  }

  res.setHeader("Set-Cookie", cookie.join("; "));
}

export function clearSessionCookie(res) {
  const isProd = NODE_ENV === "production";
  const cookie = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "Max-Age=0"];

  if (isProd) {
    cookie.push("Secure");
    cookie.push("SameSite=None");
  } else {
    cookie.push("SameSite=Lax");
  }

  res.setHeader("Set-Cookie", cookie.join("; "));
}

/* =========================================================
   SESSION TOKENS
========================================================= */

export function makeSessionToken(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET not configured.");
  const body = b64urlJson(payload);
  const sig = hmacSign(body, SESSION_SECRET);
  return `${body}.${sig}`;
}

export function readSessionToken(token) {
  if (!SESSION_SECRET) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = hmacSign(body, SESSION_SECRET);
  if (!safeEqual(sig, expected)) return null;

  let payload;
  try {
    payload = b64urlJsonParse(body);
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== "number" || typeof payload.uid !== "string") return null;
  if (nowMs() > payload.exp) return null;

  return payload;
}

/* =========================================================
   PASSWORD RESET TOKENS
   - Uses same signing secret as sessions (keeps env simple)
   - Different "typ" so session tokens can't be used as reset tokens
========================================================= */

export function makeResetToken(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET not configured.");

  const clean = {
    ...payload,
    typ: "reset",
    v: 1,
  };

  const body = b64urlJson(clean);
  const sig = hmacSign(body, SESSION_SECRET);
  return `${body}.${sig}`;
}

export function readResetToken(token) {
  if (!SESSION_SECRET) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = hmacSign(body, SESSION_SECRET);
  if (!safeEqual(sig, expected)) return null;

  let payload;
  try {
    payload = b64urlJsonParse(body);
  } catch {
    return null;
  }

  // must be a reset token
  if (!payload || payload.typ !== "reset") return null;
  if (typeof payload.exp !== "number" || typeof payload.uid !== "string") return null;
  if (nowMs() > payload.exp) return null;

  return payload;
}
