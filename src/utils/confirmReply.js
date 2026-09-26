// What to do with something said while a "Did you mean X?" is open.
//
// Three outcomes, not two, and the third is the one that was missing.
//
// A confirmation is a question the app asked, so the obvious reading of
// the next utterance is "this is the answer". That holds for yes and no.
// It does not hold for anything else: someone who says "what does mix
// sauce even mean?" while a confirmation is up has not answered it, they
// have moved on -- and forcing an answer's reading onto that is how a
// perfectly good question got met with "I didn't catch that."
//
// So a non-answer closes the question and is then handled on its own
// merits, as if the question had never been asked. This is exactly what
// utils/voiceTurn.js already does for every other page:
//
//   "Not an answer: they moved on, and the question goes. What they said
//    instead still counts."
//
// The live cook had its own confirmation state that predated that rule
// and did not follow it, sending the leftover utterance to the keyword
// grammar -- which has no concept of a question -- instead of the model.
//
// Pure: no DOM, no React.
import { matchConfirmation } from "./navCommands.js";

/**
 * @param {string} text what was just said
 * @returns {{type: "resolve", answer: "yes"|"no"} | {type: "moved-on"}}
 */
export function routeConfirmReply(text) {
  const answer = matchConfirmation(text);
  if (answer === "yes" || answer === "no") return { type: "resolve", answer };
  return { type: "moved-on" };
}
