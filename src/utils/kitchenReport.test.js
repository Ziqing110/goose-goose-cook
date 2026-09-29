// The three eyes-off questions: what's available, where is everyone, and
// does anything cooking on its own need a check. Run with:
// node --test src/utils/kitchenReport.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createRun, applyStart, applyDone } from "./liveCook.js";
import { availableLine, checkupLine, checkups, matchKitchenQuestion, newlyOpenLine, spokenDuration, whereLine } from "./kitchenReport.js";

const nodes = [
  { id: "rice", label: "Cook the rice", attended: false, estimated_duration_sec: 1200, depends_on: [],
    unattended: { initial: { duration_sec: 60, difficulty: "low" }, checkpoints: { count: 2, interval_sec: 600, duration_sec: 60, difficulty: "low" }, ending: { duration_sec: 60, difficulty: "low" } } },
  { id: "beef", label: "Slice the beef", estimated_duration_sec: 300, depends_on: [] },
  { id: "broc", label: "Cut the broccoli", estimated_duration_sec: 180, depends_on: [] },
  { id: "fry", label: "Stir-fry the beef", estimated_duration_sec: 300, depends_on: ["beef", "broc"] },
];
const cooks = [{ id: "c1", name: "Lindy" }, { id: "c2", name: "Zeina" }];
const T0 = Date.parse("2026-09-30T18:00:00Z");
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const versus = () => createRun({ nodes, mode: "competition", schedule: null, opening: null, now: new Date(T0) });

test("available: the open steps, then what is holding the rest up", () => {
  let run = versus();
  assert.equal(availableLine({ nodes, run }), "Up for grabs: Cook the rice, Slice the beef and Cut the broccoli.");
  run = applyStart({ run, stepId: "rice", cookId: "c2", at: at(0) });
  run = applyStart({ run, stepId: "beef", cookId: "c1", at: at(0) });
  assert.equal(availableLine({ nodes, run }), "Up for grabs: Cut the broccoli.");
  run = applyStart({ run, stepId: "broc", cookId: "c2", at: at(70) });
  assert.match(availableLine({ nodes, run }), /Nothing's free right now\. Stir-fry the beef opens up once Slice the beef and Cut the broccoli are done\./);
});

test("where: each cook's hands, what they have cooking, and the count", () => {
  let run = versus();
  run = applyStart({ run, stepId: "rice", cookId: "c2", at: at(0) });
  run = applyStart({ run, stepId: "beef", cookId: "c1", at: at(0) });
  run = applyDone({ run, stepId: "beef", cookId: "c1", at: at(240) });
  const line = whereLine({ nodes, run, cooks, now: T0 + 300_000 });
  assert.equal(line, "Lindy is free. Zeina is free, with Cook the rice cooking. 1 of 4 done.");
  const early = whereLine({ nodes, run: applyStart({ run: versus(), stepId: "beef", cookId: "c1", at: at(0) }), cooks, now: T0 + 180_000 });
  assert.match(early, /^Lindy is on Slice the beef, about 3 minutes in\. Zeina is free\. 0 of 4 done\.$/);
});

test("checkup: due now leads, otherwise when the next moment is", () => {
  const run = applyStart({ run: versus(), stepId: "rice", cookId: "c2", at: at(0) });
  assert.equal(checkupLine({ nodes, run, cooks, now: T0 + 300_000 }), "Nothing needs you yet. Cook the rice: next check in about 6 minutes.");
  // Checks at 60s and 660s (after the 60s setup, then every 600s), 60s each.
  assert.equal(checkupLine({ nodes, run, cooks, now: T0 + 680_000 }), "Zeina, check on Cook the rice now.");
  assert.equal(checkupLine({ nodes, run, cooks, now: T0 + 900_000 }), "Nothing needs you yet. Cook the rice: comes off in about 4 minutes.");
  assert.equal(checkupLine({ nodes, run, cooks, now: T0 + 1_150_000 }), "Zeina, Cook the rice needs finishing now.");
  assert.equal(checkups({ nodes, run: versus(), cooks }).length, 0);
  assert.equal(checkupLine({ nodes, run: versus(), cooks }), "Nothing's cooking on its own right now.");
});

test("the questions are recognised, and actions and the goose's own lines are not", () => {
  const cases = {
    "what steps are available?": "available",
    "Goose, what's left?": "available",
    "what can I do?": "available",
    "what's next": "available",
    "anything up for grabs?": "available",
    "where are we?": "where",
    "who's doing what": "where",
    "how far along are we": "where",
    "does anything need checking?": "checkup",
    "anything that needs a check": "checkup",
    "anything cooking on its own?": "checkup",
    "should I check the rice": "checkup",
    "any unattended tasks": "checkup",
    "还有什么可以做": "available",
    "到哪了": "where",
  };
  for (const [said, kind] of Object.entries(cases)) assert.equal(matchKitchenQuestion(said), kind, said);
  for (const said of [
    "I'm done with the beef, what's next?",
    "I'll take the rice",
    "Up for grabs: Cut the broccoli.",
    "Nothing's cooking on its own right now.",
    "Zeina, check on Cook the rice now.",
    "Lindy is free. 1 of 4 done.",
    "pass me the salt",
  ]) {
    assert.equal(matchKitchenQuestion(said), null, said);
  }
});

test("durations are said, not read off a clock", () => {
  assert.equal(spokenDuration(20), "under a minute");
  assert.equal(spokenDuration(61), "about 1 minute");
  assert.equal(spokenDuration(3900), "about 1 hour 5 minutes");
});

test("finishing a step announces only what it opened", () => {
  let run = versus();
  run = applyStart({ run, stepId: "beef", cookId: "c1", at: at(0) });
  run = applyStart({ run, stepId: "broc", cookId: "c2", at: at(0) });
  const before = applyDone({ run, stepId: "broc", cookId: "c2", at: at(100) });
  assert.equal(newlyOpenLine(nodes, run, before), "", "the beef is still going, so nothing opened");
  const after = applyDone({ run: before, stepId: "beef", cookId: "c1", at: at(200) });
  assert.equal(newlyOpenLine(nodes, before, after), "Now up for grabs: Stir-fry the beef.");
});
