// Pieces the live cook's cards, board and page share.
import { EQUIPMENT_GLYPHS, equipmentName } from "../../data/dishes.js";
import { stepVariance, unattendedPhaseNow } from "../../utils/liveCook.js";
import { unattendedEvents } from "../../utils/scheduleLayout.js";
import { tendingLabel } from "../../utils/tending.js";
import { clock } from "../../utils/time.js";
import KpIcon from "../../components/KpIcon.jsx";
import Mono from "../../components/Mono.jsx";

// A finish that has sat open this long reads as a count-up, not a
// countdown (§3, "Late").
const LATE_AFTER_SEC = 60;

// The goose posture sheet, one per card state (design §05), from the
// approved baby-goose set (assets/baby-goose-final/animated). The
// drawn goose is never recoloured; the player's colour stays on the
// avatar, rail and chip.
export const GOOSE = {
  active: "g1-on-it",
  assigned: "g2-up-next",
  waiting: "g3-waiting",
  idle_fill: "g4-free-hands",
  finished: "g5-done-for-the-night",
  grabs: "g6-eyeing-the-offer",
  due: "g7-due-honk",
  victory: "g9-victory",
  defeat: "g14-defeat-good-game",
  onTheMove: "g10-walking",
  handoff: "g11-handoff",
  behind: "g12-behind-plan",
};

/**
 * Everything the card and the "cooking on its own" row need to know
 * about one running unattended step, derived per tick from the step's
 * real start — the same numbers unattendedPhaseNow reads, plus the
 * moments laid out from 0 so a time axis can be drawn.
 */
export function momentState(node, record, now) {
  const moments = unattendedEvents(node, 0);
  const checkCount = moments.filter((m) => m.kind === "checkpoint").length;
  const { phase, index } = unattendedPhaseNow(node, record, now);
  const elapsedSec = stepVariance(node, record, now).actualSec;
  const estSec = node.estimated_duration_sec || 0;
  const current =
    phase === "initial"
      ? moments.find((m) => m.kind === "initial")
      : phase === "checkpoint"
        ? moments.find((m) => m.kind === "checkpoint" && m.index === index)
        : phase === "ending"
          ? moments.find((m) => m.kind === "ending")
          : null;
  const from = current ? current.endSec : elapsedSec;
  const next = phase === "ending" ? null : moments.find((m) => m !== current && m.atSec >= from) || null;
  // The finish window stays open until Done; past LATE_AFTER_SEC it is
  // a count-up in warning text, never red.
  const lateSec = current?.kind === "ending" ? elapsedSec - current.atSec : 0;
  return {
    moments,
    checkCount,
    phase,
    current,
    next,
    elapsedSec,
    estSec,
    inMoment: Boolean(current),
    countdownSec: current ? Math.max(0, current.endSec - elapsedSec) : null,
    nextInSec: next ? next.atSec - elapsedSec : null,
    late: lateSec > LATE_AFTER_SEC,
    lateSec,
    // Leave it: nothing to come back for, just a moment it becomes usable.
    readyInSec: Math.max(0, estSec - elapsedSec),
    handsOnSec: moments.reduce((sum, m) => sum + (m.endSec - m.atSec), 0),
  };
}

export function EquipmentChip({ type }) {
  const glyph = EQUIPMENT_GLYPHS[type];
  return (
    <span className="lc-chip">
      {glyph && <KpIcon glyph={glyph} size={14} />}
      {equipmentName(type)}
    </span>
  );
}

export function TendingChip({ node, className = "" }) {
  const label = tendingLabel(node);
  if (!label) return null;
  return <span className={`lc-tending-chip ${className}`}>{label}</span>;
}

// What a step is worth, as a dashed tag pinned to the ticket's corner.
export function PointsTag({ pts, player }) {
  return <span className={`lc-pts-tag ${player ? `is-${player}` : ""}`}>+{pts}</span>;
}

// The Schedule's rail-and-moments drawing, scaled to a row and made
// live: a 6px rail 0 → est with the elapsed part filled in the player's
// color, a block per moment standing on it (past ones drop to the
// tint), and a 2px now marker.
export function MomentAxis({ state, player, compact = false }) {
  const { moments, elapsedSec, estSec } = state;
  const pct = (sec) => (estSec > 0 ? Math.min(100, Math.max(0, (sec / estSec) * 100)) : 0);
  return (
    <div className={`lc-axis is-${player} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {!compact && <Mono className="lc-axis-end">0:00</Mono>}
      <div className="lc-axis-track">
        <span className="lc-axis-rail" />
        <span className="lc-axis-fill" style={{ width: `${pct(elapsedSec)}%` }} />
        {moments.map((m) => (
          <span
            key={`${m.kind}-${m.index}`}
            className={`lc-axis-moment ${m.endSec <= elapsedSec ? "is-past" : ""}`}
            style={{ left: `${pct(m.atSec)}%`, width: `max(10px, ${pct(m.endSec - m.atSec)}%)` }}
          />
        ))}
        <span className="lc-axis-now" style={{ left: `${pct(elapsedSec)}%` }} />
      </div>
      {!compact && <Mono className="lc-axis-end">{clock(estSec)}</Mono>}
    </div>
  );
}
