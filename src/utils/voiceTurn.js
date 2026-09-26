// One finished voice turn -> what the app should do about it.
//
// This is the decision VoiceBar used to make inline, pulled out so it can
// be tested without a microphone, a router or React. VoiceBar gathers the
// state (route, open question, dictation, dialogs), asks this, and then
// carries out the answer. Nothing here has side effects: page commands
// are matched by the function passed in, and running them is the
// caller's job.
//
// The order is the contract, and most of the edge cases are about it:
//
//   1. the agent's own voice, echoed back by the mic   -> ignored
//   2. a page that owns every turn (the live cook)     -> handed over
//   3. an open question                                -> answered
//   4. a page taking dictation (Conversation)          -> its whileDictating
//                                                         commands, strict
//                                                         nav, else typed
//   5. the page's own commands                         -> run, or asked first
//   6. an open dialog                                  -> nothing else heard
//   7. navigation
//   8. none of it matched                              -> the goose is asked
//                                                         what was meant
//
// Step 8 only runs when the caller says it can (`ctx.interpret`). What
// comes back is a rewrite into one of the page's own commands, and it
// re-enters here through routeInterpretedTurn -- never straight into
// an action, and never without asking first.
import { matchConfirmation, matchesConfirmationPhrase, matchNavCommand, navHelpLine, normalizeUtterance, pathLabel, isLikelyConversation, hasSubject } from "./navCommands.js";
import { ROUTES } from "./routeGuards.js";

export const LINES = {
  already: "You're already here.",
  notYet: "Not yet — finish this step first.",
  noSession: "Start a run first.",
  kitchenPicked: "This run already has its kitchen.",
  cancelled: "Cancelled.",
  mismatch: "That didn't match, so nothing changed.",
  firstPage: "That’s as far back as I can go.",
};

/**
 * The lowest word confidence in a turn, 0-1. One mumbled word is enough
 * to make the whole command a guess. A turn with no words (typed, or a
 * test) counts as certain.
 */
export function turnConfidence(words) {
  return (words || []).reduce((lowest, w) => Math.min(lowest, w.confidence ?? 1), 1);
}

/**
 * @param {string} text  the final transcript
 * @param {object} ctx
 * @param {string}   ctx.route        current pathname
 * @param {string[]} ctx.reachable    see voiceReachablePaths
 * @param {boolean}  ctx.hasSession
 * @param {number}   [ctx.confidence] see turnConfidence
 * @param {boolean}  [ctx.echo]       the agent was speaking when this began
 * @param {object}   [ctx.dictation]  getVoiceDictation(route)
 * @param {object}   [ctx.pending]    the open question, { phrase? }
 * @param {Function} [ctx.matchPage]  (said, text) => page command | null
 * @param {boolean}  [ctx.exclusive]  a dialog holds the microphone
 * @param {boolean}  [ctx.canGoBack]  going back stays inside the app
 * @param {boolean}  [ctx.interpret]  the goose may be asked what an
 *   unmatched turn meant; without it, those turns are ignored as before
 * @returns {object} a decision; `type` says which. Any decision may also
 *   carry `clearPending: true`, meaning the open question is closed
 *   whatever else happens.
 */
export function routeVoiceTurn(text, ctx) {
  const said = (text || "").trim();
  if (!said) return { type: "ignore", reason: "empty" };
  // The mic hears the agent's own voice. Judged by when the words were
  // spoken, since the transcript lands after the agent is done.
  if (ctx.echo) return { type: "ignore", reason: "echo" };

  // The app's own chrome answers on every page, including the ones that
  // take every word as dictation or own every turn: "open the notes" in
  // the middle of a cook is not a cooking command, and the page would
  // otherwise never let it through. Whole-utterance phrases only.
  if (ctx.dictation) {
    const chrome = ctx.matchPage?.(normalizeUtterance(said), said, { everywhere: true });
    if (chrome) return pageDecision(chrome);
  }

  // A page with its own conversation gets every turn untouched, and
  // navigation stays out of it: leaving mid-cook by voice is exactly
  // what must not happen. Without a registered takeover the page is an
  // ordinary one — the live cook before "Go live" is an empty page whose
  // only button is "Back to the plan", and it used to hear nothing at all.
  if (ctx.dictation?.takeover) return { type: "takeover" };

  // A question is open: this turn is its answer.
  if (ctx.pending) {
    // A passphrase is not a yes/no question. Anything else leaves things
    // alone — including "yes", which is the point: saying yes is exactly
    // what a passphrase stops being sufficient for. Not re-read as a
    // command either; someone mid-way through reading a sentence back
    // should not have half of it acted on.
    if (ctx.pending.phrase) {
      return matchesConfirmationPhrase(said, ctx.pending.phrase)
        ? { type: "perform", clearPending: true }
        : { type: "say", line: LINES.mismatch, clearPending: true };
    }
    const answer = matchConfirmation(said);
    if (answer === "yes") return { type: "perform", clearPending: true };
    if (answer === "no") return { type: "say", line: LINES.cancelled, clearPending: true };
    // Not an answer: they moved on, and the question goes. What they
    // said instead still counts — "go home" while "Did you mean go
    // back?" is up should take you home, not vanish with the question.
    return { ...routeCommand(said, ctx), clearPending: true };
  }

  return routeCommand(said, ctx);
}

