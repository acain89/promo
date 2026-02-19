// backend/routes/checkout.js
import { Router } from "express";

import requireUser from "../middleware/auth.js";
import rateLimit from "../middleware/rateLimit.js";

import { FRONTEND_URL, UNPAID_EXPIRE_MS, BRAND_NAME, MODES } from "../lib/config.js";

import { db } from "../lib/firestore.js";
import { auditLog } from "../lib/audit.js";
import { onlyDigits, normalizeNumber, nowMs } from "../lib/utils.js";
import { ensureActiveContestNow } from "../lib/time.js";
import { stripe } from "../lib/stripe.js";

const r = Router();

// $10 Game Pass + fee pass-through => charge $10.50
const GAME_PASS_CHARGE_CENTS = 1050;
const GAME_PASS_LABEL = "Weekly Game Pass (Daily 4 Sweepstakes Entry)";

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

/**
 * NOTE ON "CLAIMED" NUMBERS:
 * - A number is considered "claimed" if there is an entry in entries/{contestId}/items
 *   with guess == normalizedGuess AND countedInContest === true.
 *   This covers:
 *   - PAID entries after confirm/webhook (countedInContest true)
 *   - AMOE mirrored into the contest pool (countedInContest true in your admin route)
 *
 * - Unpaid/PENDING entries do NOT claim a number.
 */
async function isGuessClaimedTx(tx, { contestId, guessNorm, excludeUserId = null }) {
  const col = db().collection("entries").doc(String(contestId)).collection("items");
  const q = col.where("guess", "==", String(guessNorm)).where("countedInContest", "==", true).limit(2);
  const snap = await tx.get(q);
  if (snap.empty) return { claimed: false, claimedByEntryId: null };

  const other = snap.docs.find((d) => d.id !== String(excludeUserId || ""));
  if (!other) return { claimed: false, claimedByEntryId: null };
  return { claimed: true, claimedByEntryId: other.id };
}

function toUpper(s) {
  return String(s || "").toUpperCase();
}

function isRetryablePaidStatus(statusUpper) {
  // ✅ These are "paid but not counted" situations in checkoutConfirm.
  // We allow a new checkout attempt, but we preserve the prior payment ids for refund/admin tracking.
  return statusUpper === "DUPLICATE" || statusUpper === "QUEUED";
}

