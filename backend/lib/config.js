// backend/lib/config.js
import crypto from "crypto";

export const PORT = process.env.PORT || 3001;

export const FRONTEND_URL = String(process.env.FRONTEND_URL || "").trim();
export const NODE_ENV = String(process.env.NODE_ENV || "development").trim();

// Stripe
export const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
export const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

// Session
export const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
export const SESSION_COOKIE = "sid";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Password reset
export const RESET_TTL_MS = 60 * 60 * 1000;

// Admin auth
export const ADMIN_CODE = String(process.env.ADMIN_CODE || "893889").trim();
export const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || "").trim();
export const TOKEN_TTL_SECONDS = 30 * 60;

// Timezone + cutoff rules
export const CHICAGO_TZ = "America/Chicago";
export const CUTOFF_WEEKDAY_SHORT = "Sat";
export const CUTOFF_HOUR_24 = Number(process.env.CUTOFF_HOUR_24 ?? 21);
export const CUTOFF_MINUTE = Number(process.env.CUTOFF_MINUTE ?? 30);

// Unpaid entry expiration
export const UNPAID_EXPIRE_MS = Number(process.env.UNPAID_EXPIRE_MS ?? 2 * 60 * 60 * 1000);

// Brand / descriptor
export const BRAND_NAME = String(process.env.BRAND_NAME || "DRAWNFRAY LLC").trim();

// AMOE
export const AMOE_TARGET_COUNT = Number(process.env.AMOE_TARGET_COUNT ?? 500);
export const AMOE_PRIZE_CENTS = Number(process.env.AMOE_PRIZE_CENTS ?? AMOE_TARGET_COUNT * 355);

// Contest constants
export const MODES = {
  PICK3: { min: 0, max: 999, digits: 3 },
  DAILY4: { min: 0, max: 9999, digits: 4 }, // DARK — READY
};

export const HISTORY_LIMIT = 52;

/* =========================================================
   CORS ORIGINS
========================================================= */

function buildCorsOrigins() {
  const origins = new Set();

  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:5173");
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");

  if (FRONTEND_URL) origins.add(FRONTEND_URL.replace(/\/+$/, ""));

  const extra = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  extra.forEach((o) => origins.add(o.replace(/\/+$/, "")));

  return Array.from(origins);
}

export const ALLOWED_ORIGINS = buildCorsOrigins();

/* =========================================================
   ID / KEYS
========================================================= */
export function randomHex(n = 32) {
  return crypto.randomBytes(n).toString("hex");
}
