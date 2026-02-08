// backend/index.js
import express from "express";
import cors from "cors";

import { NODE_ENV, PORT, ALLOWED_ORIGINS } from "./lib/config.js";
import { initFirestore } from "./lib/firestore.js";
import { ensureActiveContestNow, getOrInitAmoeState } from "./lib/time.js";

import healthRoutes from "./routes/health.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.js";
import requireUser from "./middleware/auth.js";
import publicRoutes from "./routes/public.js";
import myEntryRoutes from "./routes/myEntry.js";
import checkoutRoutes from "./routes/checkout.js";
import adminRoutes from "./routes/admin.js";

const app = express();

// Render/Proxy
app.set("trust proxy", 1);

/* =========================================================
   CORS
========================================================= */
app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser clients / same-origin
      if (!origin) return cb(null, true);

      const o = String(origin).replace(/\/+$/, "");
      if (ALLOWED_ORIGINS.includes(o)) return cb(null, true);

      // reject
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
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

// JSON for everything else
app.use(express.json());

// Public
app.use(publicRoutes);

// My entry (auth)
app.use(myEntryRoutes);

// Checkout (auth)
app.use(checkoutRoutes);

// Admin
app.use(adminRoutes);

/* =========================================================
   FALLBACKS
========================================================= */

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const msg = String(err?.message || "Server error.");
  // CORS errors, etc.
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
