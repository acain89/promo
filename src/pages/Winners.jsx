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

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString();
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function safe(v) {
  const s = String(v ?? "").trim();
  return s || "—";
}

export default function Winners() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const r = await apiGet("/api/winners");
        if (!alive) return;
        setItems(Array.isArray(r) ? r : []);
      } catch {
        if (!alive) return;
        setItems([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    return (items || []).map((w, i) => ({
      id: w.id || `w-${i}`,
      un: safe(w.winnerUN || w.winner || w.username),
      submission: safe(w.guess),
      target: safe(w.target),
      diff: w.diff ?? "—",
      prizeCents: w.prizeCents || 0,
      submittedAt: w.entryTimestamp || w.submittedAt || null,
    }));
  }, [items]);

  return (
    <PanelShell
      label="PAST WINNERS"
      labelClass="winners"
      footer={
        <div className="form" style={{ marginTop: 0 }}>
          <button className="secondary" onClick={() => nav("/")}>
            Back
          </button>
        </div>
      }
    >
      <div className="scrollList">
        {loading ? (
          <div className="miniMuted" style={{ textAlign: "center", padding: "10px 0" }}>
            Loading…
          </div>
        ) : null}

        {!loading && !rows.length ? (
          <div className="miniMuted" style={{ textAlign: "center", padding: "10px 0" }}>
            No winners posted yet.
          </div>
        ) : null}

        {rows.map((r) => (
          <div key={r.id} className="winnerCard">
            <div className="winnerUN">{r.un}</div>
            <div className="winnerPrize">{dollarsFromCents(r.prizeCents)}</div>

            <div className="winnerGrid">
              <div>
                <div className="label">Submission</div>
                <div className="value">{r.submission}</div>
              </div>
              <div>
                <div className="label">Target</div>
                <div className="value">{r.target}</div>
              </div>
              <div>
                <div className="label">Distance</div>
                <div className="value">{r.diff}</div>
              </div>
            </div>

            <div className="winnerTS">
              {formatDate(r.submittedAt)} · {formatTime(r.submittedAt)}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
