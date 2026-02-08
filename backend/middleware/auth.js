// backend/middleware/auth.js
import { SESSION_COOKIE } from "../lib/config.js";
import { parseCookies } from "../lib/utils.js";
import { readSessionToken } from "../lib/session.js";

export default function requireUser(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE] || "";
    const sess = readSessionToken(token);
    if (!sess) return res.status(401).json({ error: "Unauthorized." });

    req.user = { id: sess.uid };
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized." });
  }
}
