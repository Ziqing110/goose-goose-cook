// Commentary for the summary card. Deterministic — no LLM. Each line is
// earned by something that actually happened in the run, so the card is
// about *their* cook rather than generic filler.
//
// Lines are picked by predicate and then chosen with a seeded index, so
// the same cook always gets the same line for the same performance and
// reopening the card never reshuffles it.

function seededIndex(seed, length) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return length ? h % length : 0;
}

const mins = (sec) => Math.max(1, Math.round(Math.abs(sec) / 60));

// Each entry: when it applies, and a few interchangeable phrasings.
const COOK_QUIPS = [
  {
    key: "nothing",
    when: (c) => c.doneCount === 0,
    lines: [
      (c) => `${c.name} supervised. Extensively.`,
      (c) => `${c.name} finished nothing, but held the space beautifully.`,
      (c) => `Zero steps for ${c.name}. Moral support is also a contribution.`,
    ],
  },
  {
    key: "overran",
    when: (c, r) => c.worstOverrunSec >= 60 && c.worstOverrunLabel && c.cookId === r.biggestOverrunCookId,
    lines: [
      (c) => `"${c.worstOverrunLabel}" took ${mins(c.worstOverrunSec)} min longer than anyone promised.`,
      (c) => `${c.name} and "${c.worstOverrunLabel}" had a long conversation — ${mins(c.worstOverrunSec)} min over.`,
      (c) => `The clock lost to "${c.worstOverrunLabel}" by ${mins(c.worstOverrunSec)} min.`,
    ],
  },
  {
    key: "fast",
    when: (c, r) => c.bestUnderSec <= -30 && c.cookId === r.fastestCookId,
    lines: [
      (c) => `Beat the estimate on "${c.bestUnderLabel}" by ${mins(c.bestUnderSec)} min. Show-off.`,
      (c) => `${c.name} finished "${c.bestUnderLabel}" ${mins(c.bestUnderSec)} min early and said nothing about it.`,
      (c) => `"${c.bestUnderLabel}" never stood a chance.`,
    ],
  },
  {
    key: "skipper",
    when: (c) => c.skippedCount > 0,
    lines: [
      (c) => `Skipped ${c.skippedCount} step${c.skippedCount > 1 ? "s" : ""}. We're calling it improvisation.`,
      (c) => `${c.skippedCount} step${c.skippedCount > 1 ? "s" : ""} quietly did not happen on ${c.name}'s watch.`,
      (c) => `${c.name} decided ${c.skippedCount === 1 ? "one step was" : "some steps were"} optional.`,
    ],
  },
  {
    key: "workhorse",
    when: (c, r) => c.doneCount >= 2 && c.cookId === r.mostStepsCookId && r.cookCount > 1,
    lines: [
      (c) => `Did ${c.doneCount} steps. Somebody had to.`,
      (c) => `${c.doneCount} steps for ${c.name} — the engine room.`,
      (c) => `${c.name} carried most of the board tonight.`,
    ],
  },
  {
    key: "lightwork",
    when: (c, r) => r.cookCount > 1 && c.cookId === r.fewestStepsCookId && c.doneCount > 0 && c.doneCount < r.mostSteps,
    lines: [
      (c) => `${c.doneCount} step${c.doneCount > 1 ? "s" : ""}, all of them dignified.`,
      (c) => `${c.name} picked quality over quantity. We assume.`,
      (c) => `A lean ${c.doneCount}-step evening for ${c.name}.`,
    ],
  },
  {
    key: "steady",
    when: (c) => c.doneCount > 0 && c.worstOverrunSec < 60 && c.skippedCount === 0,
    lines: [
      () => `Everything on time, nothing dropped. Suspiciously professional.`,
      (c) => `${c.name} hit every estimate. No notes.`,
      (c) => `Not a single step ran long for ${c.name}.`,
    ],
  },
];

