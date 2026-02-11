// backend/index.js
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
import adminRoutes from "./routes/admin.js";

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
   CORS
========================================================= */
function normalizeOrigin(o) {
  return String(o || "").trim().replace(/\/+$/, "");
}

const allowed = ALLOWED_ORIGINS.map(normalizeOrigin);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser clients / same-origin / server-to-server (Stripe webhooks won't use CORS anyway)
      if (!origin) return cb(null, true);

      const o = normalizeOrigin(origin);
      if (allowed.includes(o)) return cb(null, true);

      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Make preflights reliable (esp. with cookies)
app.options("*", cors());

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
// Do NOT wrap it with express.raw() again here.
app.use("/api/stripe/webhook", stripeWebhookRoutes());

// JSON + cookies for everything else
app.use(express.json());
app.use(cookieParser());

// Auth endpoints
app.use(authRoutes);

// Public
app.use(publicRoutes);

// Admin routes:
// - /api/admin/login must be reachable WITHOUT user session
// - all other admin endpoints enforce requireAdmin inside routes/admin.js
app.use(adminRoutes);

// Protected (user session required)
app.use(requireUser, checkoutRoutes);

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
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
