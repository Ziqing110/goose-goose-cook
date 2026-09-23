// English-only coverage for global voice navigation (navCommands.js).
// Mandarin is out of scope here — nav vocabulary is English by design.
import test from "node:test";
import assert from "node:assert/strict";
import {
  matchNavCommand,
  matchConfirmation,
  matchesConfirmationPhrase,
  navCommandList,
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
