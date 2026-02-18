// src/pages/Reveal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, authMe } from "../lib/api.js";

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function pad4(raw) {
  const d = onlyDigits(raw);
  if (!d) return "—";
  return d.slice(-4).padStart(4, "0");
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

function absDiff(aRaw, bRaw) {
  const a = Number(onlyDigits(aRaw));
  const b = Number(onlyDigits(bRaw));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b);
}

function pickFirstDefined(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function normalizeDraws(rs) {
  // Accept many backend shapes without breaking.
  const src =
    rs?.draws ||
    rs?.daily4Draws ||
    rs?.contest?.draws ||
    rs?.contest?.daily4Draws ||
    rs?.paid?.draws ||
    rs?.paid?.daily4Draws ||
    rs?.reveal ||
    rs?.state ||
    {};

  const morning = pickFirstDefined(src, ["morning", "am", "morn", "drawMorning", "morningDraw", "m"]);
  const day = pickFirstDefined(src, ["day", "midday", "noon", "drawDay", "dayDraw", "d"]);
  const evening = pickFirstDefined(src, ["evening", "pm", "drawEvening", "eveningDraw", "e"]);
  const night = pickFirstDefined(src, ["night", "late", "drawNight", "nightDraw", "n"]);

  return {
    morning: morning != null ? pad4(morning) : "—",
    day: day != null ? pad4(day) : "—",
    evening: evening != null ? pad4(evening) : "—",
    night: night != null ? pad4(night) : "—",
  };
}

function computeMyDfts(guess, draws) {
  const g = pad4(guess);
  const out = {
    guess: g,
    best: null,
    bestLabel: null,
    by: {
      morning: null,
      day: null,
      evening: null,
      night: null,
    },
  };

  ["morning", "day", "evening", "night"].forEach((k) => {
    const target = draws[k];
    if (!guess || g === "—" || !target || target === "—") {
      out.by[k] = null;
      return;
    }
    out.by[k] = absDiff(g, target);
  });

  const entries = Object.entries(out.by).filter(([, v]) => typeof v === "number");
  if (entries.length) {
    entries.sort((a, b) => a[1] - b[1]);
    out.bestLabel = entries[0][0];
    out.best = entries[0][1];
  }

  return out;
}

function labelNice(k) {
  if (k === "morning") return "Morning";
  if (k === "day") return "Day";
  if (k === "evening") return "Evening";
  if (k === "night") return "Night";
  return k;
}

function StatPill({ label, value }) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        minHeight: 54,
        display: "grid",
        alignContent: "center",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export default function Reveal() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);

  const [state, setState] = useState(null);
  const [draws, setDraws] = useState({ morning: "—", day: "—", evening: "—", night: "—" });

  // Projected winner (public)
  const [proj, setProj] = useState(null);

  // My status (requires login)
  const [meGuess, setMeGuess] = useState(null);

  const pollRef = useRef(null);
  const mountedRef = useRef(false);

  async function refresh({ silent = false } = {}) {
    try {
      if (!silent) {
        setErr("");
        setLoading(true);
      }

      let ok = false;
      try {
        const m = await authMe();
        ok = !!m?.ok;
      } catch {
        ok = false;
      }
      setAuthed(ok);

      const rs = await apiGet("/api/reveal-state");
      setState(rs && typeof rs === "object" ? rs : null);

      const d = normalizeDraws(rs);
      setDraws(d);

      // Projected winner: accept whatever backend returns, but don’t break if missing.
      // Preferred shapes:
      // - rs.projectedWinner { username, guess, bestDft, bestDraw }
      // - rs.leaderboard[0]  { username, guess, bestDft, bestDraw }
      const pw =
        rs?.projectedWinner ||
        (Array.isArray(rs?.leaderboard) && rs.leaderboard[0]) ||
        (Array.isArray(rs?.top10) && rs.top10[0]) ||
        null;

      if (pw) {
        setProj({
          username: String(pw.username || pw.un || pw.winnerUN || pw.winner || "—"),
          guess: pad4(pw.guess || pw.entry || pw.submission || ""),
          bestDft: pw.bestDft ?? pw.dft ?? pw.bestDiff ?? pw.diff ?? pw.distance ?? null,
          bestDraw: String(pw.bestDraw || pw.drawLabel || pw.draw || pw.targetLabel || "").trim() || null,
          timestamp: pw.timestamp || pw.entryTimestamp || pw.submittedAt || null,
        });
      } else {
        setProj(null);
      }

      // My entry
      if (ok) {
        try {
          const my = await apiGet("/api/my-entry");
          setMeGuess(my?.ok ? my?.entry?.guess : null);
        } catch {
          setMeGuess(null);
        }
      } else {
        setMeGuess(null);
      }
    } catch (e) {
      if (!silent) setErr(e?.message || "Failed to load reveal.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    refresh({ silent: false }).finally(() => {
      if (!mountedRef.current) return;

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        refresh({ silent: true });
      }, 5000);
    });

    const onVis = () => {
      if (document.visibilityState === "visible") refresh({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myStats = useMemo(() => {
    if (!authed || !meGuess) return null;
    return computeMyDfts(meGuess, draws);
  }, [authed, meGuess, draws]);

  const projectedLabelNice = useMemo(() => {
    if (!proj?.bestDraw) return "—";
    const t = proj.bestDraw.toLowerCase();
    if (t.includes("morn")) return "Morning";
    if (t.includes("day")) return "Day";
    if (t.includes("eve")) return "Evening";
    if (t.includes("night")) return "Night";
    return proj.bestDraw;
  }, [proj?.bestDraw]);

  // Optional contest text (safe fallbacks)
  const endsOn =
    state?.endsOn ||
    state?.contest?.endsOn ||
    state?.paid?.endsOn ||
    state?.contest?.endsOnText ||
    null;

  return (
    <PanelShell
      label=""
      labelClass="reveal"
      footer={
        <div className="fineprint" style={{ opacity: 0.7, textAlign: "center", lineHeight: 1.25 }}>
          For verification:{" "}
          <a
            href="https://www.texaslottery.com/export/sites/lottery/Games/Daily_4/index.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            Texas Daily 4
          </a>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {/* Top: title + slogan (no Home/Back/Logout buttons) */}
        <div
          style={{
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: "0.06em",
            color: "var(--accent)",
            marginTop: 10,
            textAlign: "left",
          }}
        >
          drawnfray
        </div>

        <div style={{ fontSize: 13, letterSpacing: "0.14em", marginTop: -6 }}>
          <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
          <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
          <span style={{ color: "#7affc2" }}>Reveal.</span>
        </div>

        {endsOn ? (
          <div className="miniMuted" style={{ textAlign: "center" }}>
            Week ending <strong>{endsOn}</strong>
          </div>
        ) : null}

        {loading ? <div className="fineprint">Loading…</div> : null}
        {err ? <div className="error">{err}</div> : null}

        {/* Sections 1–4: Draw blocks */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          <StatPill label="Morning" value={draws.morning} />
          <StatPill label="Day" value={draws.day} />
          <StatPill label="Evening" value={draws.evening} />
          <StatPill label="Night" value={draws.night} />
        </div>

        {/* Section 5: Projected Winner */}
        <div
          style={{
            padding: "14px 14px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div className="label" style={{ textAlign: "center", marginBottom: 10 }}>
            Projected Winner
          </div>

          {proj ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.25rem", fontWeight: 950, letterSpacing: "0.02em" }}>
                  {proj.username}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">Submission</span>
                  <span className="value">{proj.guess}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">DFT</span>
                  <span className="value">{proj.bestDft ?? "—"}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">From draw</span>
                  <span className="value">{projectedLabelNice}</span>
                </div>

                {proj.timestamp ? (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="label">Timestamp</span>
                    <span className="value">{formatDateTime(proj.timestamp)}</span>
                  </div>
                ) : null}
              </div>

              <div className="miniMuted" style={{ opacity: 0.8, textAlign: "center" }}>
                Updates automatically as draw results are entered.
              </div>
            </div>
          ) : (
            <div className="miniMuted" style={{ textAlign: "center" }}>
              Projected winner will appear after entries and/or draw results are available.
            </div>
          )}
        </div>

        {/* Section 6: My Status */}
        <div
          style={{
            padding: "14px 14px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.01)",
          }}
        >
          <div className="label" style={{ textAlign: "center", marginBottom: 10 }}>
            My Status
          </div>

          {!authed ? (
            <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
              <div className="miniMuted">Log in to see your submission and DFT tracking.</div>
              <div className="form" style={{ marginTop: 0 }}>
                <button className="primary" onClick={() => nav("/join")} disabled={busy || loading}>
                  Log in
                </button>
              </div>
            </div>
          ) : !myStats || !myStats.guess || myStats.guess === "—" ? (
            <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
              <div className="miniMuted">No submission found for your account.</div>
              <div className="form" style={{ marginTop: 0 }}>
                <button className="secondary" onClick={() => nav("/profile")} disabled={busy || loading}>
                  Go to Profile
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: 10,
              }}
            >
              {/* Left: submission + best */}
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 12,
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">Submission</span>
                  <span className="value" style={{ letterSpacing: "0.14em", fontVariantNumeric: "tabular-nums" }}>
                    {myStats.guess}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">Best DFT</span>
                  <span className="value">{myStats.best ?? "—"}</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label">From draw</span>
                  <span className="value">{myStats.bestLabel ? labelNice(myStats.bestLabel) : "—"}</span>
                </div>
              </div>

              {/* Right: 4 mini sections */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {["morning", "day", "evening", "night"].map((k) => {
                  const target = draws[k];
                  const dft = myStats.by[k];

                  return (
                    <div
                      key={k}
                      style={{
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.02)",
                        padding: 12,
                        minHeight: 76,
                        display: "grid",
                        alignContent: "center",
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.7 }}>
                        {labelNice(k)}
                      </div>

                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 900,
                          letterSpacing: "0.12em",
                          fontVariantNumeric: "tabular-nums",
                          opacity: target === "—" ? 0.25 : 1,
                        }}
                      >
                        {target === "—" ? "—" : target}
                      </div>

                      <div className="miniMuted" style={{ opacity: target === "—" ? 0.25 : 0.85 }}>
                        {target === "—" ? "DFT: —" : `DFT: ${dft ?? "—"}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="form" style={{ marginTop: 0 }}>
          <button className="secondary" onClick={() => refresh({ silent: false })} disabled={loading || busy}>
            Refresh
          </button>
        </div>
      </div>
    </PanelShell>
  );
}
