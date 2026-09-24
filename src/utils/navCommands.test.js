// English-only coverage for global voice navigation (navCommands.js).
// Mandarin is out of scope here — nav vocabulary is English by design.
import test from "node:test";
import assert from "node:assert/strict";
import {
  matchNavCommand,
  matchConfirmation,
  matchesConfirmationPhrase,
  navCommandList,
  navHelpLine,
  navHintFor,
  normalizeUtterance,
} from "./navCommands.js";
import { HOME_VOICE, SCHEDULE_VOICE } from "./pageVoiceGrammar.js";

const ALL = [
  "/",
  "/session/kitchen-setup",
  "/session/conversation",
  "/session/inventory",
  "/session/voice-binding",
  "/session/schedule",
  "/session/live-cook",
];

test("nav: go to a named destination", () => {
  const r = matchNavCommand("go to the schedule", {
    route: "/session/inventory",
    reachable: ALL,
    confidence: 0.95,
  });
  assert.equal(r.action, "goto");
  assert.equal(r.path, "/session/schedule");
});

test("nav: open / show / take me to also navigate", () => {
  for (const said of ["open the recipe", "show ingredients", "take me to home"]) {
    const r = matchNavCommand(said, { route: "/session/conversation", reachable: ALL, confidence: 1 });
    assert.equal(r.action, "goto", said);
  }
});

test("nav: already on the destination", () => {
  const r = matchNavCommand("go to the schedule", {
    route: "/session/schedule",
    reachable: ALL,
    confidence: 1,
  });
  assert.equal(r.action, "already");
  assert.equal(r.path, "/session/schedule");
});

test("nav: blocked when the stage is not reachable yet", () => {
  const r = matchNavCommand("go to the live cook", {
    route: "/session/inventory",
    reachable: ["/", "/session/conversation", "/session/inventory"],
    confidence: 1,
  });
  assert.equal(r.action, "blocked");
  assert.equal(r.path, "/session/live-cook");
});

test("nav: naming a page without a verb is not a command", () => {
  const r = matchNavCommand("the schedule looks tight", {
    route: "/",
    reachable: ALL,
    confidence: 1,
  });
  assert.equal(r.action, "none");
});

test("nav: go back is explicit", () => {
  const r = matchNavCommand("go back", { route: "/session/inventory", reachable: ALL, confidence: 1 });
  assert.equal(r.action, "back");
});

test("nav: conversation with a subject is not navigation", () => {
  const r = matchNavCommand("we should go back", {
    route: "/session/inventory",
    reachable: ALL,
    confidence: 1,
  });
  assert.equal(r.action, "none");
});

test("nav: low confidence bare back is dropped or confirmable, not a silent goto", () => {
  const r = matchNavCommand("back", {
    route: "/session/inventory",
    reachable: ALL,
    confidence: 0.2,
  });
  assert.notEqual(r.action, "goto");
});

test("nav: confirmation yes/no", () => {
  assert.equal(matchConfirmation("yes"), "yes");
  assert.equal(matchConfirmation("nope"), "no");
  assert.equal(matchConfirmation("no, the other jar beside the pan"), null);
});

test("nav: a filler in front of the answer is still the answer", () => {
  for (const said of ["Uh, yes.", "um yeah", "oh yes", "well okay", "uh uh yes"]) {
    assert.equal(matchConfirmation(said), "yes", said);
  }
  for (const said of ["Um, no.", "oh no", "uh nope"]) {
    assert.equal(matchConfirmation(said), "no", said);
  }
  assert.equal(matchConfirmation("uh"), null);
});

test("nav: a named destination still works while the page is taking dictation", () => {
  const r = matchNavCommand("go to inventory", {
    route: "/session/conversation",
    reachable: ALL,
    confidence: 0.95,
    strict: true,
  });
  assert.deepEqual(r, { action: "goto", path: "/session/inventory" });
});

test("nav: normalizeUtterance lowercases for matching", () => {
  assert.equal(normalizeUtterance("Go To The Schedule!"), "go to the schedule");
});

test("nav: every documented destination alias works with every navigation verb", () => {
  const destinations = [
    ["/", ["home", "the start"]],
    ["/session/kitchen-setup", ["kitchen setup", "the kitchen", "equipment"]],
    ["/session/conversation", ["conversation", "the questions"]],
    ["/session/inventory", ["inventory", "the recipe", "the board", "ingredients"]],
    ["/session/voice-binding", ["voice binding", "voices", "the cooks"]],
    ["/session/schedule", ["schedule", "the timeline", "the plan"]],
    ["/session/live-cook", ["live cook", "cooking", "the cook"]],
  ];
  const verbs = ["go to", "open", "show", "take me to", "jump to", "switch to", "navigate to"];
  for (const [path, names] of destinations) {
    for (const name of names) {
      for (const verb of verbs) {
        const result = matchNavCommand(`${verb} ${name}`, {
          route: path === "/" ? "/session/conversation" : "/",
          reachable: ALL,
          confidence: 1,
        });
        assert.equal(result.path, path, `${verb} ${name}`);
        assert.equal(result.action, "goto", `${verb} ${name}`);
      }
    }
  }
  assert.deepEqual(navCommandList(), destinations.map(([, names]) => names[0]));
});

