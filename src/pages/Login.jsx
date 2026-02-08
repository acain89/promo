// src/pages/Login.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import {
  authForgot,
  authLogin,
  authMe,
  authSignup,
} from "../lib/api.js";

export default function Login() {
  const nav = useNavigate();

  // LOGIN | SIGNUP | FORGOT
  const [view, setView] = useState("LOGIN");

  const [un, setUn] = useState("");
  const [pw, setPw] = useState("");

  const [suUn, setSuUn] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");

  const [fpEmail, setFpEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    // If already authed, Join/Login should route to Profile immediately.
    (async () => {
      try {
        const r = await authMe();
        if (r?.ok) {
          nav("/profile", { replace: true });
          return;
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  function titleFor(v) {
    if (v === "SIGNUP") return "Create Account";
    if (v === "FORGOT") return "Reset Password";
    return "Join / Log In";
  }

  async function doLogin() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);

      if (un.trim().length < 2) throw new Error("Enter username.");
      if (!pw) throw new Error("Enter password.");

      await authLogin({ username: un.trim(), password: pw });

      const r = await authMe();
      if (!r?.ok) throw new Error("Login failed.");

      setPw("");
      nav("/profile", { replace: true });
    } catch (e) {
      setErr(e.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doSignup() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);

      if (suUn.trim().length < 2) throw new Error("Username too short.");
      if (!suEmail.includes("@")) throw new Error("Invalid email.");
      if (!suPw || suPw.length < 8) throw new Error("Password must be at least 8 characters.");

      await authSignup({
        username: suUn.trim(),
        email: suEmail.trim(),
        password: suPw,
      });

      const r = await authMe();
      if (!r?.ok) throw new Error("Signup failed.");

      setSuPw("");
      nav("/profile", { replace: true });
    } catch (e) {
      setErr(e.message || "Signup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doForgot() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);

      if (!fpEmail.includes("@")) throw new Error("Enter a valid email.");

      await authForgot({ email: fpEmail.trim() });
      setStatus("If the email exists, a reset link will be sent.");
    } catch (e) {
      setErr(e.message || "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = loading || busy;

  return (
    <PanelShell
      label="JOIN / LOGIN"
      labelClass="join"
      footer={
        <div className="form" style={{ marginTop: 0 }}>
          <button className="secondary" onClick={() => nav("/")} disabled={disabled}>
            Back to Landing
          </button>
        </div>
      }
    >
      {loading ? <div className="fineprint">Loading…</div> : null}

      {!loading && (
        <>
          <div className="label" style={{ textAlign: "center" }}>
            {titleFor(view)}
          </div>

          {err ? <div className="error">{err}</div> : null}
          {status ? <div className="fineprint">{status}</div> : null}

          {/* LOGIN */}
          {view === "LOGIN" && (
            <div className="form">
              <input
                className="field"
                placeholder="Username"
                value={un}
                onChange={(e) => setUn(e.target.value)}
                autoComplete="username"
                disabled={disabled}
              />

              <input
                className="field"
                type="password"
                placeholder="Password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                disabled={disabled}
              />

              <button className="primary" onClick={doLogin} disabled={disabled}>
                Log In
              </button>

              <button className="secondary" onClick={() => setView("SIGNUP")} disabled={disabled}>
                Create Account
              </button>

              <button className="secondary" onClick={() => setView("FORGOT")} disabled={disabled}>
                Forgot Password
              </button>
            </div>
          )}

          {/* SIGNUP */}
          {view === "SIGNUP" && (
            <div className="form">
              <input
                className="field"
                placeholder="Username"
                value={suUn}
                onChange={(e) => setSuUn(e.target.value)}
                disabled={disabled}
              />

              <input
                className="field"
                placeholder="Email"
                value={suEmail}
                onChange={(e) => setSuEmail(e.target.value)}
                disabled={disabled}
              />

              <input
                className="field"
                type="password"
                placeholder="Password (8+ chars)"
                value={suPw}
                onChange={(e) => setSuPw(e.target.value)}
                disabled={disabled}
              />

              <button className="primary" onClick={doSignup} disabled={disabled}>
                Create Account
              </button>

              <button className="secondary" onClick={() => setView("LOGIN")} disabled={disabled}>
                Back
              </button>
            </div>
          )}

          {/* FORGOT */}
          {view === "FORGOT" && (
            <div className="form">
              <input
                className="field"
                placeholder="Email"
                value={fpEmail}
                onChange={(e) => setFpEmail(e.target.value)}
                disabled={disabled}
              />

              <button className="primary" onClick={doForgot} disabled={disabled}>
                Send Reset Link
              </button>

              <button className="secondary" onClick={() => setView("LOGIN")} disabled={disabled}>
                Back
              </button>
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
