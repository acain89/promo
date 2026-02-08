// src/lib/api.js
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const TOKEN_KEY = "admin_token_v1";

/* =========================================================
   ADMIN TOKEN (sessionStorage)
========================================================= */

function getAdminToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token) {
  try {
    if (!token) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

/* =========================================================
   CORE FETCH HELPERS (cookie-session)
========================================================= */

async function readJson(res) {
  const j = await res.json().catch(() => ({}));
  return j;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include", // REQUIRED for cookie sessions
  });

  const j = await readJson(res);
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}

export async function apiPost(path, body, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  // Admin endpoints still use Bearer token (separate from user cookie session)
  if (path.startsWith("/api/admin/")) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    credentials: "include", // REQUIRED for cookie sessions
    body: JSON.stringify(body || {}),
  });

  const j = await readJson(res);
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}

/* =========================================================
   AUTH HELPERS (cookie-session)
   backend routes:
   POST /api/auth/signup
   POST /api/auth/login
   POST /api/auth/logout
   GET  /api/me
   POST /api/auth/forgot
   POST /api/auth/reset
========================================================= */

export function authSignup({ username, email, password }) {
  return apiPost("/api/auth/signup", { username, email, password });
}

export function authLogin({ username, password }) {
  return apiPost("/api/auth/login", { username, password });
}

export function authLogout() {
  return apiPost("/api/auth/logout", {});
}

export function authMe() {
  return apiGet("/api/me");
}

export function authForgot({ email }) {
  return apiPost("/api/auth/forgot", { email });
}

export function authReset({ token, newPassword }) {
  return apiPost("/api/auth/reset", { token, newPassword });
}
