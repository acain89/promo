// backend/lib/config.js
import crypto from "crypto";

export const PORT = Number(process.env.PORT || 3001);

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

// Clamp cutoff inputs to avoid bad env values causing weird behavior
export const CUTOFF_HOUR_24 = Math.max(0, Math.min(23, Number(process.env.CUTOFF_HOUR_24 ?? 21)));
export const CUTOFF_MINUTE = Math.max(0, Math.min(59, Number(process.env.CUTOFF_MINUTE ?? 30)));

// Unpaid entry expiration
export const UNPAID_EXPIRE_MS = Number(process.env.UNPAID_EXPIRE_MS ?? 2 * 60 * 60 * 1000);

// Brand / descriptor
export const BRAND_NAME = String(process.env.BRAND_NAME || "drawnfray").trim();

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

function normalizeOrigin(o) {
  return String(o || "").trim().replace(/\/+$/, "");
}

// Accept common "domain only" forms and make them parseable
function coerceToOriginUrl(raw) {
  const s = normalizeOrigin(raw);
  if (!s) return "";
  // already has protocol
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  // if it's a bare domain like "drawnfray.com" or "www.drawnfray.com"
  // assume https in production-like setups
  return `https://${s}`;
}

function addWithWwwVariants(set, url) {
  const u0 = normalizeOrigin(url);
  if (!u0) return;

  const u = coerceToOriginUrl(u0);
  if (!u) return;

  set.add(normalizeOrigin(u));

  // If it's an https/http origin, add/remove www variant automatically.
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      const host = parsed.hostname;
      const baseHost = host.startsWith("www.") ? host.slice(4) : host;
      const wwwHost = `www.${baseHost}`;

      const baseUrl = `${parsed.protocol}//${baseHost}${parsed.port ? `:${parsed.port}` : ""}`;
      const wwwUrl = `${parsed.protocol}//${wwwHost}${parsed.port ? `:${parsed.port}` : ""}`;

      set.add(normalizeOrigin(baseUrl));
      set.add(normalizeOrigin(wwwUrl));
    }
  } catch {
    // ignore invalid URL formats
  }
}

function buildCorsOrigins() {
  const origins = new Set();

  // local dev
  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:5173");
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");

  // primary frontend (and www/non-www variants)
  if (FRONTEND_URL) addWithWwwVariants(origins, FRONTEND_URL);

  // extra origins (comma-separated)
  const extra = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  extra.forEach((o) => addWithWwwVariants(origins, o));

  return Array.from(origins).map(normalizeOrigin);
}

export const ALLOWED_ORIGINS = buildCorsOrigins();

/* =========================================================
   PRODUCTION SAFETY CHECKS (fail fast)
========================================================= */
if (NODE_ENV === "production") {
  const missing = [];
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!ADMIN_TOKEN_SECRET) missing.push("ADMIN_TOKEN_SECRET");

  // Stripe keys are required if you intend to take payments in production.
  // If you want to run a "no payments" build, set STRIPE_SECRET_KEY empty AND keep VITE_STRIPE_ENABLED=false on frontend.
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!FRONTEND_URL) missing.push("FRONTEND_URL");

  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}

/* =========================================================
   ID / KEYS
========================================================= */
export function randomHex(n = 32) {
  return crypto.randomBytes(n).toString("hex");
}
