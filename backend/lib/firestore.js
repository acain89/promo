// backend/lib/firestore.js
import admin from "firebase-admin";

let _db = null;

function readEnv(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

export function initFirestore() {
  if (_db) return _db;

  if (!admin.apps.length) {
    // Support BOTH env naming conventions:
    // FB_* (what our code expects) OR FIREBASE_* (what you had in Render)
    const projectId = readEnv("FB_PROJECT_ID", "FIREBASE_PROJECT_ID");
    const clientEmail = readEnv("FB_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");

    // Private key: allow raw PEM OR base64
    const raw =
      process.env.FB_PRIVATE_KEY_B64
        ? Buffer.from(String(process.env.FB_PRIVATE_KEY_B64).trim(), "base64").toString("utf8")
        : process.env.FIREBASE_PRIVATE_KEY_B64
        ? Buffer.from(String(process.env.FIREBASE_PRIVATE_KEY_B64).trim(), "base64").toString("utf8")
        : readEnv("FB_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY");

    const privateKey = String(raw || "")
      .replace(/^"(.*)"$/s, "$1")
      .replace(/^'(.*)'$/s, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!projectId || !clientEmail) {
      throw new Error(
        "FB_PROJECT_ID / FB_CLIENT_EMAIL not found. " +
          `Got projectId=${projectId ? "set" : "missing"}, clientEmail=${clientEmail ? "set" : "missing"}. ` +
          "Set FB_PROJECT_ID + FB_CLIENT_EMAIL (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL) on the BACKEND Render service."
      );
    }

    if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
      throw new Error(
        "FB private key is not a valid PEM. " +
          `Got length=${privateKey.length}, startsWith="${privateKey.slice(0, 30)}"...`
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  _db = admin.firestore();
  return _db;
}

export function db() {
  if (!_db) initFirestore();
  return _db;
}

export { admin };
