// src/pages/Reset.jsx
import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authReset } from "../lib/api.js";

export default function Reset() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  const token = useMemo(() => String(params.get("token") || "").trim(), [params]);
  const tokenOk = token.length >= 20;

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  async function submit() {
    try {
      setErr("");
      setStatus("");
      setLoading(true);

      if (!tokenOk) throw new Error("Invalid reset link.");
      if (!pw1 || pw1.length < 8) throw new Error("Password must be at least 8 characters.");
      if (pw1.length > 128) throw new Error("Password is too long.");
      if (pw1 !== pw2) throw new Error("Passwords do not match.");

      await authReset({ token, newPassword: pw1 });

      setStatus("Password updated.");
      setPw1("");
      setPw2("");

      setTimeout(() => nav("/login", { replace: true }), 700);
    } catch (e) {
      setErr(e.message || "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="panel">
        <div className="label" style={{ marginBottom: 16 }}>
          Reset Password
        </div>

        {!tokenOk && <div className="error">Invalid or expired reset link.</div>}
        {err && <div className="error">{err}</div>}
        {status && <div className="fineprint">{status}</div>}

        <div className="form">
          <input
            className="field"
            type="password"
            placeholder="New password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoComplete="new-password"
            disabled={!tokenOk || loading}
          />

          <input
            className="field"
            type="password"
            placeholder="Confirm password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            disabled={!tokenOk || loading}
            style={{ marginTop: 10 }}
          />

          <button className="primary" onClick={submit} disabled={!tokenOk || loading}>
            {loading ? "Updating…" : "Update Password"}
          </button>

          <button
            className="secondary"
            onClick={() => nav("/login")}
            disabled={loading}
          >
            Back
          </button>
        </div>
      </section>
    </main>
  );
}
