// src/pages/Join.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { authForgot, authLogin, authMe, authSignup } from "../lib/api.js";

export default function Join() {
  const nav = useNavigate();

  // LOGIN | SIGNUP | FORGOT
  const [view, setView] = useState("LOGIN");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  // login fields
  const [un, setUn] = useState("");
  const [pw, setPw] = useState("");

  // signup fields
  const [suUn, setSuUn] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPw, setSuPw] = useState("");

  // forgot fields
  const [fpEmail, setFpEmail] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const m = await authMe();
        if (m?.ok) {
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

  async function doLogin() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);

      if (un.trim().length < 2) throw new Error("Enter username.");
      if (!pw) throw new Error("Enter password.");

      await authLogin({ username: un.trim(), password: pw });

      const m = await authMe();
      if (!m?.ok) throw new Error("Login failed.");

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
      if (!suEmail.includes("@")) throw new Error("Enter a valid email.");
      if (!suPw || suPw.length < 8) throw new Error("Password must be at least 8 characters.");

      await authSignup({
        username: suUn.trim(),
        email: suEmail.trim(),
        password: suPw,
      });

      const m = await authMe();
      if (!m?.ok) throw new Error("Signup failed.");

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

  function resetMessages() {
    setErr("");
    setStatus("");
  }

  return (
    <PanelShell
      /* Match Landing: no visible header label */
      label=""
      labelClass="join"
      footer={
        <div className="form" style={{ marginTop: 0 }}>
          <button className="secondary" onClick={() => nav("/")} disabled={loading || busy}>
            Back to Landing
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {loading && <div className="fineprint">Loading…</div>}

        {!loading && (
          <>
            {err && <div className="error">{err}</div>}
            {status && <div className="fineprint">{status}</div>}

            {/* LOGIN */}
            {view === "LOGIN" && (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) doLogin();
                }}
              >
                <input
                  className="field"
                  placeholder="Username"
                  value={un}
                  onChange={(e) => setUn(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                />

                <input
                  className="field"
                  type="password"
                  placeholder="Password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                />

                <button className="primary" type="submit" disabled={busy}>
                  Log In
                </button>

                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView("SIGNUP");
                  }}
                  disabled={busy}
                >
                  Create Account
                </button>

                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView("FORGOT");
                  }}
                  disabled={busy}
                >
                  Forgot Password
                </button>
              </form>
            )}

            {/* SIGNUP */}
            {view === "SIGNUP" && (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) doSignup();
                }}
              >
                <input
                  className="field"
                  placeholder="Username"
                  value={suUn}
                  onChange={(e) => setSuUn(e.target.value)}
                  disabled={busy}
                  autoComplete="username"
                />

                <input
                  className="field"
                  placeholder="Email"
                  value={suEmail}
                  onChange={(e) => setSuEmail(e.target.value)}
                  disabled={busy}
                  autoComplete="email"
                />

                <input
                  className="field"
                  type="password"
                  placeholder="Password"
                  value={suPw}
                  onChange={(e) => setSuPw(e.target.value)}
                  disabled={busy}
                  autoComplete="new-password"
                />

                <button className="primary" type="submit" disabled={busy}>
                  Create Account
                </button>

                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView("LOGIN");
                  }}
                  disabled={busy}
                >
                  Back
                </button>
              </form>
            )}

            {/* FORGOT */}
            {view === "FORGOT" && (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) doForgot();
                }}
              >
                <input
                  className="field"
                  placeholder="Email"
                  value={fpEmail}
                  onChange={(e) => setFpEmail(e.target.value)}
                  disabled={busy}
                  autoComplete="email"
                />

                <button className="primary" type="submit" disabled={busy}>
                  Send Reset Link
                </button>

                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView("LOGIN");
                  }}
                  disabled={busy}
                >
                  Back
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </PanelShell>
  );
}
