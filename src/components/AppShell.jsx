import { Link, Outlet, useLocation } from "react-router-dom";
import VoiceBar from "./VoiceBar.jsx";
import { useDesignV4 } from "../utils/designV4.js";
import "./AppShell.css";
import "../styles/design-v4.css";

export default function AppShell() {
  // The design-system class has to sit on the shell (not the page):
  // that's the only ancestor shared by the page, SessionProgress (in
  // SessionLayout) and VoiceBar (rendered below) — which a class on the
  // page's own <section> could never reach via descendant selectors.
  const isDesignV4 = useDesignV4();
  const { pathname } = useLocation();
  // A cook journal is a frozen page, not a session step: it keeps the
  // same chrome as Home so it reads as part of the app, but swaps the
  // voice bar for a way back.
  const isJournal = pathname.startsWith("/cook/");

  return (
    <div className={`app-shell${isDesignV4 ? " ds-v4" : ""}${isJournal ? " is-journal" : ""}`}>
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
        {isJournal && (
          <nav className="topbar-nav" aria-label="Journal">
            <Link className="topbar-link" to="/">← Home</Link>
          </nav>
        )}
      </header>

      <main className="stage-root">
        <Outlet />
      </main>

      {!isJournal && <VoiceBar />}
    </div>
  );
}
