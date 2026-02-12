// src/pages/Admin.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiPost, setAdminToken } from "../lib/api.js";

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function formatTS(ms) {
  if (!ms) return "—";
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const v = Number.isFinite(n) ? n : 0;
  return (v / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function downloadJson(filename, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {}
}

// Best-effort extract of error details from thrown objects
function errMsg(e, fallback = "Request failed.") {
  const m =
    e?.message ||
    e?.error ||
    e?.response?.data?.error ||
    e?.response?.error ||
    e?.data?.error ||
    e?.toString?.();
  return String(m || fallback);
}

function LoginModal({ open, onClose, onSubmit, err, busy }) {
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode("");
  }, [open]);

  if (!open) return null;

  const canSubmit = !!String(code || "").trim() && !busy;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Admin Login"
    >
      <div
        style={{
          width: "min(520px, 92vw)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(15,15,18,0.92)",
          padding: 16,
          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Admin Code</h3>
          <button className="secondary" onClick={onClose} style={{ padding: "8px 10px" }} disabled={busy}>
            Close
          </button>
        </div>

        <p style={{ marginTop: 8, marginBottom: 12, opacity: 0.8, fontSize: 13 }}>
          Enter the admin passcode to unlock controls.
        </p>

        <input
          className="field"
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) onSubmit?.(code);
            if (e.key === "Escape" && !busy) onClose?.();
          }}
          placeholder="••••••"
          style={{ width: "100%", maxWidth: "100%", padding: "12px 12px" }}
          disabled={busy}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSubmit?.(code)} disabled={!canSubmit}>
            {busy ? "Unlocking..." : "Unlock"}
          </button>
        </div>

        {err ? <div style={{ marginTop: 10, color: "#ffb2b2", fontSize: 13 }}>{err}</div> : null}
      </div>
    </div>
  );
}

