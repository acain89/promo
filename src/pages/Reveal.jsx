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
  return d.slice(0, digits).padStart(d.length ? digits : 0, "0");
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

export default function Reveal() {
  const nav = useNavigate();

  const [contest, setContest] = useState(null);
  const [paidWinner, setPaidWinner] = useState(null);

  // Keep fetching AMOE state so backend / terms / admin workflows aren’t impacted,
  // but we do NOT render AMOE on this page.
  const [amoe, setAmoe] = useState(null);
  const [amoeWinner, setAmoeWinner] = useState(null);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

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
  const paidTarget = paidWinner?.target !== "—" ? paidWinner?.target : padNum(contest?.targetNumber, paidDigits);
  const paidEndsOn = contest?.endsOn || paidWinner?.endsOn || "—";

  const paidState = useMemo(() => {
    if (loading) return "LOADING";
    if (err) return "ERROR";
    if (!contest) return "NO_CONTEST";
    if (!paidResolved) return "PENDING";
    return "FINAL";
  }, [loading, err, contest, paidResolved]);

  return (
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

        {/* =======================
            PAID SECTION
        ======================= */}
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
            </>
          )}
        </div>

        {/* AMOE SECTION REMOVED FROM REVEAL PAGE (per request). */}
      </div>
    </PanelShell>
  );
}
