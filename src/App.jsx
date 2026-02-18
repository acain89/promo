// src/App.jsx
import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import Landing from "./pages/Landing.jsx";
import Terms from "./pages/Terms.jsx";
import Admin from "./pages/Admin.jsx";
import Reveal from "./pages/Reveal.jsx";
import Winners from "./pages/Winners.jsx";

import Join from "./pages/Join.jsx";
import Reset from "./pages/Reset.jsx";

import Profile from "./pages/Profile.jsx";

import { authLogout } from "./lib/api.js";

/* =========================================================
   Tiny logout route (so "Log out" can be a real page too)
========================================================= */
function Logout() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        await authLogout();
      } catch {
        // ignore
      } finally {
        nav("/", { replace: true });
      }
    })();
  }, [nav]);

  return <Navigate to="/" replace />;
}

export default function App() {
  const navigate = useNavigate();

  // ✅ GLOBAL ADMIN HOTKEY (App.jsx only)
  useEffect(() => {
    function onKeyDown(e) {
      // Ctrl + Alt + T
      if (e.ctrlKey && e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        navigate("/admin");
      }
    }
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <Routes>
      {/* 6 user-facing panels */}
      <Route path="/" element={<Landing />} />
      <Route path="/join" element={<Join />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/winners" element={<Winners />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/reveal" element={<Reveal />} />

      {/* real logout route */}
      <Route path="/logout" element={<Logout />} />

      {/* Compliance-friendly aliases (same content for now) */}
      <Route path="/official-rules" element={<Navigate to="/terms" replace />} />
      <Route path="/rules" element={<Navigate to="/terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/terms" replace />} />

      {/* Admin (separate, desktop-only) */}
      <Route path="/admin" element={<Admin />} />

      {/* legacy/compat routes -> keep clean + direct */}
      <Route path="/login" element={<Navigate to="/join" replace />} />
      <Route path="/reset" element={<Reset />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
