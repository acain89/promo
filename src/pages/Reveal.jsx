// src/pages/Reveal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, authMe, authLogout } from "../lib/api.js";

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function pad4(raw) {
  const d = onlyDigits(raw);
  if (!d) return "—";
  return d.slice(-4).padStart(4, "0");
}

function formatDateTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
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

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, lineHeight: 1.1 }}>
      <span className="label">{label}</span>
      <span className="value" style={{ textAlign: "right" }}>
        {value && String(value).length ? value : <span style={{ opacity: 0.25 }}>&nbsp;</span>}
      </span>
    </div>
  );
}

function normalizeEndsOnText(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // Upcoming Saturday is 02/21/26 (not 02/14/26)
  // If backend sends the old date string, fix it here so UI is correct.
  if (s.includes("02/14/26")) return s.replaceAll("02/14/26", "02/21/26");

  return s;
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
  const [meUser, setMeUser] = useState(null);
  const [myEntry, setMyEntry] = useState(null); // store full entry so we can show timestamp, etc.

  const pollRef = useRef(null);
  const mountedRef = useRef(false);

  async function doLogout() {
    try {
      setBusy(true);
      await authLogout();
    } catch {
      // ignore
    } finally {
      setBusy(false);
      nav("/"); // safe landing
    }
  }

  async function refresh({ silent = false } = {}) {
    try {
      if (!silent) {
        setErr("");
        setLoading(true);
      }

      let ok = false;
      let me = null;
      try {
        me = await authMe();
        ok = !!me?.ok;
      } catch {
        ok = false;
        me = null;
      }
      setAuthed(ok);
      setMeUser(ok ? me?.user || me?.me || null : null);

      const rs = await apiGet("/api/reveal-state");
      setState(rs && typeof rs === "object" ? rs : null);

      const d = normalizeDraws(rs);
      setDraws(d);

      // Projected winner: accept whatever backend returns, but don’t break if missing.
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
          if (my?.ok) setMyEntry(my?.entry || null);
          else setMyEntry(null);
        } catch {
          setMyEntry(null);
        }
      } else {
        setMyEntry(null);
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

  const meGuess = myEntry?.guess ?? myEntry?.entry ?? myEntry?.submission ?? null;

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

  const endsOnRaw =
    state?.endsOn ||
    state?.contest?.endsOn ||
    state?.paid?.endsOn ||
    state?.contest?.endsOnText ||
    null;

  const endsOn = useMemo(() => normalizeEndsOnText(endsOnRaw), [endsOnRaw]);

  const myUsername = useMemo(() => {
    const u = meUser;
    if (!u) return "";
    return String(u.username || u.un || u.name || u.displayName || "").trim();
  }, [meUser]);

  const isCurrentWinner = useMemo(() => {
    if (!authed) return null;
    if (!myUsername || !proj?.username || proj.username === "—") return null;
    return proj.username === myUsername;
  }, [authed, myUsername, proj?.username]);

  function dftLine(k) {
    const dft = myStats?.by?.[k];
    if (typeof dft === "number") {
      if (dft === 0) return "Exact! You win!";
      return String(dft);
    }
    return "";
  }

  const topBtnStyle = {
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "inherit",
    cursor: "pointer",
  };

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
        {/* Top: Back + Logout + centered title */}
        <div style={{ position: "relative", paddingTop: 6 }}>
          <button
            type="button"
            style={{ ...topBtnStyle, position: "absolute", top: 0, left: 0 }}
            onClick={() => nav(-1)}
            disabled={busy}
            aria-label="Back"
          >
            Back
          </button>

          <button
            type="button"
            style={{ ...topBtnStyle, position: "absolute", top: 0, right: 0 }}
            onClick={doLogout}
            disabled={busy}
            aria-label="Log out"
          >
            Log Out
          </button>

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
                    <span className="value">{formatDateTime(proj.timestamp) || "—"}</span>
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
          ) : (
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.02)",
                padding: 8,
                display: "grid",
                gap: 3,
                fontSize: 13,
                lineHeight: 1.1,
              }}
            >
              <Row label="UN:" value={myUsername} />
              <Row label="Entry:" value={myStats?.guess && myStats.guess !== "—" ? myStats.guess : ""} />
              <Row
                label="Timestamp:"
                value={formatDateTime(myEntry?.timestamp || myEntry?.submittedAt || myEntry?.entryTimestamp || "")}
              />

              <Row label="DFT Morning:" value={dftLine("morning")} />
              <Row label="DFT Day:" value={dftLine("day")} />
              <Row label="DFT Evening:" value={dftLine("evening")} />
              <Row label="DFT Night:" value={dftLine("night")} />

              <Row label="Current Winner:" value={isCurrentWinner === null ? "" : isCurrentWinner ? "Yes" : "No"} />

              {/* removed "Go to Profile" button entirely */}
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
