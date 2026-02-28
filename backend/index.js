// backend/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { NODE_ENV, PORT, ALLOWED_ORIGINS } from "./lib/config.js";
import { initFirestore } from "./lib/firestore.js";
import { ensureActiveContestNow, getOrInitAmoeState } from "./lib/time.js";

import healthRoutes from "./routes/health.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.js";
import authRoutes from "./routes/auth.js";

import requireUser from "./middleware/auth.js";
import publicRoutes from "./routes/public.js";
import checkoutRoutes from "./routes/checkout.js";
import checkoutConfirmRoutes from "./routes/checkoutConfirm.js";
import adminRoutes from "./routes/admin.js";
import adminUsers from "./routes/adminUsers.js";

import profileBootstrapRoutes from "./routes/profileBootstrap.js";
import guessAvailabilityRoutes from "./routes/guessAvailability.js";
import quickPickRoutes from "./routes/quickPick.js";

const app = express();

// Render/Proxy
app.set("trust proxy", 1);

/* =========================================================
   LIGHT SECURITY HEADERS (no deps)
========================================================= */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

/* =========================================================
   NO-CACHE FOR LIVE STATE ENDPOINTS
========================================================= */
const NO_CACHE_PATHS = new Set([
  "/api/contest",
  "/api/reveal-state",
  "/api/winners",
  "/api/amoe/winners",
  "/api/round-summary",
  "/api/my-entry",
  "/api/profile-bootstrap",
  "/api/guess-availability",
  // (optional) admin state is live too
  "/api/admin/state",
]);

app.use((req, res, next) => {
  if (req.method === "GET" && NO_CACHE_PATHS.has(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  // Ensure Vary includes Origin (without duplicates)
  const prev = res.getHeader("Vary");
  const vary = Array.isArray(prev) ? prev.join(", ") : String(prev || "");
  if (!vary) res.setHeader("Vary", "Origin");
  else if (!vary.split(",").map((v) => v.trim()).includes("Origin")) {
    res.setHeader("Vary", `${vary}, Origin`);
  }

  next();
});

/* =========================================================
   CORS (cookies + Admin token header)
========================================================= */
function normalizeOrigin(o) {
  return String(o || "").trim().replace(/\/+$/, "");
}

// Build allowlist once
const allowed = (Array.isArray(ALLOWED_ORIGINS) ? ALLOWED_ORIGINS : [])
  .map(normalizeOrigin)
  .filter(Boolean);

const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOW_HEADERS =
  "Content-Type, Authorization, X-Admin-Token, x-admin-token, cache-control, pragma, expires";

/**
 * HARD STOP FIX:
 * Handle OPTIONS explicitly and ALWAYS include x-admin-token.
 * This prevents the cors() middleware (or a proxy) from replying with a stale allowlist.
 */
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (!origin) return res.sendStatus(204);

  const o = normalizeOrigin(origin);
  if (!allowed.includes(o)) {
    return res.status(403).send("CORS: Origin not allowed");
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);

  const essentials = [
    "content-type",
    "authorization",
    "x-admin-token",
    "cache-control",
    "pragma",
    "expires",
  ];

  const requested = String(req.headers["access-control-request-headers"] || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const merged = Array.from(new Set([...requested, ...essentials]));

  // Return in a conventional casing
  const allowHeaders = merged
    .map((h) =>
      h === "content-type"
        ? "Content-Type"
        : h === "authorization"
        ? "Authorization"
        : h === "x-admin-token"
        ? "X-Admin-Token"
        : h
    )
    .join(", ");

  res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  res.setHeader("Access-Control-Max-Age", "86400");
  return res.sendStatus(204);
});
// Normal CORS for non-OPTIONS requests
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server
      const o = normalizeOrigin(origin);
      if (allowed.includes(o)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Admin-Token",
      "x-admin-token",
      "cache-control",
      "pragma",
      "expires",
    ],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  })
);

/* =========================================================
   FIRESTORE INIT
========================================================= */
initFirestore();

/* =========================================================
   ROUTES
========================================================= */

// Health (no json needed)
app.use(healthRoutes);

// Stripe webhook MUST be mounted before express.json()
app.use("/api/stripe/webhook", stripeWebhookRoutes());

// JSON + cookies for everything else
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Auth endpoints
app.use(authRoutes);

// Public
app.use(publicRoutes);

// Admin routes
app.use(adminRoutes);
app.use(adminUsers);

// Protected (user session required)
app.use(requireUser, checkoutRoutes);
app.use(requireUser, checkoutConfirmRoutes);
app.use(requireUser, profileBootstrapRoutes);
app.use(requireUser, guessAvailabilityRoutes);

// ✅ Quick Pick MUST be protected too
app.use(requireUser, quickPickRoutes);

/* =========================================================
   FALLBACKS
========================================================= */

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const msg = String(err?.message || "Server error.");
  const status = msg.toLowerCase().includes("cors") ? 403 : 500;
  res.status(status).json({ error: msg });
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, async () => {
  try {
    await ensureActiveContestNow();
    await getOrInitAmoeState();
  } catch (e) {
    console.error("Boot init failed:", e?.message || e);
  }

  console.log(`Backend running on port ${PORT}`);
  console.log(`env=${NODE_ENV}`);
  console.log(`Allowed origins: ${(ALLOWED_ORIGINS || []).join(", ")}`);
});