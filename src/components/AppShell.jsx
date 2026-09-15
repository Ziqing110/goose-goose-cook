import { Outlet } from "react-router-dom";
import VoiceBar from "./VoiceBar.jsx";
import { useDesignV4 } from "../utils/designV4.js";
import "./AppShell.css";
import "../styles/design-v4.css";

export default function AppShell() {
  // The v4 design system is route-scoped (see utils/designV4.js). It's
  // applied here, at the shell root, because it has to reach chrome that
  // is a *sibling* of the routed page — SessionProgress (under
  // SessionLayout) and VoiceBar (rendered below) — which a class on the
  // page's own <section> could never reach via descendant selectors.
  const isDesignV4 = useDesignV4();

  return (
    <div className={`app-shell${isDesignV4 ? " ds-v4" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="10" cy="12" r="2.1" fill="currentColor" />
              <circle cx="22" cy="11" r="2.1" fill="currentColor" />
              <circle cx="21" cy="21" r="2.1" fill="currentColor" />
              <path d="M10 12 L21 21 M22 11 L21 21" stroke="currentColor" strokeWidth="1.6" fill="none" />
            </svg>
          </span>
          <span className="brand-name">Kitchen Path</span>
        </div>
      </header>

      <main className="stage-root">
        <Outlet />
      </main>

      <VoiceBar />
    </div>
  );
}
