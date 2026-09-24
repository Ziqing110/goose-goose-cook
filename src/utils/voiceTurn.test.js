// What one finished voice turn does, end to end short of the router:
// the real matcher, the real page-command registry and the real page
// grammar, with only the side effects left out. Each test is an edge case
// between two of the layers — the places VoiceBar's old inline handler
// did not join up.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LINES, routeVoiceTurn, turnConfidence } from "./voiceTurn.js";
import { ROUTES } from "./routeGuards.js";
import {
  clearVoiceCommands,
  matchPageCommand,
  registerVoiceCommands,
  voiceCommandsAreExclusive,
} from "./voicePageCommands.js";
import { AVATAR_PICKER_VOICE, CONVERSATION_VOICE, HOME_VOICE, SCHEDULE_VOICE } from "./pageVoiceGrammar.js";

const ALL = Object.values(ROUTES);
const UP_TO_INVENTORY = [ROUTES.home, ROUTES.conversation, ROUTES.inventory];

beforeEach(() => clearVoiceCommands());

// The context VoiceBar builds, with a finished session's defaults.
const turn = (text, over = {}) =>
  routeVoiceTurn(text, {
    route: ROUTES.inventory,
    reachable: ALL,
    hasSession: true,
    confidence: 1,
    matchPage: matchPageCommand,
    exclusive: voiceCommandsAreExclusive(),
    canGoBack: true,
    ...over,
  });

const noop = () => {};

// --- before anything is matched ------------------------------------------

test("turn: empty and whitespace-only transcripts are ignored", () => {
  assert.deepEqual(turn(""), { type: "ignore", reason: "empty" });
  assert.deepEqual(turn("   "), { type: "ignore", reason: "empty" });
  assert.deepEqual(turn(undefined), { type: "ignore", reason: "empty" });
});

test("turn: the agent's own voice is never acted on, even a perfect command", () => {
  assert.deepEqual(turn("go home", { echo: true }), { type: "ignore", reason: "echo" });
});

test("turn: the agent's own voice does not answer an open question", () => {
  const r = turn("yes", { echo: true, pending: {} });
  assert.equal(r.type, "ignore");
  assert.equal(r.clearPending, undefined);
});

test("turn: confidence is the weakest word; no words counts as certain", () => {
  assert.equal(turnConfidence([{ confidence: 0.9 }, { confidence: 0.3 }, {}]), 0.3);
  assert.equal(turnConfidence([]), 1);
  assert.equal(turnConfidence(undefined), 1);
});

// --- live cook -----------------------------------------------------------

test("turn: during a cook the page takes every turn, navigation included", () => {
  const dictation = { route: ROUTES.liveCook, takeover: true, onFinal: noop };
  for (const said of ["go home", "go back", "help", "yes"]) {
    assert.equal(turn(said, { route: ROUTES.liveCook, dictation }).type, "takeover", said);
  }
});

test("turn: live cook without a run is an ordinary page — its way out is heard", () => {
  // Used to be switched off by route, so the one button on the empty
  // page ("Back to the plan") could not be said.
  assert.deepEqual(turn("go back to the plan", { route: ROUTES.liveCook }), {
    type: "navigate",
    path: ROUTES.schedule,
  });
  assert.deepEqual(turn("go back", { route: ROUTES.liveCook }), { type: "back" });
});

// --- open questions ------------------------------------------------------

test("turn: yes performs the question, no cancels it", () => {
  assert.deepEqual(turn("yeah", { pending: {} }), { type: "perform", clearPending: true });
  assert.deepEqual(turn("no", { pending: {} }), { type: "say", line: LINES.cancelled, clearPending: true });
});

test("turn: a non-answer closes the question and is heard as what it is", () => {
  // Previously the question was dropped and so was the command.
  assert.deepEqual(turn("go home", { pending: {} }), { type: "navigate", path: ROUTES.home, clearPending: true });
});

test("turn: chatter over an open question closes it without doing anything", () => {
  assert.deepEqual(turn("the onions look good", { pending: {} }), {
    type: "ignore",
    reason: "not-a-command",
    clearPending: true,
  });
});

