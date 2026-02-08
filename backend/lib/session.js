// backend/lib/session.js
import { NODE_ENV, SESSION_COOKIE, SESSION_SECRET, SESSION_TTL_MS } from "./config.js";
import { b64urlJson, b64urlJsonParse, hmacSign, nowMs } from "./utils.js";

export function setSessionCookie(res, token) {
  const isProd = NODE_ENV === "production";
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

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
  if (sig !== expected) return null;

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
