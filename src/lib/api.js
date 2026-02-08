// src/lib/api.js

// If you deploy frontend+backend separately on Render, set VITE_API_BASE to your backend URL.
// Example: VITE_API_BASE=https://your-backend.onrender.com
const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

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

async function readJsonSafe(res) {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt };
  }
}

function makeHeaders(extra = {}, includeAdminToken = true) {
  const h = { ...extra };
  if (includeAdminToken && ADMIN_TOKEN) {
    h.Authorization = `Bearer ${ADMIN_TOKEN}`;
  }
  return h;
}

async function request(method, path, body, opts = {}) {
  const url = buildUrl(path);

  const includeAdminToken = opts.includeAdminToken !== false;
  const headers = makeHeaders(opts.headers || {}, includeAdminToken);

  const init = {
    method,
    headers,
    credentials: "include", // ✅ REQUIRED for session cookie auth
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

  const data = await readJsonSafe(res);

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
