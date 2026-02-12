// src/pages/Profile.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, apiPost, authLogout, authMe } from "../lib/api.js";

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

// Stripe feature flag (frontend)
const STRIPE_ENABLED = String(import.meta.env.VITE_STRIPE_ENABLED || "")
  .toLowerCase()
  .trim() === "true";

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

function DigitBox({ value, onChange, disabled }) {
  const digits = 3;
  const [arr, setArr] = useState(["", "", ""]);
  const r0 = useRef(null);
  const r1 = useRef(null);
  const r2 = useRef(null);
  const refs = [r0, r1, r2];

  useEffect(() => {
    const d = onlyDigits(value).slice(0, digits);
    setArr([d[0] || "", d[1] || "", d[2] || ""]);
  }, [value]);

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
    const text = onlyDigits(e.clipboardData.getData("text") || "").slice(0, 3);
    if (!text) return;
    e.preventDefault();
    const next = [text[0] || "", text[1] || "", text[2] || ""];
    setArr(next);
    emit(next);
    const idx = Math.min(text.length, 3) - 1;
    refs[Math.max(0, idx)].current?.focus();
  }

  return (
    <div className="digitRow" onPaste={handlePaste} aria-label="3-digit submission">
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

export default function Profile() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  const [me, setMe] = useState(null);
  const [contest, setContest] = useState(null);

  const [passActive, setPassActive] = useState(false);
  const [passSupported, setPassSupported] = useState(false);

  const [myEntry, setMyEntry] = useState(null);
  const [myEntryMeta, setMyEntryMeta] = useState({
    contestId: null,
    contestActivatedAt: null,
  });

  // NOTE: lastWeek UI block removed, so we no longer need this state
  // const [lastWeek, setLastWeek] = useState(null);

  const [guessRaw, setGuessRaw] = useState("");
  const guess = useMemo(() => padGuess(guessRaw, 3), [guessRaw]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const lockBtnRef = useRef(null);

  // ✅ Allow editing guess during pending checkout
  const [editPending, setEditPending] = useState(false);

  const checkoutResult = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return String(p.get("checkout") || "").toLowerCase(); // success | cancel | ""
    } catch {
      return "";
    }
  }, []);

  const entryStatusUpper = useMemo(
    () => String(myEntry?.status || "").toUpperCase(),
    [myEntry?.status]
  );

  // ✅ CRITICAL: "Locked" means PAID only.
  const paidLocked =
    !!myEntry?.paid ||
    entryStatusUpper === "PAID" ||
    entryStatusUpper === "PAID_LOCKED" ||
    entryStatusUpper === "LOCKED_PAID";

  // ✅ IMPORTANT: pendingPayment should only exist when Stripe is enabled
  const pendingPayment =
    STRIPE_ENABLED &&
    !!myEntry?.guess &&
    !paidLocked &&
    (entryStatusUpper.includes("PENDING") ||
      entryStatusUpper.includes("AWAIT") ||
      entryStatusUpper.includes("UNPAID") ||
      entryStatusUpper.includes("CHECKOUT") ||
      entryStatusUpper.includes("PAYMENT"));

  const locked = paidLocked;

  async function refresh() {
    setErr("");
    setLoading(true);

    try {
      const m = await authMe();
      if (!m?.ok) {
        nav("/join", { replace: true });
        return;
      }
      setMe(m.user);

      const c = await apiGet("/api/contest");
      setContest(c && typeof c === "object" ? c : null);

      // Reset pending-edit UI on refresh
      setEditPending(false);

      // Parallelize the optional calls for faster load
      const [entryRes, passRes] = await Promise.allSettled([
        apiGet("/api/my-entry"),
        apiGet("/api/my-pass"),
        // apiGet("/api/last-week"), // removed with UI block
      ]);

      // Entry
      if (entryRes.status === "fulfilled") {
        const e = entryRes.value;
        setMyEntry(e?.ok ? e.entry : null);
        setMyEntryMeta({
          contestId: e?.contestId || null,
          contestActivatedAt: e?.contestActivatedAt ?? null,
        });

        // Prefill guess only when NOT paid
        if (e?.ok && e?.entry?.guess && !(e?.entry?.paid)) {
          setGuessRaw(String(e.entry.guess));
        }
      } else {
        setMyEntry(null);
        setMyEntryMeta({ contestId: null, contestActivatedAt: null });
      }

      // Pass
      if (passRes.status === "fulfilled") {
        const p = passRes.value;
        if (p && typeof p === "object" && ("active" in p || "passActive" in p || p?.ok)) {
          setPassSupported(true);
          setPassActive(!!(p.active ?? p.passActive));
        } else {
          setPassSupported(false);
          setPassActive(false);
        }
      } else {
        setPassSupported(false);
        setPassActive(false);
      }

      // Checkout message (only meaningful when Stripe enabled)
      if (STRIPE_ENABLED && checkoutResult === "success") {
        setStatus("Payment received. Your entry is recorded.");
      } else if (STRIPE_ENABLED && checkoutResult === "cancel") {
        setStatus("Checkout canceled. No entry was submitted.");
      } else {
        setStatus("");
      }
    } catch (e) {
      setErr(e?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutoffAt = contest?.cutoffAt ?? null;
  const endsOn = contest?.endsOn ?? null;
  const activatedAt = contest?.activatedAt ?? null;

  const needsPass = passSupported ? !passActive : false;

  const canProceed =
    !loading &&
    !busy &&
    !locked &&
    !needsPass &&
    !!cutoffAt &&
    onlyDigits(guessRaw).length === 3;

  const isQueued =
    locked && !!myEntry?.paid && String(myEntry?.status || "").toUpperCase() === "QUEUED";
  const contestNotActivated = locked && !activatedAt;

  async function doLogout() {
    try {
      setErr("");
      setStatus("");
      setBusy(true);
      await authLogout();
      nav("/", { replace: true });
    } catch (e) {
      setErr(e?.message || "Logout failed.");
    } finally {
      setBusy(false);
    }
  }

  async function buyPass() {
    setStatus("");
    setErr("");
    setStatus("Game pass purchase is not yet enabled on this build.");
  }

  async function beginCheckout(useExistingGuess = false) {
    // ✅ If Stripe is not enabled, never enter pending states or scary UX.
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

      const clean = padGuess(useExistingGuess ? myEntry?.guess ?? guessRaw : guessRaw, 3);
      if (onlyDigits(clean).length !== 3) throw new Error("Enter a 3-digit number.");

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

  const AmoeCompactNotice = ({ compact = false }) => (
    <div
      style={{
        marginTop: compact ? 8 : 10,
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

  return (
    <>
      <PanelShell label="" labelClass="profile" footer={null}>
        <div style={{ display: "grid", gap: 12 }}>
          {loading ? <div className="fineprint">Loading…</div> : null}
          {err ? <div className="error">{err}</div> : null}
          {status ? <div className="fineprint">{status}</div> : null}

          {!loading && me && (
            <>
              {/* Top Bar (compact) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <button
                  className="secondary"
                  style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                  onClick={() => nav("/")}
                  disabled={busy}
                >
                  Home
                </button>

                <button
                  className="secondary"
                  style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                  onClick={doLogout}
                  disabled={busy}
                >
                  Log out
                </button>
              </div>

              {/* User Info */}
              <div style={{ display: "grid", gap: 4, textAlign: "center" }}>
                <div style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: "0.02em" }}>
                  {me.username}
                </div>
                <div className="miniMuted">{me.email || ""}</div>
              </div>
            </>
          )}

          {/* THIS WEEK */}
          <div
            style={{
              marginTop: 2,
              padding: "14px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.02)",
              textAlign: "center",
            }}
          >
            <div className="label" style={{ marginBottom: 8 }}>
              This Week
            </div>

            {needsPass && (
              <>
                <div
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    opacity: 0.85,
                    marginBottom: 10,
                    fontSize: "0.78rem",
                  }}
                >
                  Game pass required
                </div>

                <DigitBox value={onlyDigits(guessRaw).slice(0, 3)} onChange={setGuessRaw} disabled />

                <div className="form" style={{ marginTop: 0 }}>
                  <button className="primary" onClick={buyPass} disabled={busy}>
                    Buy game pass
                  </button>
                </div>
              </>
            )}

            {/* Pending payment notice (only when Stripe enabled) */}
            {!needsPass && STRIPE_ENABLED && pendingPayment && !locked && (
              <div
                className="miniMuted"
                style={{
                  marginBottom: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.015)",
                  textAlign: "left",
                  lineHeight: 1.25,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  {editPending ? "Change entry" : "Checkout in progress"}
                </div>

                {!editPending ? (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      Your entry is recorded only after payment is completed. You can resume checkout or change your
                      guess and try again.
                    </div>

                    <div className="form" style={{ marginTop: 0 }}>
                      <button className="primary" onClick={() => beginCheckout(true)} disabled={busy}>
                        Continue to checkout
                      </button>

                      <button
                        className="secondary"
                        onClick={() => {
                          setEditPending(true);
                          setErr("");
                          setStatus("");
                          setGuessRaw(String(myEntry?.guess || ""));
                        }}
                        disabled={busy}
                      >
                        Change Entry
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      Enter a new 3-digit number, then continue to checkout.
                    </div>

                    <div style={{ display: "grid", placeItems: "center", marginBottom: 10 }}>
                      <DigitBox
                        value={onlyDigits(guessRaw).slice(0, 3)}
                        onChange={setGuessRaw}
                        disabled={busy || !cutoffAt}
                      />
                    </div>

                    <div className="form" style={{ marginTop: 0 }}>
                      <button className="primary" onClick={() => beginCheckout(false)} disabled={busy || !canProceed}>
                        Continue to checkout
                      </button>

                      <button
                        className="secondary"
                        onClick={() => {
                          setEditPending(false);
                          setGuessRaw(String(myEntry?.guess || ""));
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Normal flow when not locked (and either Stripe off, or no pending) */}
            {!needsPass && !locked && (!STRIPE_ENABLED || !pendingPayment) && (
              <>
                <div className="miniMuted" style={{ marginBottom: 8 }}>
                  No submission locked for this week.
                </div>

                <DigitBox
                  value={onlyDigits(guessRaw).slice(0, 3)}
                  onChange={setGuessRaw}
                  disabled={busy || !cutoffAt}
                />

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
                      setConfirmOpen(true);
                    }}
                  >
                    Continue to checkout
                  </button>
                </div>
              </>
            )}

            {locked && (
              <>
                <DigitBox value={String(myEntry?.guess || "")} onChange={() => {}} disabled />

                {isQueued || contestNotActivated ? (
                  <div
                    className="miniMuted"
                    style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.012)",
                      textAlign: "left",
                      lineHeight: 1.25,
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Queued for next week</div>
                    <div>
                      Entries submitted after cutoff are saved immediately, but the prize display updates after the
                      Sunday reset.
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="label">Submission</span>
                    <span className="value">{myEntry?.guess ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="label">Locked at</span>
                    <span className="value">{formatDateTime(myEntry?.timestamp)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="label">Game ending on</span>
                    <span className="value">{endsOn || "—"}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* YOUR ENTRY INFO */}
          <div
            style={{
              padding: "14px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.01)",
              textAlign: "left",
            }}
          >
            <div className="label" style={{ marginBottom: 10, textAlign: "center" }}>
              Your Entry Info
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="label">Game ending on</span>
                <span className="value">{endsOn || "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="label">Submission</span>
                <span className="value">{locked ? myEntry?.guess : "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="label">Locked timestamp</span>
                <span className="value">{locked ? formatDateTime(myEntry?.timestamp) : "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="label">Entry status</span>
                <span className="value">
                  {locked
                    ? String(myEntry?.status || "PAID_LOCKED")
                    : STRIPE_ENABLED && pendingPayment
                    ? String(myEntry?.status || "CHECKOUT_IN_PROGRESS")
                    : "—"}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="label">Pass status</span>
                <span className="value">
                  {passSupported ? (passActive ? "Active" : "Not purchased") : locked ? "Active" : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* LAST WEEK block removed */}
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
          You are about to proceed to payment for <strong>{guess.padStart(3, "0")}</strong>. Your entry is recorded{" "}
          <strong>only after payment is confirmed</strong>.
        </div>

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
