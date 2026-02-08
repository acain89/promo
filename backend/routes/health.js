// backend/routes/health.js
import { Router } from "express";
import {
  NODE_ENV,
  CHICAGO_TZ,
  CUTOFF_HOUR_24,
  CUTOFF_MINUTE,
  AMOE_TARGET_COUNT,
  AMOE_PRIZE_CENTS,
} from "../lib/config.js";
import { nowMs } from "../lib/utils.js";

const r = Router();

r.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    serverNow: nowMs(),
    cutoffHour: CUTOFF_HOUR_24,
    cutoffMinute: CUTOFF_MINUTE,
    tz: CHICAGO_TZ,
    amoeTarget: AMOE_TARGET_COUNT,
    amoePrizeCents: AMOE_PRIZE_CENTS,
  });
});

export default r;
