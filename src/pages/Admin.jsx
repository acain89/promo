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

function WinnerModal({ open, onClose, data }) {
  if (!open) return null;

  const wr = data?.winnerRecord || null;
  const pw = data?.projectedWinner || null;

  const un = wr?.winnerUN || data?.best?.winnerUN || pw?.winnerUN || "—";
  const guess = wr?.guess || data?.best?.guess || pw?.guess || "—";
  const target = wr?.target || data?.target || pw?.target || "—";
  const drawLabel = wr?.drawLabel || data?.drawLabel || pw?.drawLabel || "—";
  const dft = wr?.diff ?? data?.best?.diff ?? pw?.diff ?? "—";

  const prize = wr?.finalPrizeCents != null ? dollarsFromCents(wr.finalPrizeCents) : "—";
  const playedAt = wr?.playedAt ?? data?.playedAt ?? pw?.playedAt ?? null;
  const stamp = wr?.resolvedAt ?? data?.serverNow ?? Date.now();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "rgba(0,0,0,0.74)",
        backdropFilter: "blur(6px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Winner"
    >
      <div
        style={{
          width: "min(560px, 94vw)",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(15,15,18,0.94)",
          padding: 16,
          boxShadow: "0 14px 50px rgba(0,0,0,0.65)",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -40,
            opacity: 0.18,
            background:
              "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.9) 0 2px, transparent 3px) , " +
              "radial-gradient(circle at 70% 20%, rgba(255,255,255,0.9) 0 2px, transparent 3px) , " +
              "radial-gradient(circle at 40% 80%, rgba(255,255,255,0.9) 0 2px, transparent 3px) , " +
              "radial-gradient(circle at 85% 75%, rgba(255,255,255,0.9) 0 2px, transparent 3px)",
          }}
        />

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.75 }}>
              Exact Match — Winner
            </div>
            <div style={{ fontSize: 22, fontWeight: 950 }}>{un}</div>
          </div>

          <button className="secondary" onClick={onClose} style={{ padding: "8px 10px" }}>
            Close
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
            padding: "12px 12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.8 }}>
              Winning Placard
            </div>
            <div style={{ fontSize: 16, fontWeight: 950 }}>{prize}</div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 10,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.015)",
                padding: "10px 10px",
              }}
            >
              <div className="label">Entry</div>
              <div className="value" style={{ letterSpacing: "0.14em", fontVariantNumeric: "tabular-nums" }}>
                {guess}
              </div>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.015)",
                padding: "10px 10px",
              }}
            >
              <div className="label">Target</div>
              <div className="value" style={{ fontVariantNumeric: "tabular-nums" }}>
                {drawLabel} · {target}
              </div>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.015)",
                padding: "10px 10px",
              }}
            >
              <div className="label">DFT</div>
              <div className="value">{String(dft)}</div>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.015)",
                padding: "10px 10px",
              }}
            >
              <div className="label">Timestamp</div>
              <div className="value">
                {playedAt ? formatTS(playedAt) : "—"} <span className="miniMuted">•</span> {formatTS(stamp)}
              </div>
            </div>
          </div>

          <div className="miniMuted" style={{ marginTop: 10, textAlign: "center" }}>
            Winners page should update automatically. If it doesn’t, refresh once.
          </div>
        </div>
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

  // AMOE
  const [amoeName, setAmoeName] = useState("");
  const [amoeEmail, setAmoeEmail] = useState("");
  const [amoeAddress, setAmoeAddress] = useState("");
  const [amoeGuessRaw, setAmoeGuessRaw] = useState("");

  // Unified targets (1..4)
  const [t1Raw, setT1Raw] = useState("");
  const [t2Raw, setT2Raw] = useState("");
  const [t3Raw, setT3Raw] = useState("");
  const [t4Raw, setT4Raw] = useState("");
  const [targetBusy, setTargetBusy] = useState({ 1: false, 2: false, 3: false, 4: false });

  // Winner popup (exact match)
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [winnerData, setWinnerData] = useState(null);

  // USER LOOKUP
  const [lookupUN, setLookupUN] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupResult, setLookupResult] = useState(null);

  // ✅ LIFETIME "TOTAL PAID OUT" (MANUAL)
  const [totalPaidBusy, setTotalPaidBusy] = useState(false);
  const [totalPaidErr, setTotalPaidErr] = useState("");
  const [addPaidRaw, setAddPaidRaw] = useState(""); // dollars typed, e.g. "600"
  const [setPaidRaw, setSetPaidRaw] = useState(""); // dollars typed for absolute set

  // ✅ RESET ALL (paid + AMOE)
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState("");

  const active = state?.activeContest || null;
  const last = state?.lastContest || null;

  const totalPaidCents = Number(state?.stats?.totalPaidCents || 0);

  const amoe = state?.amoe || null;
  const amoeStatus = String(amoe?.status || "COLLECTING");
  const amoeCount = Number(amoe?.count || 0);
  const amoePrizeCents = Number(amoe?.prizeCents || 0);

  const targets = active?.targets && typeof active.targets === "object" ? active.targets : {};
  const projected = active?.projectedWinner || null;

  // Targets are always DAILY4 now (0000–9999)
  const t1 = useMemo(() => onlyDigits(t1Raw).slice(0, 4), [t1Raw]);
  const t2 = useMemo(() => onlyDigits(t2Raw).slice(0, 4), [t2Raw]);
  const t3 = useMemo(() => onlyDigits(t3Raw).slice(0, 4), [t3Raw]);
  const t4 = useMemo(() => onlyDigits(t4Raw).slice(0, 4), [t4Raw]);

  const amoeGuess = useMemo(() => onlyDigits(amoeGuessRaw).slice(0, 4), [amoeGuessRaw]);

  function dollarsToCents(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

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
        if (amoeGuess.length !== 4) throw new Error("AMOE guess must be 4 digits (0000–9999).");

        await apiPost("/api/admin/amoe/add", { name: nm, email: em, address: ad, guess: amoeGuess });

        setAmoeGuessRaw("");
        setStatus("AMOE entry added.");
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to add AMOE."));
      }
    });
  }

  async function amoeResetCycle() {
    await withBusy(async () => {
      try {
        setStatus("");
        setErr("");

        const confirmText = `RESET AMOE CYCLE?\n\nThis starts collecting a new AMOE set.\nProceed?`;
        if (!window.confirm(confirmText)) return;

        await apiPost("/api/admin/amoe/reset-cycle", {});
        setStatus("AMOE cycle reset.");
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Failed to reset AMOE cycle."));
      }
    });
  }

  async function submitTarget(slot, raw) {
    const target = onlyDigits(raw).slice(0, 4);
    if (target.length !== 4) {
      setErr("Target must be exactly 4 digits (0000–9999).");
      return;
    }

    if (targetBusy[slot]) return;

    await withBusy(async () => {
      let didSetBusy = false;
      try {
        setStatus("");
        setErr("");

        const confirmText =
          `SUBMIT Target #${slot} as ${target}?\n\n` +
          `This locks that slot.\n` +
          `System will check ALL entries (Paid + AMOE).\n\n` +
          `Proceed?`;

        if (!window.confirm(confirmText)) return;

        setTargetBusy((m) => ({ ...m, [slot]: true }));
        didSetBusy = true;

        const contestId = String(active?.id || "").trim();
        const body = contestId ? { contestId, slot, targetNumber: target } : { slot, targetNumber: target };

        const r = await apiPost("/api/admin/targets/submit", body);

        // Always refresh state after submit
        await refresh();

        // Exact match -> show winner popup
        if (r?.exactHit) {
          setWinnerData({ ...r, serverNow: Date.now() });
          setWinnerOpen(true);
          setStatus("Exact match found. Contest resolved.");
        } else {
          setStatus(`Target #${slot} locked. Projected winner updated (if improved).`);
        }
      } catch (e) {
        setErr(errMsg(e, "Target submit failed."));
      } finally {
        if (didSetBusy) setTargetBusy((m) => ({ ...m, [slot]: false }));
      }
    });
  }

  // User lookup action
  async function lookupUser() {
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
          `ADD to Lifetime Paid Out?\n\n` + `Add: ${dollarsFromCents(addCents)}\n` + `Proceed?`;

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

  // ✅ RESET ALL (paid + AMOE)
  async function resetAll() {
    if (resetBusy) return;

    await withBusy(async () => {
      try {
        setResetBusy(true);
        setResetErr("");
        setStatus("");
        setErr("");

        const contestId = String(active?.id || "").trim();

        const confirmText =
          `RESET EVERYTHING?\n\n` +
          `This will:\n` +
          `• Delete ALL contest entries (Paid + AMOE mirror)\n` +
          `• Delete ALL AMOE entries in the current cycle\n` +
          `• Reset contest state (targets/projection/resolved/entryCount)\n` +
          `• Advance AMOE cycle (Cycle +1)\n\n` +
          `Strongly recommended: Export Paid + Export AMOE first.\n\n` +
          `Type RESET to proceed.`;

        const typed = window.prompt(confirmText);
        if (String(typed || "").trim().toUpperCase() !== "RESET") return;

        const body = contestId ? { contestId } : {};
        const r = await apiPost("/api/admin/reset-all", body);

        setStatus(
          `Reset complete. Deleted contest entries: ${Number(r?.deletedContestEntries || 0)} • Deleted AMOE entries: ${Number(
            r?.deletedAmoeEntries || 0
          )} • AMOE Cycle: ${Number(r?.amoePrevCycleId || 0)} → ${Number(r?.amoeNextCycleId || 0)}`
        );

        // clear local inputs
        setT1Raw("");
        setT2Raw("");
        setT3Raw("");
        setT4Raw("");
        setWinnerOpen(false);
        setWinnerData(null);

        setAmoeName("");
        setAmoeEmail("");
        setAmoeAddress("");
        setAmoeGuessRaw("");

        setLookupUN("");
        setLookupErr("");
        setLookupResult(null);

        await refresh();
      } catch (e) {
        setResetErr(errMsg(e, "Reset failed."));
      } finally {
        setResetBusy(false);
      }
    });
  }

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

  // Current Game panel values (best-effort)
  const paidEntryCount = Number(active?.entryCount || 0);
  const paidEntryPriceUsd = 10;
  const paidAmountUsd = paidEntryCount * paidEntryPriceUsd;

  const resolved = !!active?.resolved;

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

        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSubmit={adminLoginSubmit} err={err} busy={loginBusy} />
      </main>
    );
  }

  const slotLocked = (slot) => !!targets?.[String(slot)]?.locked;
  const slotInfo = (slot) => targets?.[String(slot)] || null;

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
          {/* LEFT: PAID WEEKLY GAME */}
          <section style={panelStyle}>
            <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
              Paid Weekly Game
            </div>

            {/* Daily4-only indicator */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.01)",
                marginBottom: 10,
              }}
            >
              <div style={compactRow}>
                <span className="label">Mode</span>
                <span className="value">DAILY4</span>
              </div>
              <div className="miniMuted" style={{ marginTop: 6, textAlign: "center" }}>
                Primary mode is locked to DAILY4.
              </div>
            </div>

            {/* Current Game panel */}
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.01)",
              }}
            >
              <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                Current Game
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={compactRow}>
                  <span className="label">Paid Entries</span>
                  <span className="value">{Number.isFinite(paidEntryCount) ? paidEntryCount : 0}</span>
                </div>

                <div style={compactRow}>
                  <span className="label">Dollar Amount</span>
                  <span className="value">${Number.isFinite(paidAmountUsd) ? paidAmountUsd.toLocaleString("en-US") : "0"}</span>
                </div>

                <div style={compactRow}>
                  <span className="label">Today</span>
                  <span className="value">{new Date().toLocaleDateString()}</span>
                </div>

                <div style={compactRow}>
                  <span className="label">Game Ending On</span>
                  <span className="value">{active?.endsOn || "—"}</span>
                </div>

                <div style={compactRow}>
                  <span className="label">Server Time</span>
                  <span className="value">{formatTS(state?.serverNow || null)}</span>
                </div>

                <div style={compactRow}>
                  <span className="label">Resolved</span>
                  <span className="value">{resolved ? "YES" : "NO"}</span>
                </div>
              </div>

              {projected ? (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div className="label" style={{ textAlign: "center" }}>
                    Projected Winner (Best DFT So Far)
                  </div>

                  <div style={compactRow}>
                    <span className="label">UN</span>
                    <span className="value">{projected?.winnerUN || "—"}</span>
                  </div>

                  <div style={compactRow}>
                    <span className="label">Entry • DFT</span>
                    <span className="value">
                      {projected?.guess || "—"} • {String(projected?.diff ?? "—")}
                    </span>
                  </div>

                  <div style={compactRow}>
                    <span className="label">Target</span>
                    <span className="value">
                      {projected?.drawLabel || "—"} · {projected?.target || "—"}
                    </span>
                  </div>

                  <div style={compactRow}>
                    <span className="label">Entry TS</span>
                    <span className="value">{formatTS(projected?.entryTimestamp || null)}</span>
                  </div>

                  <div className="miniMuted" style={{ textAlign: "center" }}>
                    Tie rule enforced: same DFT keeps the earlier timestamp.
                  </div>
                </div>
              ) : null}
            </div>

            {/* Resolve Targets (Unified) */}
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                  Resolve Targets (4 Draws)
                </div>

                <div className="miniMuted" style={{ textAlign: "center", marginBottom: 10 }}>
                  Submit targets one at a time. Each slot locks after submit. System checks Paid + AMOE.
                </div>

                {/* Slot 1 */}
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <div style={compactRow}>
                    <span className="label">Target #1</span>
                    <span className="value">{slotLocked(1) ? "LOCKED" : "OPEN"}</span>
                  </div>

                  <input
                    className="field"
                    type="text"
                    inputMode="numeric"
                    placeholder="0000–9999"
                    value={t1}
                    onChange={(e) => setT1Raw(e.target.value)}
                    disabled={busy || slotLocked(1) || resolved}
                  />

                  <button
                    className="primary"
                    onClick={() => submitTarget(1, t1)}
                    disabled={busy || resolved || slotLocked(1) || t1.length !== 4 || targetBusy[1]}
                  >
                    {targetBusy[1] ? "Submitting…" : "Submit Target #1 (Locks Slot)"}
                  </button>

                  {slotLocked(1) ? (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      {slotInfo(1)?.drawLabel || "—"} · {slotInfo(1)?.target || "—"} • {formatTS(slotInfo(1)?.playedAt || null)}
                    </div>
                  ) : null}
                </div>

                {/* Slot 2 */}
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <div style={compactRow}>
                    <span className="label">Target #2</span>
                    <span className="value">{slotLocked(2) ? "LOCKED" : "OPEN"}</span>
                  </div>

                  <input
                    className="field"
                    type="text"
                    inputMode="numeric"
                    placeholder="0000–9999"
                    value={t2}
                    onChange={(e) => setT2Raw(e.target.value)}
                    disabled={busy || slotLocked(2) || resolved}
                  />

                  <button
                    className="secondary"
                    onClick={() => submitTarget(2, t2)}
                    disabled={busy || resolved || slotLocked(2) || t2.length !== 4 || targetBusy[2]}
                  >
                    {targetBusy[2] ? "Submitting…" : "Submit Target #2 (Locks Slot)"}
                  </button>

                  {slotLocked(2) ? (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      {slotInfo(2)?.drawLabel || "—"} · {slotInfo(2)?.target || "—"} • {formatTS(slotInfo(2)?.playedAt || null)}
                    </div>
                  ) : null}
                </div>

                {/* Slot 3 */}
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                  <div style={compactRow}>
                    <span className="label">Target #3</span>
                    <span className="value">{slotLocked(3) ? "LOCKED" : "OPEN"}</span>
                  </div>

                  <input
                    className="field"
                    type="text"
                    inputMode="numeric"
                    placeholder="0000–9999"
                    value={t3}
                    onChange={(e) => setT3Raw(e.target.value)}
                    disabled={busy || slotLocked(3) || resolved}
                  />

                  <button
                    className="secondary"
                    onClick={() => submitTarget(3, t3)}
                    disabled={busy || resolved || slotLocked(3) || t3.length !== 4 || targetBusy[3]}
                  >
                    {targetBusy[3] ? "Submitting…" : "Submit Target #3 (Locks Slot)"}
                  </button>

                  {slotLocked(3) ? (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      {slotInfo(3)?.drawLabel || "—"} · {slotInfo(3)?.target || "—"} • {formatTS(slotInfo(3)?.playedAt || null)}
                    </div>
                  ) : null}
                </div>

                {/* Slot 4 */}
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={compactRow}>
                    <span className="label">Target #4</span>
                    <span className="value">{slotLocked(4) ? "LOCKED" : "OPEN"}</span>
                  </div>

                  <input
                    className="field"
                    type="text"
                    inputMode="numeric"
                    placeholder="0000–9999"
                    value={t4}
                    onChange={(e) => setT4Raw(e.target.value)}
                    disabled={busy || slotLocked(4) || resolved}
                  />

                  <button
                    className="secondary"
                    onClick={() => submitTarget(4, t4)}
                    disabled={busy || resolved || slotLocked(4) || t4.length !== 4 || targetBusy[4]}
                  >
                    {targetBusy[4] ? "Submitting…" : "Submit Target #4 (Locks Slot)"}
                  </button>

                  {slotLocked(4) ? (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      {slotInfo(4)?.drawLabel || "—"} · {slotInfo(4)?.target || "—"} • {formatTS(slotInfo(4)?.playedAt || null)}
                    </div>
                  ) : null}
                </div>

                {resolved ? (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(201,75,75,0.45)",
                      background: "rgba(201,75,75,0.10)",
                      textAlign: "center",
                      fontSize: 13,
                    }}
                  >
                    Contest is resolved. Targets are locked.
                  </div>
                ) : null}
              </div>

              {/* Exports */}
              <button className="secondary" onClick={exportPaid} disabled={busy}>
                Export Paid Summary (JSON)
              </button>

              {/* ✅ RESET EVERYTHING (paid + AMOE) */}
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(201,75,75,0.45)",
                  background: "rgba(201,75,75,0.06)",
                }}
              >
                <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                  Reset Everything (Paid + AMOE)
                </div>

                <div className="miniMuted" style={{ textAlign: "center" }}>
                  This wipes entries and resets contest state. Export first.
                </div>

                <button
                  className="secondary"
                  onClick={resetAll}
                  style={{ marginTop: 10, width: "100%", borderColor: "rgba(201,75,75,0.55)" }}
                  disabled={busy || resetBusy}
                >
                  {resetBusy ? "Resetting…" : "Reset All (Type RESET)"}
                </button>

                {resetErr ? <div style={{ color: "#ffb2b2", fontSize: 13, marginTop: 8 }}>{resetErr}</div> : null}
              </div>

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
                    Update this after you actually pay winners via your processor.
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

                    <button className="secondary" onClick={totalPaidAdd} disabled={busy || totalPaidBusy || dollarsToCents(addPaidRaw) == null}>
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

              {/* USER LOOKUP */}
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
                  User Lookup (Email + Phone by UN)
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    className="field"
                    placeholder="Enter UN (username)"
                    value={lookupUN}
                    onChange={(e) => setLookupUN(e.target.value)}
                    disabled={busy || lookupBusy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") lookupUser();
                    }}
                  />

                  <button className="secondary" onClick={lookupUser} disabled={busy || lookupBusy || !String(lookupUN || "").trim()}>
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
                      <div style={compactRow}>
                        <span className="label">Phone</span>
                        <span className="value">{lookupResult.phone || "—"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      Use this to quickly retrieve contact info.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT: AMOE */}
          <section style={panelStyle}>
            <div className="label" style={{ textAlign: "center", marginBottom: 8 }}>
              AMOE
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={compactRow}>
                <span className="label">Status</span>
                <span className="value">{amoeStatus}</span>
              </div>
              <div style={compactRow}>
                <span className="label">Count</span>
                <span className="value">{amoeCount}</span>
              </div>
              <div style={compactRow}>
                <span className="label">Prize</span>
                <span className="value">{dollarsFromCents(amoePrizeCents)}</span>
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
                  placeholder="AMOE guess (0000–9999)"
                  value={amoeGuess}
                  onChange={(e) => setAmoeGuessRaw(e.target.value)}
                  disabled={busy}
                />

                <button className="primary" onClick={amoeAdd} disabled={busy || amoeGuess.length !== 4}>
                  Add AMOE Entry
                </button>

                <div className="miniMuted" style={{ textAlign: "center" }}>
                  AMOE entries are checked by the same 4 targets (Paid + AMOE together).
                </div>
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
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

        <WinnerModal
          open={winnerOpen}
          onClose={() => {
            setWinnerOpen(false);
            setWinnerData(null);
          }}
          data={winnerData}
        />
      </div>
    </main>
  );
}