test("nav: every back alias and help phrase has its global action", () => {
  for (const phrase of [
    "go back", "last page", "last step", "last screen", "previous page", "previous step", "previous screen", "back", "previous",
  ]) {
    assert.equal(matchNavCommand(phrase, { route: "/session/inventory", confidence: 1 }).action, "back", phrase);
  }
  for (const phrase of ["help", "command", "commands", "what can I say"]) {
    assert.equal(matchNavCommand(phrase, { route: "/session/inventory", confidence: 1 }).action, "help", phrase);
  }
});

test("nav: every advertised confirmation response is recognized", () => {
  for (const phrase of ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "do it", "go ahead", "confirm", "please"]) {
    assert.equal(matchConfirmation(phrase), "yes", phrase);
  }
  for (const phrase of ["no", "nope", "nah", "don't", "do not", "cancel", "never mind", "stop", "wait"]) {
    assert.equal(matchConfirmation(phrase), "no", phrase);
  }
});

test("nav: destructive actions require the page's exact normalized passphrase", () => {
  for (const phrase of [HOME_VOICE.abandonConfirmation, SCHEDULE_VOICE.abandonConfirmation]) {
    assert.equal(matchesConfirmationPhrase(phrase, phrase), true, phrase);
    assert.equal(matchesConfirmationPhrase(phrase.toUpperCase(), phrase), true, phrase);
    assert.equal(matchesConfirmationPhrase("yes", phrase), false, phrase);
    assert.equal(matchesConfirmationPhrase(`${phrase} please`, phrase), false, phrase);
  }
});

test("nav: a destination with a subject is conversation, not a command", () => {
  for (const said of ["we should go home", "they'll show the board later", "you can open the schedule"]) {
    const r = matchNavCommand(said, { route: "/session/inventory", reachable: ALL, confidence: 1 });
    assert.equal(r.action, "none", said);
  }
});

test("nav: polite filler around a destination is still a command", () => {
  for (const said of ["can you take me home", "I want to go to the schedule", "lets go to the schedule", "please show the plan"]) {
    const r = matchNavCommand(said, { route: "/session/inventory", reachable: ALL, confidence: 1 });
    assert.equal(r.action, "goto", said);
  }
});

test("nav: destination names match whole words only", () => {
  const cases = {
    "show me the homemade sauce": "none",
    "open the cooker": "none",
    "go to the cooks": "goto",
    "take me back to the cook": "goto",
  };
  for (const [said, action] of Object.entries(cases)) {
    const r = matchNavCommand(said, { route: "/", reachable: ALL, confidence: 1 });
    assert.equal(r.action, action, said);
  }
  assert.equal(matchNavCommand("go to the cooks", { route: "/", reachable: ALL }).path, "/session/voice-binding");
  assert.equal(matchNavCommand("take me back to the cook", { route: "/", reachable: ALL }).path, "/session/live-cook");
});

test("nav: destination confidence bands — act, ask, drop", () => {
  const at = (confidence) => matchNavCommand("go to the schedule", { route: "/", reachable: ALL, confidence });
  assert.deepEqual(at(0.9), { action: "goto", path: "/session/schedule" });
  assert.deepEqual(at(0.5), { action: "goto", path: "/session/schedule", confirm: true });
  assert.deepEqual(at(0.3), { action: "none" });
  // Not reachable is a fact about the page, not the hearing: no question.
  const blocked = matchNavCommand("go to the schedule", { route: "/", reachable: ["/"], confidence: 0.5 });
  assert.deepEqual(blocked, { action: "blocked", path: "/session/schedule" });
});

test("nav: the hint only suggests a page you can reach", () => {
  // It used to be the first name on the list, which on Home was kitchen
  // setup — a page that answers "not yet" for almost everyone.
  assert.equal(navHintFor("/", ["/"]).line, "Say “go back” or “go home”.");
  assert.match(navHintFor("/", ["/", "/session/conversation", "/session/inventory"]).line, /go to inventory/);
  assert.doesNotMatch(navHintFor("/session/inventory", ALL).line, /inventory/);
});

test("nav: help never offers a page you are on or can't reach", () => {
  const line = navHelpLine("/session/inventory", ["/", "/session/conversation", "/session/inventory"]);
  assert.match(line, /conversation/);
  assert.match(line, /home/);
  assert.doesNotMatch(line, /inventory|schedule|next/);
});
