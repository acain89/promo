// backend/lib/utils.js
import crypto from "crypto";

export function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

export function normalizeNumber(n, digits) {
  return String(n).padStart(digits, "0");
}

export function absDiff(a, b) {
  return Math.abs(Number(a) - Number(b));
}

export function nowMs() {
  return Date.now();
}

/* =========================================================
   BASE64URL + HMAC
========================================================= */

export function b64url(strOrBuf) {
  const b = Buffer.isBuffer(strOrBuf) ? strOrBuf : Buffer.from(String(strOrBuf), "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function b64urlJson(obj) {
  return b64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

export function b64urlJsonParse(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : "";
  return JSON.parse(Buffer.from(t + pad, "base64").toString("utf8"));
}

export function hmacSign(body, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(body).digest());
}

/* =========================================================
   COOKIES
========================================================= */

export function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function mmddyyyyFromCutoffMs(ms) {
  const d = new Date(Number(ms || 0));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}
