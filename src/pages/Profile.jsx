// src/pages/Profile.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, apiPost, authLogout } from "../lib/api.js";

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function padGuess(raw, digits) {
  const d = onlyDigits(raw).slice(0, digits);
  return d.padStart(d.length ? digits : 0, "0");
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// ✅ Always format contest week-ending from the authoritative cutoff timestamp (Chicago time)
function formatEndsOnChicagoFromMs(ms) {
  if (!ms) return "—";
  try {
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "2-digit",
      day: "2-digit",
      year: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

// Stripe feature flag (frontend)
const STRIPE_ENABLED =
  String(import.meta.env.VITE_STRIPE_ENABLED || "").toLowerCase().trim() === "true";

/* ---------- Accessible Modal (ESC + focus trap + focus return) ---------- */
function getFocusable(root) {
  if (!root) return [];
  const sel = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
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
      style={{ display: "grid", placeItems: "center", padding: 18 }}
    >
      <div ref={cardRef} className="prevCard">
        <div className="prevHeader">
          <div className="prevTitle">{title}</div>
          <button className="prevClose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="prevBody">{children}</div>

        {actions ? (
          <div className="prevBody" style={{ paddingTop: 0 }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DigitBox({ value, onChange, disabled, digits = 4 }) {
  const [arr, setArr] = useState(Array.from({ length: digits }, () => ""));
  const refs = Array.from({ length: digits }, () => useRef(null));

  useEffect(() => {
    const d = onlyDigits(value).slice(0, digits);
    const next = Array.from({ length: digits }, (_, i) => d[i] || "");
    setArr(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, digits]);

  useEffect(() => {
    if (disabled) return;
    const t = setTimeout(() => refs[0].current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function emit(nextArr) {
    onChange?.(nextArr.join(""));
  }

  function handleInput(i, v) {
    if (disabled) return;
    const ch = onlyDigits(v).slice(-1);
    const next = [...arr];
    next[i] = ch;
    setArr(next);
    emit(next);
    if (ch && i < digits - 1) refs[i + 1].current?.focus();
  }

  function handleKeyDown(i, e) {
    if (disabled) return;

    if (e.key === "Backspace") {
      if (arr[i]) {
        const next = [...arr];
        next[i] = "";
        setArr(next);
        emit(next);
        return;
      }
      if (i > 0) {
        refs[i - 1].current?.focus();
        const next = [...arr];
        next[i - 1] = "";
        setArr(next);
        emit(next);
      }
    }

    if (e.key === "ArrowLeft" && i > 0) refs[i - 1].current?.focus();
    if (e.key === "ArrowRight" && i < digits - 1) refs[i + 1].current?.focus();
  }

  function handlePaste(e) {
    if (disabled) return;
    const text = onlyDigits(e.clipboardData.getData("text") || "").slice(0, digits);
    if (!text) return;
    e.preventDefault();
    const next = Array.from({ length: digits }, (_, i) => text[i] || "");
    setArr(next);
    emit(next);
    const idx = Math.min(text.length, digits) - 1;
    refs[Math.max(0, idx)].current?.focus();
  }

  return (
    <div className="digitRow" onPaste={handlePaste} aria-label={`${digits}-digit submission`}>
      {arr.map((v, i) => (
        <input
          key={i}
          ref={refs[i]}
          className="digitBox"
          value={v}
          disabled={disabled}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

function isLockedEntry(entry) {
  const s = String(entry?.status || "").toUpperCase();
  const paid = entry?.paid === true;

  // IMPORTANT:
  // - "DUPLICATE" means Stripe paid but number was already claimed → user must be allowed to pick again.
  // - "QUEUED" means paid after contest resolved → also don’t “lock” the picker forever.
  if (s === "DUPLICATE" || s === "QUEUED") return false;

  return (
    paid ||
    s === "PAID" ||
    s === "PAID_LOCKED" ||
    s === "LOCKED_PAID"
  );
}

export default function Profile() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  const [me, setMe] = useState(null);
  const [contest, setContest] = useState(null);
  const [myEntry, setMyEntry] = useState(null);

  const DIGITS = 4;

  const [guessRaw, setGuessRaw] = useState("");
  const guess = useMemo(() => padGuess(guessRaw, DIGITS), [guessRaw]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const lockBtnRef = useRef(null);

  // Availability UI state (paid-only OR AMOE already entered claims it)
  const [availLoading, setAvailLoading] = useState(false);
  const [available, setAvailable] = useState(null); // null | true | false

  const parsedCheckout = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return {
        result: String(p.get("checkout") || "").toLowerCase(),
        sessionId: String(p.get("session_id") || "").trim(),
      };
    } catch {
      return { result: "", sessionId: "" };
    }
  }, []);

  const checkoutResult = parsedCheckout.result;
  const checkoutSessionId = parsedCheckout.sessionId;

  const didConfirmRef = useRef(false);

  function stripQueryParams() {
    try {
      const path = window.location.pathname || "/profile";
      window.history.replaceState({}, "", path);
    } catch {
      // no-op
    }
  }

  const entryStatusUpper = useMemo(
    () => String(myEntry?.status || "").toUpperCase(),
    [myEntry?.status]
  );

  const duplicatePaid = entryStatusUpper === "DUPLICATE";
  const queuedPaid = entryStatusUpper === "QUEUED";

  const locked = useMemo(() => isLockedEntry(myEntry), [myEntry]);

  // Prefer authoritative cutoff timestamp; don't rely on endsOn text.
  const cutoffAt = contest?.cutoffAt ?? contest?.endsOnMs ?? null;
  const endsOn = useMemo(() => formatEndsOnChicagoFromMs(cutoffAt), [cutoffAt]);

  const guessDigitsLen = useMemo(() => onlyDigits(guessRaw).length, [guessRaw]);

  // Paid-only rule: user can proceed only if guess has 4 digits and is not known to be unavailable
  const canProceedBase = !loading && !busy && !locked && !!cutoffAt && guessDigitsLen === DIGITS;
  const canProceed = canProceedBase && available !== false;

  async function refresh({ silent = false } = {}) {
    if (!silent) {
      setErr("");
      setLoading(true);
    }

    try {
      // Stripe success -> confirm once (then we bootstrap fresh)
      if (
        STRIPE_ENABLED &&
        checkoutResult === "success" &&
        checkoutSessionId &&
        !didConfirmRef.current
      ) {
        didConfirmRef.current = true;
        try {
          await apiGet(`/api/checkout/confirm?session_id=${encodeURIComponent(checkoutSessionId)}`);
        } catch {
          // ignore
        }
      }

      const boot = await apiGet("/api/profile-bootstrap");

      if (!boot?.ok) {
        nav("/join", { replace: true });
        return;
      }

      const bootUser = boot.user ?? boot.me ?? null;
      const bootContest = boot.contest ?? null;
      const bootEntry = boot.entry ?? boot.myEntry ?? null;

      setMe(bootUser);
      setContest(bootContest);
      setMyEntry(bootEntry);

      const bootLocked = isLockedEntry(bootEntry);

      // Prefill guess when the picker is editable (including DUPLICATE/QUEUED)
      if (bootEntry?.guess && !bootLocked) {
        setGuessRaw(String(bootEntry.guess));
      }

      // If they got DUPLICATE after confirm, show a clear message and keep picker editable.
      const bootStatusUpper = String(bootEntry?.status || "").toUpperCase();
      if (bootStatusUpper === "DUPLICATE") {
        setErr("Payment went through, but that number was already claimed. Please pick another number.");
      } else if (bootStatusUpper === "QUEUED") {
        setErr("Payment went through, but the contest is already closed. Your entry is queued.");
      }

      if (STRIPE_ENABLED && checkoutResult === "success") {
        setStatus("Payment received. Updating your entry…");
        stripQueryParams();
      } else if (STRIPE_ENABLED && checkoutResult === "cancel") {
        setStatus("Checkout canceled.");
        stripQueryParams();
      } else {
        setStatus("");
      }
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        nav("/join", { replace: true });
        return;
      }
      setErr(e?.message || "Failed to load.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    if (STRIPE_ENABLED && checkoutResult === "success") {
      const timers = [];
      timers.push(setTimeout(() => refresh({ silent: true }), 1200));
      timers.push(setTimeout(() => refresh({ silent: true }), 3200));
      timers.push(setTimeout(() => refresh({ silent: true }), 6200));
      return () => timers.forEach(clearTimeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced availability check (paid-only + AMOE claims)
  const availReqIdRef = useRef(0);
  useEffect(() => {
    // Only show availability for editable entry
    if (loading || busy || locked || !cutoffAt) {
      setAvailLoading(false);
      setAvailable(null);
      return;
    }

    // Only check when user has entered 4 digits
    if (guessDigitsLen !== DIGITS) {
      setAvailLoading(false);
      setAvailable(null);
      return;
    }

    const g = padGuess(guessRaw, DIGITS);
    const reqId = ++availReqIdRef.current;

    setAvailLoading(true);
    setAvailable(null);

    const t = setTimeout(async () => {
      try {
        const r = await apiGet(`/api/guess-availability?guess=${encodeURIComponent(g)}`);
        if (reqId !== availReqIdRef.current) return;

        if (!r || r.ok === false) {
          setAvailable(null);
          return;
        }

        setAvailable(r.available === true);
      } catch {
        if (reqId !== availReqIdRef.current) return;
        setAvailable(null);
      } finally {
        if (reqId === availReqIdRef.current) setAvailLoading(false);
      }
    }, 320);

    return () => clearTimeout(t);
  }, [guessRaw, guessDigitsLen, DIGITS, loading, busy, locked, cutoffAt]);

  function availabilityBadge() {
    if (locked) return null;
    if (!cutoffAt) return null;
    if (guessDigitsLen !== DIGITS) return null;

    const baseStyle = {
      marginTop: 10,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.02)",
      fontWeight: 900,
      letterSpacing: "0.06em",
      fontSize: 11,
      textTransform: "uppercase",
      justifyContent: "center",
      width: "100%",
      boxSizing: "border-box",
    };

    if (availLoading) {
      return (
        <div style={baseStyle} aria-label="Availability checking">
          <span className="miniMuted">Checking…</span>
        </div>
      );
    }

    if (available === true) {
      return (
        <div
          style={{
            ...baseStyle,
            border: "1px solid rgba(122,255,194,0.28)",
            background: "rgba(122,255,194,0.06)",
          }}
          aria-label="Number available"
        >
          <span style={{ fontWeight: 950 }}>✓ Available</span>
        </div>
      );
    }

    if (available === false) {
      return (
        <div
          style={{
            ...baseStyle,
            border: "1px solid rgba(255,120,120,0.28)",
            background: "rgba(255,120,120,0.06)",
          }}
          aria-label="Number not available"
        >
          <span style={{ fontWeight: 950 }}>✕ Not Available</span>
        </div>
      );
    }

    // unknown
    return (
      <div style={baseStyle} aria-label="Availability unknown">
        <span className="miniMuted">Availability unavailable</span>
      </div>
    );
  }

  async function beginCheckout(useExistingGuess = false) {
    if (!STRIPE_ENABLED) {
      setErr("");
      setStatus("Payments are not enabled yet on this build.");
      setConfirmOpen(false);
      return;
    }

    try {
      setErr("");
      setStatus("");
      setBusy(true);

      const clean = padGuess(useExistingGuess ? myEntry?.guess ?? guessRaw : guessRaw, DIGITS);
      if (onlyDigits(clean).length !== DIGITS) throw new Error(`Enter a ${DIGITS}-digit number.`);

      if (available === false) throw new Error("That number is already claimed. Please pick another.");

      const r = await apiPost("/api/checkout", { guess: clean });
      if (!r?.url) throw new Error("Checkout not available.");
      window.location.assign(r.url);
    } catch (e) {
      setErr(e?.message || "Failed to start checkout.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  async function doLogout() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);
      await authLogout();
    } catch {
      // ignore
    } finally {
      setBusy(false);
      nav("/join", { replace: true });
    }
  }

  const AmoeCompactNotice = () => (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.015)",
        textAlign: "left",
        lineHeight: 1.25,
      }}
      aria-label="No purchase necessary disclosure"
    >
      <div style={{ fontWeight: 900, letterSpacing: "0.02em", marginBottom: 6 }}>
        No purchase necessary.
      </div>
      <div className="miniMuted" style={{ marginBottom: 6 }}>
        Free mail-in entry option available. Void where prohibited.
      </div>
      <button
        type="button"
        className="linkLike"
        onClick={() => nav("/terms")}
        disabled={busy}
        style={{
          padding: 0,
          border: "none",
          background: "transparent",
          color: "inherit",
          textDecoration: "underline",
          cursor: busy ? "default" : "pointer",
        }}
      >
        Official Rules
      </button>
    </div>
  );

  const cornerBtnStyle = {
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    borderRadius: 10,
    letterSpacing: "0.12em",
    lineHeight: 1,
    minHeight: 28,
    width: "auto",
  };

  return (
    <>
      <PanelShell label="" labelClass="profile" footer={null}>
        <div style={{ position: "relative", display: "grid", gap: 10 }}>
          {!loading && me ? (
            <>
              <button
                className="secondary"
                onClick={() => nav("/")}
                disabled={busy}
                style={{
                  ...cornerBtnStyle,
                  position: "absolute",
                  top: 6,
                  left: 0,
                  zIndex: 5,
                }}
                aria-label="Home"
              >
                HOME
              </button>

              <button
                className="secondary"
                onClick={doLogout}
                disabled={busy}
                style={{
                  ...cornerBtnStyle,
                  position: "absolute",
                  top: 6,
                  right: 0,
                  zIndex: 5,
                }}
                aria-label="Log out"
              >
                LOG OUT
              </button>
            </>
          ) : null}

          {/* Brand header */}
          <div style={{ display: "grid", gap: 6, textAlign: "center", marginTop: 6 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 950,
                letterSpacing: "0.06em",
                color: "var(--accent)",
              }}
            >
              drawnfray
            </div>

            <div style={{ marginTop: 8, fontSize: 12, letterSpacing: "0.14em" }}>
              <span style={{ color: "#9ad7ff" }}>Select.</span>{" "}
              <span style={{ color: "#c6a7ff" }}>Submit.</span>{" "}
              <span style={{ color: "#7affc2" }}>Reveal.</span>
            </div>
          </div>

          {loading ? (
            <div className="fineprint" style={{ textAlign: "center" }}>
              Loading…
            </div>
          ) : null}
          {err ? <div className="error">{err}</div> : null}
          {status ? <div className="fineprint">{status}</div> : null}

          {!loading && me ? (
            <>
              <div style={{ display: "grid", gap: 8, textAlign: "center", marginTop: 24 }}>
                <div style={{ fontSize: "1.15rem", fontWeight: 900, letterSpacing: "0.02em" }}>
                  {me.username}
                </div>

                <div className="form" style={{ marginTop: 0 }}>
                  <button
                    className="primary"
                    onClick={() => nav("/reveal")}
                    disabled={busy}
                    style={{
                      width: "100%",
                      minHeight: 58,
                      borderRadius: 14,
                      fontWeight: 950,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    Reveal
                  </button>
                </div>

                <div className="form" style={{ marginTop: 0 }}>
                  <button className="secondary" onClick={() => nav("/winners")} disabled={busy}>
                    Winners
                  </button>
                </div>
              </div>

              {/* ENTRY */}
              <div
                style={{
                  marginTop: 0,
                  padding: "14px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  textAlign: "center",
                }}
              >
                <div className="label" style={{ marginBottom: 8 }}>
                  Your Entry
                </div>

                {!locked ? (
                  <>
                    <div className="miniMuted" style={{ marginBottom: 8 }}>
                      {duplicatePaid ? (
                        <>
                          Your payment was received, but that number was already claimed.
                          <br />
                          Please choose a new number.
                        </>
                      ) : queuedPaid ? (
                        <>
                          Your payment was received, but the contest is already closed.
                          <br />
                          Your entry is queued.
                        </>
                      ) : (
                        <>No submission locked for this week.</>
                      )}
                    </div>

                    <DigitBox
                      value={onlyDigits(guessRaw).slice(0, DIGITS)}
                      onChange={(v) => {
                        // If they start editing after a DUPLICATE/QUEUED message, clear it.
                        if (duplicatePaid || queuedPaid) setErr("");
                        setGuessRaw(v);
                      }}
                      disabled={busy || !cutoffAt}
                      digits={DIGITS}
                    />

                    {/* ✅ Availability indicator */}
                    {availabilityBadge()}

                    <AmoeCompactNotice />

                    <div className="form" style={{ marginTop: 10 }}>
                      <button
                        ref={lockBtnRef}
                        className="primary"
                        disabled={!canProceed}
                        onClick={() => {
                          if (!STRIPE_ENABLED) {
                            setErr("");
                            setStatus("Payments are not enabled yet on this build.");
                            return;
                          }
                          if (available === false) {
                            setErr("That number is already claimed. Please pick another.");
                            return;
                          }
                          setConfirmOpen(true);
                        }}
                      >
                        Continue to checkout
                      </button>
                    </div>
                  </>
                ) : null}

                {locked ? (
                  <>
                    <DigitBox
                      value={String(myEntry?.guess || "")}
                      onChange={() => {}}
                      disabled
                      digits={DIGITS}
                    />

                    <div style={{ display: "grid", gap: 8, marginTop: 10, textAlign: "left" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="label">Submission</span>
                        <span className="value">{myEntry?.guess ?? "—"}</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="label">Locked at</span>
                        <span className="value">{formatDateTime(myEntry?.timestamp)}</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="label">Contest ending</span>
                        <span className="value">{endsOn || "—"}</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="label">Entry status</span>
                        <span className="value">{String(myEntry?.status || "PAID_LOCKED")}</span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </PanelShell>

      <Modal
        open={confirmOpen}
        title="Confirm"
        onClose={() => setConfirmOpen(false)}
        initialFocusRef={lockBtnRef}
        actions={
          <div className="form" style={{ marginTop: 0 }}>
            <button className="primary" onClick={() => beginCheckout(false)} disabled={busy || !canProceed}>
              Continue to checkout
            </button>
            <button className="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        }
      >
        <div className="miniMuted" style={{ marginBottom: 10 }}>
          You are about to proceed to payment for <strong>{guess.padStart(DIGITS, "0")}</strong>. Your entry
          is recorded <strong>only after payment is confirmed</strong>.
        </div>

        {guessDigitsLen === DIGITS && available === false ? (
          <div className="miniMuted" style={{ marginBottom: 10 }}>
            <strong>That number is already claimed.</strong> Please pick another.
          </div>
        ) : null}

        <div className="miniMuted" style={{ marginBottom: 8 }}>
          One entry per person per contest (paid or AMOE). No purchase necessary. Void where prohibited.
        </div>

        <div className="miniMuted">
          Free mail-in entry instructions are in{" "}
          <button
            type="button"
            className="linkLike"
            onClick={() => nav("/terms")}
            disabled={busy}
            style={{
              padding: 0,
              border: "none",
              background: "transparent",
              color: "inherit",
              textDecoration: "underline",
              cursor: busy ? "default" : "pointer",
            }}
          >
            Official Rules
          </button>
          .
        </div>
      </Modal>
    </>
  );
}
