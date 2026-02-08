// backend/lib/stripe.js
import Stripe from "stripe";

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();

export const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

export const STRIPE_WEBHOOK_SECRET =
  String(process.env.STRIPE_WEBHOOK_SECRET || "").trim() || "";
