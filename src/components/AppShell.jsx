import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import VoiceBar from "./VoiceBar.jsx";
import ConversationRail from "./ConversationRail.jsx";
import BrandGoose from "./BrandGoose.jsx";
import Wordmark from "./Wordmark.jsx";
import { useDesignV4 } from "../utils/designV4.js";
import { useAppState } from "../state/AppStateContext.jsx";
import { usePlayerLaneVars } from "../hooks/usePlayerLaneVars.js";
import "./AppShell.css";
import "../styles/design-v4.css";

export default function AppShell() {
  // The design-system class has to sit on the shell (not the page):
  // that's the only ancestor shared by the page, SessionProgress (in
  // SessionLayout) and VoiceBar (rendered below) — which a class on the
  // page's own <section> could never reach via descendant selectors.
  const isDesignV4 = useDesignV4();
  const { pathname } = useLocation();
  const { state } = useAppState();
  // A cook journal is a frozen page, not a session step: it keeps the
  // same chrome as Home so it reads as part of the app — goose included —
  // plus a way back.
  const isJournal = pathname.startsWith("/cook/");
  // Live-cook has its own demo notice (voice recognition, non-dismissable);
  // showing this generic one there too would be a redundant second banner.
  const isLiveCook = pathname.startsWith("/session/live-cook");
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
        {isJournal && (
          <nav className="topbar-nav" aria-label="Journal">
            <Link className="topbar-link" to="/">← Home</Link>
          </nav>
        )}
      </header>

      {!isLiveCook && demoOpen && (
        <div className="demo-banner" role="note">
          <span className="demo-banner-tag">Honk! This is a demo</span>
          <span className="demo-banner-body">
            Nothing you enter is saved anywhere — closing or reloading this tab loses your kitchen, cooks, and schedule.
          </span>
          <a className="demo-banner-link" href="https://github.com/Ziqing110/goose-goose-cook" target="_blank" rel="noopener noreferrer">
            Full voice kit on GitHub
          </a>
          <button type="button" className="demo-banner-close" aria-label="Dismiss demo notice" onClick={() => setDemoOpen(false)}>
            &times;
          </button>
        </div>
      )}

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
