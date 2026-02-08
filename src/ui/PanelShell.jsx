// src/ui/PanelShell.jsx
import React from "react";

export default function PanelShell({
  label,
  labelClass = "landing", // landing | join | profile | reveal | winners | terms
  headerRight = null,
  footer = null,
  bodyScroll = false, // Terms true, Winners list uses its own internal scroll
  children,
}) {
  const hasLabel = !!String(label || "").trim();

  return (
    <main className="screen">
      <section className="panel" role="region" aria-label={label || "panel"}>
        <div className="screenPad">
          {hasLabel || headerRight ? (
            <header className="screenHeader">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {hasLabel ? (
                  <div className={`panelLabel ${labelClass}`} aria-label={`${label} panel`}>
                    {label}
                  </div>
                ) : (
                  <div />
                )}

                {headerRight ? <div>{headerRight}</div> : null}
              </div>

              {hasLabel ? <hr className="headerRule" /> : null}
            </header>
          ) : null}

          <div className={`screenBody ${bodyScroll ? "scroll" : ""}`}>{children}</div>

          {footer ? <footer className="screenFooter">{footer}</footer> : null}
        </div>
      </section>
    </main>
  );
}
