// backend/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import Stripe from "stripe";
import crypto from "crypto";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 3001;

const FRONTEND_URL = String(process.env.FRONTEND_URL || "").trim(); // https://your-frontend.onrender.com
const NODE_ENV = String(process.env.NODE_ENV || "development").trim();

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();

// Session
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Password reset
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// Render/Proxy
app.set("trust proxy", 1);

/* =========================================================
   CORS
========================================================= */

function buildCorsOrigins() {
  const origins = new Set();

  // local dev
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

const ALLOWED_ORIGINS = buildCorsOrigins();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const o = String(origin).replace(/\/+$/, "");
      if (ALLOWED_ORIGINS.includes(o)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* =========================================================
   FIRESTORE INIT (ADMIN SDK)
========================================================= */

if (!admin.apps.length) {
  const raw =
    process.env.FB_PRIVATE_KEY_B64
      ? Buffer.from(String(process.env.FB_PRIVATE_KEY_B64).trim(), "base64").toString("utf8")
      : String(process.env.FB_PRIVATE_KEY || "");

  const privateKey = raw
    .replace(/^"(.*)"$/s, "$1")
    .replace(/^'(.*)'$/s, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    throw new Error(
      "FB private key is not a valid PEM. " +
        `Got length=${privateKey.length}, startsWith="${privateKey.slice(0, 30)}"...`
    );
  }

  const projectId = String(process.env.FB_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FB_CLIENT_EMAIL || "").trim();
  if (!projectId || !clientEmail) {
    throw new Error("FB_PROJECT_ID and FB_CLIENT_EMAIL must be configured.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const db = admin.firestore();

/* =========================================================
   CONSTANTS
========================================================= */

const MODES = {
  PICK3: { min: 0, max: 999, digits: 3 },
  DAILY4: { min: 0, max: 9999, digits: 4 }, // DARK — READY
};

const HISTORY_LIMIT = 52;

// Admin auth
const ADMIN_CODE = String(process.env.ADMIN_CODE || "893889").trim();
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || "").trim();
const TOKEN_TTL_SECONDS = 30 * 60;

// Timezone + cutoff rules
const CHICAGO_TZ = "America/Chicago";
const CUTOFF_WEEKDAY_SHORT = "Sat";

// ✅ cutoff time configurable
const CUTOFF_HOUR_24 = Number(process.env.CUTOFF_HOUR_24 ?? 21); // 21 = 9 PM
const CUTOFF_MINUTE = Number(process.env.CUTOFF_MINUTE ?? 30); // 30 = :30

// ✅ Unpaid entry expiration
const UNPAID_EXPIRE_MS = Number(process.env.UNPAID_EXPIRE_MS ?? 2 * 60 * 60 * 1000); // 2 hours

// Stripe descriptor suffix best-effort
const BRAND_NAME = String(process.env.BRAND_NAME || "DRAWNFRAY LLC").trim();

/**
 * AMOE
 * - Separate pool
 * - Collected until AMOE_TARGET_COUNT reached
 * - Prize fixed to 500 paid entries worth: 500 * $3.55
 */
const AMOE_TARGET_COUNT = Number(process.env.AMOE_TARGET_COUNT ?? 500);
const AMOE_PRIZE_CENTS = Number(process.env.AMOE_PRIZE_CENTS ?? AMOE_TARGET_COUNT * 355);

/* =========================================================
   HELPERS
========================================================= */

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function normalizeNumber(n, digits) {
  return String(n).padStart(digits, "0");
}

function absDiff(a, b) {
  return Math.abs(Number(a) - Number(b));
}

function nowMs() {
  return Date.now();
}

function chicagoParts(ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

function mmddyyyyFromCutoffMs(cutoffMs) {
  const p = chicagoParts(cutoffMs);
  return `${p.month}/${p.day}/${p.year}`;
}

function contestIdFromCutoffMs(cutoffMs) {
  const p = chicagoParts(cutoffMs);
  return `${p.year}-${p.month}-${p.day}`;
}

function floorToMinute(ms) {
  return Math.floor(ms / 60000) * 60000;
}

/**
 * Find the next Saturday cutoff (America/Chicago) AFTER the given time.
 * Minute stepping (<= 14 days) avoids DST issues without extra deps.
 */
function nextChicagoCutoffAfter(startMs) {
  const start = floorToMinute(startMs) + 60000; // strictly after
  const maxSteps = 14 * 24 * 60 + 5;
  for (let i = 0; i < maxSteps; i++) {
    const ms = start + i * 60000;
    const p = chicagoParts(ms);
    if (
      p.weekday === CUTOFF_WEEKDAY_SHORT &&
      Number(p.hour) === CUTOFF_HOUR_24 &&
      Number(p.minute) === CUTOFF_MINUTE
    ) {
      return ms;
    }
  }
  return startMs + 7 * 24 * 60 * 60 * 1000;
}

function mostRecentChicagoCutoffAtOrBefore(endMs) {
  const end = floorToMinute(endMs);
  const maxSteps = 14 * 24 * 60 + 5;
  for (let i = 0; i < maxSteps; i++) {
    const ms = end - i * 60000;
    const p = chicagoParts(ms);
    if (
      p.weekday === CUTOFF_WEEKDAY_SHORT &&
      Number(p.hour) === CUTOFF_HOUR_24 &&
      Number(p.minute) === CUTOFF_MINUTE
    ) {
      return ms;
    }
  }
  return endMs - 7 * 24 * 60 * 60 * 1000;
}

/**
 * Contest selection:
 * - Each entry belongs to the next Saturday cutoff after entry timestamp.
 * - Entries after cutoff roll to the following week's contest automatically.
 */
function cutoffForEntryMs(entryMs) {
  return nextChicagoCutoffAfter(entryMs);
}

/**
 * Contest lifecycle:
 * - "active" contest exists immediately (next cutoff)
 * - BUT you wanted: entries after Saturday cutoff should NOT increase visible prize until Sunday reset.
 * We implement this by an "activatedAt" flag:
 * - When a contest is first created: activatedAt = now (if it is the CURRENT active contest)
 * - After the Saturday cutoff passes, the NEXT contest is created but remains NOT activated until admin triggers reset.
 * - Payments after cutoff for next contest are stored as entries, but do not increment contest.entryCount/prizeCents
 *   until activation (admin reset).
 */
async function ensureContestForCutoff(cutoffAtMs) {
  const contestId = contestIdFromCutoffMs(cutoffAtMs);
  const endsOn = mmddyyyyFromCutoffMs(cutoffAtMs);

  const contestRef = db.collection("contests").doc(contestId);
  const snap = await contestRef.get();

  if (!snap.exists) {
    // default: not activated until explicitly activated
    // We'll activate the "current active contest" on boot via ensureActiveContest().
    await contestRef.set({
      id: contestId,
      mode: "PICK3",
      cutoffAt: cutoffAtMs,
      endsOn,
      resolved: false,
      resolvedAt: null,
      entryCount: 0,
      targetNumber: null,
      prizeCents: 0,
      activatedAt: null,
      createdAt: nowMs(),
    });
    return {
      id: contestId,
      mode: "PICK3",
      cutoffAt: cutoffAtMs,
      endsOn,
      resolved: false,
      entryCount: 0,
      prizeCents: 0,
      activatedAt: null,
    };
  }

  const c = snap.data();
  if (!c.cutoffAt || Number(c.cutoffAt) !== Number(cutoffAtMs) || !c.endsOn) {
    await contestRef.update({
      cutoffAt: cutoffAtMs,
      endsOn,
    });
    return { ...c, cutoffAt: cutoffAtMs, endsOn };
  }

  return c;
}

async function ensureActiveContestNow() {
  const cutoffAt = cutoffForEntryMs(nowMs());
  const contest = await ensureContestForCutoff(cutoffAt);

  // pointer doc
  await db.collection("contest").doc("current").set(
    {
      contestId: contest.id,
      cutoffAt: contest.cutoffAt,
      endsOn: contest.endsOn,
      mode: contest.mode || "PICK3",
      updatedAt: nowMs(),
    },
    { merge: true }
  );

  // If this contest is not activated yet, activate it now.
  // This activation is what makes prize/entry totals "visible".
  const ref = db.collection("contests").doc(contest.id);
  if (!contest.activatedAt) {
    await ref.set({ activatedAt: nowMs() }, { merge: true });
    return { ...contest, activatedAt: nowMs() };
  }

  return contest;
}

async function getContestForEntryTime(entryMs) {
  const cutoffAt = cutoffForEntryMs(entryMs);
  const contest = await ensureContestForCutoff(cutoffAt);

  await db.collection("contest").doc("current").set(
    {
      contestId: contest.id,
      cutoffAt: contest.cutoffAt,
      endsOn: contest.endsOn,
      mode: contest.mode || "PICK3",
      updatedAt: nowMs(),
    },
    { merge: true }
  );

  return contest;
}

function safeContestForClient(contest) {
  if (!contest) return { serverNow: nowMs(), ok: false };

  return {
    ok: true,
    serverNow: nowMs(),
    id: contest.id || null,
    mode: contest.mode || "PICK3",
    cutoffAt: contest.cutoffAt ?? null,
    endsOn: contest.endsOn ?? null,
    resolved: !!contest.resolved,
    resolvedAt: contest.resolvedAt ?? null,
    targetNumber: contest.targetNumber ?? null,
    entryCount: Number(contest.entryCount || 0),
    prizeCents: Number(contest.prizeCents || 0),
    activatedAt: contest.activatedAt ?? null,
  };
}

function b64url(strOrBuf) {
  const b = Buffer.isBuffer(strOrBuf) ? strOrBuf : Buffer.from(String(strOrBuf), "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJson(obj) {
  return b64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

function b64urlJsonParse(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : "";
  return JSON.parse(Buffer.from(t + pad, "base64").toString("utf8"));
}

function hmacSign(body, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(body).digest());
}

function parseCookies(req) {
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

function setSessionCookie(res, token) {
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

function clearSessionCookie(res) {
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

function makeSessionToken(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET not configured.");
  const body = b64urlJson(payload);
  const sig = hmacSign(body, SESSION_SECRET);
  return `${body}.${sig}`;
}

function readSessionToken(token) {
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

async function getUserByUsernameLower(usernameLower) {
  const snap = await db.collection("users").where("usernameLower", "==", usernameLower).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getUserByEmailLower(emailLower) {
  const snap = await db.collection("users").where("emailLower", "==", emailLower).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

function requireUser(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE] || "";
    const sess = readSessionToken(token);
    if (!sess) return res.status(401).json({ error: "Unauthorized." });

    req.user = { id: sess.uid };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }
}

/* =========================================================
   IP / UA + AUDIT LOGS
========================================================= */

function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.connection?.remoteAddress || "";
}

function getUa(req) {
  return String(req.headers["user-agent"] || "");
}

async function auditLog(type, data = {}, req = null) {
  try {
    const ip = req ? getClientIp(req) : null;
    const ua = req ? getUa(req) : null;
    await db.collection("auditLogs").add({
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

/* =========================================================
   RATE LIMITING (simple in-memory)
========================================================= */

const rlState = new Map();
function rateLimit({ routeKey, limit, windowMs }) {
  return (req, res, next) => {
    try {
      const ip = getClientIp(req) || "unknown";
      const key = `${routeKey}:${ip}`;
      const now = nowMs();
      const cur = rlState.get(key);

      if (!cur || now > cur.resetAt) {
        rlState.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }

      cur.count += 1;
      if (cur.count > limit) {
        const retryAfterSec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Too many requests. Please try again shortly." });
      }

      rlState.set(key, cur);
      next();
    } catch {
      next();
    }
  };
}

/* =========================================================
   ADMIN TOKEN (HMAC)
========================================================= */

function signAdminToken(payload) {
  if (!ADMIN_TOKEN_SECRET) throw new Error("ADMIN_TOKEN_SECRET not configured.");
  const body = b64urlJson(payload);
  const sig = hmacSign(body, ADMIN_TOKEN_SECRET);
  return `${body}.${sig}`;
}

function verifyAdminToken(token) {
  if (!ADMIN_TOKEN_SECRET) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = hmacSign(body, ADMIN_TOKEN_SECRET);
  if (sig !== expected) return null;

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

function requireAdmin(req, res, next) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Unauthorized." });

  const payload = verifyAdminToken(m[1]);
  if (!payload) return res.status(401).json({ error: "Unauthorized." });

  next();
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    serverNow: nowMs(),
    cutoffHour: CUTOFF_HOUR_24,
    cutoffMinute: CUTOFF_MINUTE,
    tz: CHICAGO_TZ,
    amoeTarget: AMOE_TARGET_COUNT,
    amoePrizeCents: AMOE_PRIZE_CENTS,
  });
});

/* =========================================================
   STRIPE WEBHOOK (RAW BODY ONLY) — before express.json()
========================================================= */

async function updateEntryByPaymentIntent(paymentIntentId, patch, auditType, stripeObj) {
  if (!paymentIntentId) return;

  const snap = await db.collectionGroup("items").where("paymentIntentId", "==", String(paymentIntentId)).limit(20).get();
  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.update(doc.ref, patch));
  await batch.commit();

  for (const doc of snap.docs) {
    const contestId = doc.ref.parent?.parent?.id || null;
    const userId = doc.id || null;
    await auditLog(auditType, {
      contestId,
      userId,
      paymentIntentId: String(paymentIntentId),
      stripe: stripeObj ? { id: stripeObj.id || null, object: stripeObj.object || null } : null,
    });
  }
}

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe not configured.");
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Webhook secret not configured.");

  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // 1) PAID transition (Checkout)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const contestId = String(session.metadata?.contestId || "").trim();
      const userId = String(session.metadata?.userId || "").trim();

      if (!contestId || !userId) return res.json({ received: true });

      const entryRef = db.collection("entries").doc(contestId).collection("items").doc(userId);
      const contestRef = db.collection("contests").doc(contestId);

      await db.runTransaction(async (tx) => {
        const [entrySnap, contestSnap] = await Promise.all([tx.get(entryRef), tx.get(contestRef)]);
        if (!entrySnap.exists) return;
        if (!contestSnap.exists) return;

        const entry = entrySnap.data();
        const contest = contestSnap.data();

        const alreadyPaid = !!entry.paid;

        const paymentIntentId = session.payment_intent ? String(session.payment_intent) : null;
        const stripeSessionId = session.id ? String(session.id) : null;

        if (alreadyPaid) {
          const patch = {};
          if (!entry.stripeSessionId && stripeSessionId) patch.stripeSessionId = stripeSessionId;
          if (!entry.paymentIntentId && paymentIntentId) patch.paymentIntentId = paymentIntentId;
          if (Object.keys(patch).length) tx.update(entryRef, patch);
          return;
        }

        tx.update(entryRef, {
          paid: true,
          paidAt: nowMs(),
          status: "PAID",
          stripeSessionId,
          paymentIntentId,
        });

        // ✅ Prize increment rules:
        // - Only increment if contest is NOT resolved
        // - AND contest is activated (Sunday reset activates next contest)
        if (!contest.resolved && !!contest.activatedAt) {
          tx.update(contestRef, {
            entryCount: admin.firestore.FieldValue.increment(1),
            prizeCents: admin.firestore.FieldValue.increment(355), // $3.55 per paid entry
          });
        } else {
          // contest not activated yet => this paid entry is "queued" for next week
          tx.update(entryRef, { status: "QUEUED" });
        }
      });

      await auditLog("webhook_checkout_paid", {
        contestId,
        userId,
        stripeSessionId: session.id || null,
        paymentIntentId: session.payment_intent || null,
      });
    }

    // 2) Refunds
    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      const pi = charge.payment_intent ? String(charge.payment_intent) : null;

      await updateEntryByPaymentIntent(
        pi,
        {
          status: "REFUNDED",
          refundedAt: nowMs(),
          refundAmount: charge.amount_refunded ?? null,
          refundCurrency: charge.currency ?? null,
        },
        "webhook_charge_refunded",
        charge
      );
    }

    // 3) Disputes
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object;
      const chargeId = dispute.charge ? String(dispute.charge) : null;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        const pi = charge.payment_intent ? String(charge.payment_intent) : null;

        await updateEntryByPaymentIntent(
          pi,
          {
            status: "DISPUTED",
            disputedAt: nowMs(),
            disputeId: dispute.id || null,
            disputeReason: dispute.reason || null,
          },
          "webhook_dispute_created",
          dispute
        );
      }
    }

    if (event.type === "charge.dispute.closed") {
      const dispute = event.data.object;
      const chargeId = dispute.charge ? String(dispute.charge) : null;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        const pi = charge.payment_intent ? String(charge.payment_intent) : null;

        const finalStatus =
          dispute.status === "won" ? "PAID" : dispute.status === "lost" ? "REFUNDED" : "DISPUTE_CLOSED";

        await updateEntryByPaymentIntent(
          pi,
          {
            status: finalStatus,
            disputeClosedAt: nowMs(),
            disputeId: dispute.id || null,
            disputeStatus: dispute.status || null,
          },
          "webhook_dispute_closed",
          dispute
        );
      }
    }

    return res.json({ received: true });
  } catch {
    return res.json({ received: true });
  }
});

/* =========================================================
   JSON FOR ALL OTHER ROUTES
========================================================= */

app.use(express.json());

/* =========================================================
   AUTH
========================================================= */

app.post(
  "/api/auth/signup",
  rateLimit({ routeKey: "auth_signup", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET not configured." });

      const username = String(req.body?.username || "").trim();
      const email = String(req.body?.email || "").trim();
      const password = String(req.body?.password || "");

      if (username.length < 2 || username.length > 24) {
        return res.status(400).json({ error: "Username must be 2–24 characters." });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: "Username may contain letters, numbers, underscore only." });
      }
      if (!email.includes("@") || email.length > 254) {
        return res.status(400).json({ error: "Invalid email." });
      }
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: "Password must be 8–128 characters." });
      }

      const usernameLower = username.toLowerCase();
      const emailLower = email.toLowerCase();

      const [u1, e1] = await Promise.all([getUserByUsernameLower(usernameLower), getUserByEmailLower(emailLower)]);
      if (u1) return res.status(400).json({ error: "Username already in use." });
      if (e1) return res.status(400).json({ error: "Email already in use." });

      const passwordHash = await bcrypt.hash(password, 12);

      const doc = await db.collection("users").add({
        username,
        usernameLower,
        email,
        emailLower,
        passwordHash,
        createdAt: nowMs(),
      });

      const token = makeSessionToken({
        uid: doc.id,
        iat: nowMs(),
        exp: nowMs() + SESSION_TTL_MS,
      });
      setSessionCookie(res, token);

      await auditLog("auth_signup", { userId: doc.id, username }, req);

      return res.json({ ok: true, user: { id: doc.id, username, email } });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Signup failed." });
    }
  }
);

