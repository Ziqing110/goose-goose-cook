// Answering "what does that step actually mean?" out of the recipe
// itself.
//
// Step labels are short because a board full of long ones is unreadable:
// "Mix sauce & slurry" fits on a card and tells an experienced cook
// everything. It tells a beginner nothing, and the detail that would
// help is already written down in the node's description, sitting on the
// step card the cook is not looking at because their hands are wet.
//
// So the agent can be asked, and answers from the recipe's own words
// rather than inventing them. The model decides WHICH step is being
// asked about -- that is language, and it is good at it -- and this
// builds what gets said, so the answer cannot drift from the plan.
//
// How much comes back depends on the `skill` answer from the
// conversation, which asked "how much should I explain each step?" and,
// until now, nothing downstream read.
//
// Pure: no DOM, no React.

const MINUTE = 60;

/** "about 3 minutes", "about 90 seconds" — spoken, so no digits-heavy clock. */
export function spokenDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // Under a minute, spoken to the nearest ten seconds; a recipe that
  // says 47 does not mean 47.
  if (seconds < MINUTE) return `about ${Math.round(seconds / 10) * 10} seconds`;
  const minutes = Math.round(seconds / MINUTE);
  // "About a minute" is what a person says. "About 1 minute" is what a
  // form says, and this is read aloud.
  if (minutes === 1) return "about a minute";
  return `about ${minutes} minutes`;
}

/** "the wok", "the cutting board and a pot" — for a spoken sentence. */
function spokenList(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * What to say when someone asks about a step.
 *
 * @param {object} node   the graph node
 * @param {object} [opts]
 *   skill          "beginner" | "regular" | "confident" (from the Brief)
 *   equipmentLabel (type) => human label
 * @returns {string|null} null when there is no such step
 */
export function explainStep(node, { skill = "regular", equipmentLabel = (t) => t } = {}) {
  if (!node) return null;

  const label = String(node.label || "").trim();
  const description = String(node.description || "").trim();
  const parts = [];

  // The recipe's own sentence, first and unedited. This is the answer;
  // everything after it is context.
  if (description) {
    parts.push(description.replace(/\s*$/, "").replace(/([^.!?])$/, "$1."));
  } else if (label) {
    // No description written for this step. Saying the label back is not
    // an answer, so say plainly that there is nothing more, rather than
    // padding it into something that sounds like one.
    parts.push(`There's no more detail on ${label} than the name.`);
  } else {
    return null;
  }

  // "Just the essentials" means the description and nothing else.
  if (skill === "confident") return parts.join(" ");

  const duration = spokenDuration(node.estimated_duration_sec);
  if (duration) parts.push(`It should take ${duration}.`);

  // Only a beginner gets told what to reach for; anyone else can see the
  // board, and every extra clause is another second of the goose talking
  // while a pan is on.
  if (skill === "beginner") {
    const gear = spokenList((node.required_equipment || []).map(equipmentLabel));
    if (gear) parts.push(`You'll want ${gear}.`);
  }

  return parts.join(" ");
}
