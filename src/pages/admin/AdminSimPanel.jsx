// src/pages/admin/AdminSimPanel.jsx
import React, { useMemo, useState } from "react";
import { apiPost } from "../../lib/api.js";

export default function AdminSimPanel({ onDone }) {
  const [count, setCount] = useState(200);
  const [resetFirst, setResetFirst] = useState(true);
  const [includeAmoe, setIncludeAmoe] = useState(true);
  const [paidRatio, setPaidRatio] = useState(0.85);
  const [autoResolve, setAutoResolve] = useState(true);

  // Optional (only if your backend supports it): maxTargets 1..4
  const [maxTargets, setMaxTargets] = useState(1);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const payload = useMemo(() => {
    // keep it clean and predictable for the backend
    return {
      count: Number(count) || 0,
      resetFirst: !!resetFirst,
      includeAmoe: !!includeAmoe,
      paidRatio: Math.max(0, Math.min(1, Number(paidRatio))),
      autoResolve: !!autoResolve,
      maxTargets: Math.max(1, Math.min(4, Number(maxTargets) || 1)),
    };
  }, [count, resetFirst, includeAmoe, paidRatio, autoResolve, maxTargets]);

  async function run() {
    try {
      setErr("");
      setStatus("");
      setLoading(true);

      const res = await apiPost("/api/admin/simulate-cycle", payload, { admin: true });

      // show a compact success banner (works even if response shape changes slightly)
      const msg = [
        `✅ Sim complete`,
        res?.contestId ? `contestId: ${res.contestId}` : null,
        Number.isFinite(res?.created) ? `created: ${res.created}` : null,
        Number.isFinite(res?.deletedBefore) ? `deletedBefore: ${res.deletedBefore}` : null,
        res?.winner?.name ? `winner: ${res.winner.name}` : null,
        res?.winner?.guess ? `guess: ${res.winner.guess}` : null,
        Number.isFinite(res?.winner?.diff) ? `diff: ${res.winner.diff}` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      setStatus(msg);

      if (typeof onDone === "function") onDone(res);
    } catch (e) {
      setErr(e?.message || "Simulation failed.");
    } finally {
      setLoading(false);
    }
  }

  const box = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 14,
    background: "rgba(255,255,255,0.04)",
  };

  const row = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" };
  const label = { fontSize: 12, opacity: 0.9, marginBottom: 6 };
  const field = { display: "flex", flexDirection: "column", minWidth: 160, flex: "0 0 auto" };

  const input = {
    height: 36,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    padding: "0 10px",
    outline: "none",
  };

  const btn = {
    height: 38,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: loading ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.08)",
    color: "inherit",
    cursor: loading ? "not-allowed" : "pointer",
    fontWeight: 700,
  };

  const toggleRow = { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" };
  const toggle = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, opacity: 0.95 };

  return (
    <section style={box}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>SIMULATE CONTEST CYCLE</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
            Seeds entries (PAID + optional AMOE), optionally resets, and can auto-resolve immediately.
          </div>
        </div>

        <button onClick={run} disabled={loading} style={btn}>
          {loading ? "Running..." : "Run Simulation"}
        </button>
      </div>

      <div style={{ height: 12 }} />

      <div style={row}>
        <div style={field}>
          <div style={label}>Count</div>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={input}
            disabled={loading}
          >
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={2000}>2000</option>
          </select>
        </div>

        <div style={field}>
          <div style={label}>Paid ratio (0..1)</div>
          <input
            value={paidRatio}
            onChange={(e) => setPaidRatio(e.target.value)}
            style={input}
            disabled={loading}
            inputMode="decimal"
            placeholder="0.85"
          />
        </div>

        <div style={field}>
          <div style={label}>Max targets (1..4)</div>
          <select
            value={maxTargets}
            onChange={(e) => setMaxTargets(Number(e.target.value))}
            style={input}
            disabled={loading || !autoResolve}
            title={!autoResolve ? "Enable Auto-resolve to use targets" : ""}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>
      </div>

      <div style={{ height: 10 }} />

      <div style={toggleRow}>
        <label style={toggle}>
          <input
            type="checkbox"
            checked={resetFirst}
            onChange={(e) => setResetFirst(e.target.checked)}
            disabled={loading}
          />
          Reset first (wipe contest entries + state)
        </label>

        <label style={toggle}>
          <input
            type="checkbox"
            checked={includeAmoe}
            onChange={(e) => setIncludeAmoe(e.target.checked)}
            disabled={loading}
          />
          Include AMOE
        </label>

        <label style={toggle}>
          <input
            type="checkbox"
            checked={autoResolve}
            onChange={(e) => setAutoResolve(e.target.checked)}
            disabled={loading}
          />
          Auto-resolve now
        </label>
      </div>

      {(status || err) && <div style={{ height: 10 }} />}

      {status && (
        <div style={{ fontSize: 12, padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.22)" }}>
          {status}
        </div>
      )}

      {err && (
        <div
          style={{
            fontSize: 12,
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,0,0,0.10)",
            border: "1px solid rgba(255,0,0,0.18)",
          }}
        >
          {err}
        </div>
      )}
    </section>
  );
}