app.post(
  "/api/auth/login",
  rateLimit({ routeKey: "auth_login", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET not configured." });

      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");

      if (username.length < 2) return res.status(400).json({ error: "Invalid credentials." });
      if (!password) return res.status(400).json({ error: "Invalid credentials." });

      const user = await getUserByUsernameLower(username.toLowerCase());
      if (!user) return res.status(400).json({ error: "Invalid credentials." });

      const ok = await bcrypt.compare(password, String(user.passwordHash || ""));
      if (!ok) return res.status(400).json({ error: "Invalid credentials." });

      const token = makeSessionToken({
        uid: user.id,
        iat: nowMs(),
        exp: nowMs() + SESSION_TTL_MS,
      });
      setSessionCookie(res, token);

      await auditLog("auth_login", { userId: user.id, username: user.username }, req);

      return res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email } });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Login failed." });
    }
  }
);

app.post("/api/auth/logout", async (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE] || "";
  const sess = readSessionToken(token);
  if (!sess) return res.json({ ok: false });

  const userDoc = await db.collection("users").doc(sess.uid).get();
  if (!userDoc.exists) return res.json({ ok: false });

  const u = userDoc.data();
  return res.json({
    ok: true,
    user: { id: sess.uid, username: u.username, email: u.email },
  });
});

