// backend/lib/stripe.js
import Stripe from "stripe";

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();

export const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
      // Pin API version for stability (avoid breaking changes)
      apiVersion: "2023-10-16",
      // Small resiliency boost for transient network errors
      maxNetworkRetries: 2,
    })
  : null;

export const STRIPE_WEBHOOK_SECRET =
  String(process.env.STRIPE_WEBHOOK_SECRET || "").trim() || "";
