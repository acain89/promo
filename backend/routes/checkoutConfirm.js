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
 * - ✅ Enforces "first to be COUNTED claims the number" via a deterministic guess index doc:
 *     entries/{contestId}/guessIndex/{GUESS4}
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

    // ✅ Deterministic guess index lives under entries/{contestId}/guessIndex/{GUESS4}
    const guessIndexCol = db().collection("entries").doc(finalContestId).collection("guessIndex");

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

      const guessIndexRef = guessIndexCol.doc(String(guessNorm));

      // If contest is resolved, do NOT count toward entryCount; mark queued (but still mark paid)
      if (contest.resolved) {
        queued = true;

        tx.update(entryRef, {
          paid: true,
          paidAt: alreadyPaid ? entry.paidAt ?? nowMs() : nowMs(),
          status: "QUEUED",

          // do not count once resolved
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

      /**
       * ✅ Hard uniqueness: if we are about to count this entry (or ensure it stays counted),
       * the guessIndex doc must either:
       * - not exist (we can create it), OR
       * - exist and belong to THIS entryId (idempotent success)
       */
      const idxSnap = await tx.get(guessIndexRef);
      if (idxSnap.exists) {
        const idx = idxSnap.data() || {};
        const ownerEntryId = String(idx.entryId || "").trim();
        if (ownerEntryId && ownerEntryId !== finalEntryId) {
          duplicate = true;
          claimedByEntryId = ownerEntryId;

          // Paid, but NOT counted. (Admin can refund if desired.)
          tx.update(entryRef, {
            paid: true,
            paidAt: alreadyPaid ? entry.paidAt ?? nowMs() : nowMs(),
            status: "DUPLICATE",

            countedInContest: false,
            countedAt: entry.countedAt ?? null,

            duplicateOfEntryId: ownerEntryId,
            duplicateGuess: guessNorm,

            stripeSessionId: session.id || entry.stripeSessionId || null,
            paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
            lastTouchedAt: nowMs(),

            guess: guessNorm,
          });

          changed = true;
          return;
        }
        // If ownerEntryId === finalEntryId, we’re good (idempotent).
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

      // Apply entryCount increment EXACTLY ONCE, and claim the guess index EXACTLY ONCE
      if (!alreadyCounted) {
        // Create/claim the guess index first (or ensure it’s ours)
        if (!idxSnap.exists) {
          tx.create(guessIndexRef, {
            entryId: finalEntryId,
            contestId: finalContestId,
            guess: guessNorm,
            source: "PAID",
            createdAt: nowMs(),
          });
        } else {
          // idx exists and belongs to us (or has empty owner) -> ensure it points to us
          tx.set(
            guessIndexRef,
            {
              entryId: finalEntryId,
              contestId: finalContestId,
              guess: guessNorm,
              source: "PAID",
              updatedAt: nowMs(),
            },
            { merge: true }
          );
        }

        tx.update(contestRef, {
          entryCount: admin.firestore.FieldValue.increment(1),
        });

        tx.update(entryRef, {
          countedInContest: true,
          countedAt: nowMs(),
          status: "PAID",
        });

        appliedContestIncrement = true;
        changed = true;
      } else {
        // Already counted: best-effort ensure the guessIndex exists and is owned by us
        if (!idxSnap.exists) {
          tx.create(guessIndexRef, {
            entryId: finalEntryId,
            contestId: finalContestId,
            guess: guessNorm,
            source: "PAID",
            createdAt: nowMs(),
            recovered: true,
          });
          changed = true;
        } else {
          const idx = idxSnap.data() || {};
          const ownerEntryId = String(idx.entryId || "").trim();
          if (!ownerEntryId) {
            tx.set(
              guessIndexRef,
              { entryId: finalEntryId, contestId: finalContestId, guess: guessNorm, source: "PAID", updatedAt: nowMs() },
              { merge: true }
            );
            changed = true;
          }
        }
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