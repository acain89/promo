// backend/routes/checkout.js
import { Router } from "express";
import Stripe from "stripe";

import requireUser from "../middleware/auth.js";
import rateLimit from "../middleware/rateLimit.js";

import {
  FRONTEND_URL,
  STRIPE_SECRET_KEY,
  UNPAID_EXPIRE_MS,
  BRAND_NAME,
  MODES,
} from "../lib/config.js";

import { db } from "../lib/firestore.js";
import { auditLog } from "../lib/audit.js";
import { onlyDigits, normalizeNumber, nowMs } from "../lib/utils.js";
import { ensureActiveContestNow } from "../lib/time.js";

const r = Router();

// Treat Stripe as "enabled" only if we have a secret key AND can construct the client
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Small helper: normalize frontend url once
function cleanBase(u) {
  return String(u || "").replace(/\/+$/, "");
}

// Small helper: build user-friendly (non-scary) messages
function paymentsNotEnabledMessage() {
  return "Payments are not enabled on this build.";
}

/**
 * Stripe statement_descriptor_suffix rules are strict.
 * Keep it simple: alphanum + spaces, 5–22 chars, must contain at least one letter.
 */
function safeDescriptorSuffix(name) {
  const raw = String(name || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);

  if (raw.length < 5) return "";
  if (!/[a-zA-Z]/.test(raw)) return "";
  return raw;
}

/* =========================================================
   STRIPE CHECKOUT (PAID ENTRY)
   - If Stripe disabled → NO writes, return 501 cleanly
   - If Stripe enabled → creates/updates entry as PENDING_PAYMENT
   - ✅ Allow changing guess BEFORE payment
========================================================= */

r.post(
  "/api/checkout",
  requireUser,
  rateLimit({ routeKey: "checkout", limit: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
    try {
      // If Stripe is not configured, do NOT create pending entries.
      if (!stripe) {
        return res.status(501).json({ error: paymentsNotEnabledMessage() });
      }
      if (!FRONTEND_URL) {
        return res.status(500).json({ error: "FRONTEND_URL not configured." });
      }

      const { guess } = req.body || {};

      /* ---------------------------
         Contest availability
      ---------------------------- */
      const contest = await ensureActiveContestNow();
      if (!contest || contest.resolved) {
        return res.status(400).json({ error: "Contest unavailable." });
      }

      /* ---------------------------
         Validate guess
      ---------------------------- */
      const mode = MODES[contest.mode] || MODES.PICK3;
      const n = Number(onlyDigits(guess));
      if (Number.isNaN(n) || n < mode.min || n > mode.max) {
        return res.status(400).json({ error: "Invalid number." });
      }

      const normalizedGuess = normalizeNumber(n, mode.digits);

      /* ---------------------------
         Load username (best-effort)
      ---------------------------- */
      let username = "";
      try {
        const userSnap = await db().collection("users").doc(req.user.id).get();
        username = userSnap.exists ? String(userSnap.data()?.username || "") : "";
      } catch {
        username = "";
      }

      const entryRef = db()
        .collection("entries")
        .doc(contest.id)
        .collection("items")
        .doc(req.user.id);

      const now = nowMs();

      /* =====================================================
         ENTRY CREATION / REUSE LOGIC

         Rules:
         - Only ONE entry per contest per user
         - ✅ Guess is changeable BEFORE payment
         - Paid entry is immutable
         - If unpaid + expired → allow retry
         - If unpaid + not expired → touch / reuse
         - Any retry or guess-change increments checkoutAttempt (new session)
      ====================================================== */

      const existingSnap = await entryRef.get();

      let checkoutAttempt = 1;
      let prevGuess = null;
      let guessChanged = false;

      if (existingSnap.exists) {
        const entry = existingSnap.data() || {};
        prevGuess = String(entry.guess || "");

        // Already paid → hard stop
        if (entry.paid) {
          return res.status(400).json({ error: "You already entered this contest." });
        }

        guessChanged = prevGuess !== normalizedGuess;

        // Determine attempt + expiration
        checkoutAttempt = Number(entry.checkoutAttempt || 1);

        const touched = Number(entry.lastTouchedAt || entry.retryAt || entry.timestamp || 0);
        const ageMs = now - touched;
        const isExpired = entry.status === "EXPIRED" || ageMs > UNPAID_EXPIRE_MS;

        // If guess changed OR expired → bump attempt and reset pending state
        if (guessChanged || isExpired) {
          checkoutAttempt = checkoutAttempt + 1;

          await entryRef.update({
            // ✅ allow changing guess before payment
            guess: normalizedGuess,

            status: "PENDING_PAYMENT",
            retryAt: now,
            lastTouchedAt: now,

            // new attempt => new Stripe session
            checkoutAttempt,

            // clear any previous session references (best-effort hygiene)
            stripeSessionId: null,
            paymentIntentId: null,
          });
        } else {
          // Still pending (same guess): touch it so it doesn't expire while user is actively trying
          await entryRef.update({
            status: "PENDING_PAYMENT",
            lastTouchedAt: now,
          });
        }
      } else {
        // Create new unpaid entry
        await entryRef.create({
          userId: req.user.id,
          username,
          guess: normalizedGuess,
          timestamp: now,
          lastTouchedAt: now,
          type: "PAID",
          paid: false,
          paidAt: null,
          status: "PENDING_PAYMENT",
          stripeSessionId: null,
          paymentIntentId: null,
          checkoutAttempt: 1,
        });
        checkoutAttempt = 1;
      }

      /* ---------------------------
         Stripe Checkout Session
         - Use attempt in idempotency key so retries generate a fresh session
      ---------------------------- */
      const idempotencyKey = `checkout_${contest.id}_${req.user.id}_a${checkoutAttempt}`;

      const suffix = safeDescriptorSuffix(BRAND_NAME || "");
      const base = cleanBase(FRONTEND_URL);

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],

          payment_intent_data: suffix
            ? { statement_descriptor_suffix: suffix }
            : undefined,

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: "Weekly Game Pass (Digital Access)" },
                unit_amount: 500,
              },
              quantity: 1,
            },
          ],

          metadata: {
            userId: req.user.id,
            contestId: contest.id,
            contestEndsOn: contest.endsOn || "",
            guess: normalizedGuess,
            checkoutAttempt: String(checkoutAttempt),
          },

          custom_text: {
            submit: {
              message:
                "No purchase necessary. Free mail-in entry (AMOE) available. One entry per person per contest.",
            },
          },

          success_url: `${base}/profile?checkout=success`,
          cancel_url: `${base}/profile?checkout=cancel`,
        },
        { idempotencyKey }
      );

      // Best-effort session ID backfill + touch
      try {
        await entryRef.update({
          stripeSessionId: session.id,
          lastTouchedAt: nowMs(),
        });
      } catch {}

      await auditLog(
        "checkout_created",
        {
          contestId: contest.id,
          userId: req.user.id,
          stripeSessionId: session.id || null,
          guess: normalizedGuess,
          checkoutAttempt,
          guessChanged,
          prevGuess,
        },
        req
      );

      return res.json({
        url: session.url,
        contestEndsOn: contest.endsOn || null,
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || "Checkout failed.",
      });
    }
  }
);

export default r;
