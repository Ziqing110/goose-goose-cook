// What to do with something said while one of the live cook's confirm
// dialogs is open.
//
// Those dialogs used to take taps only, so a cook who said "Goose, skip
// the stock" -- a step others depend on -- or "we're done" before the
// board was finished was left with a dialog on screen that nothing they
// said could close. The live cook is meant to run hands-free, so both
// now answer to voice.
//
// How much has to be said follows how much is lost:
//
//   skip   -- one step, and "undo" brings it back. A plain yes or no.
//   finish -- ends the run for everyone, and there is no undo from the
//             summary. "Yes" is not enough: a stray "yeah" across the
//             kitchen must not end the cook. The phrase has to be said,
//             the same way abandoning a session asks for its passphrase.
//
// Anything else is not an answer: the dialog closes and what was said is
// handled on its own merits, as utils/confirmReply.js does for "Did you
// mean X?".
//
// Pure: no DOM, no React.
import { matchConfirmation, normalizeUtterance } from "./navCommands.js";

/** Said aloud to end a run early. The dialog's own title, so it reads back. */
export const FINISH_PHRASE = "call it early";

const KEEP = /\b(?:keep (?:it|cooking|going)|don'?t|do not|cancel|never ?mind|not yet)\b/;
const SKIP_IT = /\bskip (?:it|anyway|that)\b/;
const FINISH = /\bcall it(?: early)?\b|\bend (?:it|the cook|now)\b/;

/**
 * @param {string} text what was just said
 * @param {"skip"|"finish"} kind which dialog is open
 * @param {string} [agentName] stripped first, so "Goose, yes" is a yes
 * @returns {{type: "confirm"|"cancel"|"reprompt"|"moved-on"}}
 */
export function routeModalReply(text, kind, agentName = "") {
  let said = normalizeUtterance(text);
  const name = normalizeUtterance(agentName);
  if (name) said = said.replace(new RegExp(`^(?:hey |ok |okay )?${name}\\b\\s*`), "").trim();
  if (!said) return { type: "moved-on" };

  // Checked before anything that confirms: "don't call it early" and
  // "no, keep cooking" both contain words that would.
  if (KEEP.test(said) || matchConfirmation(said) === "no") return { type: "cancel" };

  if (kind === "skip") {
    if (SKIP_IT.test(said) || matchConfirmation(said) === "yes") return { type: "confirm" };
    return { type: "moved-on" };
  }

  if (FINISH.test(said)) return { type: "confirm" };
  // Agreeing without the phrase is an answer, just not a sufficient one.
  // Asked again rather than dropped, or the cook hears nothing back and
  // assumes the kitchen is over.
  if (matchConfirmation(said) === "yes") return { type: "reprompt" };
  return { type: "moved-on" };
}
