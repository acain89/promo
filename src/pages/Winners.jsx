// src/pages/Winners.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet } from "../lib/api.js";

function dollarsFromCents(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatDateTime(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function safe(v) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function pad4(raw) {
  const d = onlyDigits(raw);
  if (!d) return "—";
  return d.slice(-4).padStart(4, "0");
}

function normalizeDrawLabel(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("morn")) return "Morning";
  if (s.includes("day")) return "Day";
  if (s.includes("eve")) return "Evening";
  if (s.includes("night")) return "Night";
  return raw ? String(raw) : "—";
}

function truthyExact(w) {
  const v = w?.exact ?? w?.isExact ?? null;
  if (typeof v === "boolean") return v;
  return String(v).toLowerCase() === "true";
}

function pickAdvertisedPrizeCents(w) {
  const vals = [
    w?.advertisedPrizeCents,
    w?.prizePoolCents,
    w?.prizeCents,
    w?.amountCents,
  ];
  for (const c of vals) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

export default function Winners() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiGet("/api/winners");
        if (!alive) return;
        setItems(Array.isArray(r) ? r : r?.items || []);
      } catch {
        if (!alive) return;
        setErr("Failed to load winners.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => (alive = false);
  }, []);

  const rows = useMemo(() => {
    return (Array.isArray(items) ? items : [])
      .map((w, i) => ({
        id: w?.id || `w-${i}`,
        un: safe(w?.winnerUN || w?.winner || w?.username),
        entry: pad4(w?.guess || w?.entry),
        drawLabel: normalizeDrawLabel(w?.drawLabel || w?.draw),
        target: pad4(w?.target || w?.targetNumber),

        // 🔥 DFT FIX (restored)
        dft: w?.dft ?? w?.diff ?? w?.distance ?? w?.bestDft ?? "—",

        exact: truthyExact(w),
        playedAt: w?.playedAt ?? null,
        ts: w?.timestamp ?? w?.resolvedAt ?? null,
        prizeCents: pickAdvertisedPrizeCents(w),
      }))
      .sort((a, b) => (Number(b.ts || 0) || 0) - (Number(a.ts || 0) || 0))
      .slice(0, 52);
  }, [items]);

  return (
    <PanelShell
      label=""
      labelClass="winners"
      footer={
        <div className="form" style={{ marginTop: 0 }}>
          <button className="secondary" onClick={() => nav("/")} disabled={loading}>
            Back
          </button>
        </div>
      }
    >
      <div
        style={{
          height: "calc(100dvh - 190px)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 34, fontWeight: 900, color: "var(--accent)" }}>
            drawnfray
          </div>
          <div style={{ fontSize: 12, letterSpacing: "0.12em" }}>
            <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
            <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
            <span style={{ color: "#7affc2" }}>Reveal.</span>
          </div>
        </div>

        {/* SCROLL AREA */}
        <div
          style={{
            flex: 1,
            minHeight: 0,

            // 🔥 ALWAYS SHOW SCROLLBAR
            overflowY: "scroll",

            paddingRight: 4,
          }}
        >
          {loading && <div className="miniMuted">Loading…</div>}
          {!loading && err && <div className="error">{err}</div>}
          {!loading && !rows.length && <div className="miniMuted">No winners posted yet.</div>}

          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                borderRadius: 14,
                border: "2px solid rgba(110,160,255,0.65)",
                background:
                  "linear-gradient(180deg, rgba(70,110,255,.18), rgba(255,255,255,.02))",
                boxShadow:
                  "0 0 0 1px rgba(120,170,255,.35), 0 0 16px rgba(80,120,255,.30)",
                padding: "10px 12px",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 900 }}>{r.un}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{formatDateTime(r.ts)}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>
                  {dollarsFromCents(r.prizeCents)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <InfoCell label="Entry" value={r.entry} />
                <InfoCell label="Exact" value={r.exact ? "Yes" : "No"} />
                <InfoCell label="DFT" value={r.dft} />
                <InfoCell
                  label="Target"
                  value={`${r.drawLabel} · ${r.target}`}
                  sub={`Played: ${formatDateTime(r.playedAt)}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

function InfoCell({ label, value, sub }) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,.12)",
        padding: "8px 10px",
        background: "rgba(255,255,255,.02)",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: ".14em", opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, opacity: 0.7 }}>{sub}</div> : null}
    </div>
  );
}