function routeCommand(said, ctx) {
  const { route, reachable, confidence } = ctx;

  // A page taking dictation wants the words, not a command read of them
  // — "go back to basics" is an answer, and typing it is right. But "go
  // back to home" is not an answer to anything, and typing it strands you
  // on a page you asked to leave. So navigation gets a strict look first:
  // a named destination, said briefly and heard clearly.
  const normalized = normalizeUtterance(said);

  if (ctx.dictation) {
    // A few whole sentences are never an answer — "start over", "go
    // back" — and the page marks those to be heard anyway. Everything
    // else it registered stands down, so "check the inventory" said
    // mid-question is still typed. They come before navigation, as page
    // commands do everywhere, so the page can ask before "go home"
    // takes someone out of the middle of its questions.
    const command = ctx.matchPage?.(normalized, said, { dictating: true });
    if (command && !isLikelyConversation(normalized, confidence, { allowSubject: command.allowSubject })) {
      return pageDecision(command);
    }
    const nav = matchNavCommand(said, { route, confidence, reachable, strict: true });
    if (nav.action === "goto" || nav.action === "already" || nav.action === "blocked") {
      return navDecision(nav, ctx);
    }
    return { type: "dictate" };
  }

  // The page gets first refusal. Home can "resume the run", Inventory can
  // mark an ingredient out; neither is navigation, but both are in the
  // hint, so they are heard before anything generic looks at the words.
  const command = ctx.matchPage?.(normalized, said);
  if (command) {
    // The same guards as navigation. Without them "resume" was
    // protected but "we should resume later" fired.
    //
    // The two halves of that guard deserve different answers, though,
    // and treating them alike is why "go live" could be said four
    // times into total silence. A sentence with a subject in it is
    // somebody talking; dropping it is right. A command heard poorly
    // is somebody talking TO us, badly heard -- and the honest answer
    // to that is to ask, which is exactly what navigation already does
    // with a plausible-but-not-solid match.
    // With the goose to ask, a sentence with a subject goes to it rather
    // than straight in the bin: "I'm out of ginger" matched the ginger
    // command and was dropped as chat. The goose can tell a request from
    // two people talking, and nothing it suggests runs without a yes.
    if (hasSubject(normalized) && !command.allowSubject) {
      return ctx.interpret ? { type: "interpret" } : { type: "ignore", reason: "conversation" };
    }
    if (isLikelyConversation(normalized, confidence, { allowSubject: true })) {
      return {
        type: "confirm",
        question: `Did you mean “${command.heardAs ?? said}”? Say yes or no.`,
        then: { type: "page", command },
      };
    }
    return pageDecision(command);
  }

  // A dialog is open and the words were not one of its commands.
  // Navigating away would abandon a half-filled form, so the way out is
  // the dialog's own "cancel".
  if (ctx.exclusive) return ctx.interpret ? { type: "interpret" } : { type: "ignore", reason: "dialog-open" };

  return navDecision(matchNavCommand(said, { route, confidence, reachable }), ctx);
}

function pageDecision(command) {
  const then = { type: "page", command };
  // Irreversible commands ask first; the most destructive ones make you
  // read a sentence back.
  if (command.confirmPhrase) {
    return {
      type: "confirm",
      question: `To confirm, say: “${command.confirmPhrase}”`,
      phrase: normalizeUtterance(command.confirmPhrase),
      then,
    };
  }
  if (command.confirm) return { type: "confirm", question: command.confirm, then };
  return then;
}

function navDecision(nav, ctx) {
  switch (nav.action) {
    case "goto":
    case "back": {
      const move = nav.action === "goto" ? { type: "navigate", path: nav.path } : { type: "back" };
      // react-router's first entry is the page this visit opened. Going
      // back from it leaves the app, and the voice agent with it — a dead
      // end you can talk your way into and not out of.
      if (move.type === "back" && !ctx.canGoBack) return { type: "say", line: LINES.firstPage };
      // Plausible but not solid: ask rather than guess, and rather than
      // drop it — silence on a real command reads as being ignored.
      if (nav.confirm) {
        const what = move.type === "navigate" ? `go to ${pathLabel(nav.path)}` : "go back";
        return { type: "confirm", question: `Did you mean ${what}? Say yes or no.`, then: move };
      }
      return move;
    }
    case "already":
      return { type: "say", line: LINES.already };
    case "blocked":
      return { type: "say", line: blockedLine(nav.path, ctx) };
    case "help":
      return { type: "say", line: navHelpLine(ctx.route, ctx.reachable) };
    default:
      return ctx.interpret ? { type: "interpret" } : { type: "ignore", reason: "not-a-command" };
  }
}

// "Not yet — finish this step first" is only true when there is a step
// to finish. Before a run there is none, and kitchen setup is not a step
// at all: it is only there to replace a kitchen that was deleted.
function blockedLine(path, ctx) {
  if (!ctx.hasSession) return LINES.noSession;
  if (path === ROUTES.kitchenSetup) return LINES.kitchenPicked;
  return LINES.notYet;
}

/**
 * The goose's rewrite of an unmatched turn, routed like a turn of its
 * own -- but it is a guess about what somebody meant, so nothing it
 * leads to happens without a yes. A command that already asks (or asks
 * for a phrase) keeps its own question rather than stacking a second.
 *
 * Runs with interpretation off: a rewrite that matches nothing is
 * dropped, not sent back to be rewritten again.
 */
export function routeInterpretedTurn(utterance, ctx) {
  const said = (utterance || "").trim();
  if (!said) return { type: "ignore", reason: "interpreted-empty" };
  const decision = routeCommand(said, { ...ctx, confidence: 1, dictation: null, interpret: false });
  switch (decision.type) {
    case "page":
      return { type: "confirm", question: `Did you mean “${said}”? Say yes or no.`, then: decision };
    case "navigate":
      return { type: "confirm", question: `Did you mean go to ${pathLabel(decision.path)}? Say yes or no.`, then: decision };
    case "back":
      return { type: "confirm", question: "Did you mean go back? Say yes or no.", then: decision };
    case "ignore":
      return { type: "ignore", reason: "interpreted-no-match" };
    default:
      return decision;
  }
}