test("turn: a passphrase needs the exact sentence; yes is not enough", () => {
  const pending = { phrase: "i want to abort this cooking session" };
  assert.deepEqual(turn("I want to abort this cooking session.", { pending }), { type: "perform", clearPending: true });
  assert.deepEqual(turn("yes", { pending }), { type: "say", line: LINES.mismatch, clearPending: true });
  assert.deepEqual(turn("I want to abort this session", { pending }), {
    type: "say",
    line: LINES.mismatch,
    clearPending: true,
  });
});

test("turn: a misread passphrase is not also run as a command", () => {
  const r = turn("go home", { pending: { phrase: "i want to abandon this cook" } });
  assert.equal(r.type, "say");
  assert.equal(r.line, LINES.mismatch);
});

test("turn: an open question is answered before an open dialog's commands", () => {
  registerVoiceCommands([{ phrases: [/\byes\b/], run: noop }], { priority: 10, exclusive: true });
  assert.equal(turn("yes", { pending: {} }).type, "perform");
});

// --- dictation (Conversation) ---------------------------------------------

const dictating = { route: ROUTES.conversation, onFinal: noop };
const onConversation = (said, over = {}) =>
  turn(said, { route: ROUTES.conversation, dictation: dictating, reachable: UP_TO_INVENTORY, ...over });

test("dictation: answers are typed, even ones with movement words in them", () => {
  for (const said of ["go back to basics", "back", "previous", "help", "the plan was spicy noodles"]) {
    assert.deepEqual(onConversation(said), { type: "dictate" }, said);
  }
});

test("dictation: a short named destination still navigates", () => {
  assert.deepEqual(onConversation("go home"), { type: "navigate", path: ROUTES.home });
  assert.deepEqual(onConversation("take me to the start"), { type: "navigate", path: ROUTES.home });
});

test("dictation: naming a page you can't reach or are on says so instead of typing it", () => {
  assert.deepEqual(onConversation("go to the schedule"), { type: "say", line: LINES.notYet });
  assert.deepEqual(onConversation("go to the conversation"), { type: "say", line: LINES.already });
});

test("dictation: a long answer that names a page is an answer", () => {
  assert.deepEqual(onConversation("go back to the recipe my mum used to make"), { type: "dictate" });
});

test("dictation: a mumbled destination is typed, not navigated or asked about", () => {
  assert.deepEqual(onConversation("go home", { confidence: 0.5 }), { type: "dictate" });
});

test("dictation: someone talking about going somewhere is typed", () => {
  assert.deepEqual(onConversation("we should go home"), { type: "dictate" });
});

test("dictation: page commands stand down while the page is dictating", () => {
  registerVoiceCommands([{ phrases: CONVERSATION_VOICE.continueInventory, run: noop }]);
  assert.deepEqual(onConversation("check the inventory"), { type: "dictate" });
});

// The conversation page registers these for both of its states.
const conversationCommands = () =>
  registerVoiceCommands([
    {
      phrases: CONVERSATION_VOICE.startOver,
      whileDictating: true,
      allowSubject: true,
      confirm: "Start over?",
      run: noop,
    },
    { phrases: CONVERSATION_VOICE.goHome, whileDictating: true, confirm: "Go back home?", run: noop },
    {
      phrases: CONVERSATION_VOICE.previousQuestion,
      whileDictating: true,
      allowSubject: true,
      confirm: "Go back to the last question?",
      run: noop,
    },
  ]);

test("dictation: 'start over' is heard mid-question, and asks first", () => {
  conversationCommands();
  for (const said of ["start over", "let's start over", "can we start over"]) {
    const r = onConversation(said);
    assert.equal(r.type, "confirm", said);
    assert.equal(r.question, "Start over?");
  }
  const yes = onConversation("yes", { pending: { perform: noop } });
  assert.equal(yes.type, "perform");
});

