// The derivations behind the results pieces (components/ServiceResults)
// — shared by Service done, which reads a live run's outcome, and the
// cook card, which reads the frozen summary back into the same shape.
import { spokenDuration } from "./kitchenReport.js";

// Player slots come from the index in cooks[] — player 1 is "a", player
// 2 is "b" — never stored. The slot is just which lane a player renders
// in; the colour that --cook-a/--cook-b resolve to now follows the bird
// each player picked (see utils/playerColors.js), not a fixed pair.
const PLAYER_KEYS = ["a", "b"];
export const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

const longestOf = (steps) => steps.reduce((best, s) => (!best || s.actualSec > best.actualSec ? s : best), null);

/** The longest finished step of the night, or null. */
export function longestStep(perStep) {
  return longestOf(perStep.filter((s) => s.status === "done"));
}

/**
 * One entry per player (at most two), in player order: their scoreboard
 * line, their longest step, the dish most of their points came from,
 * and whether they won. `dishOfStep` names a step's dish; `quips` and
 * `quotes`, by cook id, ride along for the cook card.
 */
export function resultPlayers({ outcome, cooks, dishOfStep = () => null, quips = {}, quotes = {} }) {
  const winners = outcome.winnerCookIds || [];
  return cooks.slice(0, 2).map((cook, i) => {
    const entry = outcome.scoreboard.find((b) => b.cookId === cook.id) || { points: 0, doneCount: 0, skippedCount: 0 };
    const mine = outcome.perStep.filter((s) => s.cookId === cook.id && s.status === "done");
    const byDish = {};
    mine.forEach((s) => {
      const dish = dishOfStep(s);
      if (dish) byDish[dish] = (byDish[dish] || 0) + (s.points || 0);
    });
    const topDish = Object.entries(byDish).sort((a, b) => b[1] - a[1])[0];
    return {
      cook,
      i,
      key: playerKey(i),
      entry,
      longest: longestOf(mine),
      topDish: topDish && topDish[1] > 0 ? topDish[0] : null,
      won: winners.includes(cook.id),
      quips: quips[cook.id] || [],
      quote: quotes[cook.id] || null,
    };
  });
}

/**
 * A saved summary read back as a run outcome, so the cook card can hand
 * it to the same pieces Service done uses. Summaries saved before
 * `perStep` was stored rebuild it from each cook's own steps — the
 * night's order and the steps nobody took are lost for those.
 */
export function summaryOutcome(summary) {
  const perStep =
    summary.perStep ||
    (summary.cooks || []).flatMap((c) =>
      (c.steps || []).map((s, i) => ({ id: `${c.cookId}-${i}`, cookId: c.cookId, ...s })),
    );
  return {
    totalSec: summary.totalSec,
    estimatedSec: summary.estimatedSec ?? null,
    winnerCookIds: summary.winnerCookIds || [],
    scoreboard: (summary.cooks || []).map((c) => ({
      cookId: c.cookId,
      name: c.name,
      points: c.points,
      doneCount: c.doneCount,
      skippedCount: c.skippedCount,
    })),
    doneCount: summary.doneCount ?? perStep.filter((s) => s.status === "done").length,
    skippedCount: summary.skippedCount ?? perStep.filter((s) => s.status === "skipped").length,
    perStep,
  };
}

/** Co-op's line against the plan — only a run that got through everything has a fair one. */
export function planDelta(outcome) {
  const show = outcome.estimatedSec != null && outcome.skippedCount === 0 && outcome.doneCount > 0;
  return { show, deltaSec: show ? outcome.totalSec - outcome.estimatedSec : 0 };
}

/** Level with the plan to the second: "0:00 under plan" is a sentence nobody says. */
export const isOnPlan = (deltaSec) => Math.round(deltaSec) === 0;

/**
 * How the night went, as something the goose can say: who won and the
 * score in Versus, or how co-op did against the plan. No clock digits,
 * because it is read aloud.
 */
export function resultLine(outcome, { versus }) {
  const took = `Dinner took ${spokenDuration(outcome.totalSec)}.`;
  if (versus) {
    const winners = outcome.scoreboard.filter((b) => outcome.winnerCookIds.includes(b.cookId));
    const verdict = winners.length === 1 ? `${winners[0].name} wins.` : winners.length ? "It's a tie." : "Nobody scored.";
    const score = outcome.scoreboard.map((b) => `${b.name} ${b.points}`).join(", ");
    return `${verdict} ${score}. ${took}`;
  }
  const { show, deltaSec } = planDelta(outcome);
  const plan = !show
    ? ""
    : isOnPlan(deltaSec)
      ? " Right on plan."
      : ` That's ${spokenDuration(Math.abs(deltaSec))} ${deltaSec < 0 ? "under" : "over"} plan.`;
  const skipped = outcome.skippedCount ? `, ${outcome.skippedCount} skipped` : "";
  return `${took}${plan} ${outcome.doneCount} steps done${skipped}.`;
}
