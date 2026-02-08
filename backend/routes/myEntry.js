import express from "express";

const r = express.Router();

/**
 * Minimal "my entry" endpoint so server boots on Render.
 * Assumes auth middleware has already set req.user = { id } when needed.
 */
r.get("/api/my/entry", async (req, res) => {
  res.json({ ok: true, userId: req.user?.id || null, entry: null });
});

export default r;