test("dictation: 'go back' and 'go home' ask before leaving, instead of typing or navigating", () => {
  conversationCommands();
  // "go home" is also a named destination; the page's own command, which
  // asks first, is heard before navigation gets a look at it.
  for (const said of ["go back", "go back home", "go home", "take me home"]) {
    const r = onConversation(said);
    assert.equal(r.type, "confirm", said);
    assert.equal(r.question, "Go back home?", said);
  }
});

test("dictation: 'go back to the last question' asks, and is not mistaken for home", () => {
  conversationCommands();
  for (const said of ["go back to the last question", "can we go back to the last question", "previous question"]) {
    const r = onConversation(said);
    assert.equal(r.type, "confirm", said);
    assert.equal(r.question, "Go back to the last question?", said);
  }
});

test("dictation: 'uh, yes' answers the question the page asked", () => {
  assert.deepEqual(onConversation("Uh, yes.", { pending: {} }), { type: "perform", clearPending: true });
});

test("dictation: answers that contain the words are still typed", () => {
  conversationCommands();
  for (const said of ["go back to basics", "start over with pasta instead", "back", "previous"]) {
    assert.deepEqual(onConversation(said), { type: "dictate" }, said);
  }
});

test("dictation: a mumbled 'start over' is typed rather than acted on", () => {
  conversationCommands();
  assert.deepEqual(onConversation("start over", { confidence: 0.3 }), { type: "dictate" });
});

test("dictation: a finished conversation hears its own command before navigation", () => {
  registerVoiceCommands([{ phrases: CONVERSATION_VOICE.continueInventory, run: noop }]);
  const r = turn("go to the inventory", { route: ROUTES.conversation });
  assert.equal(r.type, "page");
});

// --- page commands --------------------------------------------------------

test("page: a page command outranks navigation on the same words", () => {
  // Home's picker claims "go back" to close itself.
  registerVoiceCommands([{ phrases: HOME_VOICE.cancelPicker, run: noop, label: "Closed." }]);
  const r = turn("go back", { route: ROUTES.home });
  assert.equal(r.type, "page");
  assert.equal(r.command.label, "Closed.");
});