app.post("/api/auth/forgot", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!email.includes("@")) return res.status(400).json({ error: "Invalid email." });

    const user = await getUserByEmailLower(email.toLowerCase());
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await db.collection("passwordResets").add({
      userId: user.id,
      tokenHash,
      createdAt: nowMs(),
      expiresAt: nowMs() + RESET_TTL_MS,
      used: false,
    });

    const resetUrl = FRONTEND_URL ? `${FRONTEND_URL.replace(/\/+$/, "")}/reset?token=${token}` : "";

    if (NODE_ENV !== "production") return res.json({ ok: true, resetUrl });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed." });
  }
});

app.post("/api/auth/reset", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!token || token.length < 20) return res.status(400).json({ error: "Invalid token." });
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: "Password must be 8–128 characters." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const snap = await db.collection("passwordResets").where("tokenHash", "==", tokenHash).limit(1).get();
    if (snap.empty) return res.status(400).json({ error: "Invalid token." });

    const doc = snap.docs[0];
    const r = doc.data();

    if (r.used) return res.status(400).json({ error: "Token already used." });
    if (nowMs() > Number(r.expiresAt || 0)) return res.status(400).json({ error: "Token expired." });

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db.collection("users").doc(r.userId).update({ passwordHash });
    await doc.ref.update({ used: true, usedAt: nowMs() });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Reset failed." });
  }
});

