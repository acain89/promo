// src/pages/Landing.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, authMe } from "../lib/api.js";

function pad2(n) {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function formatDDHHMMSS(ms) {
  if (ms == null) return "--:--:--:--";
  if (ms <= 0) return "00:00:00:00";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const rem1 = total - days * 86400;
  const hours = Math.floor(rem1 / 3600);
  const rem2 = rem1 - hours * 3600;
  const mins = Math.floor(rem2 / 60);
  const secs = rem2 - mins * 60;
  return `${pad2(days)}:${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
}

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const v = Number.isFinite(n) ? n : 0;
  return (v / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function Landing() {
  const nav = useNavigate();

  const [serverDelta, setServerDelta] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState("");

  const [showHow, setShowHow] = useState(false);

  const mountedRef = useRef(false);
  const pollRef = useRef(null);
  const okBtnRef = useRef(null);
  const lastFocusRef = useRef(null);

  // Tick every second using sponsor-server delta (official timekeeper)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + serverDelta), 1000);
    return () => clearInterval(t);
  }, [serverDelta]);

  async function refreshContest({ silent = false } = {}) {
    try {
      if (!silent) {
        setErr("");
        setLoading(true);
      }

      // ✅ Cache-bust so landing reflects admin schedule changes immediately
      const c = await apiGet(`/api/contest?__ts=${Date.now()}`);
      if (c?.serverNow) setServerDelta(c.serverNow - Date.now());

      if (c?.ok) setContest(c);
      else setContest(null);

      try {
        const m = await authMe();
        setAuthed(!!m?.ok);
      } catch {
        setAuthed(false);
      }

      if (!silent) setErr("");
    } catch {
      if (!silent) {
        setContest(null);
        setErr("Failed to load contest state.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    refreshContest({ silent: false }).finally(() => {
      if (!mountedRef.current) return;

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        refreshContest({ silent: true });
      }, 5000);
    });

    const onVis = () => {
      if (document.visibilityState === "visible") refreshContest({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Timer source-of-truth:
// Countdown should always target the *effective* registration end (manual window wins).
const endAtMs = useMemo(() => {
  const v =
    contest?.effectiveEndMs ??
    contest?.endsOnMs ?? // back-compat from backend
    contest?.endMs ??
    contest?.activeContest?.endMs ??
    contest?.activeContest?.end ??
    contest?.end ??
    null;

  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}, [contest]);

const remaining = endAtMs ? endAtMs - now : null;

  // Admin can override later; safe fallback now.
  const prizeHeadline =
    String(contest?.prizeHeadline || contest?.headline || "").trim() || "$100 guaranteed + bonus";

  const officialTimeNote =
    String(contest?.timeNote || "").trim() || "Sponsor server time is the official timekeeper.";

  // Optional backend flags (if/when you add them). Fallback keeps UX usable now.
  const playStatus = String(contest?.playStatus || "").toUpperCase(); // OPEN | CLOSED | QUEUED | etc.
  const playOpen = typeof contest?.playOpen === "boolean" ? contest.playOpen : true;

  // Treat "closed" as: backend explicitly closed, OR playOpen false.
  const isClosed = !playOpen || playStatus === "CLOSED";

  // ✅ IMPORTANT: button should NEVER be dead just because entry is closed.
  // When closed: CTA becomes "View Results" and routes to /reveal.
  const ctaLabel = isClosed ? "View Results" : "Enter";
  const ctaDisabled = loading; // only disable while loading (not based on timer)

  function onEnter() {
    if (loading) return;

    if (isClosed) {
      nav("/reveal");
      return;
    }

    nav(authed ? "/profile" : "/join");
  }

  function openHow() {
    lastFocusRef.current = document.activeElement;
    setShowHow(true);
    setTimeout(() => okBtnRef.current?.focus?.(), 0);
  }

  function closeHow() {
    setShowHow(false);
    const el = lastFocusRef.current;
    setTimeout(() => el?.focus?.(), 0);
  }

  useEffect(() => {
    if (!showHow) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeHow();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHow]);

  const infoTextStyle = {
    fontSize: 14,
    letterSpacing: "0.04em",
    opacity: 0.88,
    lineHeight: 1.25,
    textAlign: "center",
  };

  // Live stats (safe fallbacks)
  const livePlayers = Number.isFinite(Number(contest?.entryCount))
    ? Number(contest?.entryCount)
    : Number.isFinite(Number(contest?.playerCount))
      ? Number(contest?.playerCount)
      : 0;

  function toCentsMaybe(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n >= 10000) return Math.round(n); // assume cents
    return Math.round(n * 100); // assume dollars
  }

  // ✅ Pull lifetime paid-out cents from /api/contest
  const totalPaidOutCents = toCentsMaybe(contest?.totalPaidOutCents) ?? 0;

  const statBoxStyle = {
    flex: 1,
    borderRadius: 12,
    padding: "10px 10px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset",
    minHeight: 46,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
  };

  const statLabelStyle = {
    fontSize: 11,
    letterSpacing: "0.12em",
    opacity: 0.8,
    textTransform: "uppercase",
    lineHeight: 1.1,
  };

  const statValueStyle = {
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: "0.03em",
    lineHeight: 1.1,
  };

  return (
    <PanelShell
      label=""
      labelClass="landing"
      footer={
        <>
          <div
            className="fineprint"
            style={{ opacity: 0.78, lineHeight: 1.25, paddingTop: 6 }}
            aria-label="No purchase necessary disclosure"
          >
            <strong style={{ fontWeight: 900 }}>No purchase necessary.</strong> Free mail-in entry available. Paid and
            mail-in entries compete together. One entry per person per contest. Void where prohibited.{" "}
            <button
              type="button"
              className="linkLike"
              onClick={() => nav("/terms")}
              disabled={loading}
              style={{
                padding: 0,
                border: "none",
                background: "transparent",
                color: "inherit",
                textDecoration: "underline",
                cursor: loading ? "default" : "pointer",
              }}
            >
              Official Rules
            </button>
          </div>

          <div className="fineprint" style={{ opacity: 0.35 }}>
            Not affiliated with any government or lottery entity. {officialTimeNote}
          </div>
        </>
      }
    >
      <div
        style={{
          minHeight: "calc(100dvh - 170px)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: 18,
        }}
      >
        <div style={{ width: "100%", display: "grid", gap: 12, textAlign: "center" }}>
          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              letterSpacing: "0.06em",
              color: "var(--accent)",
              marginTop: 2,
            }}
          >
            drawnfray
          </div>

          <div style={{ fontSize: 13, letterSpacing: "0.14em", marginBottom: 2 }}>
            <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
            <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
            <span style={{ color: "#7affc2" }}>Reveal.</span>
          </div>

          <div
            style={{
              padding: "16px 18px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              fontSize: 26,
              fontWeight: 900,
              border: "2px solid var(--accent)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 0 18px rgba(122,255,194,0.20)",
            }}
          >
            {prizeHeadline}
          </div>

          <div style={{ ...infoTextStyle, marginTop: -4 }}>
            <div>Odds: 1 in total number of players this week.</div>
            <div>Someone is going to win.</div>
            <div>Could be you.</div>
          </div>

          <div className="countdownTimer" aria-label="Countdown">
            {formatDDHHMMSS(remaining)}
          </div>

          <div style={{ ...infoTextStyle, marginTop: -6 }}>
            {isClosed ? "Entry is closed. Results are available on Reveal." : "Time left to lock in your submission."}
          </div>

          <div className="form" style={{ marginTop: 4 }}>
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <div style={statBoxStyle} aria-label="Live player count">
                <div style={statLabelStyle}>Live Players</div>
                <div style={statValueStyle}>{loading ? "—" : String(livePlayers)}</div>
              </div>

              <div style={statBoxStyle} aria-label="Total paid out">
                <div style={statLabelStyle}>Total Paid Out</div>
                <div style={statValueStyle}>{loading ? "—" : dollarsFromCents(totalPaidOutCents)}</div>
              </div>
            </div>

            <button className="primary" onClick={onEnter} disabled={ctaDisabled} style={{ marginTop: 10 }}>
              {ctaLabel}
            </button>

            <button className="secondary" onClick={openHow} disabled={loading}>
              How To Play
            </button>
          </div>

          {isClosed ? (
            <div className="miniMuted" style={{ textAlign: "center", opacity: 0.75, lineHeight: 1.25 }}>
              Entry is currently closed. Entries submitted during the closed window are queued for the next contest.
            </div>
          ) : null}

          {err ? <div className="error">{err}</div> : null}
        </div>
      </div>

      {showHow ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to play"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeHow();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              borderRadius: 16,
              background: "rgba(15,18,24,0.98)",
              border: "2px solid var(--accent)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 0 22px rgba(122,255,194,0.22)",
              padding: 16,
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: "0.08em",
                color: "var(--accent)",
                textAlign: "center",
              }}
            >
              How To Play
            </div>

            <div style={{ marginTop: 12, opacity: 0.92, lineHeight: 1.4, fontSize: 16 }}>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Choose and lock in a 4-digit number (0000–9999).</li>
                <li>Entries close when the timer hits zero.</li>
                <li>We use the official Texas Daily 4 draws: Morning, Day, Evening, Night.</li>
                <li>Each number can only be claimed once per week.</li>
                <li>Exact match on any draw? You win instantly.</li>
                <li>If no exact match occurs, the closest number wins after the Night draw.</li>
                <li>One winner. One prize. Every week.</li>
              </ol>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button
                ref={okBtnRef}
                type="button"
                className="primary"
                onClick={closeHow}
                style={{ padding: "10px 18px", minWidth: 120 }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PanelShell>
  );
}