test("page: a subject makes it conversation, unless the command opts in", () => {
  registerVoiceCommands([{ phrases: HOME_VOICE.resume, run: noop }]);
  assert.deepEqual(turn("we should resume later", { route: ROUTES.home }), { type: "ignore", reason: "conversation" });
  clearVoiceCommands();
  registerVoiceCommands([{ phrases: [/\bi'm (\w+)$/], run: noop, allowSubject: true }]);
  assert.equal(turn("I'm Mia", { route: ROUTES.voiceBinding }).type, "page");
});

test("page: a garbled page command is not run", () => {
  registerVoiceCommands([{ phrases: HOME_VOICE.resume, run: noop }]);
  assert.deepEqual(turn("resume", { route: ROUTES.home, confidence: 0.2 }), { type: "ignore", reason: "conversation" });
});

test("page: irreversible commands ask first, destructive ones want the sentence", () => {
  registerVoiceCommands([
    { phrases: SCHEDULE_VOICE.live, run: noop, confirm: "Go live now? Say yes or no." },
    { phrases: SCHEDULE_VOICE.abandon, run: noop, confirmPhrase: SCHEDULE_VOICE.abandonConfirmation },
  ]);
  const live = turn("go live", { route: ROUTES.schedule });
  assert.equal(live.type, "confirm");
  assert.equal(live.question, "Go live now? Say yes or no.");
  assert.equal(live.phrase, undefined);
  assert.equal(live.then.type, "page");

  const abandon = turn("abandon the cook", { route: ROUTES.schedule });
  assert.equal(abandon.type, "confirm");
  assert.equal(abandon.phrase, "i want to abandon this cook");
  assert.match(abandon.question, /I want to abandon this cook/);
});

test("page: the question it asks is answered by its own passphrase", () => {
  registerVoiceCommands([{ phrases: HOME_VOICE.abandon, run: noop, confirmPhrase: HOME_VOICE.abandonConfirmation }]);
  const asked = turn("abandon the run", { route: ROUTES.home });
  const answered = turn(HOME_VOICE.abandonConfirmation, { route: ROUTES.home, pending: { phrase: asked.phrase } });
  assert.equal(answered.type, "perform");
});

// --- dialogs --------------------------------------------------------------

test("dialog: an open dialog blocks navigation but hears its own commands", () => {
  registerVoiceCommands([{ phrases: [/\bshow ingredients\b/], run: noop }]);
  registerVoiceCommands([{ phrases: AVATAR_PICKER_VOICE.cancel, run: noop, label: "Closed." }], {
    priority: 10,
    exclusive: true,
  });
  assert.deepEqual(turn("go home"), { type: "ignore", reason: "dialog-open" });
  assert.deepEqual(turn("help"), { type: "ignore", reason: "dialog-open" });
  // The page underneath is shadowed too.
  assert.deepEqual(turn("show ingredients"), { type: "ignore", reason: "dialog-open" });
  assert.equal(turn("never mind").type, "page");
});

test("dialog: closing it gives navigation back", () => {
  const close = registerVoiceCommands([{ phrases: [/\bcancel\b/], run: noop }], { priority: 10, exclusive: true });
  assert.equal(turn("go home").type, "ignore");
  close();
  assert.deepEqual(turn("go home"), { type: "navigate", path: ROUTES.home });
});

// --- navigation -----------------------------------------------------------

test("nav: a reachable page navigates; the page you are on says so", () => {
  assert.deepEqual(turn("go to the schedule"), { type: "navigate", path: ROUTES.schedule });
  assert.deepEqual(turn("show the board"), { type: "say", line: LINES.already });
});

test("nav: why you can't go there depends on why", () => {
  assert.deepEqual(turn("go to the schedule", { reachable: UP_TO_INVENTORY }), { type: "say", line: LINES.notYet });
  assert.deepEqual(turn("go to the schedule", { route: ROUTES.home, reachable: [ROUTES.home], hasSession: false }), {
    type: "say",
    line: LINES.noSession,
  });
  // Kitchen setup isn't a step you haven't reached; it only replaces a
  // deleted kitchen. "Not yet" would be a lie.
  assert.deepEqual(turn("go to kitchen setup", { reachable: UP_TO_INVENTORY }), {
    type: "say",
    line: LINES.kitchenPicked,
  });
});

test("nav: going back from the first page this visit opened stays put", () => {
  assert.deepEqual(turn("go back", { canGoBack: false }), { type: "say", line: LINES.firstPage });
  assert.deepEqual(turn("go back", { canGoBack: true }), { type: "back" });
});

test("nav: a doubtful back asks first, but not when there is nowhere to go", () => {
  const asked = turn("back", { confidence: 0.5 });
  assert.equal(asked.type, "confirm");
  assert.equal(asked.question, "Did you mean go back? Say yes or no.");
  assert.deepEqual(asked.then, { type: "back" });
  assert.deepEqual(turn("back", { confidence: 0.5, canGoBack: false }), { type: "say", line: LINES.firstPage });
});

test("nav: a doubtful destination asks first — the prompt that never fired", () => {
  const asked = turn("go to the schedule", { confidence: 0.5 });
  assert.equal(asked.type, "confirm");
  assert.equal(asked.question, "Did you mean go to schedule? Say yes or no.");
  assert.deepEqual(asked.then, { type: "navigate", path: ROUTES.schedule });
});

test("nav: a garbled destination moves nobody", () => {
  assert.deepEqual(turn("go to the schedule", { confidence: 0.2 }), { type: "ignore", reason: "not-a-command" });
});

test("nav: a page name inside a longer word is not that page", () => {
  for (const said of ["show me the homemade sauce", "open the cooker", "show the plantains", "open the boards drawer"]) {
    assert.equal(turn(said).type, "ignore", said);
  }
});

test("nav: help lists places you can go, and never a 'next' that doesn't exist", () => {
  const r = turn("what can I say", { route: ROUTES.inventory, reachable: UP_TO_INVENTORY });
  assert.equal(r.type, "say");
  assert.doesNotMatch(r.line, /\bnext\b/);
  assert.match(r.line, /conversation/);
  assert.doesNotMatch(r.line, /schedule|live cook/);
});
