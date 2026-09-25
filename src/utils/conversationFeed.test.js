import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationFeed, feedKey, ATTRIBUTION } from "./conversationFeed.js";

const byId = { dice: { label: "Dice onion" }, garlic: { label: "Mince garlic" } };
const cooks = [{ id: "mia", name: "Mia" }, { id: "leo", name: "Leo" }];
const at = (s) => new Date(Date.UTC(2026, 0, 1, 18, 0, s)).toISOString();

test("talking and doing end up in one list, in time order", () => {
  // The whole point: the page kept two records and showed one.
  const rows = buildConversationFeed({
    transcript: [
      { at: at(1), speaker: "mia", text: "Goose, I'll take the onion" },
      { at: at(3), speaker: "agent", text: "Mia has Dice onion. Go." },
    ],
    events: [{ at: at(2), type: "start", cookId: "mia", stepId: "dice", source: "voice" }],
    byId,
    cooks,
  });
  assert.deepEqual(rows.map((r) => r.kind), ["said", "action", "agent"]);
});

test("an action names the person, the verb and the step", () => {
  // "Mia has Dice onion. Go." makes you work out that a claim happened.
  const [row] = buildConversationFeed({
    events: [{ at: at(1), type: "start", cookId: "mia", stepId: "dice", source: "voice" }],
    byId,
    cooks,
  });
  assert.equal(row.kind, "action");
  assert.equal(row.name, "Mia");
  assert.equal(row.verb, "started");
  assert.equal(row.label, "Dice onion");
  assert.equal(row.source, "voice");
});

test("every acting verb gets a past-tense reading", () => {
  const types = { start: "started", done: "finished", skip: "skipped", drop: "put back", undo: "undid" };
  for (const [type, verb] of Object.entries(types)) {
    const [row] = buildConversationFeed({
      events: [{ at: at(1), type, cookId: "leo", stepId: "garlic" }],
      byId,
      cooks,
    });
    assert.equal(row.verb, verb, type);
  }
});

test("tapped and spoken actions are tellable apart", () => {
  // Which matters when a claim went to the wrong person: was it heard
  // wrong, or did somebody press it?
  const rows = buildConversationFeed({
    events: [
      { at: at(1), type: "start", cookId: "mia", stepId: "dice", source: "tap" },
      { at: at(2), type: "start", cookId: "leo", stepId: "garlic", source: "voice" },
    ],
    byId,
    cooks,
  });
  assert.deepEqual(rows.map((r) => r.source), ["tap", "voice"]);
});

test("how the speaker was decided is carried, when it is known", () => {
  // The toggle is a guess nobody made deliberately, so it is the one
  // worth saying out loud.
  const rows = buildConversationFeed({
    transcript: [
      { at: at(1), speaker: "mia", text: "done", via: "toggle" },
      { at: at(2), speaker: "leo", text: "done", via: "voiceprint" },
      { at: at(3), speaker: "leo", text: "typed" },
    ],
    cooks,
  });
  assert.equal(rows[0].via, ATTRIBUTION.toggle);
  assert.equal(rows[1].via, ATTRIBUTION.voiceprint);
  assert.equal(rows[2].via, null, "older runs and typing do not claim to know");
});

test("an unknown attribution does not become a broken label", () => {
  const [row] = buildConversationFeed({
    transcript: [{ at: at(1), speaker: "mia", text: "hi", via: "telepathy" }],
    cooks,
  });
  assert.equal(row.via, null);
});

test("run-level events belong to the run, not a person", () => {
  const rows = buildConversationFeed({
    events: [
      { at: at(1), type: "run_start", cookId: null },
      { at: at(2), type: "run_pause", cookId: null },
      { at: at(3), type: "run_resume", cookId: null },
      { at: at(4), type: "run_end", cookId: null },
    ],
    cooks,
  });
  assert.deepEqual(rows.map((r) => r.kind), ["run", "run", "run", "run"]);
  assert.deepEqual(rows.map((r) => r.text), ["Run started", "Paused", "Resumed", "Run ended"]);
});

