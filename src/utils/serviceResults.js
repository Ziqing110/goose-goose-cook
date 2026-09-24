// The derivations behind the results pieces (components/ServiceResults)
// — shared by Service done, which reads a live run's outcome, and the
// cook card, which reads the frozen summary back into the same shape.

// Player colors come from the index in cooks[] — player 1 is "a",
// player 2 is "b" — never stored, never chosen (design-v4.css tokens).
const PLAYER_KEYS = ["a", "b"];
export const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

/** "12:48" — every clock on the play surface. */
export const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const longestOf = (steps) => steps.reduce((best, s) => (!best || s.actualSec > best.actualSec ? s : best), null);

/** The longest finished step of the night, or null. */
export function longestStep(perStep) {
  return longestOf(perStep.filter((s) => s.status === "done"));
}

/**
 * One entry per player (at most two), in player order: their scoreboard
 * line, their longest step, the dish most of their points came from,
 * and whether they won. `dishOfStep` names a step's dish; `quips`, by
 * cook id, rides along for the cook card.
 */
export function resultPlayers({ outcome, cooks, dishOfStep = () => null, quips = {} }) {
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
