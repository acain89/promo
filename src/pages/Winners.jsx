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
  if (s.includes("mid")) return "Night";
  return raw ? String(raw) : "—";
}

function truthyExact(w) {
  const v =
    w?.exact ??
    w?.isExact ??
    w?.exactMatch ??
    w?.matchedExact ??
    w?.matchExact ??
    null;

  if (typeof v === "boolean") return v;

  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["true", "yes", "y", "1", "exact"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
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
        setErr("");
        const r = await apiGet("/api/winners");
        if (!alive) return;

        // Support either array or { items: [...] }
        const list = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
        setItems(list);
      } catch {
        if (!alive) return;
        setItems([]);
        setErr("Failed to load winners.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Newest first, cap 52
  const rows = useMemo(() => {
    const list = Array.isArray(items) ? items : [];

    const normalized = list
      .map((w, i) => {
        // Winner/record timestamp
        const ts =
          w?.timestamp ??
          w?.winnerTimestamp ??
          w?.resolvedAt ??
          w?.endedAt ??
          w?.createdAt ??
          w?.entryTimestamp ??
          w?.submittedAt ??
          null;

        const prizeCents = Number(w?.prizeCents ?? w?.prize ?? w?.amountCents ?? w?.amount ?? 0) || 0;
        const bonusCents = Number(w?.bonusCents ?? w?.bonus ?? 0) || 0;

        const un = safe(w?.winnerUN || w?.winner || w?.username || w?.un);

        const entry = pad4(w?.guess || w?.entry || w?.submission || w?.pick);

        const drawLabel = normalizeDrawLabel(
          w?.drawLabel || w?.draw || w?.targetLabel || w?.targetName || w?.winningDraw
        );

        const target = pad4(w?.target || w?.targetNumber || w?.drawResult || w?.winningTarget);

        const dftRaw = w?.dft ?? w?.diff ?? w?.distance ?? w?.bestDft ?? null;
        const dft = dftRaw == null || dftRaw === "" ? "—" : String(dftRaw);

        // Exact match flag (best-effort)
        const exact = truthyExact(w);

        // When that draw was played (best-effort)
        const playedAt =
          w?.playedAt ??
          w?.drawPlayedAt ??
          w?.targetPlayedAt ??
          w?.winningDrawAt ??
          w?.drawTimestamp ??
          w?.resultTimestamp ??
          null;

        return {
          id: w?.id || `w-${i}`,
          un,
          entry,
          exact, // true | false | null
          drawLabel,
          playedAt,
          target,
          dft,
          ts,
          prizeCents,
          bonusCents,
        };
      })
      .sort((a, b) => (Number(b.ts || 0) || 0) - (Number(a.ts || 0) || 0))
      .slice(0, 52);

    return normalized;
  }, [items]);

  const lastWinner = rows[0] || null;

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
      {/* Layout with scrollable middle, footer stays stationary */}
      <div
        style={{
          height: "calc(100dvh - 170px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          paddingBottom: 6,
        }}
      >
        {/* Top: title + slogan */}
        <div
          style={{
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: "0.06em",
            color: "var(--accent)",
            marginTop: 10,
            textAlign: "center",
          }}
        >
          drawnfray
        </div>

        <div style={{ fontSize: 13, letterSpacing: "0.14em", marginTop: -6, textAlign: "center" }}>
          <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
          <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
          <span style={{ color: "#7affc2" }}>Reveal.</span>
        </div>

        {/* Last winner pinned */}
        {lastWinner ? (
          <div
            style={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
              padding: "14px 14px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                opacity: 0.75,
                marginBottom: 10,
                textAlign: "center",
              }}
            >
              Most Recent Winner
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: 18, fontWeight: 950 }}>{lastWinner.un}</div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 16, fontWeight: 950 }}>
                  {dollarsFromCents(lastWinner.prizeCents + lastWinner.bonusCents)}
                </div>
                <div className="miniMuted" style={{ marginTop: 2, opacity: 0.85 }}>
                  Prize: {dollarsFromCents(lastWinner.prizeCents)} · Bonus: {dollarsFromCents(lastWinner.bonusCents)}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10,
                marginTop: 12,
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
                  {lastWinner.entry}
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
                <div className="label">Exact</div>
                <div className="value">{lastWinner.exact == null ? "—" : lastWinner.exact ? "Yes" : "No"}</div>
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
                <div className="value">{lastWinner.dft}</div>
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
                  {lastWinner.drawLabel} · {lastWinner.target}
                </div>
                <div className="miniMuted" style={{ marginTop: 4, opacity: 0.8 }}>
                  Played: {formatDateTime(lastWinner.playedAt)}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.015)",
                  padding: "10px 10px",
                  gridColumn: "1 / -1",
                }}
              >
                <div className="label">Timestamp</div>
                <div className="value">{formatDateTime(lastWinner.ts)}</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Scrollable list */}
        <div
          className="scrollList"
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            paddingRight: 4,
          }}
        >
          {loading ? (
            <div className="miniMuted" style={{ textAlign: "center", padding: "10px 0" }}>
              Loading…
            </div>
          ) : null}

          {!loading && err ? (
            <div className="error" style={{ textAlign: "center" }}>
              {err}
            </div>
          ) : null}

          {!loading && !rows.length ? (
            <div className="miniMuted" style={{ textAlign: "center", padding: "10px 0" }}>
              No winners posted yet.
            </div>
          ) : null}

          {rows.map((r, idx) => (
            <div
              key={r.id}
              className="winnerCard"
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.02)",
                padding: "14px 14px",
                marginTop: idx === 0 ? 0 : 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <div className="winnerUN" style={{ fontSize: 16, fontWeight: 950 }}>
                    {r.un}
                  </div>
                  <div className="miniMuted" style={{ opacity: 0.75 }}>
                    {formatDateTime(r.ts)}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="winnerPrize" style={{ fontSize: 15, fontWeight: 950 }}>
                    {dollarsFromCents(r.prizeCents + r.bonusCents)}
                  </div>
                  <div className="miniMuted" style={{ marginTop: 2, opacity: 0.8 }}>
                    Prize: {dollarsFromCents(r.prizeCents)} · Bonus: {dollarsFromCents(r.bonusCents)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.012)",
                    padding: "10px 10px",
                  }}
                >
                  <div className="label">Entry</div>
                  <div className="value" style={{ letterSpacing: "0.14em", fontVariantNumeric: "tabular-nums" }}>
                    {r.entry}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.012)",
                    padding: "10px 10px",
                  }}
                >
                  <div className="label">Exact</div>
                  <div className="value">{r.exact == null ? "—" : r.exact ? "Yes" : "No"}</div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.012)",
                    padding: "10px 10px",
                  }}
                >
                  <div className="label">DFT</div>
                  <div className="value">{r.dft}</div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.012)",
                    padding: "10px 10px",
                  }}
                >
                  <div className="label">Target</div>
                  <div className="value" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.drawLabel} · {r.target}
                  </div>
                  <div className="miniMuted" style={{ marginTop: 4, opacity: 0.8 }}>
                    Played: {formatDateTime(r.playedAt)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}
