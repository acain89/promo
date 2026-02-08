// backend/middleware/rateLimit.js
import { nowMs } from "../lib/utils.js";
import { getClientIp } from "../lib/audit.js";

const rlState = new Map();

export default function rateLimit({ routeKey, limit, windowMs }) {
  return (req, res, next) => {
    try {
      const ip = getClientIp(req) || "unknown";
      const key = `${routeKey}:${ip}`;
      const now = nowMs();
      const cur = rlState.get(key);

      if (!cur || now > cur.resetAt) {
        rlState.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }

      cur.count += 1;
      if (cur.count > limit) {
        const retryAfterSec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Too many requests. Please try again shortly." });
      }

      rlState.set(key, cur);
      next();
    } catch {
      next();
    }
  };
}
