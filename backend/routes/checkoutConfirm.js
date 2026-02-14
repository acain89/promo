// backend/routes/checkoutConfirm.js
import { Router } from "express";
import admin from "firebase-admin";

import requireUser from "../middleware/auth.js";
import { db } from "../lib/firestore.js";
import { stripe } from "../lib/stripe.js";
import { nowMs } from "../lib/utils.js";

const r = Router();

/**
 * GET /api/checkout/confirm?session_id=cs_test_...
 * - Verifies session is paid
 * - Marks entry PAID
 * - Increments contest entryCount + prizeCents (once)
 */
r.get("/api/checkout/confirm", requireUser, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured." });

    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing session_id." });

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Stripe v2020+ has payment_status; also ensure we have a payment_intent
    const paymentStatus = String(session.payment_status || "").toLowerCase();
    const paymentIntentId = session.payment_intent ? String(session.payment_intent) : null;

    if (paymentStatus !== "paid") {
      return res.json({
        ok: true,
        paid: false,
        paymentStatus: session.payment_status || null,
      });
    }

    // Metadata must identify which entry to mark paid
    const contestId = String(session.metadata?.contestId || "").trim();
    const entryId =
      String(session.metadata?.entryId || "").trim() ||
      String(session.metadata?.userId || "").trim();

    // Fallback: assume entryId == logged-in user id if metadata missing
    const userId = String(req.user?.id || "").trim();
    const finalContestId = contestId;
    const finalEntryId = entryId || userId;

    if (!finalContestId || !finalEntryId) {
      return res.status(400).json({
        ok: false,
        error: "Missing contestId/entryId metadata on session.",
      });
    }

    const entryRef = db()
      .collection("entries")
      .doc(finalContestId)
      .collection("items")
      .doc(finalEntryId);

    const contestRef = db().collection("contests").doc(finalContestId);

    let changed = false;

    await db().runTransaction(async (tx) => {
      const [entrySnap, contestSnap] = await Promise.all([tx.get(entryRef), tx.get(contestRef)]);
      if (!entrySnap.exists) throw new Error("Entry doc not found for this session.");
      if (!contestSnap.exists) throw new Error("Contest doc not found for this session.");

      const entry = entrySnap.data() || {};
      const contest = contestSnap.data() || {};

      // If already marked paid, idempotent success
      if (entry.paid === true || String(entry.status || "").toUpperCase() === "PAID") return;

      // Mark entry paid
      tx.update(entryRef, {
        paid: true,
        paidAt: nowMs(),
        status: "PAID",
        stripeSessionId: session.id || null,
        paymentIntentId: paymentIntentId || null,
      });

      // Increment contest only if contest is active + not resolved
      // (match your webhook logic)
      if (!contest.resolved && !!contest.activatedAt) {
        const lockCents = Number.isFinite(Number(contest.poolContributionCentsLocked))
          ? Math.floor(Number(contest.poolContributionCentsLocked))
          : 455;

        // If not locked, lock it once
        if (!(Number.isFinite(Number(contest.poolContributionCentsLocked)) && Number(contest.poolContributionCentsLocked) >= 0)) {
          tx.update(contestRef, { poolContributionCentsLocked: lockCents });
        }

        tx.update(contestRef, {
          entryCount: admin.firestore.FieldValue.increment(1),
          prizeCents: admin.firestore.FieldValue.increment(lockCents),
        });
      } else {
        tx.update(entryRef, { status: "QUEUED" });
      }

      changed = true;
    });

    return res.json({
      ok: true,
      paid: true,
      updated: changed,
      contestId: finalContestId,
      entryId: finalEntryId,
      paymentIntentId,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Confirm failed." });
  }
});

export default r;
