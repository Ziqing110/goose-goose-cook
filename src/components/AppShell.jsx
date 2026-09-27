import { Link, Outlet, useLocation } from "react-router-dom";
import VoiceBar from "./VoiceBar.jsx";
import ConversationRail from "./ConversationRail.jsx";
import BrandGoose from "./BrandGoose.jsx";
import Wordmark from "./Wordmark.jsx";
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

      <main className="stage-root">
        <Outlet />
      </main>

      {!isJournal && <VoiceBar />}
      {/* One microphone, one conversation, one record of it. Beside
          VoiceBar for the same reason it is. */}
      {!isJournal && <ConversationRail />}
    </div>
  );
}