/* =========================================================
   ADMIN — LOGIN (CODE -> TOKEN)
========================================================= */

app.post(
  "/api/admin/login",
  rateLimit({ routeKey: "admin_login", limit: 20, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    const { code } = req.body || {};
    const c = String(code || "").trim();

    if (!ADMIN_TOKEN_SECRET) return res.status(500).json({ error: "ADMIN_TOKEN_SECRET not configured." });
    if (c !== ADMIN_CODE) return res.status(401).json({ error: "Unauthorized." });

    const now = nowMs();
    const token = signAdminToken({
      v: 1,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS * 1000,
    });

    await auditLog("admin_login", { ok: true }, req);

    res.json({ token, expiresInSeconds: TOKEN_TTL_SECONDS });
  }
);

/* =========================================================
   PUBLIC — CONTEST STATE (ACTIVE CONTEST)
========================================================= */

app.get("/api/contest", async (req, res) => {
  // active contest is based on now()
  const contest = await ensureActiveContestNow();
  res.json(safeContestForClient(contest));
});

/* =========================================================
   PUBLIC — WINNERS LIST (PAID)
========================================================= */

app.get("/api/winners", async (req, res) => {
  const snap = await db.collection("winners").orderBy("resolvedAt", "desc").limit(HISTORY_LIMIT).get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

/* =========================================================
   PUBLIC — AMOE WINNERS LIST
========================================================= */

app.get("/api/amoe/winners", async (req, res) => {
  const snap = await db.collection("amoeWinners").orderBy("resolvedAt", "desc").limit(HISTORY_LIMIT).get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

/* =========================================================
   PUBLIC — REVEAL STATE (MOST RECENT PAID CONTEST + AMOE)
   This fixes the "endsOn" mismatch after cutoff.
========================================================= */

app.get("/api/reveal-state", async (req, res) => {
  const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
  const paidId = contestIdFromCutoffMs(lastCutoff);

  const paidSnap = await db.collection("contests").doc(paidId).get();
  const paid = paidSnap.exists ? paidSnap.data() : null;

  // most recent paid winner (if any)
  const paidWinnerSnap = await db.collection("winners").orderBy("resolvedAt", "desc").limit(1).get();
  const paidWinner = paidWinnerSnap.empty ? null : { id: paidWinnerSnap.docs[0].id, ...paidWinnerSnap.docs[0].data() };

  // AMOE state + most recent AMOE winner
  const amoeStateSnap = await db.collection("amoe").doc("state").get();
  const amoeState = amoeStateSnap.exists ? amoeStateSnap.data() : null;

  const amoeWinnerSnap = await db.collection("amoeWinners").orderBy("resolvedAt", "desc").limit(1).get();
  const amoeWinner = amoeWinnerSnap.empty ? null : { id: amoeWinnerSnap.docs[0].id, ...amoeWinnerSnap.docs[0].data() };

  res.json({
    ok: true,
    serverNow: nowMs(),
    paid: paid
      ? {
          id: paid.id || paidId,
          mode: paid.mode || "PICK3",
          cutoffAt: paid.cutoffAt ?? null,
          endsOn: paid.endsOn ?? null,
          resolved: !!paid.resolved,
          resolvedAt: paid.resolvedAt ?? null,
          targetNumber: paid.targetNumber ?? null,
          prizeCents: Number(paid.prizeCents || 0),
        }
      : {
          id: paidId,
          mode: "PICK3",
          cutoffAt: lastCutoff,
          endsOn: mmddyyyyFromCutoffMs(lastCutoff),
          resolved: false,
          resolvedAt: null,
          targetNumber: null,
          prizeCents: 0,
        },
    paidWinner,
    amoe: amoeState
      ? {
          cycleId: amoeState.cycleId ?? 1,
          status: amoeState.status || "COLLECTING",
          count: Number(amoeState.count || 0),
          reachedAt: amoeState.reachedAt ?? null,
          resolvedAt: amoeState.resolvedAt ?? null,
          targetNumber: amoeState.targetNumber ?? null,
          prizeCents: Number(amoeState.prizeCents || AMOE_PRIZE_CENTS),
        }
      : {
          cycleId: 1,
          status: "COLLECTING",
          count: 0,
          reachedAt: null,
          resolvedAt: null,
          targetNumber: null,
          prizeCents: AMOE_PRIZE_CENTS,
        },
    amoeWinner,
  });
});

/* =========================================================
   MY ENTRY — AUTH REQUIRED
========================================================= */

app.get("/api/my-entry", requireUser, async (req, res) => {
  const contest = await ensureActiveContestNow();
  if (!contest || !contest.id) return res.json({ ok: false });

  const doc = await db.collection("entries").doc(contest.id).collection("items").doc(req.user.id).get();
  if (!doc.exists) {
    return res.json({
      ok: false,
      contestEndsOn: contest.endsOn || null,
      contestId: contest.id,
      contestActivatedAt: contest.activatedAt ?? null,
    });
  }

  const e = doc.data();
  return res.json({
    ok: true,
    contestEndsOn: contest.endsOn || null,
    contestId: contest.id,
    contestActivatedAt: contest.activatedAt ?? null,
    entry: {
      username: e.username,
      guess: e.guess,
      timestamp: e.timestamp,
      type: e.type,
      paid: !!e.paid,
      status: e.status || null,
    },
  });
});

/* =========================================================
   ENTRY (AMOE) — PUBLIC SELF-SERVE DISABLED
========================================================= */

app.post("/api/entry", requireUser, async (req, res) => {
  return res.status(403).json({
    error: "AMOE is mail-in only. Mail-in entries are processed manually per the Official Rules.",
  });
});

/* =========================================================
   STRIPE CHECKOUT (PAID ENTRY) — AUTH REQUIRED
========================================================= */

app.post(
  "/api/checkout",
  requireUser,
  rateLimit({ routeKey: "checkout", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured." });
    if (!FRONTEND_URL) return res.status(500).json({ error: "FRONTEND_URL not configured." });

    const { guess } = req.body || {};

    const contest = await ensureActiveContestNow();
    if (!contest || contest.resolved) return res.status(400).json({ error: "Contest unavailable." });

    const mode = MODES[contest.mode] || MODES.PICK3;
    const n = Number(onlyDigits(guess));
    if (Number.isNaN(n) || n < mode.min || n > mode.max) {
      return res.status(400).json({ error: "Invalid number." });
    }

    const userDoc = await db.collection("users").doc(req.user.id).get();
    const username = userDoc.exists ? String(userDoc.data().username || "") : "";

    const entryRef = db.collection("entries").doc(contest.id).collection("items").doc(req.user.id);

    // One-entry enforcement + immutability anchor:
    // - Create once
    // - If unpaid and old, expire but do NOT allow guess changes
    let entry = null;
    const existingSnap = await entryRef.get();
    if (existingSnap.exists) {
      entry = existingSnap.data();

      if (entry.paid) {
        return res.status(400).json({ error: "You already entered this game." });
      }

      const age = nowMs() - Number(entry.timestamp || 0);
      const expiredAlready = entry.status === "EXPIRED";

      if (!expiredAlready && age > UNPAID_EXPIRE_MS) {
        await entryRef.update({ status: "EXPIRED", expiredAt: nowMs() });
        entry.status = "EXPIRED";
      }

      const lockedGuess = String(entry.guess || "");
      const requestedGuess = normalizeNumber(n, mode.digits);

      if (lockedGuess && requestedGuess !== lockedGuess) {
        return res.status(400).json({
          error: "An unpaid entry already exists. For integrity, the number cannot be changed. Please use the same number.",
        });
      }

      if (entry.status !== "EXPIRED") {
        return res.status(400).json({
          error: "Payment pending for your existing entry. Please complete checkout or try again after it expires.",
        });
      }

      await entryRef.update({
        status: "PENDING_PAYMENT",
        retryAt: nowMs(),
      });
    } else {
      try {
        await entryRef.create({
          userId: req.user.id,
          username,
          guess: normalizeNumber(n, mode.digits),
          timestamp: nowMs(),
          type: "PAID",
          paid: false,
          paidAt: null,
          status: "PENDING_PAYMENT",
          stripeSessionId: null,
          paymentIntentId: null,
        });
      } catch (e) {
        return res.status(400).json({ error: "You already entered this game." });
      }
    }

    const amoeText = "No purchase necessary. Mail-in AMOE available. One entry per person.";
    const productName = "Promotional Entry (Weekly)";

    const idempotencyKey = `checkout_${String(contest.id || "unknown")}_${String(req.user.id || "unknown")}`;

    const descriptorSuffix = String(BRAND_NAME || "")
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .slice(0, 22);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],

        payment_intent_data: descriptorSuffix
          ? {
              statement_descriptor_suffix: descriptorSuffix,
            }
          : undefined,

        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: productName,
              },
              unit_amount: 500,
            },
            quantity: 1,
          },
        ],

        metadata: {
          userId: req.user.id,
          contestId: String(contest.id || ""),
          contestEndsOn: String(contest.endsOn || ""),
          guess: String(n),
        },

        custom_text: {
          submit: {
            message: amoeText,
          },
        },

        success_url: `${FRONTEND_URL.replace(/\/+$/, "")}/profile?checkout=success`,
        cancel_url: `${FRONTEND_URL.replace(/\/+$/, "")}/profile?checkout=cancel`,
      },
      { idempotencyKey }
    );

    try {
      await entryRef.update({ stripeSessionId: String(session.id || "") });
    } catch {}

    await auditLog(
      "checkout_created",
      {
        contestId: contest.id,
        userId: req.user.id,
        stripeSessionId: session.id || null,
        guess: normalizeNumber(n, mode.digits),
      },
      req
    );

    res.json({ url: session.url, contestEndsOn: contest.endsOn || null });
  }
);

