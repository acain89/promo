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

  // PAID (RESOLVE/PREVIEW operates on LAST contest by design)
  const [paidTargetRaw, setPaidTargetRaw] = useState("");
  const [paidPreview, setPaidPreview] = useState(null);
  const [showPaidPreviewDetails, setShowPaidPreviewDetails] = useState(false);

  // ✅ PAID — POOL CONTRIBUTION CONFIG (per paid entry)
  const [poolUsdRaw, setPoolUsdRaw] = useState(""); // dollars typed, e.g. "4.55"
  const [poolDirty, setPoolDirty] = useState(false);
  const [poolBusy, setPoolBusy] = useState(false);
  const [poolErr, setPoolErr] = useState("");

  // AMOE
  const [amoeName, setAmoeName] = useState("");
  const [amoeEmail, setAmoeEmail] = useState("");
  const [amoeAddress, setAmoeAddress] = useState("");
  const [amoeGuessRaw, setAmoeGuessRaw] = useState("");

  const [amoeTargetRaw, setAmoeTargetRaw] = useState("");
  const [amoePreview, setAmoePreview] = useState(null);
  const [showAmoePreviewDetails, setShowAmoePreviewDetails] = useState(false);

  // USER LOOKUP (Paid winner email by UN)
  const [lookupUN, setLookupUN] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupResult, setLookupResult] = useState(null);

  // ✅ LIFETIME "TOTAL PAID OUT" (MANUAL)
  const [totalPaidBusy, setTotalPaidBusy] = useState(false);
  const [totalPaidErr, setTotalPaidErr] = useState("");
  const [addPaidRaw, setAddPaidRaw] = useState(""); // dollars typed, e.g. "600"
  const [setPaidRaw, setSetPaidRaw] = useState(""); // dollars typed for absolute set

  const active = state?.activeContest || null;
  const last = state?.lastContest || null;

  const totalPaidCents = Number(state?.stats?.totalPaidCents || 0);

  // ✅ Pool config values from backend state
  const poolCfgCents = Number(state?.config?.poolContributionCents);
  const hasPoolCfg = Number.isFinite(poolCfgCents) && poolCfgCents >= 0;

  const activeLockedFromState = Number(state?.config?.activePoolContributionCentsLocked);
  const activeLockedCents =
    Number.isFinite(activeLockedFromState) && activeLockedFromState >= 0
      ? Math.floor(activeLockedFromState)
      : Number.isFinite(Number(active?.poolContributionCentsLocked)) && Number(active?.poolContributionCentsLocked) >= 0
        ? Math.floor(Number(active?.poolContributionCentsLocked))
        : null;

  // Important: preview/resolve use the *last* contest (same as backend default).
  function paidDigits() {
    const mode = String(last?.mode || active?.mode || "PICK3").toUpperCase();
    return mode === "DAILY4" ? 4 : 3;
  }

  const paidTarget = useMemo(() => {
    const d = paidDigits();
    return onlyDigits(paidTargetRaw).slice(0, d);
  }, [paidTargetRaw, last?.mode, active?.mode]);

  const amoeGuess = useMemo(() => onlyDigits(amoeGuessRaw).slice(0, 3), [amoeGuessRaw]);
  const amoeTarget = useMemo(() => onlyDigits(amoeTargetRaw).slice(0, 3), [amoeTargetRaw]);

  function dollarsToCents(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  // ✅ keep the pool USD input synced from backend, unless user is actively editing
  useEffect(() => {
    if (!unlocked) return;
    if (!hasPoolCfg) return;
    if (poolDirty) return;
    setPoolUsdRaw(String((poolCfgCents / 100).toFixed(2)));
  }, [unlocked, hasPoolCfg, poolCfgCents, poolDirty]);

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

  // ✅ Save pool contribution (per paid entry)
  async function savePoolContribution() {
    const cents = dollarsToCents(poolUsdRaw);
    if (cents == null || poolBusy) return;

    await withBusy(async () => {
      try {
        setPoolBusy(true);
        setPoolErr("");
        setStatus("");
        setErr("");

        const confirmText =
          `Update prize pool contribution per paid entry?\n\n` +
          `New default: ${dollarsFromCents(cents)}\n\n` +
          `Note: If the active contest is locked, this applies to future contests only.\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/pool-config/set", { poolContributionCents: cents });

        setPoolDirty(false);
        setStatus(`Pool contribution set to ${dollarsFromCents(cents)} (default).`);
        await refresh();
      } catch (e) {
        setPoolErr(errMsg(e, "Failed to update pool contribution."));
      } finally {
        setPoolBusy(false);
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

        const contestId = String(last?.id || "").trim();
        const body = contestId ? { targetNumber: paidTarget, contestId } : { targetNumber: paidTarget };

        const r = await apiPost("/api/admin/paid/preview", body);
        setPaidPreview(r);

        // Autofill lookup box with winner UN (and clear prior lookup result/errors)
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

        const contestId = String(last?.id || "").trim();

        const confirmText =
          `POST PAID RESULTS as ${paidTarget}?\n\n` +
          `Contest: ${contestId || "(auto)"}\n` +
          `This action is IRREVERSIBLE.\n` +
          `Winner: Closest DFT, then earliest timestamp.\n\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        const body = contestId ? { targetNumber: paidTarget, contestId } : { targetNumber: paidTarget };
        await apiPost("/api/admin/resolve", body);

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
          `ACTIVATE current paid contest?\n\n` +
          `This will apply queued paid entries to the ACTIVE contest (entryCount + prize).\n` +
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

  // User lookup action
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

  // ✅ Total paid out actions (manual)
  async function totalPaidAdd() {
    const addCents = dollarsToCents(addPaidRaw);
    if (addCents == null || totalPaidBusy) return;

    await withBusy(async () => {
      try {
        setTotalPaidBusy(true);
        setTotalPaidErr("");
        setStatus("");
        setErr("");

        const confirmText =
          `ADD to Lifetime Paid Out?\n\n` +
          `Add: ${dollarsFromCents(addCents)}\n` +
          `This should match a payout you actually completed.\n\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/stats/total-paid/add", { addCents });
        setAddPaidRaw("");
        setStatus(`Lifetime Paid Out updated (+${dollarsFromCents(addCents)}).`);
        await refresh();
      } catch (e) {
        setTotalPaidErr(errMsg(e, "Failed to update total paid."));
      } finally {
        setTotalPaidBusy(false);
      }
    });
  }

  async function totalPaidSetAbsolute() {
    const totalCents = dollarsToCents(setPaidRaw);
    if (totalCents == null || totalPaidBusy) return;

    await withBusy(async () => {
      try {
        setTotalPaidBusy(true);
        setTotalPaidErr("");
        setStatus("");
        setErr("");

        const confirmText =
          `SET Lifetime Paid Out (ABSOLUTE)?\n\n` +
          `New value: ${dollarsFromCents(totalCents)}\n\n` +
          `Only use this to correct mistakes.\n` +
          `Type OK to proceed.`;

        const ok = window.prompt(confirmText);
        if (String(ok || "").trim().toUpperCase() !== "OK") return;

        await apiPost("/api/admin/stats/total-paid/set", { totalPaidCents: totalCents });
        setSetPaidRaw("");
        setStatus(`Lifetime Paid Out set to ${dollarsFromCents(totalCents)}.`);
        await refresh();
      } catch (e) {
        setTotalPaidErr(errMsg(e, "Failed to set total paid."));
      } finally {
        setTotalPaidBusy(false);
      }
    });
  }

  // Derived (safe) UI values
  const paidActivated = !!active?.activatedAt;
  const paidMode = String(active?.mode || "PICK3").toUpperCase();

  // Post/preview target should be for the LAST contest (the one you’re resolving).
  const resolveContestId = String(last?.id || "").trim();
  const resolveMode = String(last?.mode || "PICK3").toUpperCase();
  const resolveResolved = !!last?.resolved;

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
                <span className="label">Active Mode</span>
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

              {/* ✅ POOL CONTRIBUTION CONFIG CARD */}
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                  Prize Pool Contribution (Per Paid Entry)
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={compactRow}>
                    <span className="label">Default (Config)</span>
                    <span className="value">{hasPoolCfg ? dollarsFromCents(poolCfgCents) : "—"}</span>
                  </div>

                  <div style={compactRow}>
                    <span className="label">Active Locked</span>
                    <span className="value">{activeLockedCents != null ? dollarsFromCents(activeLockedCents) : "—"}</span>
                  </div>

                  <div className="miniMuted" style={{ textAlign: "center" }}>
                    Change the default anytime. If “Active Locked” is set, changes apply to future contests only.
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 6 }}>
                    <input
                      className="field"
                      inputMode="decimal"
                      placeholder="e.g. 4.55"
                      value={poolUsdRaw}
                      onChange={(e) => {
                        setPoolUsdRaw(e.target.value);
                        setPoolDirty(true);
                        setPoolErr("");
                      }}
                      disabled={busy || poolBusy}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") savePoolContribution();
                      }}
                    />

                    <button
                      className="secondary"
                      onClick={savePoolContribution}
                      disabled={busy || poolBusy || dollarsToCents(poolUsdRaw) == null}
                      style={{ padding: "10px 12px" }}
                    >
                      {poolBusy ? "Saving…" : "Save"}
                    </button>
                  </div>

                  {!poolDirty && hasPoolCfg ? (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      Tip: type a new value (USD), then Save.
                    </div>
                  ) : null}

                  {poolErr ? <div style={{ color: "#ffb2b2", fontSize: 13, textAlign: "center" }}>{poolErr}</div> : null}
                </div>
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                  Resolve Target Applies To (Last Contest)
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={compactRow}>
                    <span className="label">Contest ID</span>
                    <span className="value">{resolveContestId || "—"}</span>
                  </div>
                  <div style={compactRow}>
                    <span className="label">Mode</span>
                    <span className="value">{resolveMode}</span>
                  </div>
                  <div style={compactRow}>
                    <span className="label">Ends On</span>
                    <span className="value">{last?.endsOn || "—"}</span>
                  </div>
                  <div style={compactRow}>
                    <span className="label">Resolved</span>
                    <span className="value">{resolveResolved ? "YES" : "NO"}</span>
                  </div>
                </div>
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
                    disabled={busy || paidTarget.length !== paidDigits() || resolveResolved}
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
                          <div style={compactRow}>
                            <span className="label">Prize</span>
                            <span className="value">{dollarsFromCents(paidPreview.prizeCents || 0)}</span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8 }}>
                  {/* ✅ LIFETIME PAID OUT (MANUAL) */}
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                      Lifetime Paid Out (Manual)
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={compactRow}>
                        <span className="label">Current Total</span>
                        <span className="value">{dollarsFromCents(totalPaidCents)}</span>
                      </div>

                      <div className="miniMuted" style={{ textAlign: "center" }}>
                        Update this after you actually pay winners via your 3rd-party processor.
                      </div>

                      <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                        <input
                          className="field"
                          inputMode="decimal"
                          placeholder="Add amount (USD) e.g. 600"
                          value={addPaidRaw}
                          onChange={(e) => setAddPaidRaw(e.target.value)}
                          disabled={busy || totalPaidBusy}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") totalPaidAdd();
                          }}
                        />

                        <button
                          className="secondary"
                          onClick={totalPaidAdd}
                          disabled={busy || totalPaidBusy || dollarsToCents(addPaidRaw) == null}
                        >
                          {totalPaidBusy ? "Updating…" : "Add to Total Paid Out"}
                        </button>

                        <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

                        <input
                          className="field"
                          inputMode="decimal"
                          placeholder="Set absolute total (USD) e.g. 1200"
                          value={setPaidRaw}
                          onChange={(e) => setSetPaidRaw(e.target.value)}
                          disabled={busy || totalPaidBusy}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") totalPaidSetAbsolute();
                          }}
                        />

                        <button
                          className="secondary"
                          onClick={totalPaidSetAbsolute}
                          style={{ borderColor: "rgba(201,75,75,0.45)" }}
                          disabled={busy || totalPaidBusy || dollarsToCents(setPaidRaw) == null}
                        >
                          {totalPaidBusy ? "Updating…" : "Set Total Paid Out (Danger)"}
                        </button>

                        {totalPaidErr ? <div style={{ color: "#ffb2b2", fontSize: 13 }}>{totalPaidErr}</div> : null}
                      </div>
                    </div>
                  </div>

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
                      Operational Snapshot (Active)
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

                  {/* USER LOOKUP CARD (Paid winners email by UN) */}
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

                      {lookupErr ? <div style={{ color: "#ffb2b2", fontSize: 13 }}>{lookupErr}</div> : null}

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

                <input
                  className="field"
                  placeholder="Full legal name"
                  value={amoeName}
                  onChange={(e) => setAmoeName(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="field"
                  placeholder="Email"
                  value={amoeEmail}
                  onChange={(e) => setAmoeEmail(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="field"
                  placeholder="Mailing address"
                  value={amoeAddress}
                  onChange={(e) => setAmoeAddress(e.target.value)}
                  disabled={busy}
                />
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
