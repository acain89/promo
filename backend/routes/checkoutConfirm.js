// backend/routes/checkoutConfirm.js
import { Router } from "express";
import admin from "firebase-admin";

import requireUser from "../middleware/auth.js";
import { db } from "../lib/firestore.js";
import { stripe } from "../lib/stripe.js";
import { nowMs } from "../lib/utils.js";

const r = Router();

// Keep ONE default here (match your business math)
const DEFAULT_POOL_CONTRIB_CENTS = 455; // $4.55

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

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
 * Resolve contribution for a contest, in priority order:
 * 1) contest.poolContributionCentsLocked
 * 2) contest.poolContributionCents (per-contest editable via Admin)
 * 3) config/public.poolContributionCents
 * 4) DEFAULT_POOL_CONTRIB_CENTS
 */
async function resolveContributionCentsTx(tx, contestRef, contest) {
  const locked = clampInt(contest?.poolContributionCentsLocked, 0, 5000);
  if (locked != null) return locked;

  const perContest = clampInt(contest?.poolContributionCents, 0, 5000);
  if (perContest != null) return perContest;

  const cfg = await getPoolContributionCentsTx(tx);
  return clampInt(cfg, 0, 5000) ?? DEFAULT_POOL_CONTRIB_CENTS;
}

/**
 * GET /api/checkout/confirm?session_id=cs_test_...
 * - Verifies session is paid
 * - Marks entry PAID
 * - Increments contest entryCount + prizeCents (exactly once)
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

    // Metadata must identify which entry to mark paid
    const contestId = String(session.metadata?.contestId || "").trim();
    const entryIdFromMeta =
      String(session.metadata?.entryId || "").trim() ||
      String(session.metadata?.userId || "").trim();

    // Only allow confirming YOUR OWN entry (requireUser)
    const userId = String(req.user?.id || "").trim();
    const finalContestId = contestId;
    const finalEntryId = entryIdFromMeta || userId;

    if (!finalContestId) {
      return res.status(400).json({
        ok: false,
        error: "Missing contestId metadata on session.",
      });
    }

    // Security: never let user confirm someone else's entry doc
    if (!userId || finalEntryId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden.",
      });
    }

    const entryRef = db()
      .collection("entries")
      .doc(finalContestId)
      .collection("items")
      .doc(finalEntryId);

    const contestRef = db().collection("contests").doc(finalContestId);

    let changed = false;
    let appliedContestIncrement = false;

    await db().runTransaction(async (tx) => {
      const [entrySnap, contestSnap] = await Promise.all([tx.get(entryRef), tx.get(contestRef)]);
      if (!entrySnap.exists) throw new Error("Entry doc not found for this session.");
      if (!contestSnap.exists) throw new Error("Contest doc not found for this session.");

      const entry = entrySnap.data() || {};
      const contest = contestSnap.data() || {};

      // Idempotency flags
      const alreadyPaid = entry.paid === true;
      const alreadyCounted = entry.countedInContest === true;

      // If contest is resolved, do NOT add to pool; mark queued (but still mark paid)
      if (contest.resolved) {
        if (!alreadyPaid) {
          tx.update(entryRef, {
            paid: true,
            paidAt: nowMs(),
            status: "QUEUED",
            stripeSessionId: session.id || null,
            paymentIntentId: paymentIntentId || null,
            lastTouchedAt: nowMs(),
          });
          changed = true;
        } else {
          // keep IDs fresh + ensure QUEUED status
          const curStatus = String(entry.status || "").toUpperCase();
          tx.update(entryRef, {
            status: curStatus === "QUEUED" ? entry.status : "QUEUED",
            stripeSessionId: session.id || entry.stripeSessionId || null,
            paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
            lastTouchedAt: nowMs(),
          });
        }
        return;
      }

      // Mark entry paid (idempotent)
      if (!alreadyPaid) {
        tx.update(entryRef, {
          paid: true,
          paidAt: nowMs(),
          status: "PAID",
          stripeSessionId: session.id || null,
          paymentIntentId: paymentIntentId || null,
          lastTouchedAt: nowMs(),
        });
        changed = true;
      } else {
        // keep lastTouchedAt + ids fresh (helps your UNPAID expiry logic hygiene)
        tx.update(entryRef, {
          stripeSessionId: session.id || entry.stripeSessionId || null,
          paymentIntentId: paymentIntentId || entry.paymentIntentId || null,
          lastTouchedAt: nowMs(),
        });
      }

      // Apply contest increment EXACTLY ONCE
      if (!alreadyCounted) {
        const lockCents = await resolveContributionCentsTx(tx, contestRef, contest);

        // Lock it if missing so future accounting stays consistent
        const lockedExisting = clampInt(contest.poolContributionCentsLocked, 0, 5000);
        if (lockedExisting == null) {
          tx.update(contestRef, { poolContributionCentsLocked: lockCents });
        }

        tx.update(contestRef, {
          entryCount: admin.firestore.FieldValue.increment(1),
          prizeCents: admin.firestore.FieldValue.increment(lockCents),
        });

        // Flag entry so confirm/webhook can never double-increment
        tx.update(entryRef, {
          countedInContest: true,
          countedAt: nowMs(),
        });

        appliedContestIncrement = true;
        changed = true;
      }
    });

    return res.json({
      ok: true,
      paid: true,
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