/* =========================================================
   ADMIN — COMBINED STATE (PAID + AMOE)
   (Admin UI uses apiPost so token attaches automatically.)
========================================================= */

async function getPaidContestByIdOrLast(contestIdMaybe) {
  let id = String(contestIdMaybe || "").trim();
  if (!id) {
    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    id = contestIdFromCutoffMs(lastCutoff);
  }
  const ref = db.collection("contests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "No such contest.", contestId: id };
  return { ok: true, contest: snap.data() };
}

async function getOrInitAmoeState() {
  const ref = db.collection("amoe").doc("state");
  const snap = await ref.get();
  if (snap.exists) return { ref, state: snap.data() };

  const init = {
    cycleId: 1,
    status: "COLLECTING", // COLLECTING | READY | RESOLVED
    count: 0,
    reachedAt: null,
    resolvedAt: null,
    targetNumber: null,
    prizeCents: AMOE_PRIZE_CENTS,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };
  await ref.set(init);
  return { ref, state: init };
}

function isPaidEntryEligible(e) {
  // eligible for winner calc:
  // - must be paid
  // - must not be refunded/disputed/expired
  if (!e) return false;
  if (!e.paid) return false;
  const s = String(e.status || "").toUpperCase();
  if (s === "REFUNDED" || s === "DISPUTED" || s === "EXPIRED") return false;
  return true;
}

app.post("/api/admin/state", requireAdmin, async (req, res) => {
  try {
    const active = await ensureActiveContestNow();

    const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
    const lastId = contestIdFromCutoffMs(lastCutoff);

    const lastSnap = await db.collection("contests").doc(lastId).get();
    const lastContest = lastSnap.exists ? lastSnap.data() : null;

    const { state: amoeState } = await getOrInitAmoeState();

    // queued counts for active contest = paid entries that are paid but contest not activated at payment time (status QUEUED)
    // Note: Some entries may still show status PAID even if queued; so we compute both.
    let queuedCount = 0;
    let queuedPrizeCents = 0;

    const activeEntriesSnap = await db.collection("entries").doc(active.id).collection("items").get();
    activeEntriesSnap.forEach((d) => {
      const e = d.data();
      if (e && e.paid && String(e.status || "").toUpperCase() === "QUEUED") {
        queuedCount += 1;
        queuedPrizeCents += 355;
      }
    });

    res.json({
      ok: true,
      serverNow: nowMs(),
      activeContest: safeContestForClient(active),
      lastContest: lastContest
        ? {
            id: lastContest.id || lastId,
            mode: lastContest.mode || "PICK3",
            cutoffAt: lastContest.cutoffAt ?? null,
            endsOn: lastContest.endsOn ?? null,
            resolved: !!lastContest.resolved,
            resolvedAt: lastContest.resolvedAt ?? null,
            targetNumber: lastContest.targetNumber ?? null,
            entryCount: Number(lastContest.entryCount || 0),
            prizeCents: Number(lastContest.prizeCents || 0),
            activatedAt: lastContest.activatedAt ?? null,
          }
        : null,
      paid: {
        queuedCount,
        queuedPrizeCents,
      },
      amoe: {
        cycleId: amoeState.cycleId ?? 1,
        status: amoeState.status || "COLLECTING",
        count: Number(amoeState.count || 0),
        reachedAt: amoeState.reachedAt ?? null,
        resolvedAt: amoeState.resolvedAt ?? null,
        targetNumber: amoeState.targetNumber ?? null,
        prizeCents: Number(amoeState.prizeCents || AMOE_PRIZE_CENTS),
        targetCount: AMOE_TARGET_COUNT,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to load admin state." });
  }
});

/* =========================================================
   ADMIN — MODE (PAID)
========================================================= */

app.post("/api/admin/mode", requireAdmin, async (req, res) => {
  const { mode } = req.body || {};
  const m = String(mode || "").toUpperCase();
  if (!MODES[m]) return res.status(400).json({ error: "Invalid mode." });

  const contest = await ensureActiveContestNow();
  await db.collection("contests").doc(contest.id).update({ mode: m });

  await auditLog("admin_mode", { contestId: contest.id, mode: m }, req);

  res.json({ ok: true, mode: m, contestId: contest.id });
});

/* =========================================================
   ADMIN — PAID PREVIEW + RESOLVE
========================================================= */

async function computePaidWinner({ contestId, targetNumber }) {
  const contestRef = db.collection("contests").doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) throw new Error("No such contest.");

  const contest = contestSnap.data();
  const mode = MODES[contest.mode] || MODES.PICK3;

  const target = Number(onlyDigits(targetNumber));
  if (Number.isNaN(target) || target < mode.min || target > mode.max) throw new Error("Invalid target.");

  const entriesSnap = await db.collection("entries").doc(contestId).collection("items").get();
  if (entriesSnap.empty) throw new Error("No entries.");

  let eligibleCount = 0;
  let winner = null;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    if (!isPaidEntryEligible(e)) return;
    eligibleCount += 1;

    const diff = absDiff(e.guess, target);
    if (!winner || diff < winner.diff || (diff === winner.diff && Number(e.timestamp) < Number(winner.timestamp))) {
      winner = { ...e, diff };
    }
  });

  if (!winner) throw new Error("No eligible paid entries.");

  return {
    contest,
    mode,
    targetNorm: normalizeNumber(target, mode.digits),
    winner,
    eligibleCount,
    totalEntries: entriesSnap.size,
  };
}

app.post("/api/admin/paid/preview", requireAdmin, async (req, res) => {
  try {
    const { targetNumber, contestId } = req.body || {};
    const id = String(contestId || "").trim() || contestIdFromCutoffMs(mostRecentChicagoCutoffAtOrBefore(nowMs()));

    const r = await computePaidWinner({ contestId: id, targetNumber });

    res.json({
      ok: true,
      contestId: id,
      endsOn: r.contest.endsOn || null,
      mode: r.contest.mode || "PICK3",
      target: r.targetNorm,
      eligibleCount: r.eligibleCount,
      totalEntries: r.totalEntries,
      winnerUN: r.winner.username,
      winnerUserId: r.winner.userId || null,
      guess: r.winner.guess,
      diff: r.winner.diff,
      entryTimestamp: r.winner.timestamp,
      prizeCents: Number(r.contest.prizeCents || 0),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "Preview failed." });
  }
});

app.post("/api/admin/resolve", requireAdmin, async (req, res) => {
  try {
    const { targetNumber, contestId } = req.body || {};

    let id = String(contestId || "").trim();
    if (!id) {
      const lastCutoff = mostRecentChicagoCutoffAtOrBefore(nowMs());
      id = contestIdFromCutoffMs(lastCutoff);
    }

    const contestRef = db.collection("contests").doc(id);
    const contestSnap = await contestRef.get();
    if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

    const contest = contestSnap.data();
    if (contest.resolved) return res.status(400).json({ error: "Already resolved." });

    const r = await computePaidWinner({ contestId: id, targetNumber });

    const prizeCents = Number(contest.prizeCents || 0);

    const record = {
      contestId: contest.id,
      endsOn: contest.endsOn || null,
      mode: contest.mode,
      target: r.targetNorm,
      winnerUN: r.winner.username,
      winnerUserId: r.winner.userId || null,
      guess: r.winner.guess,
      diff: r.winner.diff,
      prizeCents,
      resolvedAt: nowMs(),
      entryTimestamp: r.winner.timestamp,
      eligibleCount: r.eligibleCount,
      totalEntries: r.totalEntries,
    };

    await db.collection("winners").add(record);

    const winnersSnap = await db.collection("winners").orderBy("resolvedAt", "desc").get();
    const batch = db.batch();
    winnersSnap.docs.slice(HISTORY_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await contestRef.update({
      resolved: true,
      resolvedAt: record.resolvedAt,
      targetNumber: record.target,
    });

    await auditLog("admin_resolve_paid", { contestId: contest.id, target: record.target, prizeCents }, req);

    res.json(record);
  } catch (e) {
    res.status(400).json({ error: e.message || "Failed to post results." });
  }
});

/* =========================================================
   ADMIN — PAID RESET / ACTIVATE NEXT CONTEST (SUNDAY ACTION)
   - Activates current active contest if not activated
   - Backfills entryCount/prizeCents for any paid entries already present (QUEUED/PAID)
========================================================= */

app.post("/api/admin/paid/activate", requireAdmin, async (req, res) => {
  try {
    const contest = await getContestForEntryTime(nowMs()); // next cutoff contest
    const contestRef = db.collection("contests").doc(contest.id);
    const snap = await contestRef.get();
    if (!snap.exists) return res.status(400).json({ error: "Contest missing." });

    const c = snap.data();

    if (c.resolved) return res.status(400).json({ error: "Cannot activate a resolved contest." });
    if (c.activatedAt) return res.json({ ok: true, contestId: contest.id, activatedAt: c.activatedAt });

    // Count paid entries already collected for this contest (stored while not activated)
    const entriesSnap = await db.collection("entries").doc(contest.id).collection("items").get();
    let paidCount = 0;

    entriesSnap.forEach((d) => {
      const e = d.data();
      if (e && e.paid && isPaidEntryEligible(e)) paidCount += 1;
    });

    const patch = {
      activatedAt: nowMs(),
      // make visible totals now
      entryCount: paidCount,
      prizeCents: paidCount * 355,
    };

    await contestRef.set(patch, { merge: true });

    // Update any queued entries to PAID (still eligible)
    const batch = db.batch();
    entriesSnap.docs.forEach((d) => {
      const e = d.data();
      if (e && e.paid && String(e.status || "").toUpperCase() === "QUEUED") {
        batch.update(d.ref, { status: "PAID", activatedAt: nowMs() });
      }
    });
    await batch.commit();

    await auditLog("admin_paid_activate", { contestId: contest.id, paidCount }, req);

    res.json({ ok: true, contestId: contest.id, activatedAt: patch.activatedAt, entryCount: paidCount, prizeCents: patch.prizeCents });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to activate contest." });
  }
});

/**
 * Keep legacy endpoint name used by old Admin.jsx button.
 * We now interpret /api/admin/reset as "activate the upcoming contest if it has no entries" ONLY.
 * Your new Admin panel uses /api/admin/paid/activate for Sunday action.
 */
app.post("/api/admin/reset", requireAdmin, async (req, res) => {
  try {
    const contest = await getContestForEntryTime(nowMs());
    const snap = await db.collection("contests").doc(contest.id).get();
    if (!snap.exists) return res.json({ ok: true });

    const c = snap.data();
    if (c.entryCount && Number(c.entryCount) > 0) {
      return res.status(400).json({ error: "Cannot reset an active contest with entries." });
    }

    await db.collection("contests").doc(contest.id).set(
      {
        id: contest.id,
        mode: "PICK3",
        cutoffAt: contest.cutoffAt,
        endsOn: contest.endsOn,
        resolved: false,
        resolvedAt: null,
        entryCount: 0,
        targetNumber: null,
        prizeCents: 0,
        activatedAt: null,
        resetAt: nowMs(),
      },
      { merge: true }
    );

    await auditLog("admin_reset", { contestId: contest.id }, req);

    res.json({ ok: true, contestId: contest.id });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to reset." });
  }
});

/* =========================================================
   ADMIN — AMOE CONTROLS (SEPARATE POOL)
========================================================= */

function cleanEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function cleanName(s) {
  return String(s || "").trim();
}

function cleanAddr(s) {
  return String(s || "").trim();
}

app.post("/api/admin/amoe/add", requireAdmin, async (req, res) => {
  try {
    const { name, email, address, guess, receivedAt } = req.body || {};

    const nm = cleanName(name);
    const em = cleanEmail(email);
    const addr = cleanAddr(address);

    if (nm.length < 2) return res.status(400).json({ error: "Name required." });
    if (!em.includes("@")) return res.status(400).json({ error: "Valid email required." });
    if (addr.length < 6) return res.status(400).json({ error: "Address required." });

    const digits = MODES.PICK3.digits;
    const n = Number(onlyDigits(guess));
    if (Number.isNaN(n) || n < 0 || n > 999) return res.status(400).json({ error: "Invalid AMOE number." });

    const recv = receivedAt ? Number(receivedAt) : nowMs();
    const { ref: stateRef, state } = await getOrInitAmoeState();

    if (String(state.status || "COLLECTING") === "RESOLVED") {
      return res.status(400).json({ error: "AMOE cycle is resolved. Reset cycle to start collecting again." });
    }
    if (String(state.status || "COLLECTING") === "READY") {
      return res.status(400).json({ error: "AMOE is ready to resolve. Do not add more entries to this cycle." });
    }

    const cycleId = Number(state.cycleId || 1);

    // One entry per person per AMOE cycle (by email)
    const dupeSnap = await db
      .collection("amoeEntries")
      .doc(String(cycleId))
      .collection("items")
      .where("emailLower", "==", em)
      .limit(1)
      .get();

    if (!dupeSnap.empty) {
      return res.status(400).json({ error: "An AMOE entry already exists for this email in the current AMOE cycle." });
    }

    const entryDoc = await db
      .collection("amoeEntries")
      .doc(String(cycleId))
      .collection("items")
      .add({
        name: nm,
        email: em,
        emailLower: em,
        address: addr,
        guess: normalizeNumber(n, digits),
        receivedAt: recv,
        timestamp: recv, // tie-breaker among AMOEs
        createdAt: nowMs(),
      });

    // increment count; if reaches target -> READY
    const nextCount = Number(state.count || 0) + 1;
    const nextStatus = nextCount >= AMOE_TARGET_COUNT ? "READY" : "COLLECTING";

    const patch = {
      count: nextCount,
      status: nextStatus,
      updatedAt: nowMs(),
      prizeCents: Number(state.prizeCents || AMOE_PRIZE_CENTS),
    };

    if (nextStatus === "READY" && !state.reachedAt) patch.reachedAt = nowMs();

    await stateRef.set(patch, { merge: true });

    await auditLog(
      "admin_amoe_add",
      { cycleId, entryId: entryDoc.id, email: em, guess: normalizeNumber(n, digits), count: nextCount, status: nextStatus },
      req
    );

    res.json({ ok: true, cycleId, entryId: entryDoc.id, count: nextCount, status: nextStatus });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to add AMOE entry." });
  }
});

async function computeAmoeWinner({ targetNumber }) {
  const { ref: stateRef, state } = await getOrInitAmoeState();
  const status = String(state.status || "COLLECTING");
  if (status !== "READY") throw new Error("AMOE is not ready to resolve yet.");

  const cycleId = Number(state.cycleId || 1);

  const target = Number(onlyDigits(targetNumber));
  if (Number.isNaN(target) || target < 0 || target > 999) throw new Error("Invalid target.");

  const entriesSnap = await db.collection("amoeEntries").doc(String(cycleId)).collection("items").get();
  if (entriesSnap.empty) throw new Error("No AMOE entries.");

  let winner = null;
  let count = 0;

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    count += 1;

    const diff = absDiff(e.guess, target);
    if (!winner || diff < winner.diff || (diff === winner.diff && Number(e.timestamp) < Number(winner.timestamp))) {
      winner = { id: doc.id, ...e, diff };
    }
  });

  if (!winner) throw new Error("No AMOE winner computed.");

  return { stateRef, state, cycleId, targetNorm: normalizeNumber(target, 3), winner, count };
}

