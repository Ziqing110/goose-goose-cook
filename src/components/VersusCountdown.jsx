// The four seconds between "both ready" and the first claim ("Kitchen
// Path Versus Countdown"). The split field is already drawn, both
// halves are lit, and nothing is claimable yet — the only job of this
// screen is to sync two people to the same second and let them read
// each other's half one last time.
//
// Mounted by the Schedule page for a new match only; the caller creates
// the run in onComplete, so the clock starts after the countdown, not
// under it. Portaled into the app shell — not document.body — so the
// shell's design tokens reach it, and out of the page section, whose
// entry animation would otherwise pin a fixed overlay inside it.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BabyGoose from "./BabyGoose.jsx";
import "./VersusCountdown.css";

// Each beat holds this long; GO holds a touch less before the play
// surface takes over.
const BEAT_MS = 1100;
const GO_MS = 700;
const START_FROM = 3;

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function VersusCountdown({ cooks, title, nodes = [], opening, onComplete, onCancel }) {
  const callbacks = useRef({ onComplete, onCancel });
  callbacks.current = { onComplete, onCancel };
  const backRef = useRef(null);
  const [n, setN] = useState(START_FROM);
  const go = n <= 0;

  useEffect(() => {
    backRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  // What each half opens with: the first step of their dealt bundle,
  // and how much of the graph waits on it.
  const opener = (cook) => {
    const bundle = opening?.bundles?.find((b) => b.cookId === cook.id);
    const step = bundle?.stepIds?.[0] ? byId[bundle.stepIds[0]] : null;
    if (!step) return null;
    const blocks = nodes.filter((node) => (node.depends_on || []).includes(step.id)).length;
    return { step, blocks };
  };

  const pct = go ? 0 : Math.round((n / START_FROM) * 100);
  const beatClass = go ? "is-go" : `is-${n}`;

  const host = document.querySelector(".app-shell") || document.body;
  return createPortal(
    <div className={`vs-countdown ${beatClass}`} role="dialog" aria-modal="true" aria-labelledby="vs-countdown-title">
      {/* The field: both halves lit, meeting at the seam. It pulses until
          "1", then holds solid — the halves are final. */}
      <div className="vs-field" aria-hidden="true">
        <span className="vs-half is-a" />
        <span className="vs-half is-b" />
        <span className="vs-seam" />
      </div>

      <header className="vs-topbar">
        <span className="mono vs-topbar-mode">Versus</span>
        <span className="vs-topbar-title" id="vs-countdown-title">
          {title || "Untitled cook"}
        </span>
        <span className="vs-topbar-spacer" />
        <span className="mono vs-topbar-meta">
          {plural(nodes.length, "step")} · most points wins
        </span>
        <span className="mono vs-topbar-pill">both ready</span>
      </header>

      <div className="vs-arena">
        {cooks.slice(0, 2).map((cook, i) => {
          const key = i === 0 ? "a" : "b";
          const opens = opener(cook);
          return (
            <article key={cook.id} className={`vs-card is-${key}`}>
              <div className="vs-card-head">
                <span className={`vs-avatar is-${key}`} aria-hidden="true">
                  {cook.name?.[0]?.toUpperCase() || "?"}
                </span>
                <span className="vs-card-id">
                  <span className="vs-card-name">{cook.name}</span>
                  <span className="vs-card-sub">
                    {i === 0 ? "left half" : "right half"} · station {i + 1}
                  </span>
                </span>
              </div>
              <span className="vs-rule" />
              <div className="vs-opens">
                <span className="vs-eyebrow">Opens with</span>
                {opens ? (
                  <>
                    <span className="vs-opens-step">{opens.step.label}</span>
                    <span className="mono vs-opens-meta">
                      est {clock(opens.step.estimated_duration_sec)}
                      {opens.blocks > 0 && ` · blocks ${plural(opens.blocks, "step")}`}
                    </span>
                  </>
                ) : (
                  <span className="vs-opens-step">Whatever&rsquo;s up for grabs</span>
                )}
              </div>
              <span className={`mono vs-ready is-${key}`}>ready</span>
            </article>
          );
        })}

        {/* The geese lean in over the seam: left G2 up and ready, right
            G6 eyeing the offer; at GO both hands free. The left one is
            mirrored so they face each other. */}
        <span className="vs-goose is-a" aria-hidden="true">
          <BabyGoose pose={go ? "g4-free-hands" : "g2-up-next"} size={180} decorative className="vs-goose-art is-flipped" />
        </span>
        <span className="vs-goose is-b" aria-hidden="true">
          <BabyGoose pose={go ? "g4-free-hands" : "g6-eyeing-the-offer"} size={190} decorative className="vs-goose-art" />
        </span>

        <div className="vs-center">
          <div className="vs-ring" style={{ "--pct": `${pct}%` }} role="status" aria-live="assertive" aria-atomic="true">
            <span className="vs-ring-paint" aria-hidden="true" />
            <span className="vs-ring-face" aria-hidden="true" />
            <span key={n} className={`mono vs-count ${go ? "is-go" : ""}`}>
              {go ? "GO" : n}
            </span>
          </div>
          <span className="vs-caption">{go ? "Board is live — take your first step" : "Both halves locked · claims open at zero"}</span>
        </div>
      </div>

      <footer className="vs-footer">
        <span className="vs-footer-note">Claims unlock the moment the ring empties. Nothing can be taken before then.</span>
        <button type="button" className="vs-back" ref={backRef} onClick={() => callbacks.current.onCancel()}>
          Back out
        </button>
      </footer>
    </div>,
    host,
  );
}
