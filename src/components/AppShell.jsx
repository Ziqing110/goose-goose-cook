import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import VoiceBar from "./VoiceBar.jsx";
import ConversationRail from "./ConversationRail.jsx";
import BrandGoose from "./BrandGoose.jsx";
import gooseSm from "../assets/baby-goose-final/png/goose-exclamation-v2.png";
import Wordmark from "./Wordmark.jsx";
import { useAppState } from "../state/AppStateContext.jsx";
import { usePlayerLaneVars } from "../hooks/usePlayerLaneVars.js";
import "./AppShell.css";
import "../styles/design-v4.css";

// The session stages and the cook card use the v4 design system
// (styles/design-v4.css); Home and kitchen setup keep their own look.
const DESIGN_V4_PATHS = ["/session/conversation", "/session/inventory", "/session/voice-binding", "/session/schedule", "/session/live-cook"];

export default function AppShell() {
  const { pathname } = useLocation();
  // On the shell, the only ancestor the page, SessionProgress and the
  // VoiceBar share.
  const isDesignV4 = DESIGN_V4_PATHS.includes(pathname) || pathname.startsWith("/cook/");
  const { state } = useAppState();
  // A cook journal is a frozen page, not a session step: it keeps the
  // same chrome as Home so it reads as part of the app — goose included —
  // plus a way back.
  const isJournal = pathname.startsWith("/cook/");
  // Live-cook has its own demo notice (voice recognition, non-dismissable);
  // showing this generic one there too would be a redundant second banner.
  const isLiveCook = pathname.startsWith("/session/live-cook");
  // Keep dismissal during navigation; a page reload starts a fresh notice.
  const [demoOpen, setDemoOpen] = useState(true);

  // The swim lane colours follow whichever birds the cooks picked. Set
  // on the root element (not the shell div) so a portaled surface — the
  // Schedule bottom sheet, which mounts straight onto document.body and
  // so can't inherit from anything inside .app-shell — still picks up
  // the right --kp-cook-a/-b before it remaps them. The journal reads a
  // past session by id, not the app's current one, so it owns this for
  // itself (CookSummaryPage.jsx) — setting it here too would fight over
  // document.documentElement and the wrong session would win.
  usePlayerLaneVars(isJournal ? null : state.session?.cooks);

  return (
    <div className={`app-shell${isDesignV4 ? " ds-v4" : ""}${isJournal ? " is-journal" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BrandGoose />
          </span>
          {/* Brand pass, direction A: S-28 head + drawn wordmark at a
              14.4px cap (size 20). The wordmark carries the name. */}
          <Wordmark cap={14.4} className="brand-name" />
        </div>
        {!isLiveCook && demoOpen && (
          <div className="demo-note" role="note" aria-label="Demo notice">
            <img className="demo-note-goose" src={gooseSm} alt="" width="20" height="36" />
            <div className="demo-note-text">
              <span className="demo-note-title">Just a demo — nothing is saved.</span>
              <span className="demo-note-body">Reload and your kitchen, cooks and schedule are gone · <a href="https://github.com/Ziqing110/goose-goose-cook" target="_blank" rel="noopener noreferrer">Voice kit on GitHub ↗</a></span>
            </div>
            <button type="button" className="demo-note-close" aria-label="Dismiss demo notice" onClick={() => setDemoOpen(false)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="m3 3 6 6M9 3 3 9" />
              </svg>
            </button>
          </div>
        )}
        {isJournal && (
          <nav className="topbar-nav" aria-label="Journal">
            <Link className="topbar-link" to="/">← Home</Link>
          </nav>
        )}
      </header>


      <main className="stage-root">
        <Outlet />
      </main>

      <VoiceBar />
      {/* One microphone, one conversation, one record of it. Beside
          VoiceBar for the same reason it is. */}
      <ConversationRail />
    </div>
  );
}
