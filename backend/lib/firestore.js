// backend/lib/firestore.js
import admin from "firebase-admin";

let _db = null;

export function initFirestore() {
  if (_db) return _db;

  if (!admin.apps.length) {
    const raw =
      process.env.FB_PRIVATE_KEY_B64
        ? Buffer.from(String(process.env.FB_PRIVATE_KEY_B64).trim(), "base64").toString("utf8")
        : String(process.env.FB_PRIVATE_KEY || "");

    const privateKey = raw
      .replace(/^"(.*)"$/s, "$1")
      .replace(/^'(.*)'$/s, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
      throw new Error(
        "FB private key is not a valid PEM. " +
          `Got length=${privateKey.length}, startsWith="${privateKey.slice(0, 30)}"...`
      );
    }

    const projectId = String(process.env.FB_PROJECT_ID || "").trim();
    const clientEmail = String(process.env.FB_CLIENT_EMAIL || "").trim();
    if (!projectId || !clientEmail) {
      throw new Error("FB_PROJECT_ID and FB_CLIENT_EMAIL must be configured.");
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