const HEADLINES = [
  {
    key: "tie",
    when: (r) => r.winnerCookIds.length > 1,
    lines: [(r) => `Dead heat at ${r.topPoints} points. Nobody's doing the washing up.`],
  },
  {
    key: "runaway",
    when: (r) => r.winnerCookIds.length === 1 && r.margin >= 30,
    lines: [(r) => `${r.winnerName} ran away with it by ${r.margin} points.`],
  },
  {
    key: "close",
    when: (r) => r.winnerCookIds.length === 1 && r.margin > 0 && r.margin <= 20,
    lines: [(r) => `${r.winnerName} took it by ${r.margin}. Closer than the scoreline suggests.`],
  },
  {
    key: "overtime",
    when: (r) => r.estimatedSec && r.totalSec > r.estimatedSec * 1.2,
    lines: [(r) => `${mins(r.totalSec - r.estimatedSec)} min over plan, and dinner still happened.`],
  },
  {
    key: "underplan",
    when: (r) => r.estimatedSec && r.totalSec < r.estimatedSec,
    lines: [(r) => `Finished ${mins(r.estimatedSec - r.totalSec)} min inside the plan.`],
  },
  {
    key: "skips",
    when: (r) => r.skippedCount >= 2,
    lines: [(r) => `${r.skippedCount} steps skipped. The recipe is a suggestion.`],
  },
];

/** Per-cook stats a quip can be earned from, derived from runOutcome. */
export function cookQuipStats(entry, perStep) {
  const mine = perStep.filter((s) => s.cookId === entry.cookId && s.status === "done");
  const worst = mine.reduce((max, s) => (s.deltaSec > (max?.deltaSec ?? -Infinity) ? s : max), null);
  const best = mine.reduce((min, s) => (s.deltaSec < (min?.deltaSec ?? Infinity) ? s : min), null);
  return {
    cookId: entry.cookId,
    name: entry.name,
    doneCount: entry.doneCount,
    skippedCount: entry.skippedCount,
    worstOverrunSec: worst?.deltaSec ?? 0,
    worstOverrunLabel: worst?.label ?? null,
    bestUnderSec: best?.deltaSec ?? 0,
    bestUnderLabel: best?.label ?? null,
  };
}

export function pickQuips(stats, runContext, limit = 2) {
  const earned = COOK_QUIPS.filter((q) => q.when(stats, runContext));
  return earned.slice(0, limit).map((q) => {
    const line = q.lines[seededIndex(`${stats.cookId}:${q.key}`, q.lines.length)];
    return line(stats);
  });
}

export function headlineFor(runContext) {
  const earned = HEADLINES.filter((h) => h.when(runContext));
  if (earned.length === 0) return "Dinner happened. That's the main thing.";
  const pick = earned[seededIndex(runContext.seed || "run", earned.length)];
  return pick.lines[0](runContext);
}

/** Shared context both the per-cook and headline pickers read. */
export function buildRunContext(outcome, seed = "run") {
  const board = outcome.scoreboard;
  const counts = board.map((b) => b.doneCount);
  const topPoints = board[0]?.points ?? 0;
  const runnerUp = board[1]?.points ?? 0;
  const perStep = outcome.perStep;
  const byCook = (id) => perStep.filter((s) => s.cookId === id && s.status === "done");
  const overrun = board.map((b) => ({ id: b.cookId, sec: Math.max(0, ...byCook(b.cookId).map((s) => s.deltaSec), 0) }));
  const under = board.map((b) => ({ id: b.cookId, sec: Math.min(0, ...byCook(b.cookId).map((s) => s.deltaSec), 0) }));
  return {
    seed,
    cookCount: board.length,
    mostSteps: Math.max(0, ...counts),
    mostStepsCookId: board.find((b) => b.doneCount === Math.max(0, ...counts))?.cookId ?? null,
    fewestStepsCookId: board.find((b) => b.doneCount === Math.min(...counts))?.cookId ?? null,
    biggestOverrunCookId: overrun.sort((a, b) => b.sec - a.sec)[0]?.id ?? null,
    fastestCookId: under.sort((a, b) => a.sec - b.sec)[0]?.id ?? null,
    winnerCookIds: outcome.winnerCookIds,
    winnerName: board.find((b) => b.cookId === outcome.winnerCookIds[0])?.name ?? null,
    topPoints,
    margin: topPoints - runnerUp,
    totalSec: outcome.totalSec,
    estimatedSec: outcome.estimatedSec,
    skippedCount: outcome.skippedCount,
  };
}
