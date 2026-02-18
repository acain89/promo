// backend/middleware/admin.js
import crypto from "crypto";
import { ADMIN_TOKEN_SECRET } from "../lib/config.js";
import { b64urlJson, b64urlJsonParse, hmacSign, nowMs } from "../lib/utils.js";

export function signAdminToken(payload) {
  if (!ADMIN_TOKEN_SECRET) throw new Error("ADMIN_TOKEN_SECRET not configured.");
  const body = b64urlJson(payload);
  const sig = hmacSign(body, ADMIN_TOKEN_SECRET);
  return `${body}.${sig}`;
}

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

function verifyAdminToken(token) {
  if (!ADMIN_TOKEN_SECRET) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;

  const expected = hmacSign(body, ADMIN_TOKEN_SECRET);
  if (!safeEqual(sig, expected)) return null;

  let payload;
  try {
    payload = b64urlJsonParse(body);
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== "number") return null;
  if (nowMs() > payload.exp) return null;

  return payload;
}

export default function requireAdmin(req, res, next) {
  const auth = String(req.headers.authorization || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Unauthorized." });

  const payload = verifyAdminToken(m[1]);
  if (!payload) return res.status(401).json({ error: "Unauthorized." });

  req.admin = payload;
  next();
}
