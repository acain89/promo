// backend/routes/checkoutConfirm.js
import { Router } from "express";
import admin from "firebase-admin";

import requireUser from "../middleware/auth.js";
import { db } from "../lib/firestore.js";
import { stripe } from "../lib/stripe.js";
import { nowMs, onlyDigits, normalizeNumber } from "../lib/utils.js";

const r = Router();

/**
 * GET /api/checkout/confirm?session_id=cs_test_...
 * - Verifies session is paid
 * - Marks entry PAID (or QUEUED if contest already resolved)
 * - Increments contest entryCount (exactly once)
 * - ✅ Enforces "first to pay (or AMOE already entered) claims the number"
 *
 * Claim definition:
 * - A number is "claimed" if there exists ANY OTHER entry in the same contest
 *   with the same normalized guess AND countedInContest === true.
 *   (AMOE mirror entries set countedInContest=true, and paid confirms set it true too.)
 *
 * If Stripe is paid but the number was already claimed by someone else:
 * - We DO NOT increment contest entryCount
 * - We DO mark the entry paid, but set status="DUPLICATE" so you can see/refund if needed.
 */
r.get("/api/checkout/confirm", requireUser, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, error: "Stripe not configured." });

    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing session_id." });

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paymentStatus = String(session.payment_status || "").toLowerCase();
    const paymentIntentId = session.payment_intent ? String(session.payment_intent) : null;

    if (paymentStatus !== "paid") {
      return res.json({
        ok: true,
        paid: false,
        paymentStatus: session.payment_status || null,
      });
    }

    // Metadata must identify which contest this is for
    const contestId = String(session.metadata?.contestId || "").trim();

    // Only allow confirming YOUR OWN entry (requireUser)
    const userId = String(req.user?.id || "").trim();
    const finalContestId = contestId;
    const finalEntryId = userId;

    if (!finalContestId) {
      return res.status(400).json({
        ok: false,
        error: "Missing contestId metadata on session.",
      });
    }

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const entryRef = db()
      .collection("entries")
      .doc(finalContestId)
      .collection("items")
      .doc(finalEntryId);

    const contestRef = db().collection("contests").doc(finalContestId);
    const entriesCol = db().collection("entries").doc(finalContestId).collection("items");

    let changed = false;
    let appliedContestIncrement = false;
    let queued = false;

    // If Stripe is paid but the guess was already claimed by someone else
    let duplicate = false;
    let claimedByEntryId = null;

    await db().runTransaction(async (tx) => {
      const [entrySnap, contestSnap] = await Promise.all([tx.get(entryRef), tx.get(contestRef)]);
      if (!entrySnap.exists) throw new Error("Entry doc not found for this session.");
      if (!contestSnap.exists) throw new Error("Contest doc not found for this session.");

      const entry = entrySnap.data() || {};
      const contest = contestSnap.data() || {};

      const alreadyPaid = entry.paid === true;
      const alreadyCounted = entry.countedInContest === true;

      // Need the guess to enforce uniqueness
      const rawGuess = String(entry.guess || "").trim();
      const d = onlyDigits(rawGuess);
      if (d.length !== 4) throw new Error("Entry guess is missing/invalid for this session.");
      const guessNorm = normalizeNumber(Number(d), 4);

      // If contest is resolved, do NOT count toward entryCount; mark queued (but still mark paid)
      if (contest.resolved) {
        queued = true;

        // Mark paid (idempotent), but keep this out of the contest count
        tx.update(entryRef, {
          paid: true,
          paidAt: alreadyPaid ? entry.paidAt ?? nowMs() : nowMs(),
          status: "QUEUED",
          countedInContest: alreadyCounted ? true : false,
          countedAt: alreadyCounted ? entry.countedAt ?? null : null,

          stripeSessionId: session.id || entry.stripeSessionId || null,
          paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
          lastTouchedAt: nowMs(),

          // normalize guess defensively
          guess: guessNorm,
        });

        changed = true;
        return;
      }

      // Uniqueness enforcement ONLY when we would newly count this entry.
      // If this entry is already counted, let confirm be idempotent.
      if (!alreadyCounted) {
        const q = entriesCol
          .where("guess", "==", guessNorm)
          .where("countedInContest", "==", true)
          .limit(2);

        const qSnap = await tx.get(q);

        if (!qSnap.empty) {
          const other = qSnap.docs.find((doc) => doc.id !== finalEntryId);
          if (other) {
            duplicate = true;
            claimedByEntryId = other.id;

            // Stripe is paid, but the number is already claimed by someone else.
            // Record as paid but NOT counted (admin can refund if desired).
            tx.update(entryRef, {
              paid: true,
              paidAt: alreadyPaid ? entry.paidAt ?? nowMs() : nowMs(),
              status: "DUPLICATE",

              countedInContest: false,
              countedAt: entry.countedAt ?? null,

              duplicateOfEntryId: other.id,
              duplicateGuess: guessNorm,

              stripeSessionId: session.id || entry.stripeSessionId || null,
              paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
              lastTouchedAt: nowMs(),

              // keep guess normalized
              guess: guessNorm,
            });

            changed = true;
            return;
          }
        }
      }

      // Mark entry paid (idempotent) and normalize guess
      if (!alreadyPaid) {
        tx.update(entryRef, {
          paid: true,
          paidAt: nowMs(),
          status: "PAID",
          stripeSessionId: session.id || null,
          paymentIntentId: paymentIntentId || null,
          lastTouchedAt: nowMs(),
          guess: guessNorm,
        });
        changed = true;
      } else {
        // keep it clean/idempotent, and ensure status isn't left weird if it's counted
        const curStatus = String(entry.status || "").toUpperCase();
        const statusPatch = alreadyCounted && curStatus !== "PAID" ? { status: "PAID" } : {};

        tx.update(entryRef, {
          stripeSessionId: session.id || entry.stripeSessionId || null,
          paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
          lastTouchedAt: nowMs(),
          guess: guessNorm,
          ...statusPatch,
        });
      }

      // Apply entryCount increment EXACTLY ONCE
      if (!alreadyCounted) {
        tx.update(contestRef, {
          entryCount: admin.firestore.FieldValue.increment(1),
        });

        // IMPORTANT: when we count it, it is officially claimed
        tx.update(entryRef, {
          countedInContest: true,
          countedAt: nowMs(),
          status: "PAID",
        });

        appliedContestIncrement = true;
        changed = true;
      }
    });

    return res.json({
      ok: true,
      paid: true,
      queued,
      duplicate,
      claimedByEntryId,
      updated: changed,
      contestIncremented: appliedContestIncrement,
      contestId: finalContestId,
      entryId: finalEntryId,
      paymentIntentId,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Confirm failed." });
  }
});

export default r;