/* =========================================================
   STRIPE CHECKOUT (PAID ENTRY)
   - If Stripe disabled → NO writes, return 501 cleanly
   - If Stripe enabled → creates/updates entry as PENDING_PAYMENT
   - ✅ Allow changing guess BEFORE payment
   - ✅ Include deterministic entryId in session metadata
   - ✅ Enforce "first to pay (or AMOE already entered) claims the number"
   - ✅ If prior paid status is DUPLICATE/QUEUED (paid but not counted), allow retry:
        - preserve prior payment refs for refund
        - reset to unpaid + PENDING_PAYMENT for new attempt
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
         Validate guess (DAILY4 = 4 digits, 0000–9999)
      ---------------------------- */
      const mode = MODES.DAILY4 || MODES[contest.mode] || MODES.PICK3;
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

      const contestRef = db().collection("contests").doc(contest.id);

      const now = nowMs();

      /* =====================================================
         ENTRY CREATION / REUSE LOGIC (transactional)

         Rules:
         - Only ONE entry per contest per user
         - Guess is changeable BEFORE payment
         - Unpaid + expired → allow retry
         - Unpaid + not expired → touch / reuse
         - ✅ Enforce: you cannot start checkout for a guess that is already claimed
         - ✅ If entry is PAID+COUNTED => hard stop (entered)
         - ✅ If entry is PAID but status is DUPLICATE/QUEUED (paid but NOT counted):
              allow retry by resetting to unpaid PENDING_PAYMENT, preserving prior payment refs
========================================================= */

      let checkoutAttempt = 1;
      let prevGuess = null;
      let guessChanged = false;

      await db().runTransaction(async (tx) => {
        const [contestSnap, existingSnap] = await Promise.all([tx.get(contestRef), tx.get(entryRef)]);
        if (!contestSnap.exists) throw new Error("Contest unavailable.");
        const c = contestSnap.data() || {};
        if (c.resolved) throw new Error("Contest unavailable.");

        // If user already has an entry
        if (existingSnap.exists) {
          const entry = existingSnap.data() || {};
          prevGuess = String(entry.guess || "");
          const statusUpper = toUpper(entry.status);
          const alreadyCounted = entry.countedInContest === true;

          // Paid + counted => entered for real
          if (entry.paid === true && alreadyCounted) {
            throw new Error("You already entered this contest.");
          }

          // Paid but NOT counted — only allow retry for known retryable statuses
          if (entry.paid === true && !alreadyCounted && !isRetryablePaidStatus(statusUpper)) {
            // safest default: treat as entered (prevents accidental double-charge paths)
            throw new Error("You already entered this contest.");
          }

          guessChanged = prevGuess !== normalizedGuess;

          checkoutAttempt = Number(entry.checkoutAttempt || 1);

          const touched = Number(entry.lastTouchedAt || entry.retryAt || entry.timestamp || 0);
          const ageMs = now - touched;
          const isExpired =
            statusUpper === "EXPIRED" || (Number.isFinite(ageMs) && ageMs > UNPAID_EXPIRE_MS);

          const shouldReset =
            guessChanged ||
            isExpired ||
            // ✅ if they previously hit DUPLICATE/QUEUED, we *always* reset so they can proceed cleanly
            (entry.paid === true && !alreadyCounted && isRetryablePaidStatus(statusUpper));

          if (shouldReset) {
            // ✅ Before we accept the new guess, ensure it isn't already claimed by someone else
            const { claimed } = await isGuessClaimedTx(tx, {
              contestId: contest.id,
              guessNorm: normalizedGuess,
              excludeUserId: req.user.id,
            });
            if (claimed) throw new Error("That number is not available.");

            checkoutAttempt = checkoutAttempt + 1;

            // Preserve prior payment refs for admin/refund tracking, then reset to unpaid pending
            const prevSessionId = entry.stripeSessionId || null;
            const prevIntentId = entry.paymentIntentId || null;
            const prevPaidAt = entry.paidAt || null;

            tx.update(entryRef, {
              guess: normalizedGuess,

              status: "PENDING_PAYMENT",
              retryAt: now,
              lastTouchedAt: now,

              checkoutAttempt,

              // reset current payment fields for the new attempt
              paid: false,
              paidAt: null,
              stripeSessionId: null,
              paymentIntentId: null,

              // preserve prior payment info (append-like)
              prevStripeSessionId: prevSessionId,
              prevPaymentIntentId: prevIntentId,
              prevPaidAt: prevPaidAt,

              // ensure we're not accidentally “claimed”
              countedInContest: false,
              // keep countedAt if you want a history, but it should already be null/absent in these cases
              countedAt: entry.countedAt ?? null,

              // Clear any prior duplicate markers
              duplicateOfEntryId: null,
              duplicateGuess: null,
            });
          } else {
            // Still pending (same guess): touch it so it doesn't expire while user is actively trying
            tx.update(entryRef, {
              status: "PENDING_PAYMENT",
              lastTouchedAt: now,
            });
          }

          return;
        }

        // No existing entry: new entry request.
        // ✅ Must enforce "claimed" check before creating the pending entry.
        const { claimed } = await isGuessClaimedTx(tx, {
          contestId: contest.id,
          guessNorm: normalizedGuess,
          excludeUserId: req.user.id,
        });
        if (claimed) throw new Error("That number is not available.");

        tx.create(entryRef, {
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
      });

      /* ---------------------------
         Stripe Checkout Session
         - Use attempt in idempotency key so retries generate a fresh session
      ---------------------------- */
      const idempotencyKey = `checkout_${contest.id}_${req.user.id}_a${checkoutAttempt}`;

      const suffix = safeDescriptorSuffix(BRAND_NAME || "");
      const base = cleanBase(FRONTEND_URL);

      // success includes session_id so Profile can call /api/checkout/confirm
      const successUrl = `${base}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${base}/profile`;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],

          payment_intent_data: suffix ? { statement_descriptor_suffix: suffix } : undefined,

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: GAME_PASS_LABEL },
                unit_amount: GAME_PASS_CHARGE_CENTS,
              },
              quantity: 1,
            },
          ],

          metadata: {
            userId: req.user.id,
            contestId: contest.id,
            entryId: req.user.id,
            contestEndsOn: contest.endsOn || "",
            guess: normalizedGuess,
            checkoutAttempt: String(checkoutAttempt),
            mode: String(contest.mode || "DAILY4"),
          },

          custom_text: {
            submit: {
              message:
                "No purchase necessary. Free mail-in entry (AMOE) available. One entry per person per weekly contest.",
            },
          },

          success_url: successUrl,
          cancel_url: cancelUrl,
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
          amountCents: GAME_PASS_CHARGE_CENTS,
        },
        req
      );

      return res.json({
        url: session.url,
        contestEndsOn: contest.endsOn || null,
      });
    } catch (e) {
      const msg = String(e?.message || "Checkout failed.");

      // Clean UX for expected user-facing rejections
      const lower = msg.toLowerCase();
      if (
        lower.includes("not available") ||
        lower.includes("already entered") ||
        lower.includes("contest unavailable") ||
        lower.includes("invalid number")
      ) {
        return res.status(400).json({ error: msg });
      }

      return res.status(500).json({ error: msg });
    }
  }
);

export default r;
