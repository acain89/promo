// backend/middleware/auth.js
import { SESSION_COOKIE } from "../lib/config.js";
import { parseCookies } from "../lib/utils.js";
import { readSessionToken } from "../lib/session.js";

export default function requireUser(req, res, next) {
  try {
    // Always prevent caching on protected routes
    res.setHeader("Cache-Control", "no-store");

    // Prefer cookie-parser if present (backend/index.js uses cookieParser())
    const cookies = req.cookies || parseCookies(req);
    const token = String(cookies?.[SESSION_COOKIE] || "").trim();

    if (!token) return res.status(401).json({ error: "Unauthorized." });

    const session = readSessionToken(token);
    if (!session?.uid) return res.status(401).json({ error: "Unauthorized." });

    // Attach user identity to request
    req.user = { id: session.uid };

    return next();
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "Unauthorized." });
  }
}
