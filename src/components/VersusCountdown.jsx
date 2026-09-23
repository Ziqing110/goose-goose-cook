// The four seconds between "both ready" and the first claim (design:
// "Versus countdown v6 — the goose counts you in"). The layout is Live
// cook at second zero: the same header, the scoreboard strip at 0–0
// with a grey 0:00, and both station tickets dealt with their opening
// hand and stamped READY. The only thing that moves is the referee
// goose standing in the header — a held pose per beat, a small paper
// card flipping 3 → 2 → 1 → GO — and the goose's aside, which becomes
// its voice: "Three." "Two." "One." "Go."
//
// Rendered by the Schedule page in place of itself, for a new match
// only; the caller creates the run in onComplete, so the clock starts
// after the countdown, not under it. Built from Live cook's own classes
// so the handoff to the real page doesn't shift anything.
import { useEffect, useRef, useState } from "react";
import { GoosePrint } from "./GooseMarks.jsx";
import KpIcon from "./KpIcon.jsx";
import { CardGoose, PlayerAvatar, Stamp } from "../pages/LiveCookPage.jsx";
import referee3 from "../assets/goose-referee-v1/referee-3-cut.png";
import referee2 from "../assets/goose-referee-v1/referee-2-cut.png";
import referee1 from "../assets/goose-referee-v1/referee-1-cut.png";
import refereeGo from "../assets/goose-referee-v1/referee-go-cut.png";
import "../pages/LiveCookPage.css";
import "./VersusCountdown.css";

// Each beat holds this long; GO holds a touch less before the play
// surface takes over.
const BEAT_MS = 1100;
const GO_MS = 700;
const START_FROM = 3;

