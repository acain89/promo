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

function checkoutAlreadyStartedMessage() {
  return "Checkout already started. You can continue checkout or try again later.";
}

/* =========================================================
   STRIPE CHECKOUT (PAID ENTRY)
   - If Stripe disabled → NO writes, return 501 cleanly
   - If Stripe enabled → creates/updates entry as PENDING_PAYMENT
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
         - Guess immutable once created
         - If unpaid + expired → allow retry (same guess)
         - If unpaid + not expired → allow returning the existing checkout URL if we have it
           otherwise return a neutral message (no scary error)
      ====================================================== */

      const existingSnap = await entryRef.get();

      if (existingSnap.exists) {
        const entry = existingSnap.data() || {};

        // Already paid → hard stop
        if (entry.paid) {
          return res.status(400).json({ error: "You already entered this contest." });
        }

        // Guess immutability
        if (String(entry.guess || "") !== normalizedGuess) {
          return res.status(400).json({
            error: "An unpaid entry already exists. The number cannot be changed. Please use the same number.",
          });
        }

        // Expiration check based on lastTouchedAt/ timestamp
        const touched = Number(entry.lastTouchedAt || entry.retryAt || entry.timestamp || 0);
        const ageMs = now - touched;
        const isExpired = entry.status === "EXPIRED" || ageMs > UNPAID_EXPIRE_MS;

        if (!isExpired) {
          // If we have a Stripe URL stored, send them back to it
          // (Most reliable is session id, but URL can be returned only when created;
          // so we just tell client "resume" and let them hit endpoint again.)
          // IMPORTANT: do not throw a scary error message
          return res.status(409).json({
            error: checkoutAlreadyStartedMessage(),
            pending: true,
            contestEndsOn: contest.endsOn || null,
          });
        }

        // Expired unpaid entry → re-activate for retry
        await entryRef.update({
          status: "PENDING_PAYMENT",
          retryAt: now,
          lastTouchedAt: now,
        });
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
        });
      }

      /* ---------------------------
         Stripe Checkout Session
      ---------------------------- */
      const idempotencyKey = `checkout_${contest.id}_${req.user.id}`;

      const descriptorSuffix = String(BRAND_NAME || "")
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .slice(0, 22);

      const base = cleanBase(FRONTEND_URL);

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],

          payment_intent_data: descriptorSuffix
            ? { statement_descriptor_suffix: descriptorSuffix }
            : undefined,

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: "Promotional Entry (Weekly)" },
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
          },

          custom_text: {
            submit: {
              message: "No purchase necessary. Mail-in AMOE available. One entry per person.",
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
