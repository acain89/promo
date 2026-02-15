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

/**
 * Set session cookie.
 * Supports both call signatures:
 *   - setSessionCookie(res, token)            (legacy)
 *   - setSessionCookie(req, res, token)       (preferred; detects HTTPS via proxy)
 */
export function setSessionCookie(a, b, c) {
  // Determine signature
  const hasReq = a && typeof a === "object" && a.headers && typeof a.headers === "object";
  const res = hasReq ? b : a;
  const token = hasReq ? c : b;

  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  // Determine HTTPS behind proxy (Render sets x-forwarded-proto=https)
  const xfProto = String(hasReq ? a.headers["x-forwarded-proto"] : "").toLowerCase();
  const isHttps = xfProto === "https" || NODE_ENV === "production";

  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
  ];

  // Cross-site cookie needed when frontend+backend are on different domains.
  // Use Secure + SameSite=None whenever the request is HTTPS (or prod fallback).
  if (isHttps) {
    cookie.push("Secure");
    cookie.push("SameSite=None");
  } else {
    cookie.push("SameSite=Lax");
  }

  res.setHeader("Set-Cookie", cookie.join("; "));
}

/**
 * Clear session cookie.
 * Supports both call signatures:
 *   - clearSessionCookie(res)                 (legacy)
 *   - clearSessionCookie(req, res)            (preferred; detects HTTPS via proxy)
 */
export function clearSessionCookie(a, b) {
  const hasReq = a && typeof a === "object" && a.headers && typeof a.headers === "object";
  const res = hasReq ? b : a;

  const xfProto = String(hasReq ? a.headers["x-forwarded-proto"] : "").toLowerCase();
  const isHttps = xfProto === "https" || NODE_ENV === "production";

  const cookie = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "Max-Age=0"];

  if (isHttps) {
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
   - Uses same signing secret as sessions
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

  if (!payload || payload.typ !== "reset") return null;
  if (typeof payload.exp !== "number" || typeof payload.uid !== "string") return null;
  if (nowMs() > payload.exp) return null;

  return payload;
}
