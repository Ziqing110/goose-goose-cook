// What the coverage HUD says about the run.
//
// Three registers, from the same two numbers. The stamp is the verdict
// at a glance, the summary is the sentence, and the goose says what it
// would do about it — the plan talking back rather than a status line.

const list = (labels) => {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

/**
 * @param {{ total: number, blockedCount: number, atRiskCount: number, outLabels: string[] }} run
 * @returns {{ tone, summary, stampLabel, stampTone, gooseLine, showSeal }}
 */
export function coverageNarration({ total = 0, blockedCount = 0, atRiskCount = 0, outLabels = [] } = {}) {
  const nothingMissing = outLabels.length === 0;

  let tone = "done";
  let summary = "Full inventory, every step is craftable";
  let stampLabel = "LOOKING GOOD";
  let stampTone = "done";

  if (blockedCount > 0) {
    tone = "critical";
    summary = `Run blocked, ${blockedCount} of ${total} steps can't be done`;
    stampLabel = "WE HAVE A PROBLEM";
    stampTone = "critical";
  } else if (atRiskCount > 0) {
    tone = "warning";
    summary = `${atRiskCount} of ${total} steps at risk`;
    stampLabel = "PANTRY CHECK";
    stampTone = "warning";
  } else if (!nothingMissing) {
    // Nothing is in trouble, but something is missing: worth a check
    // rather than a clean bill.
    stampLabel = "PANTRY CHECK";
    stampTone = "neutral";
  }

  let gooseLine = "Full basket. I counted it twice, then walked over it once more.";
  if (blockedCount > 0) {
    gooseLine = `${list(outLabels)} gone means ${blockedCount} ${blockedCount === 1 ? "step falls" : "steps fall"} over. I'd send someone to the shop.`;
  } else if (!nothingMissing) {
    gooseLine = `No ${list(outLabels)}. Nothing breaks — I've noted where it would have gone.`;
  }

  return {
    tone,
    summary,
    stampLabel,
    stampTone,
    gooseLine,
    // The seal is for a clean run only: stamping one with a hole in it
    // would be the page congratulating itself.
    showSeal: nothingMissing && blockedCount === 0 && atRiskCount === 0,
  };
}
