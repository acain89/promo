// src/ui/PanelShell.jsx
import React from "react";

export default function PanelShell({
  label,
  labelClass = "landing", // landing | join | profile | reveal | winners | terms
  headerRight = null,
  footer = null,
  bodyScroll = false, // Terms true, Winners list uses its own internal scroll
  children,

  /**
   * IMPORTANT CHANGE:
   * - Default nav is OFF now.
   * - Pages must explicitly opt-in to any top-row navigation via showNav/headerRight.
   */
  showNav = false,
  nav = null, // optional custom nav node if a page wants it
}) {
  const hasLabel = !!String(label || "").trim();

  return (
    <main className="screen">
      <section className="panel" role="region" aria-label={label || "panel"}>
        <div className="screenPad">
          {showNav || hasLabel || headerRight ? (
            <header className="screenHeader">
              {showNav && nav ? (
                <>
                  {nav}
                  <hr className="headerRule" style={{ marginTop: 12 }} />
                </>
              ) : null}

              {hasLabel || headerRight ? (
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
              ) : null}

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
