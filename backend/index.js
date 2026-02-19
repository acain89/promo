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

// ✅ Add this if you created it
import profileBootstrapRoutes from "./routes/profileBootstrap.js";

const app = express();

// Render/Proxy
app.set("trust proxy", 1);

/* =========================================================
   LIGHT SECURITY HEADERS (no deps)
========================================================= */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // keep CSP out for now (easy to break Stripe/inline styles)
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

  // ✅ New single-call bootstrap endpoint for Profile
  "/api/profile-bootstrap",
]);

app.use((req, res, next) => {
  if (req.method === "GET" && NO_CACHE_PATHS.has(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  // helps caches handle CORS responses correctly
  const prev = res.getHeader("Vary");
  if (!prev) res.setHeader("Vary", "Origin");
  else if (!String(prev).includes("Origin")) res.setHeader("Vary", `${prev}, Origin`);

  next();
});

/* =========================================================
   CORS (cookies + Authorization for Admin)
========================================================= */
function normalizeOrigin(o) {
  return String(o || "").trim().replace(/\/+$/, "");
}

const allowed = (Array.isArray(ALLOWED_ORIGINS) ? ALLOWED_ORIGINS : [])
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // allow non-browser clients / same-origin / server-to-server
    if (!origin) return cb(null, true);

    const o = normalizeOrigin(origin);
    if (allowed.includes(o)) return cb(null, true);

    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,

  // Make preflight explicit and reliable for Admin bearer token + JSON
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "expires", "cache-control", "pragma"],

  exposedHeaders: [],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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
// NOTE: stripeWebhookRoutes() already uses express.raw() internally.
app.use("/api/stripe/webhook", stripeWebhookRoutes());

// JSON + cookies for everything else
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Auth endpoints
app.use(authRoutes);

// Public
app.use(publicRoutes);

// Admin routes (admin.js enforces requireAdmin internally except /api/admin/login)
app.use(adminRoutes);
app.use(adminUsers);

// Protected (user session required)
app.use(requireUser, checkoutRoutes);
app.use(requireUser, checkoutConfirmRoutes);
app.use(requireUser, profileBootstrapRoutes);

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
