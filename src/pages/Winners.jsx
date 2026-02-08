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

/* Visual placeholders until real winners exist */
const PLACEHOLDERS = [
  {
    un: "PlayerOne",
    submission: "384",
    target: "392",
    diff: 8,
    prizeCents: 60000,
    submittedAt: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    un: "NeonWolf",
    submission: "701",
    target: "699",
    diff: 2,
    prizeCents: 42500,
    submittedAt: Date.now() - 1000 * 60 * 60 * 50,
  },
  {
    un: "Postman",
    submission: "112",
    target: "109",
    diff: 3,
    prizeCents: 31000,
    submittedAt: Date.now() - 1000 * 60 * 60 * 74,
  },
];

export default function Winners() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiGet("/api/winners");
        setItems(Array.isArray(r) ? r : []);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  const rows = useMemo(() => {
    if (!items.length) {
      return PLACEHOLDERS.map((p, i) => ({
        id: `ph-${i}`,
        placeholder: true,
        ...p,
      }));
    }

    return items.map((w, i) => ({
      id: w.id || `w-${i}`,
      placeholder: false,
      un: safe(w.winnerUN || w.winner),
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
        {rows.map((r) => (
          <div
            key={r.id}
            className="winnerCard"
            style={{ opacity: r.placeholder ? 0.65 : 1 }}
          >
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
