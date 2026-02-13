// backend/routes/stripeWebhook.js
import express from "express";
import admin from "firebase-admin";

import { db } from "../lib/firestore.js";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../lib/stripe.js";
import { nowMs } from "../lib/utils.js";
import { auditLog } from "../lib/audit.js";

const DEFAULT_POOL_CONTRIB_CENTS = 455; // $4.55 default if config doc missing

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/**
 * Read poolContributionCents from config/public inside a transaction.
 * Falls back to DEFAULT_POOL_CONTRIB_CENTS if missing/invalid.
 */
async function getPoolContributionCentsTx(tx) {
  try {
    const cfgRef = db().collection("config").doc("public");
    const cfgSnap = await tx.get(cfgRef);
    if (!cfgSnap.exists) return DEFAULT_POOL_CONTRIB_CENTS;

    const d = cfgSnap.data() || {};
    const v = clampInt(d.poolContributionCents, 0, 5000);
    if (v == null) return DEFAULT_POOL_CONTRIB_CENTS;
    return v;
  } catch {
    return DEFAULT_POOL_CONTRIB_CENTS;
  }
}

/**
 * Helper: update any entry doc(s) matching a paymentIntentId across all contests.
 */
async function updateEntryByPaymentIntent(paymentIntentId, patch, auditType, stripeObj) {
  if (!paymentIntentId) return;

  const snap = await db()
    .collectionGroup("items")
    .where("paymentIntentId", "==", String(paymentIntentId))
    .limit(20)
    .get();

  if (snap.empty) return;

  const batch = db().batch();
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

/**
 * IMPORTANT:
 * express.raw() is already mounted in index.js.
 * DO NOT use it again here.
 */
export default function stripeWebhookRouter() {
  const r = express.Router();

  r.post("/", async (req, res) => {
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
      /* =========================================================
         1) Checkout Session Completed
      ========================================================== */
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const contestId = String(session.metadata?.contestId || "").trim();
        const userId = String(session.metadata?.userId || "").trim();
        if (!contestId || !userId) return res.json({ received: true });

        const entryRef = db().collection("entries").doc(contestId).collection("items").doc(userId);
        const contestRef = db().collection("contests").doc(contestId);

        await db().runTransaction(async (tx) => {
          const [entrySnap, contestSnap] = await Promise.all([tx.get(entryRef), tx.get(contestRef)]);
          if (!entrySnap.exists || !contestSnap.exists) return;

          const entry = entrySnap.data() || {};
          const contest = contestSnap.data() || {};

          if (entry.paid) return; // Prevent double increment

          const paymentIntentId = session.payment_intent ? String(session.payment_intent) : null;

          // Mark entry paid (base)
          tx.update(entryRef, {
            paid: true,
            paidAt: nowMs(),
            status: "PAID",
            stripeSessionId: session.id || null,
            paymentIntentId,
          });

          // Only apply to contest totals if contest is ACTIVE + ACTIVATED + NOT RESOLVED
          if (!contest.resolved && !!contest.activatedAt) {
            // Determine the per-entry contribution:
            // 1) use contest.poolContributionCentsLocked if set
            // 2) otherwise read config/public.poolContributionCents
            // 3) if missing/invalid, fall back to DEFAULT_POOL_CONTRIB_CENTS
            const lockedExisting = Number(contest.poolContributionCentsLocked);
            const cfgCents = await getPoolContributionCentsTx(tx);

            const lockCents =
              Number.isFinite(lockedExisting) && lockedExisting >= 0 ? Math.floor(lockedExisting) : Math.floor(cfgCents);

            // If contest is activated but lock missing, backfill it (one-time hygiene)
            if (!(Number.isFinite(lockedExisting) && lockedExisting >= 0)) {
              tx.update(contestRef, { poolContributionCentsLocked: lockCents });
            }

            tx.update(contestRef, {
              entryCount: admin.firestore.FieldValue.increment(1),
              prizeCents: admin.firestore.FieldValue.increment(lockCents),
            });
          } else {
            // Not activated yet (or already resolved) => keep paid but queue it for activation
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

      /* =========================================================
         2) Payment Intent Succeeded (backup safety net)
      ========================================================== */
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        await updateEntryByPaymentIntent(
          pi.id,
          {
            paid: true,
            paidAt: nowMs(),
            status: "PAID",
          },
          "webhook_pi_succeeded",
          pi
        );
      }

      /* =========================================================
         3) Refunds
      ========================================================== */
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

      /* =========================================================
         4) Disputes
      ========================================================== */
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
      // Always respond 200 so Stripe doesn't retry infinitely
      return res.json({ received: true });
    }
  });

  return r;
}
