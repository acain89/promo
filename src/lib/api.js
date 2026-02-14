// src/lib/api.js

// IMPORTANT:
// Your frontend is currently serving index.html for "/api/*" (SPA fallback).
// So API_BASE MUST be set (via VITE_API_BASE) to your backend origin, e.g.
// VITE_API_BASE=https://p3d4.onrender.com
//
// This file enforces that in production, and also guards against HTML responses.

const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const IS_PROD = String(import.meta.env.MODE || "").toLowerCase() === "production";

let ADMIN_TOKEN = null;

export function setAdminToken(token) {
  ADMIN_TOKEN = String(token || "").trim() || null;
}

function buildUrl(path) {
  const p = String(path || "");
  if (!p) return API_BASE || "/";
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (!API_BASE) return p;
  return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

function withCacheBust(url) {
  // Only needed for GET, but safe even if called elsewhere (we only call for GET).
  const u = new URL(url, window.location.origin);
  u.searchParams.set("__ts", String(Date.now()));
  return u.toString();
}

async function readJsonStrict(res, urlForError) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const txt = await res.text();

  // If we didn't get JSON, surface a very clear error (this was your exact bug).
  if (!ct.includes("application/json")) {
    const preview = (txt || "").slice(0, 200).replace(/\s+/g, " ").trim();
    const err = new Error(
      `API returned non-JSON (${res.status}) from ${urlForError}. ` +
        `Content-Type="${ct || "unknown"}". ` +
        `Preview: ${preview || "(empty)"}`
    );
    err.status = res.status;
    err.data = { raw: txt, contentType: ct };
    throw err;
  }

  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    const err = new Error(`Invalid JSON from ${urlForError} (${res.status}).`);
    err.status = res.status;
    err.data = { raw: txt, contentType: ct };
    throw err;
  }
}

function makeHeaders(extra = {}, includeAdminToken = true) {
  const h = { ...extra };

  // Force no-cache headers (client-side request)
  if (!h["Cache-Control"] && !h["cache-control"])
    h["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
  if (!h.Pragma && !h.pragma) h.Pragma = "no-cache";
  if (!h.Expires && !h.expires) h.Expires = "0";

  if (includeAdminToken && ADMIN_TOKEN) {
    h.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }
  return h;
}

async function request(method, path, body, opts = {}) {
  // Enforce correct configuration in production.
  // Your hosting currently SPA-fallbacks "/api/*" to index.html, so API_BASE must be set.
  if (IS_PROD && !API_BASE) {
    throw new Error(
      "VITE_API_BASE is not set. In production your frontend will serve index.html for /api/* " +
        "so API calls must target the backend origin (e.g. https://p3d4.onrender.com)."
    );
  }

  let url = buildUrl(path);

  // Cache-bust GETs so landing/reveal always show fresh timer/pool counts.
  if (String(method).toUpperCase() === "GET") {
    url = withCacheBust(url);
  }

  const includeAdminToken = opts.includeAdminToken !== false;
  const headers = makeHeaders(opts.headers || {}, includeAdminToken);

  const init = {
    method,
    headers,
    credentials: "include", // ✅ REQUIRED for session cookie auth
    cache: "no-store", // ✅ tells fetch not to use HTTP cache
  };

  if (body !== undefined) {
    init.headers = {
      "Content-Type": "application/json",
      ...headers,
    };
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const err = new Error(e?.message || "Network error.");
    err.status = 0;
    throw err;
  }

  // Strict JSON read (throws if HTML comes back)
  const data = await readJsonStrict(res, url);

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* =========================================================
   Public helpers
========================================================= */

export async function apiGet(path, opts) {
  return request("GET", path, undefined, opts);
}

export async function apiPost(path, body, opts) {
  return request("POST", path, body, opts);
}

/* =========================================================
   Soft helpers (do not throw)
========================================================= */

export async function apiGetSoft(path, opts) {
  try {
    const data = await apiGet(path, opts);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export async function apiPostSoft(path, body, opts) {
  try {
    const data = await apiPost(path, body, opts);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/* =========================================================
   Auth helpers your pages already use
========================================================= */

export async function authMe() {
  return apiGet("/api/me");
}

export async function authSignup(payload) {
  return apiPost("/api/auth/signup", payload, { includeAdminToken: false });
}

export async function authLogin(payload) {
  return apiPost("/api/auth/login", payload, { includeAdminToken: false });
}

export async function authLogout() {
  return apiPost("/api/auth/logout", {}, { includeAdminToken: false });
}

export async function authForgot(payload) {
  return apiPost("/api/auth/forgot", payload, { includeAdminToken: false });
}

export async function authReset(payload) {
  return apiPost("/api/auth/reset", payload, { includeAdminToken: false });
}