test("a step deleted since is still a real action, just unnamed", () => {
  const [row] = buildConversationFeed({
    events: [{ at: at(1), type: "done", cookId: "mia", stepId: "gone" }],
    byId,
    cooks,
  });
  assert.equal(row.label, null);
  assert.equal(row.verb, "finished");
});

test("a cook who left is 'Someone', not a blank", () => {
  const rows = buildConversationFeed({
    transcript: [{ at: at(1), speaker: "ghost", text: "hello" }],
    events: [{ at: at(2), type: "done", cookId: "ghost", stepId: "dice" }],
    byId,
    cooks,
  });
  assert.deepEqual(rows.map((r) => r.name), ["Someone", "Someone"]);
});

test("the goose thinking is a row, and it is always last", () => {
  // So the cook can see a turn is in flight rather than wondering
  // whether they were heard at all.
  const rows = buildConversationFeed({
    transcript: [{ at: at(9), speaker: "agent", text: "Back on." }],
    thinkingSince: Date.UTC(2026, 0, 1, 18, 0, 0),
    now: Date.UTC(2026, 0, 1, 18, 0, 4),
    cooks,
  });
  assert.equal(rows[rows.length - 1].kind, "thinking");
  assert.equal(rows[rows.length - 1].seconds, 4, "it carries its own clock");
});

test("no turn in flight means no thinking row", () => {
  const rows = buildConversationFeed({ transcript: [], events: [], cooks });
  assert.deepEqual(rows, []);
  assert.ok(!buildConversationFeed({ thinkingSince: null, cooks }).some((r) => r.kind === "thinking"));
});

test("empty and missing input produce an empty feed, not a throw", () => {
  assert.deepEqual(buildConversationFeed(), []);
  assert.deepEqual(buildConversationFeed({}), []);
  assert.deepEqual(buildConversationFeed({ transcript: null, events: null }), []);
});

test("entries with no text and events with no verb are skipped", () => {
  const rows = buildConversationFeed({
    transcript: [{ at: at(1), speaker: "mia", text: "" }, { at: at(2), speaker: "mia" }],
    events: [{ at: at(3), type: "something_new", cookId: "mia" }, { at: at(4) }],
    cooks,
  });
  assert.deepEqual(rows, [], "an unrecognised verb is dropped, not rendered raw");
});

test("feedKey is stable for a row and distinct between rows", () => {
  const rows = buildConversationFeed({
    events: [
      { at: at(1), type: "done", cookId: "mia", stepId: "dice" },
      { at: at(1), type: "done", cookId: "mia", stepId: "garlic" },
    ],
    byId,
    cooks,
  });
  const keys = rows.map(feedKey);
  assert.equal(new Set(keys).size, 2, "same timestamp, different steps");
  assert.equal(feedKey(rows[0], 0), keys[0], "stable across calls");
});

test("rows from pages with no run of their own merge in, in time order", () => {
  // Outside a live cook there is no transcript and no events; voiceLog
  // keeps rows in this shape so the rail can show both without either
  // side knowing about the other.
  const rows = buildConversationFeed({
    transcript: [{ at: at(2), speaker: "agent", text: "Going to the schedule." }],
    extraRows: [
      { kind: "said", at: at(1), name: "You", text: "go to the schedule" },
      { kind: "run", at: at(3), text: "Opened Schedule" },
    ],
    cooks,
  });
  assert.deepEqual(rows.map((r) => r.kind), ["said", "agent", "run"]);
  assert.equal(rows[0].name, "You");
});

test("a speaker the cook list does not know can still name itself", () => {
  const [row] = buildConversationFeed({
    transcript: [{ at: at(1), speaker: null, name: "You", text: "hello" }],
    cooks,
  });
  assert.equal(row.name, "You");
});

test("the cook list wins over a self-declared name", () => {
  // Inside a run, who a cook is is not the transcript's to decide.
  const [row] = buildConversationFeed({
    transcript: [{ at: at(1), speaker: "mia", name: "Someone else", text: "hi" }],
    cooks,
  });
  assert.equal(row.name, "Mia");
});
