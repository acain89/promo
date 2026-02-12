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
    // Allow either FB_* or FIREBASE_* env var names
    const projectId = readEnv("FB_PROJECT_ID", "FIREBASE_PROJECT_ID");
    const clientEmail = readEnv("FB_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");

    // Private key can be provided as raw PEM or base64 PEM (either FB_* or FIREBASE_*)
    const b64 = readEnv("FB_PRIVATE_KEY_B64", "FIREBASE_PRIVATE_KEY_B64");
    const raw =
      b64
        ? Buffer.from(b64, "base64").toString("utf8")
        : readEnv("FB_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY");

    const privateKey = String(raw || "")
      .replace(/^"(.*)"$/s, "$1")
      .replace(/^'(.*)'$/s, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!projectId || !clientEmail) {
      throw new Error(
        "FB_PROJECT_ID and FB_CLIENT_EMAIL must be configured. " +
          `Got projectId=${projectId ? "set" : "missing"}, clientEmail=${clientEmail ? "set" : "missing"}. ` +
          "Accepted keys: FB_PROJECT_ID/FIREBASE_PROJECT_ID and FB_CLIENT_EMAIL/FIREBASE_CLIENT_EMAIL."
      );
    }

    if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
      throw new Error(
        "FB private key is not a valid PEM. " +
          `Got length=${privateKey.length}, startsWith="${privateKey.slice(0, 30)}"... ` +
          "Accepted keys: FB_PRIVATE_KEY/FIREBASE_PRIVATE_KEY or FB_PRIVATE_KEY_B64/FIREBASE_PRIVATE_KEY_B64."
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