app.post("/api/admin/amoe/preview", requireAdmin, async (req, res) => {
  try {
    const { targetNumber } = req.body || {};
    const r = await computeAmoeWinner({ targetNumber });

    res.json({
      ok: true,
      cycleId: r.cycleId,
      target: r.targetNorm,
      entryCount: r.count,
      prizeCents: Number(r.state.prizeCents || AMOE_PRIZE_CENTS),
      winnerName: r.winner.name,
      winnerEmail: r.winner.email,
      guess: r.winner.guess,
      diff: r.winner.diff,
      entryTimestamp: r.winner.timestamp,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || "AMOE preview failed." });
  }
});

app.post("/api/admin/amoe/resolve", requireAdmin, async (req, res) => {
  try {
    const { targetNumber } = req.body || {};

    const r = await computeAmoeWinner({ targetNumber });

    const record = {
      cycleId: r.cycleId,
      target: r.targetNorm,
      prizeCents: Number(r.state.prizeCents || AMOE_PRIZE_CENTS),
      winnerName: r.winner.name,
      winnerEmail: r.winner.email,
      winnerAddress: r.winner.address,
      guess: r.winner.guess,
      diff: r.winner.diff,
      entryTimestamp: r.winner.timestamp,
      resolvedAt: nowMs(),
      entryCount: r.count,
    };

    await db.collection("amoeWinners").add(record);

    const winnersSnap = await db.collection("amoeWinners").orderBy("resolvedAt", "desc").get();
    const batch = db.batch();
    winnersSnap.docs.slice(HISTORY_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await r.stateRef.set(
      {
        status: "RESOLVED",
        resolvedAt: record.resolvedAt,
        targetNumber: record.target,
        updatedAt: nowMs(),
      },
      { merge: true }
    );

    await auditLog("admin_amoe_resolve", { cycleId: r.cycleId, target: record.target, prizeCents: record.prizeCents }, req);

    res.json({ ok: true, ...record });
  } catch (e) {
    res.status(400).json({ error: e.message || "Failed to resolve AMOE." });
  }
});

app.post("/api/admin/amoe/reset-cycle", requireAdmin, async (req, res) => {
  try {
    const { ref: stateRef, state } = await getOrInitAmoeState();
    const nextCycle = Number(state.cycleId || 1) + 1;

    await stateRef.set(
      {
        cycleId: nextCycle,
        status: "COLLECTING",
        count: 0,
        reachedAt: null,
        resolvedAt: null,
        targetNumber: null,
        prizeCents: AMOE_PRIZE_CENTS,
        updatedAt: nowMs(),
      },
      { merge: true }
    );

    await auditLog("admin_amoe_reset_cycle", { cycleId: nextCycle }, req);

    res.json({ ok: true, cycleId: nextCycle });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to reset AMOE cycle." });
  }
});

/* =========================================================
   ADMIN — EXPORTS (PAID + AMOE)
========================================================= */

app.post("/api/admin/export/paid", requireAdmin, async (req, res) => {
  try {
    const { contestId } = req.body || {};
    const id = String(contestId || "").trim() || contestIdFromCutoffMs(mostRecentChicagoCutoffAtOrBefore(nowMs()));

    const contestSnap = await db.collection("contests").doc(id).get();
    if (!contestSnap.exists) return res.status(400).json({ error: "No such contest." });

    const contest = contestSnap.data();

    const entriesSnap = await db.collection("entries").doc(id).collection("items").get();
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const winnerSnap = await db.collection("winners").where("contestId", "==", id).orderBy("resolvedAt", "desc").limit(1).get();
    const winner = winnerSnap.empty ? null : { id: winnerSnap.docs[0].id, ...winnerSnap.docs[0].data() };

    const payload = {
      kind: "PAID_EXPORT",
      exportedAt: nowMs(),
      contest: {
        id: contest.id || id,
        endsOn: contest.endsOn ?? null,
        cutoffAt: contest.cutoffAt ?? null,
        mode: contest.mode ?? "PICK3",
        activatedAt: contest.activatedAt ?? null,
        resolved: !!contest.resolved,
        resolvedAt: contest.resolvedAt ?? null,
        targetNumber: contest.targetNumber ?? null,
        entryCount: Number(contest.entryCount || 0),
        prizeCents: Number(contest.prizeCents || 0),
      },
      winner,
      entriesCountTotal: entries.length,
      entries,
    };

    await auditLog("admin_export_paid", { contestId: id, entries: entries.length }, req);

    res.json({ ok: true, payload });
  } catch (e) {
    res.status(500).json({ error: e.message || "Export failed." });
  }
});

app.post("/api/admin/export/amoe", requireAdmin, async (req, res) => {
  try {
    const { cycleId } = req.body || {};
    const { state } = await getOrInitAmoeState();
    const cid = cycleId ? String(cycleId) : String(state.cycleId || 1);

    const entriesSnap = await db.collection("amoeEntries").doc(cid).collection("items").get();
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const winnerSnap = await db.collection("amoeWinners").where("cycleId", "==", Number(cid)).orderBy("resolvedAt", "desc").limit(1).get();
    const winner = winnerSnap.empty ? null : { id: winnerSnap.docs[0].id, ...winnerSnap.docs[0].data() };

    const payload = {
      kind: "AMOE_EXPORT",
      exportedAt: nowMs(),
      cycleId: Number(cid),
      state: {
        cycleId: Number(state.cycleId || 1),
        status: state.status || "COLLECTING",
        count: Number(state.count || 0),
        reachedAt: state.reachedAt ?? null,
        resolvedAt: state.resolvedAt ?? null,
        targetNumber: state.targetNumber ?? null,
        prizeCents: Number(state.prizeCents || AMOE_PRIZE_CENTS),
        targetCount: AMOE_TARGET_COUNT,
      },
      winner,
      entriesCountTotal: entries.length,
      entries,
    };

    await auditLog("admin_export_amoe", { cycleId: Number(cid), entries: entries.length }, req);

    res.json({ ok: true, payload });
  } catch (e) {
    res.status(500).json({ error: e.message || "AMOE export failed." });
  }
});

/* =========================================================
   START SERVER (LAST)
========================================================= */

app.listen(PORT, async () => {
  try {
    await ensureActiveContestNow();
    await getOrInitAmoeState();
  } catch (e) {
    console.error("Boot init failed:", e?.message || e);
  }

  console.log(`Backend running on port ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
