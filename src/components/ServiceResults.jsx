// The results pieces of Service done (design: "Live cook v7"), shared
// with the cook card so the evening reads the same on both: the player's
// avatar and the goose's stamp, the two result tickets either side of
// the final score (Versus), the night against the plan (Co-op), and the
// receipt of every step. Each takes a run outcome — Service done passes
// the live one, the cook card the saved summary read back through
// summaryOutcome() — plus the players from resultPlayers().
import { useLayoutEffect, useRef } from "react";
import { chefAvatar } from "../utils/cooks.js";
import { clock, longestStep, planDelta, playerKey } from "../utils/serviceResults.js";
import { GoosePrint } from "./GooseMarks.jsx";
import "./ServiceResults.css";

function Mono({ children, className = "" }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

// The chef bird the player picked on the Cooks page, ringed in their
// player color; the initial is the fallback for a cook who predates
// avatars. Same identity system either way — the color is the key.
export function PlayerAvatar({ cook, index, size = 32 }) {
  const chef = cook?.avatar ? chefAvatar(cook.avatar) : null;
  return (
    <span
      className={`lc-avatar is-${playerKey(index)} lc-avatar-${size} ${chef ? "has-chef" : ""}`}
      style={chef ? { backgroundColor: chef.bg, backgroundImage: `url(${chef.src})` } : undefined}
      aria-hidden="true"
    >
      {!chef && (cook?.name?.[0]?.toUpperCase() || "?")}
    </span>
  );
}

// The goose's rubber stamp — the same outlined, tilted pill as Schedule's
// APPROVED badge, in the ink of whoever it is about.
export function Stamp({ children, tone = "ink", className = "" }) {
  return <span className={`lc-stamp is-${tone} ${className}`}>{children}</span>;
}

// Versus: ticket · final score · ticket. The winner is marked by a
// banner and a tinted head, never by being bigger.
export function VersusResults({ players, winnerCookIds }) {
  const tie = winnerCookIds.length > 1;
  const anyWinner = winnerCookIds.length > 0;
  const [pa, pb] = players;
  const margin = pa && pb ? Math.abs(pa.entry.points - pb.entry.points) : 0;
  return (
    <div className={`lc-results ${tie ? "is-tie" : ""}`}>
      {tie && <span className="lc-banner is-tie">Dead heat</span>}
      {pa && <ResultTicket p={pa} tie={tie} margin={margin} anyWinner={anyWinner} />}
      <div className="lc-final">
        <span className="lc-final-score">
          <span className="is-a">{pa?.entry.points ?? 0}</span>
          <span className="lc-final-colon">:</span>
          <span className="is-b">{pb?.entry.points ?? 0}</span>
        </span>
        <span className="lc-meta">{tie ? "Level on points" : "Final score"}</span>
      </div>
      {pb && <ResultTicket p={pb} tie={tie} margin={margin} anyWinner={anyWinner} />}
    </div>
  );
}

// One player's result ticket: the same paper as the station tickets.
function ResultTicket({ p, tie, margin, anyWinner }) {
  const { cook, i, key, entry, longest, topDish, won } = p;
  const winner = won && !tie;
  return (
    <div className={`lc-score-tile lc-result is-${key} ${winner ? "is-winner" : ""}`}>
      {winner && <span className="lc-banner">Winner</span>}
      <div className="lc-result-head">
        <PlayerAvatar cook={cook} index={i} size={44} />
        <span className="lc-result-id">
          <span className="lc-result-name">{cook.name}</span>
          {winner ? (
            <span className="lc-meta">
              by <Mono>{margin}</Mono> {margin === 1 ? "point" : "points"}
            </span>
          ) : tie ? (
            <span className="lc-meta">Level on points</span>
          ) : anyWinner ? (
            <Stamp tone={key}>Good game</Stamp>
          ) : null}
        </span>
      </div>
      <div className="lc-result-stats">
        <span className="lc-result-stat">
          <span className="lc-result-num">{entry.doneCount}</span>
          <span className="lc-meta">done</span>
        </span>
        <span className="lc-result-stat">
          <span className="lc-result-num is-points">{entry.points}</span>
          <span className="lc-meta">points</span>
        </span>
        <span className="lc-result-stat">
          <span className="lc-result-num">{entry.skippedCount}</span>
          <span className="lc-meta">skipped</span>
        </span>
      </div>
      {longest && (
        <div className="lc-result-fact">
          <span className="lc-meta">Longest step</span>
          <span className="lc-result-fact-row">
            <span className="lc-result-fact-value">{longest.label}</span>
            <Mono>{clock(longest.actualSec)}</Mono>
          </span>
        </div>
      )}
      {topDish && (
        <div className="lc-result-fact">
          <span className="lc-meta">Most points from</span>
          <span className="lc-result-fact-value">{topDish}</span>
        </div>
      )}
    </div>
  );
}

// Co-op: how the night went against the plan, and one shared bar of
// who did what.
export function CoopResult({ outcome, players }) {
  // A run called off with more skipped than cooked is nothing to cheer.
  const cooked = outcome.doneCount > 0 && outcome.doneCount >= outcome.skippedCount;
  const { show: showDelta, deltaSec } = planDelta(outcome);
  const longestAll = longestStep(outcome.perStep);
  return (
    <div className="lc-coop-result">
      <h2 className="lc-coop-title">{cooked ? "Dinner’s up" : "Called it early"}</h2>
      {showDelta && (
        <div className="lc-coop-delta">
          <span className={`lc-coop-delta-num ${deltaSec <= 0 ? "is-under" : "is-over"}`}>
            {clock(Math.abs(deltaSec))} {deltaSec <= 0 ? "under plan" : "over plan"}
          </span>
          <span className="lc-coop-times">
            <span>
              <Mono>{clock(outcome.totalSec)}</Mono> actual
            </span>
            <span>
              <Mono>{clock(outcome.estimatedSec)}</Mono> planned
            </span>
          </span>
        </div>
      )}
      {/* Teamwork as one object: a single bar split by who did what. */}
      <div className="lc-share">
        <div className="lc-share-legend">
          {players.map((p) => (
            <span key={p.cook.id} className={`lc-share-who is-${p.key}`}>
              <PlayerAvatar cook={p.cook} index={p.i} size={20} />
              <span className="lc-share-name">{p.cook.name}</span>
              <Mono className="lc-share-n">{p.entry.doneCount}</Mono>
              <span className="lc-meta">{p.entry.doneCount === 1 ? "step" : "steps"}</span>
            </span>
          ))}
        </div>
        <div className="lc-share-bar" aria-hidden="true">
          {players.map((p) => (
            <span key={p.cook.id} className={`is-${p.key}`} style={{ flexGrow: p.entry.doneCount }} />
          ))}
        </div>
        <span className="lc-meta">
          <Mono>{outcome.doneCount}</Mono> done · <Mono>{outcome.skippedCount}</Mono> skipped
          {longestAll && (
            <>
              {" "}· longest was {longestAll.label}, <Mono>{clock(longestAll.actualSec)}</Mono>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// A scrolling list that shows only whole rows: the window fills the
// space the receipt has, and the list inside is cut to as many full rows
// as fit, so a row is never sliced in half at the bottom edge. The
// leftover sliver becomes air above the totals. Nothing to do when every
// row fits.
function useWholeRows(windowRef, listRef, count) {
  useLayoutEffect(() => {
    const win = windowRef.current;
    const list = listRef.current;
    if (!win || !list || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      list.style.height = "";
      const row = list.querySelector("li");
      const ws = getComputedStyle(win);
      const avail = win.clientHeight - parseFloat(ws.paddingTop) - parseFloat(ws.paddingBottom);
      if (!row || list.scrollHeight <= avail) return;
      const rowH = row.getBoundingClientRect().height;
      list.style.height = `${Math.max(1, Math.floor(avail / rowH)) * rowH}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(win);
    return () => observer.disconnect();
  }, [windowRef, listRef, count]);
}

// The receipt: every step in the order the night went, the finisher's
// avatar, the time and (Versus) the points; the totals and Toque's sign-
// off at the foot. `planMarks` adds a hairline under each finished row —
// plan in paper-dash, actual in the player's colour, overrun in warning.
export function StepReceipt({ outcome, cooks, players, isVersus, title, planMarks = false }) {
  const { show: showDelta, deltaSec } = planDelta(outcome);
  const windowRef = useRef(null);
  const listRef = useRef(null);
  useWholeRows(windowRef, listRef, outcome.perStep.length);
  const scale = Math.max(1, ...outcome.perStep.map((s) => Math.max(s.actualSec || 0, s.estSec || 0)));
  const pct = (sec) => `${((sec / scale) * 100).toFixed(1)}%`;
  return (
    <div className={`lc-receipt ${planMarks ? "has-plan-marks" : ""}`}>
      <header className="lc-receipt-head">
        <span className="lc-receipt-heading">
          <h2 className="lc-receipt-title">Every step</h2>
          <span className="lc-meta">{title}</span>
        </span>
        <span className="lc-meta">
          <Mono>{outcome.perStep.length}</Mono> steps
        </span>
      </header>
      {planMarks && (
        <div className="lc-plan-legend lc-meta" aria-hidden="true">
          <span><i className="is-plan" />plan</span>
          <span><i className="is-a" /><i className="is-b" />actual</span>
          <span><i className="is-over" />over plan</span>
        </div>
      )}
      <div ref={windowRef} className="lc-step-window">
      <ul ref={listRef} className="lc-step-list">
        {outcome.perStep.map((s) => {
          const i = cooks.findIndex((c) => c.id === s.cookId);
          const done = s.status === "done";
          const est = s.estSec || 0;
          const act = s.actualSec || 0;
          return (
            <li key={s.id} className={`lc-step-row ${done ? "" : "is-skipped"} ${i >= 0 ? `is-${playerKey(i)}` : ""}`}>
              {i >= 0 ? <PlayerAvatar cook={cooks[i]} index={i} size={20} /> : <span className="lc-receipt-dot" aria-hidden="true" />}
              <span className="lc-step-row-label">{s.label}</span>
              <span className="lc-leader" aria-hidden="true" />
              <Mono className="lc-step-row-time">{done ? clock(act) : "skipped"}</Mono>
              {isVersus && <Mono className="lc-step-row-pts">{done && s.points > 0 ? `+${s.points}` : ""}</Mono>}
              {planMarks && done && i >= 0 && est > 0 && (
                <span className="lc-plan-mark" aria-hidden="true">
                  <span className="is-plan" style={{ width: pct(est) }} />
                  <span className="is-actual" style={{ width: pct(Math.min(act, est)) }} />
                  {act > est && <span className="is-over" style={{ left: pct(est), width: pct(act - est) }} />}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      </div>
      <footer className="lc-receipt-foot">
        {isVersus ? (
          players.map((p) => (
            <span key={p.cook.id} className={`lc-receipt-total is-${p.key}`}>
              <PlayerAvatar cook={p.cook} index={p.i} size={20} />
              <span className="lc-receipt-total-label">{p.cook.name}</span>
              <Mono className="lc-receipt-total-value">{p.entry.points}</Mono>
            </span>
          ))
        ) : (
          <>
            {outcome.estimatedSec != null && (
              <span className="lc-receipt-total">
                <span className="lc-receipt-total-label">Planned</span>
                <Mono className="lc-receipt-total-value">{clock(outcome.estimatedSec)}</Mono>
              </span>
            )}
            <span className="lc-receipt-total">
              <span className="lc-receipt-total-label">Cooked in</span>
              <Mono className={`lc-receipt-total-value ${showDelta && deltaSec <= 0 ? "is-under" : ""}`}>{clock(outcome.totalSec)}</Mono>
            </span>
          </>
        )}
        <span className="lc-receipt-sign">
          <GoosePrint depth="mid" size={12} rotate={-20} />
          Kitchen closed. — Toque
          <GoosePrint depth="mid" size={12} rotate={20} />
        </span>
      </footer>
    </div>
  );
}