// Index = beats left; 0 is GO.
const FRAMES = [refereeGo, referee1, referee2, referee3];
const CARD = ["GO", "1", "2", "3"];
const SAYS = ["Go.", "One.", "Two.", "Three."];

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function VersusCountdown({ cooks, title, nodes = [], opening, dishOf, onComplete, onCancel }) {
  const callbacks = useRef({ onComplete, onCancel });
  callbacks.current = { onComplete, onCancel };
  const backRef = useRef(null);
  const [n, setN] = useState(START_FROM);
  const go = n <= 0;

  useEffect(() => {
    // Focus lands on Back out without scrolling the referee out of view
    // on a phone, where Back out sits below the fold.
    backRef.current?.focus({ preventScroll: true });
    // Sequential beats stay legible even when a background tab is
    // throttled: a hidden tab just waits rather than skipping numbers.
    let remaining = START_FROM;
    let timeout;
    const advance = () => {
      if (document.hidden) {
        timeout = setTimeout(advance, 200);
        return;
      }
      remaining -= 1;
      if (remaining < 0) {
        callbacks.current.onComplete();
        return;
      }
      setN(remaining);
      timeout = setTimeout(advance, remaining === 0 ? GO_MS : BEAT_MS);
    };
    timeout = setTimeout(advance, BEAT_MS);
    const onKey = (e) => e.key === "Escape" && callbacks.current.onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  // What each ticket opens with: the first step of their dealt bundle,
  // and how much of the graph waits on it.
  const opener = (cook) => {
    const bundle = opening?.bundles?.find((b) => b.cookId === cook.id);
    const step = bundle?.stepIds?.[0] ? byId[bundle.stepIds[0]] : null;
    if (!step) return null;
    const blocks = nodes.filter((node) => (node.depends_on || []).includes(step.id)).length;
    return { step, blocks };
  };

  return (
    <section className={`page live-cook-page is-versus vs-countdown ${go ? "is-go" : ""}`} role="dialog" aria-label="Match countdown">
      <header className="lc-header vs-header">
        <div className="lc-title">
          <span className="ds-run-eyebrow">Tonight&rsquo;s run</span>
          <span className="ds-title-mark">
            <h1>Live cook</h1>
            <svg className="ds-underline ds-underline-title" viewBox="0 0 430 10" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path d="M2 7c68-4 144 1 220-2 58-2.5 134 3 206 .5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <p className="lc-subtitle">
            {title || "Untitled cook"}
            <span className="lc-mode-chip">
              <KpIcon glyph="trophy" size={14} />
              Versus
            </span>
            <span className="vs-meta">
              <span className="mono">{nodes.length}</span> steps · most points wins
              <span className="vs-ready-dot" aria-hidden="true" />
              both ready
            </span>
          </p>
          {/* The goose's aside, now its voice — and the live region. */}
          <span className="ds-aside vs-says">
            <GoosePrint />
            <span role="status" aria-live="assertive" aria-atomic="true">
              {SAYS[n]}
            </span>
          </span>
        </div>

        {/* The referee: four held poses, stacked so every frame is
            decoded before its beat, and a paper card with the number. */}
        <div className="vs-ref" aria-hidden="true">
          <span className="vs-ref-card">
            <span key={n} className="vs-ref-num">
              {CARD[n]}
            </span>
          </span>
          <span className="vs-ref-goose">
            {FRAMES.map((src, i) => (
              <img key={src} src={src} alt="" draggable="false" className={i === n ? "is-on" : ""} />
            ))}
          </span>
        </div>
      </header>

      <div className="lc-strip is-versus" role="group" aria-label="Scoreboard">
        {cooks.slice(0, 2).map((cook, i) => (
          <div key={cook.id} className={`lc-strip-side is-${i === 0 ? "a" : "b"}`}>
            <PlayerAvatar cook={cook} index={i} size={28} />
            <span className="lc-strip-name">{cook.name}</span>
            <span className={`lc-score-pill is-${i === 0 ? "a" : "b"}`}>0</span>
          </div>
        ))}
        <div className="lc-strip-center">
          <span className="lc-clock-value vs-clock">0:00</span>
          <div className="lc-tug" aria-hidden="true">
            <span className="lc-tug-a" style={{ flexGrow: 1 }} />
            <GoosePrint depth="deep" size={14} rotate={90} className="lc-tug-print" />
            <span className="lc-tug-b" style={{ flexGrow: 1 }} />
          </div>
          <span className="lc-lead">
            <span className="lc-lead-line">Level — 0 each</span>
          </span>
        </div>
      </div>

      <div className="lc-arena">
        <div className="lc-main">
          <div className="lc-cards">
            {cooks.slice(0, 2).map((cook, i) => {
              const key = i === 0 ? "a" : "b";
              const opens = opener(cook);
              const dish = opens ? dishOf?.(opens.step.id) : null;
              const ticketNo = opens ? `#${String(nodes.indexOf(opens.step) + 1).padStart(2, "0")} / ${nodes.length}` : "0 done";
              return (
                <article key={cook.id} className={`lc-card is-${key} vs-card`} aria-label={`${cook.name} — ready`}>
                  <header className="lc-card-head">
                    <PlayerAvatar cook={cook} index={i} size={44} />
                    <span className="lc-card-id">
                      <span className="lc-card-name">{cook.name}</span>
                      <span className="mono lc-card-ticket">{ticketNo}</span>
                    </span>
                    <span className="lc-card-score">
                      <span className="lc-card-points">0</span>
                      <span className="lc-card-pts">pts</span>
                    </span>
                  </header>

                  <div className="lc-card-body">
                    <div className="lc-order-brow">
                      <span className="lc-order-dish">Opens with</span>
                      {dish && <span className="vs-opens-dish">{dish}</span>}
                    </div>
                    <h2 className="lc-step-title">{opens ? opens.step.label : "Whatever’s up for grabs"}</h2>
                    <p className="lc-step-desc">
                      {opens
                        ? opens.step.description
                        : "Nothing is dealt to you. The board opens at zero — take the first step you can reach."}
                    </p>
                    <span className="lc-order-spacer" />
                    {opens && (
                      <span className="vs-opens-meta">
                        est <span className="mono">{clock(opens.step.estimated_duration_sec)}</span>
                        {opens.blocks > 0 && (
                          <>
                            {" "}
                            · blocks <span className="mono">{opens.blocks}</span> {opens.blocks === 1 ? "step" : "steps"}
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="lc-card-actions">
                    <CardGoose pose={go ? "g4-free-hands" : i === 0 ? "g2-up-next" : "g6-eyeing-the-offer"} size={100} motion="none" />
                    <div className="lc-primary-slot vs-ready-slot">
                      <Stamp tone={key}>Ready</Stamp>
                    </div>
                    <div className="lc-card-secondary" />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="vs-foot">
            <span className="vs-caption">
              {go ? "Board is live — take your first step" : "Both halves locked · claims open at zero"}
            </span>
            <span className="vs-back-row">
              <span className="vs-back-note">Claims unlock the moment the clock starts.</span>
              <button type="button" className="btn btn-ghost" ref={backRef} onClick={() => callbacks.current.onCancel()}>
                Back out
              </button>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
