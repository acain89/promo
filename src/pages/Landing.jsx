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
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function getFocusable(root) {
  if (!root) return [];
  const sel = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  return Array.from(root.querySelectorAll(sel)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function Modal({ open, title, children, onClose, actions, initialFocusRef }) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const prevActive = document.activeElement;

    const focusFirst = () => {
      const preferred = initialFocusRef?.current;
      if (preferred && typeof preferred.focus === "function") {
        preferred.focus();
        return;
      }
      const focusables = getFocusable(cardRef.current);
      if (focusables[0]) focusables[0].focus();
    };

    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusable(cardRef.current);
      if (!focusables.length) {
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !cardRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);

      if (prevActive && typeof prevActive.focus === "function") {
        prevActive.focus();
      }
    };
  }, [open, onClose, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="prevModal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
    >
      <div
        className="prevCard"
        ref={cardRef}
        style={{
          width: "min(560px, 92vw)",
          background: "rgba(10,12,18,0.92)",
          border: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        <div className="prevHeader">
          <div
            className="prevTitle"
            style={{
              color: "var(--arc2, #00ffd1)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {title}
          </div>

          <button
            className="prevClose"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              padding: 0,
              display: "grid",
              placeItems: "center",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div className="prevBody" style={{ color: "rgba(255,255,255,0.86)", lineHeight: 1.55 }}>
          {children}
        </div>

        {actions ? (
          <div className="prevBody" style={{ paddingTop: 0 }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Landing() {
  const nav = useNavigate();

  const [serverDelta, setServerDelta] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState("");

  const [howOpen, setHowOpen] = useState(false);
  const [loginToRevealOpen, setLoginToRevealOpen] = useState(false);

  const howBtnRef = useRef(null);
  const revealBtnRef = useRef(null);

  const mountedRef = useRef(false);
  const pollRef = useRef(null);

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

      const c = await apiGet("/api/contest");
      if (c?.serverNow) setServerDelta(c.serverNow - Date.now());
      if (c?.ok) setContest(c);
      else setContest(null);

      // auth check can be less frequent, but keeping it here is fine & cheap
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
      // silent refresh failures should not nuke the UI
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    // Initial load (shows loading state)
    refreshContest({ silent: false }).finally(() => {
      // After initial load, start polling silently
      if (!mountedRef.current) return;

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        refreshContest({ silent: true });
      }, 10000); // 10s poll keeps it "live" without hammering
    });

    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshContest({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVis);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutoffAt = contest?.cutoffAt ?? null;
  const remaining = cutoffAt ? cutoffAt - now : null;

  const prizeText = useMemo(() => dollarsFromCents(contest?.prizeCents || 0), [contest?.prizeCents]);

  const revealEnabled = !!cutoffAt && remaining != null && remaining <= 0;

  function onRevealClick() {
    if (!revealEnabled || loading) return;
    if (!authed) {
      setLoginToRevealOpen(true);
      return;
    }
    nav("/reveal");
  }

  const playerCountText =
    contest?.playerCount == null ? "—" : Number(contest.playerCount || 0).toLocaleString("en-US");

  const totalPaidText = useMemo(
    () => dollarsFromCents(contest?.totalPaidCents || 0),
    [contest?.totalPaidCents]
  );

  return (
    <>
      <PanelShell
        label=""
        labelClass="landing"
        footer={
          <>
            <div
              className="fineprint"
              style={{
                opacity: 0.78,
                lineHeight: 1.25,
                paddingTop: 6,
              }}
              aria-label="No purchase necessary disclosure"
            >
              <strong style={{ fontWeight: 900 }}>No purchase necessary.</strong> Free mail-in entry (AMOE) available.
              One entry per person per contest. Void where prohibited.{" "}
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
              Not affiliated with any government or lottery entity.
            </div>
          </>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              letterSpacing: "0.06em",
              color: "var(--accent)",
              marginTop: 6,
            }}
          >
            drawnfray
          </div>

          <div style={{ fontSize: 13, letterSpacing: "0.14em", marginBottom: 6 }}>
            <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
            <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
            <span style={{ color: "#7affc2" }}>Reveal.</span>
          </div>

          <div
            style={{
              padding: "16px 18px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            {prizeText}
          </div>

          <div className="countdownTimer" aria-label="Countdown">
            {formatDDHHMMSS(remaining)}
          </div>

          <button
            ref={revealBtnRef}
            className={["secondary", "revealBtn", revealEnabled ? "revealPulse" : ""].join(" ")}
            onClick={onRevealClick}
            disabled={!revealEnabled || loading}
          >
            Reveal
          </button>

          {/* Live player count + total paid out */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 2,
            }}
          >
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
                Players this round
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>{playerCountText}</div>
            </div>

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
                Total paid out
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, marginTop: 2 }}>{totalPaidText}</div>
            </div>
          </div>

          {err ? <div className="error">{err}</div> : null}

          <div className="form">
            <button className="primary" onClick={() => nav(authed ? "/profile" : "/join")} disabled={loading}>
              Join / Log In
            </button>

            <button className="secondary" onClick={() => nav("/winners")} disabled={loading}>
              Past Winners
            </button>

            <button ref={howBtnRef} className="secondary" onClick={() => setHowOpen(true)} disabled={loading}>
              How it works
            </button>
          </div>
        </div>
      </PanelShell>

      <Modal
        open={howOpen}
        title="How it works"
        onClose={() => setHowOpen(false)}
        initialFocusRef={howBtnRef}
        actions={
          <button className="primary" onClick={() => setHowOpen(false)}>
            Got it
          </button>
        }
      >
       <div style={{ textAlign: "left" }}>
  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10, color: "rgba(255,255,255,0.86)" }}>
    <li>Secure your 3-digit number before the weekly cutoff.</li>
    <li>The prize pool grows with every entry and locks at cutoff.</li>
    <li>Saturday night’s Pick 3 drawing sets the official target number.</li>
    <li>The closest entry wins the cash prize.</li>
    <li>All results are published in Reveal when the timer expires.</li>
  </ul>
</div>
</Modal>


      <Modal
        open={loginToRevealOpen}
        title="Log in to view results"
        onClose={() => setLoginToRevealOpen(false)}
        initialFocusRef={revealBtnRef}
        actions={
          <div className="form" style={{ marginTop: 0 }}>
            <button
              className="primary"
              onClick={() => {
                setLoginToRevealOpen(false);
                nav("/join");
              }}
            >
              Join / Log In
            </button>
            <button className="secondary" onClick={() => setLoginToRevealOpen(false)}>
              Close
            </button>
          </div>
        }
      >
        <div style={{ color: "rgba(255,255,255,0.82)" }}>Results are available to all logged-in users.</div>
      </Modal>
    </>
  );
}
