// backend/lib/audit.js
import { db } from "./firestore.js";
import { nowMs } from "./utils.js";

export function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.connection?.remoteAddress || "";
}

export function getUa(req) {
  return String(req.headers["user-agent"] || "");
}

export async function auditLog(type, data = {}, req = null) {
  try {
    const ip = req ? getClientIp(req) : null;
    const ua = req ? getUa(req) : null;
    await db().collection("auditLogs").add({
      type,
      ...data,
      ip,
      ua,
      ts: nowMs(),
    });
  } catch {
    // never break runtime
  }
}