export default function Admin() {
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [state, setState] = useState(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  // PAID
  const [paidTargetRaw, setPaidTargetRaw] = useState("");
  const [paidPreview, setPaidPreview] = useState(null);
  const [showPaidPreviewDetails, setShowPaidPreviewDetails] = useState(false);

  // AMOE
  const [amoeName, setAmoeName] = useState("");
  const [amoeEmail, setAmoeEmail] = useState("");
  const [amoeAddress, setAmoeAddress] = useState("");
  const [amoeGuessRaw, setAmoeGuessRaw] = useState("");

  const [amoeTargetRaw, setAmoeTargetRaw] = useState("");
  const [amoePreview, setAmoePreview] = useState(null);
  const [showAmoePreviewDetails, setShowAmoePreviewDetails] = useState(false);

  // ✅ USER LOOKUP (Paid winner email by UN)
  const [lookupUN, setLookupUN] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupResult, setLookupResult] = useState(null);

  function paidDigits() {
    const mode = String(state?.activeContest?.mode || "PICK3");
    return mode === "DAILY4" ? 4 : 3;
  }

  const paidTarget = useMemo(() => {
    const d = paidDigits();
    return onlyDigits(paidTargetRaw).slice(0, d);
  }, [paidTargetRaw, state]);

  const amoeGuess = useMemo(() => onlyDigits(amoeGuessRaw).slice(0, 3), [amoeGuessRaw]);
  const amoeTarget = useMemo(() => onlyDigits(amoeTargetRaw).slice(0, 3), [amoeTargetRaw]);

  async function adminLoginSubmit(code) {
    const attempt = String(code || "").trim();
    if (!attempt || loginBusy) return;

    try {
      setLoginBusy(true);
      setErr("");
      setStatus("");

      const r = await apiPost("/api/admin/login", { code: attempt });
      if (!r?.token) throw new Error("Login did not return a token.");
      setAdminToken(r.token);

      setUnlocked(true);
      setLoginOpen(false);
      setStatus("Admin unlocked.");
    } catch (e) {
      setErr(errMsg(e, "Login failed."));
    } finally {
      setLoginBusy(false);
    }
  }

  async function refresh() {
    if (!unlocked) return;
    try {
      setErr("");
      const s = await apiPost("/api/admin/state", {});
      setState(s);
    } catch (e) {
      setErr(errMsg(e, "Failed to load admin state."));
    }
  }

  useEffect(() => {
    if (!unlocked) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function withBusy(fn) {
    if (busy) return;
    try {
      setBusy(true);
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function setContestMode(nextMode) {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");
        await apiPost("/api/admin/mode", { mode: nextMode });
        setStatus(`Mode set to ${nextMode}.`);
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to set mode."));
      }
    });
  }

  async function paidDoPreview() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");
        setPaidPreview(null);
        setShowPaidPreviewDetails(false);

        const d = paidDigits();
if (paidTarget.length !== d) throw new Error(`Enter exactly ${d} digits for Paid target.`);

const r = await apiPost("/api/admin/paid/preview", { targetNumber: paidTarget });
setPaidPreview(r);

// ✅ Autofill lookup box with winner UN (and clear prior lookup result/errors)
if (r?.winnerUN) {
  setLookupUN(String(r.winnerUN));
  setLookupErr("");
  setLookupResult(null);
}

setStatus("Paid preview ready (not posted).");
} catch (e) {
setErr(errMsg(e, "Paid preview failed."));
}
});
}


  async function paidPostResults() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        const d = paidDigits();
        if (paidTarget.length !== d) throw new Error(`Enter exactly ${d} digits for Paid target.`);

        const confirmText =
          `POST PAID RESULTS as ${paidTarget}?\n\n` +
          `This action is IRREVERSIBLE.\n` +
          `Winner: Closest DFT, then earliest timestamp.\n\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/resolve", { targetNumber: paidTarget });

        setStatus("Paid results posted.");
        setPaidPreview(null);
        setShowPaidPreviewDetails(false);
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to post paid results."));
      }
    });
  }

  async function paidActivateSunday() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        const confirmText =
          `ACTIVATE upcoming paid contest?\n\n` +
          `This will make queued paid entries visible (entryCount + prize) for the active contest.\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/paid/activate", {});
        setStatus("Paid contest activated. Queued entries are now applied.");
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to activate contest."));
      }
    });
  }

  async function exportPaid() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");
        const r = await apiPost("/api/admin/export/paid", {});
        downloadJson(`drawnfray_paid_export_${r?.payload?.contest?.id || "contest"}.json`, r.payload || r);
        setStatus("Paid export downloaded.");
      } catch (e) {
        setErr(errMsg(e, "Paid export failed."));
      }
    });
  }

  async function exportAmoe() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");
        const r = await apiPost("/api/admin/export/amoe", {});
        downloadJson(`drawnfray_amoe_export_cycle_${r?.payload?.cycleId || "cycle"}.json`, r.payload || r);
        setStatus("AMOE export downloaded.");
      } catch (e) {
        setErr(errMsg(e, "AMOE export failed."));
      }
    });
  }

  async function amoeAdd() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        const nm = String(amoeName || "").trim();
        const em = String(amoeEmail || "").trim();
        const ad = String(amoeAddress || "").trim();

        if (nm.length < 2) throw new Error("AMOE name required.");
        if (!em.includes("@")) throw new Error("AMOE email required.");
        if (ad.length < 6) throw new Error("AMOE address required.");
        if (amoeGuess.length !== 3) throw new Error("AMOE guess must be 3 digits.");

        await apiPost("/api/admin/amoe/add", { name: nm, email: em, address: ad, guess: amoeGuess });

        setAmoeGuessRaw("");
        setStatus("AMOE entry added.");
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to add AMOE."));
      }
    });
  }

  async function amoeDoPreview() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");
        setAmoePreview(null);
        setShowAmoePreviewDetails(false);

        if (amoeTarget.length !== 3) throw new Error("Enter exactly 3 digits for AMOE target.");

        const r = await apiPost("/api/admin/amoe/preview", { targetNumber: amoeTarget });
        setAmoePreview(r);
        setStatus("AMOE preview ready (not posted).");
      } catch (e) {
        setErr(errMsg(e, "AMOE preview failed."));
      }
    });
  }

  async function amoeResolve() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        if (amoeTarget.length !== 3) throw new Error("Enter exactly 3 digits for AMOE target.");

        const confirmText =
          `RESOLVE AMOE as ${amoeTarget}?\n\n` +
          `This action is IRREVERSIBLE.\n` +
          `Winner: Closest DFT, then earliest AMOE timestamp.\n\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/amoe/resolve", { targetNumber: amoeTarget });
        setStatus("AMOE results posted.");
        setAmoePreview(null);
        setShowAmoePreviewDetails(false);
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to resolve AMOE."));
      }
    });
  }

  async function amoeResetCycle() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        const confirmText =
          `RESET AMOE CYCLE?\n\n` +
          `This starts collecting a new AMOE set toward 500.\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/amoe/reset-cycle", {});
        setAmoePreview(null);
        setShowAmoePreviewDetails(false);
        setStatus("AMOE cycle reset.");
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to reset AMOE cycle."));
      }
    });
  }

  // ✅ User lookup action
  async function lookupUserEmail() {
    const un = String(lookupUN || "").trim();
    if (!un || lookupBusy) return;

    try {
      setLookupBusy(true);
      setLookupErr("");
      setLookupResult(null);

      const r = await apiPost("/api/admin/user-lookup", { username: un });
      if (!r?.ok || !r?.user) throw new Error(r?.error || "User not found.");

      setLookupResult(r.user);
    } catch (e) {
      setLookupErr(errMsg(e, "Lookup failed."));
    } finally {
      setLookupBusy(false);
    }
  }

  // Derived (safe) UI values
  const active = state?.activeContest || null;
  const paidActivated = !!active?.activatedAt;
  const paidMode = String(active?.mode || "PICK3");

  // Disable “post” when last contest is already resolved (backend also blocks)
  const paidResolved = !!state?.lastContest?.resolved;

  const amoe = state?.amoe || null;
  const amoeStatus = String(amoe?.status || "COLLECTING");
  const amoeCount = Number(amoe?.count || 0);
  const amoeTargetCount = Number(amoe?.targetCount || 500);

  const pageStyle = {
    minHeight: "100svh",
    width: "100%",
    display: "grid",
    placeItems: "center",
    padding: 18,
  };

  const cardStyle = {
  width: "min(1200px, 96vw)",
  maxHeight: "92vh",
  overflowY: "auto",
  overflowX: "hidden",
  margin: "0 auto",
  paddingRight: 6, // prevents scrollbar overlap
};


  const twoColStyle = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 0,
    alignItems: "start",
  };

  const panelStyle = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
  };

  const compactRow = { display: "flex", justifyContent: "space-between", gap: 10 };

  if (!unlocked) {
    return (
      <main className="adminPage" style={pageStyle}>
        <div className="adminCard" style={{ ...cardStyle, maxWidth: 560 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Admin Panel</h2>
          <p style={{ marginTop: 0, marginBottom: 12, opacity: 0.8 }}>Desktop-only. Operational controls.</p>

          <div className="form" style={{ marginTop: 0 }}>
            <button className="primary" onClick={() => setLoginOpen(true)} disabled={loginBusy}>
              Unlock
            </button>
          </div>

          {err ? (
            <p className="status" style={{ color: "#ffb2b2", marginTop: 12 }}>
              {err}
            </p>
          ) : null}
          {status ? (
            <p className="status" style={{ opacity: 0.85, marginTop: 12 }}>
              {status}
            </p>
          ) : null}
        </div>

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onSubmit={adminLoginSubmit}
          err={err}
          busy={loginBusy}
        />
      </main>
    );
  }

  return (
    <main className="adminPage" style={pageStyle}>
      <div className="adminCard" style={{ ...cardStyle, position: "relative" }}>
        {/* tiny controls */}
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            display: "flex",
            gap: 8,
            zIndex: 2,
          }}
        >
          <button
            className="secondary"
            onClick={refresh}
            title="Refresh"
            aria-label="Refresh"
            disabled={busy}
            style={{
              width: 40,
              height: 36,
              padding: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: 12,
              opacity: busy ? 0.6 : 1,
            }}
          >
            ↻
          </button>

          <button
            className="secondary"
            onClick={() => (window.location.href = "/")}
            title="Exit"
            aria-label="Exit to landing"
            disabled={busy}
            style={{
              width: 40,
              height: 36,
              padding: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: 12,
              opacity: busy ? 0.6 : 1,
            }}
          >
            ⤴
          </button>
        </div>

        <div style={twoColStyle}>
          {/* LEFT: PAID */}
          <section style={panelStyle}>
            <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
              Paid Weekly Game
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={compactRow}>
                <span className="label">Mode</span>
                <span className="value">{paidMode}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="secondary" onClick={() => setContestMode("PICK3")} disabled={busy}>
                  Set Mode: PICK3
                </button>
                <button className="secondary" onClick={() => setContestMode("DAILY4")} disabled={busy}>
                  Set Mode: DAILY4 (Hidden)
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label className="fieldLabel" style={{ marginTop: 2 }}>
                  Paid Target Number
                </label>
                <input
                  className="field"
                  type="text"
                  inputMode="numeric"
                  placeholder={paidDigits() === 4 ? "0000–9999" : "000–999"}
                  value={paidTarget}
                  onChange={(e) => setPaidTargetRaw(e.target.value)}
                  disabled={busy}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button className="secondary" onClick={paidDoPreview} disabled={busy || paidTarget.length !== paidDigits()}>
                    Preview Winner
                  </button>
                  <button
                    className="primary"
                    onClick={paidPostResults}
                    disabled={busy || paidTarget.length !== paidDigits() || paidResolved}
                  >
                    Post Paid Results (Irreversible)
                  </button>
                </div>

                {paidPreview ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div className="label">Paid Preview</div>
                      <button
                        className="secondary"
                        onClick={() => setShowPaidPreviewDetails((v) => !v)}
                        style={{ padding: "8px 10px" }}
                        disabled={busy}
                      >
                        {showPaidPreviewDetails ? "Hide" : "Details"}
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      <div style={compactRow}>
                        <span className="label">Winner</span>
                        <span className="value">{paidPreview.winnerUN}</span>
                      </div>
                      <div style={compactRow}>
                        <span className="label">Guess • DFT</span>
                        <span className="value">
                          {paidPreview.guess} • {paidPreview.diff}
                        </span>
                      </div>
                      <div style={compactRow}>
                        <span className="label">Eligible / Total</span>
                        <span className="value">
                          {paidPreview.eligibleCount} / {paidPreview.totalEntries}
                        </span>
                      </div>

                      {showPaidPreviewDetails ? (
                        <>
                          <div style={compactRow}>
                            <span className="label">Target</span>
                            <span className="value">{paidPreview.target}</span>
                          </div>
                          <div style={compactRow}>
                            <span className="label">Timestamp</span>
                            <span className="value">{formatTS(paidPreview.entryTimestamp)}</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    className="secondary"
                    onClick={paidActivateSunday}
                    style={{ borderColor: "rgba(201,75,75,0.45)" }}
                    disabled={busy}
                  >
                    Sunday Reset Action: Activate Current Contest (Apply Queued)
                  </button>

                  <button className="secondary" onClick={exportPaid} disabled={busy}>
                    Export Paid Summary (JSON)
                  </button>

                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                      Operational Snapshot
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={compactRow}>
                          <span className="label">Server</span>
                          <span className="value">{formatTS(state?.serverNow || null)}</span>
                        </div>

                        <div style={compactRow}>
                          <span className="label">Active</span>
                          <span className="value">{active?.endsOn || "—"}</span>
                        </div>

                        <div style={compactRow}>
                          <span className="label">Cutoff</span>
                          <span className="value">{formatTS(active?.cutoffAt || null)}</span>
                        </div>

                        <div style={compactRow}>
                          <span className="label">Visible Prize</span>
                          <span className="value">
                            {dollarsFromCents(active?.prizeCents || 0)} ({Number(active?.entryCount || 0)})
                            {!paidActivated ? " *" : ""}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={compactRow}>
                          <span className="label">Queued (Paid)</span>
                          <span className="value">
                            {Number(state?.paid?.queuedCount || 0)} •{" "}
                            {dollarsFromCents(Number(state?.paid?.queuedPrizeCents || 0))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!paidActivated ? (
                      <div className="miniMuted" style={{ marginTop: 8, textAlign: "center" }}>
                        * Paid prize shown is not activated yet (queued not applied).
                      </div>
                    ) : null}
                  </div>

                  {/* ✅ USER LOOKUP CARD (Paid winners email by UN) */}
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                      User Lookup (Email by UN)
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <input
                        className="field"
                        placeholder="Enter UN (username)"
                        value={lookupUN}
                        onChange={(e) => setLookupUN(e.target.value)}
                        disabled={busy || lookupBusy}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") lookupUserEmail();
                        }}
                      />

                      <button
                        className="secondary"
                        onClick={lookupUserEmail}
                        disabled={busy || lookupBusy || !String(lookupUN || "").trim()}
                      >
                        {lookupBusy ? "Searching…" : "Search"}
                      </button>

                      {lookupErr ? (
                        <div style={{ color: "#ffb2b2", fontSize: 13 }}>{lookupErr}</div>
                      ) : null}

                      {lookupResult ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={compactRow}>
                            <span className="label">UN</span>
                            <span className="value">{lookupResult.username || "—"}</span>
                          </div>
                          <div style={compactRow}>
                            <span className="label">Email</span>
                            <span className="value">{lookupResult.email || "—"}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="miniMuted" style={{ textAlign: "center" }}>
                          Use this after results post to quickly find the winner’s email.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT: AMOE */}
          <section style={panelStyle}>
            <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
              AMOE Pool (Separate Game)
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={compactRow}>
                <span className="label">Status</span>
                <span className="value">{amoeStatus}</span>
              </div>
              <div style={compactRow}>
                <span className="label">Count</span>
                <span className="value">
                  {amoeCount} / {amoeTargetCount}
                </span>
              </div>
              <div style={compactRow}>
                <span className="label">Prize</span>
                <span className="value">{dollarsFromCents(amoe?.prizeCents || 0)}</span>
              </div>

              <div style={{ marginTop: 4, display: "grid", gap: 6 }}>
                <div className="label" style={{ textAlign: "center" }}>
                  Add AMOE Entry (Manual)
                </div>

                <input className="field" placeholder="Full legal name" value={amoeName} onChange={(e) => setAmoeName(e.target.value)} disabled={busy} />
                <input className="field" placeholder="Email" value={amoeEmail} onChange={(e) => setAmoeEmail(e.target.value)} disabled={busy} />
                <input className="field" placeholder="Mailing address" value={amoeAddress} onChange={(e) => setAmoeAddress(e.target.value)} disabled={busy} />
                <input
                  className="field"
                  type="text"
                  inputMode="numeric"
                  placeholder="AMOE guess (000–999)"
                  value={amoeGuess}
                  onChange={(e) => setAmoeGuessRaw(e.target.value)}
                  disabled={busy}
                />

                <button
                  className="primary"
                  onClick={amoeAdd}
                  disabled={busy || amoeStatus !== "COLLECTING" || amoeGuess.length !== 3}
                >
                  Add AMOE Entry
                </button>
              </div>

              <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                <div className="label" style={{ textAlign: "center" }}>
                  Resolve AMOE (when READY)
                </div>

                <input
                  className="field"
                  type="text"
                  inputMode="numeric"
                  placeholder="AMOE target (Pick3 result)"
                  value={amoeTarget}
                  onChange={(e) => setAmoeTargetRaw(e.target.value)}
                  disabled={busy || amoeStatus !== "READY"}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    className="secondary"
                    onClick={amoeDoPreview}
                    disabled={busy || amoeStatus !== "READY" || amoeTarget.length !== 3}
                  >
                    Preview AMOE Winner
                  </button>
                  <button
                    className="primary"
                    onClick={amoeResolve}
                    disabled={busy || amoeStatus !== "READY" || amoeTarget.length !== 3}
                  >
                    Post AMOE Results (Irreversible)
                  </button>
                </div>

                {amoePreview ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div className="label">AMOE Preview</div>
                      <button
                        className="secondary"
                        onClick={() => setShowAmoePreviewDetails((v) => !v)}
                        style={{ padding: "8px 10px" }}
                        disabled={busy}
                      >
                        {showAmoePreviewDetails ? "Hide" : "Details"}
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      <div style={compactRow}>
                        <span className="label">Winner</span>
                        <span className="value">{amoePreview.winnerName}</span>
                      </div>
                      <div style={compactRow}>
                        <span className="label">Guess • DFT</span>
                        <span className="value">
                          {amoePreview.guess} • {amoePreview.diff}
                        </span>
                      </div>
                      <div style={compactRow}>
                        <span className="label">Entries</span>
                        <span className="value">{amoePreview.entryCount}</span>
                      </div>

                      {showAmoePreviewDetails ? (
                        <>
                          <div style={compactRow}>
                            <span className="label">Target</span>
                            <span className="value">{amoePreview.target}</span>
                          </div>
                          <div style={compactRow}>
                            <span className="label">Email</span>
                            <span className="value">{amoePreview.winnerEmail}</span>
                          </div>
                          <div style={compactRow}>
                            <span className="label">Timestamp</span>
                            <span className="value">{formatTS(amoePreview.entryTimestamp)}</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                  <button className="secondary" onClick={exportAmoe} disabled={busy}>
                    Export AMOE Summary (JSON)
                  </button>
                  <button
                    className="secondary"
                    onClick={amoeResetCycle}
                    style={{ borderColor: "rgba(201,75,75,0.45)" }}
                    disabled={busy}
                  >
                    Reset AMOE Cycle (Start New Collection)
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {status ? (
          <p className="status" style={{ opacity: 0.9, marginTop: 10 }}>
            {status}
          </p>
        ) : null}
        {err ? (
          <p className="status" style={{ color: "#ffb2b2", marginTop: 10 }}>
            {err}
          </p>
        ) : null}

        {busy ? (
          <p className="status" style={{ opacity: 0.6, marginTop: 6 }}>
            Working…
          </p>
        ) : null}
      </div>
    </main>
  );
}
