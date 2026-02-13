// src/pages/Reveal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PanelShell from "../ui/PanelShell.jsx";
import { apiGet, authMe } from "../lib/api.js";

function onlyDigits(s) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function padNum(raw, digits) {
  const d = onlyDigits(raw);
  if (!d) return "—";
  return d.slice(-digits).padStart(digits, "0");
}

// 1000-cell map index is ALWAYS last-3-digits (000–999), even if DAILY4 exists.
function norm3ToIndex(raw) {
  const d = onlyDigits(raw);
  if (!d) return -1;
  const last3 = d.slice(-3);
  const n = Number(last3);
  return Number.isFinite(n) && n >= 0 && n <= 999 ? n : -1;
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

function dollarsFromCents(cents) {
  const n = Number(cents || 0);
  const v = Number.isFinite(n) ? n : 0;
  return (v / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function paidWinnerCardFromRecord(r, digits) {
  if (!r) return null;
  return {
    id: r.id || null,
    winnerUN: r.winnerUN || r.winner || "—",
    guess: padNum(r.guess, digits),
    target: padNum(r.target || r.targetNumber, digits),
    diff: typeof r.diff === "number" ? r.diff : r.diff ?? "—",
    entryTimestamp: r.entryTimestamp || r.timestamp || null,
    resolvedAt: r.resolvedAt || null,
    prizeCents: Number(r.prizeCents || 0),
    contestId: r.contestId || null,
    endsOn: r.endsOn || null,
  };
}

// NOTE: AMOE helpers retained so AMOE logic remains in project.
// We are only removing AMOE visibility from this Reveal page.
function amoeWinnerCardFromRecord(r) {
  if (!r) return null;
  return {
    id: r.id || null,
    winnerName: r.winnerName || r.name || "—",
    winnerEmail: r.winnerEmail || r.email || null,
    guess: padNum(r.guess, 3),
    target: padNum(r.target || r.targetNumber, 3),
    diff: typeof r.diff === "number" ? r.diff : r.diff ?? "—",
    entryTimestamp: r.entryTimestamp || r.timestamp || null,
    resolvedAt: r.resolvedAt || null,
    prizeCents: Number(r.prizeCents || 0),
    cycleId: r.cycleId ?? null,
  };
}

function gridLabelFromIndex(i, digits) {
  // Display label uses digits (3 or 4), but grid itself is 0..999
  // For 4 digits, this yields 0000–0999.
  return String(i).padStart(digits, "0").slice(-digits);
}

export default function Reveal() {
  const nav = useNavigate();

  const [contest, setContest] = useState(null);
  const [paidWinner, setPaidWinner] = useState(null);

  // Retained but not displayed
  const [amoe, setAmoe] = useState(null);
  const [amoeWinner, setAmoeWinner] = useState(null);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Round summary modal state
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState("");
  const [summary, setSummary] = useState(null);

  // viewer entry (so we can circle "your submission" in blue)
  const [myGuess, setMyGuess] = useState(null);

  const paidDigits = useMemo(() => {
    const mode = String(contest?.mode || "PICK3").toUpperCase();
    return mode === "DAILY4" ? 4 : 3;
  }, [contest?.mode]);

  async function refresh() {
    try {
      setErr("");
      setLoading(true);

      let ok = false;
      try {
        const m = await authMe();
        ok = !!m?.ok;
      } catch {
        ok = false;
      }

      if (!ok) {
        nav("/join", { replace: true });
        return;
      }

      const rs = await apiGet("/api/reveal-state");

      const paid = rs?.paid || null;
      setContest(paid);

      const digits = String(paid?.mode || "PICK3").toUpperCase() === "DAILY4" ? 4 : 3;
      setPaidWinner(paidWinnerCardFromRecord(rs?.paidWinner || null, digits));

      // AMOE state retained (not displayed here)
      setAmoe(rs?.amoe || null);
      setAmoeWinner(amoeWinnerCardFromRecord(rs?.amoeWinner || null));
    } catch (e) {
      setErr(e.message || "Failed to load results.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paidResolved = !!contest?.resolved;
  const paidTarget =
    paidWinner?.target !== "—" ? paidWinner?.target : padNum(contest?.targetNumber, paidDigits);
  const paidEndsOn = contest?.endsOn || paidWinner?.endsOn || "—";

  const paidState = useMemo(() => {
    if (loading) return "LOADING";
    if (err) return "ERROR";
    if (!contest) return "NO_CONTEST";
    if (!paidResolved) return "PENDING";
    return "FINAL";
  }, [loading, err, contest, paidResolved]);

  async function loadSummaryIfNeeded() {
    if (summary) return;

    const contestId = String(contest?.id || paidWinner?.contestId || "").trim();
    if (!contestId) {
      setSummaryErr("Contest id missing; cannot load round summary.");
      return;
    }

    try {
      setSummaryErr("");
      setSummaryLoading(true);

      // Load summary map
      const data = await apiGet(`/api/round-summary?contestId=${encodeURIComponent(contestId)}`);
      if (!data?.ok) {
        setSummaryErr("Round summary unavailable.");
        return;
      }

      // ✅ IMPORTANT: need "my entry for this contest", not active contest.
      // Requires backend support: GET /api/my-entry?contestId=...
      let viewerGuess = null;
      try {
        const me = await apiGet(`/api/my-entry?contestId=${encodeURIComponent(contestId)}`);
        viewerGuess = me?.ok ? me?.entry?.guess : null;
      } catch {
        viewerGuess = null;
      }

      const digits = Number(data.digits || paidDigits);

      setMyGuess(viewerGuess ? padNum(viewerGuess, digits) : null);

      setSummary({
        contestId: data.contestId || contestId,
        digits,
        targetNumber: data.targetNumber ? padNum(data.targetNumber, digits) : null,
        winnerGuess: data.winnerGuess ? padNum(data.winnerGuess, digits) : null,
        counts: Array.isArray(data.counts) ? data.counts : [],
      });
    } catch (e) {
      setSummaryErr(e.message || "Failed to load round summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  function openSummary() {
    setSummaryOpen(true);
    loadSummaryIfNeeded();
  }

  const gridDigits = Number(summary?.digits || paidDigits);
  const counts = summary?.counts || [];

  const targetStr =
    summary?.targetNumber && summary.targetNumber !== "—" ? summary.targetNumber : paidTarget;

  // Blue ring should represent "your submission" if we have it.
  // Fallback to paidWinner.guess if we don't.
  const blueRingStr =
    myGuess && myGuess !== "—"
      ? myGuess
      : paidWinner?.guess || summary?.winnerGuess || "—";

  const winnerDisplayStr =
    summary?.winnerGuess && summary.winnerGuess !== "—"
      ? summary.winnerGuess
      : paidWinner?.guess || "—";

  // ✅ Rings use last-3 digits ALWAYS
  const targetIdx = useMemo(() => norm3ToIndex(targetStr), [targetStr]);
  const blueIdx = useMemo(() => norm3ToIndex(blueRingStr), [blueRingStr]);

  return (
    <>
      <PanelShell
        label=""
        labelClass="reveal"
        footer={
          <div className="form" style={{ marginTop: 0 }}>
            <button className="primary" onClick={() => nav("/profile")}>
              Return to Profile
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="miniMuted" style={{ textAlign: "center" }}>
            Week ending <strong>{paidEndsOn}</strong>
          </div>

          {paidState === "LOADING" && <div className="fineprint">Loading…</div>}
          {paidState === "ERROR" && <div className="error">{err}</div>}

          <div
            style={{
              padding: "12px 12px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div className="label" style={{ textAlign: "center", marginBottom: 10 }}>
              Paid Weekly Results
            </div>

            {paidState === "NO_CONTEST" && (
              <div className="miniMuted" style={{ textAlign: "center" }}>
                Paid reveal unavailable. Contest state could not be loaded.
              </div>
            )}

            {paidState === "PENDING" && (
              <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
                <div className="value" style={{ fontSize: "1.05rem", fontWeight: 900 }}>
                  Results pending
                </div>
                <div className="miniMuted">Paid results have not been posted yet.</div>
                <div className="form" style={{ marginTop: 0 }}>
                  <button className="secondary" onClick={refresh}>
                    Refresh
                  </button>
                </div>
              </div>
            )}

            {paidState === "FINAL" && (
              <>
                <div
                  style={{
                    padding: "14px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.03)",
                    textAlign: "center",
                  }}
                >
                  <div className="label" style={{ marginBottom: 8 }}>
                    Drawn Target Number
                  </div>
                  <div
                    style={{
                      fontSize: "2.1rem",
                      fontWeight: 950,
                      letterSpacing: "0.18em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {paidTarget || "—"}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    padding: "14px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.01)",
                    textAlign: "left",
                  }}
                >
                  <div className="label" style={{ textAlign: "center", marginBottom: 10 }}>
                    Paid Winner
                  </div>

                  {paidWinner ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1.25rem", fontWeight: 950, letterSpacing: "0.02em" }}>
                          {paidWinner.winnerUN}
                        </div>
                        <div className="miniMuted" style={{ marginTop: 2 }}>
                          {dollarsFromCents(paidWinner.prizeCents)}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="label">Submission</span>
                          <span className="value">{paidWinner.guess}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="label">Target</span>
                          <span className="value">{paidWinner.target}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="label">Distance</span>
                          <span className="value">{paidWinner.diff}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="label">Submission time</span>
                          <span className="value">{formatDateTime(paidWinner.entryTimestamp)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="label">Posted</span>
                          <span className="value">{formatDateTime(paidWinner.resolvedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="miniMuted" style={{ textAlign: "center" }}>
                      Results are posted, but the paid winner record isn’t available yet.
                    </div>
                  )}
                </div>

                <div className="form" style={{ marginTop: 10 }}>
                  <button className="secondary" onClick={openSummary} disabled={summaryLoading}>
                    Round Summary
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </PanelShell>

      {summaryOpen ? (
        <div
          className="prevModal"
          role="dialog"
          aria-modal="true"
          aria-label="Round Summary"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSummaryOpen(false);
          }}
          style={{ display: "grid", placeItems: "center", padding: 18 }}
        >
          <div
            className="prevCard"
            style={{
              width: "min(820px, 96vw)",
              background: "rgba(10,12,18,0.92)",
              border: "1px solid rgba(255,255,255,0.14)",
              maxHeight: "86vh",
              overflow: "hidden",
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
                Round Summary
              </div>

              <button
                className="prevClose"
                onClick={() => setSummaryOpen(false)}
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

            <div className="prevBody" style={{ color: "rgba(255,255,255,0.86)", lineHeight: 1.45 }}>
              {summaryErr ? <div className="error">{summaryErr}</div> : null}
              {summaryLoading ? <div className="fineprint">Loading round summary…</div> : null}

              {!summaryLoading ? (
                <>
                  <div style={{ display: "grid", gap: 8, padding: "4px 0 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div className="miniMuted">
                        <strong>Target:</strong>{" "}
                        <span style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.12em" }}>
                          {targetStr || "—"}
                        </span>
                      </div>

                      <div className="miniMuted">
                        <strong>Winner:</strong>{" "}
                        <span style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.12em" }}>
                          {winnerDisplayStr || "—"}
                        </span>
                      </div>

                      <div className="miniMuted">
                        <strong>Grid:</strong> 20 × 50 (1000)
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", opacity: 0.85, fontSize: 12 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(255,255,255,0.55)" }} />
                        Played
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(255,255,255,0.14)" }} />
                        Not played
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 999, border: "2px solid rgba(255,80,80,0.95)" }} />
                        Target (last 3 digits)
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 999, border: "2px solid rgba(80,160,255,0.95)" }} />
                        Your pick (last 3 digits)
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.02)",
                      overflow: "auto",
                      maxHeight: "58vh",
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(20, minmax(0, 1fr))",
                        gap: 6,
                        minWidth: 720,
                      }}
                    >
                      {Array.from({ length: 1000 }).map((_, i) => {
                        const playedCount = Number(counts[i] || 0);
                        const played = playedCount > 0;

                        const isTarget = i === targetIdx;
                        const isBlue = i === blueIdx;

                        const label = gridLabelFromIndex(i, gridDigits);

                        return (
                          <div
                            key={i}
                            title={`${label}${played ? ` • picked ${playedCount}` : ""}${isTarget ? " • TARGET" : ""}${
                              isBlue ? " • YOUR PICK" : ""
                            }`}
                            style={{
                              position: "relative",
                              borderRadius: 10,
                              padding: "10px 6px",
                              textAlign: "center",
                              fontSize: 11,
                              fontWeight: played ? 900 : 700,
                              letterSpacing: "0.10em",
                              fontVariantNumeric: "tabular-nums",
                              color: played ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.36)",
                              background: played ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              userSelect: "none",
                            }}
                          >
                            {label}

                            {played ? (
                              <div style={{ marginTop: 4, fontSize: 10, opacity: 0.75, letterSpacing: "0.02em" }}>
                                {playedCount}
                              </div>
                            ) : (
                              <div style={{ marginTop: 4, fontSize: 10, opacity: 0.25 }}>0</div>
                            )}

                            {isTarget ? (
                              <span
                                style={{
                                  position: "absolute",
                                  inset: 3,
                                  borderRadius: 12,
                                  border: "2px solid rgba(255,80,80,0.95)",
                                  pointerEvents: "none",
                                }}
                              />
                            ) : null}

                            {isBlue ? (
                              <span
                                style={{
                                  position: "absolute",
                                  inset: 7,
                                  borderRadius: 10,
                                  border: "2px solid rgba(80,160,255,0.95)",
                                  pointerEvents: "none",
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              <div className="form" style={{ marginTop: 12 }}>
                <button className="secondary" onClick={() => setSummaryOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
