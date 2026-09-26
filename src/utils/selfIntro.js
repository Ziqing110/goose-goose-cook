// "I'm Toni, and I'll start the bay leaf."
//
// Two things in one breath: who is talking, and what they want. The app
// took the second and ignored the first, so the step went to whoever the
// speaker toggle happened to be on -- which on the deployed build is
// always, since the voiceprint sidecar does not run there.
//
// Saying your own name is the one correction a cook can make without
// reaching for the screen, so it is worth taking seriously: it sets who
// is speaking AND leaves the rest of the sentence intact, to be acted on
// as that person.
//
// Handled before the addressing gate, like resuming a pause. Telling the
// app who you are is addressed to the app by definition, and requiring
// "Goose" first would mean the one fix for a misattributed turn needs
// the thing that is already going wrong to work first.
//
// Pure: no DOM, no React.
import { resolveCookRef } from "./cookVoice.js";

// How an introduction opens. Anchored at the start, because "ask Toni"
// and "that's Toni's step" are about somebody, not from them.
const LEAD = /^(?:it'?s|this is|i'?m|i am|my name is)\s+/i;

// ...or closes: "Toni here, start the garlic".
const TRAIL = /^(.+?)\s+(?:here|speaking)\b/i;

// A name is one or two words; "the second cook" is three. Tried shortest
// first, because the alternative eats the instruction: a greedy capture
// of "I'm Toni start the garlic" takes the whole sentence, still finds
// Toni inside it, and leaves nothing left to act on.
const MAX_NAME_WORDS = 3;

// What joins the introduction to the instruction, dropped so the rest
// reads as a command on its own. A trailing "cook" or "chef" goes with
// it, so "I'm the second cook, start the garlic" does not leave the word
// "cook" sitting in front of the command.
const JOINER = /^(?:cook|chef)?(?:\s*[,.;]+\s*)?(?:and\s+|then\s+|so\s+)?/i;

const tidy = (rest) => rest.replace(JOINER, "").trim();

/**
 * @param {string} text  what was said
 * @param {Array}  cooks [{ id, name }]
 * @returns {{cookId: string, rest: string}|null}
 *   null when nobody introduced themselves, or the name is not one of
 *   these cooks -- a stranger's name is not a reason to reassign work.
 */
export function findSelfIntro(text, cooks) {
  const said = String(text || "").trim();
  if (!said || !(cooks || []).length) return null;

  const lead = LEAD.exec(said);
  if (lead) {
    const words = said.slice(lead[0].length).split(/\s+/).filter(Boolean);
    for (let n = 1; n <= Math.min(MAX_NAME_WORDS, words.length); n += 1) {
      const candidate = words.slice(0, n).join(" ").replace(/[,.;!?]+$/, "");
      // resolveCookRef handles ordinals ("the second cook"), matches names
      // whole-word, and refuses an ambiguous hit rather than guessing.
      const cook = resolveCookRef(candidate, cooks);
      if (cook) return { cookId: cook.id, rest: tidy(words.slice(n).join(" ")) };
    }
    return null;
  }

  const trail = TRAIL.exec(said);
  if (trail) {
    const cook = resolveCookRef(trail[1], cooks);
    if (cook) return { cookId: cook.id, rest: tidy(said.slice(trail[0].length)) };
  }
  return null;
}
