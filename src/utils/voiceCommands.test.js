// English-only matcher coverage for live-cook voice commands.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand, isBareResume } from "./voiceCommands.js";

const ctx = {
  byId: {
    dice_onion: { label: "Dice onion" },
    mince_garlic: { label: "Mince garlic" },
  },
  activeStepId: "dice_onion",
  claimable: ["mince_garlic"],
  ownQueue: ["dice_onion"],
  agentName: "Goose",
};

test("parseCommand: English step commands resolve only against the live candidate scope", () => {
  const claim = parseCommand("Goose, I'll take mince garlic.", ctx);
  assert.equal(claim.intent, "claim");
  assert.equal(claim.stepId, "mince_garlic");
  assert.equal(claim.confidence, "exact");

  const done = parseCommand("done", ctx);
  assert.equal(done.intent, "done");
  assert.equal(done.stepId, "dice_onion");
  assert.equal(done.confidence, "exact");
});

test("parseCommand: English run controls keep their own intent", () => {
  assert.equal(parseCommand("pause", ctx).intent, "pause");
  assert.equal(parseCommand("resume", ctx).intent, "resume");
  assert.equal(parseCommand("we're done", ctx).intent, "finish_run");
  assert.equal(parseCommand("what's next?", ctx).intent, "status");
  assert.equal(parseCommand("pass the salt", ctx).intent, "unknown");
});

test("parseCommand: every English claim and start phrase resolves its spoken step", () => {
  const claimPhrases = [
    "claim mince garlic", "I'll take mince garlic", "I'll do mince garlic", "take mince garlic",
    "I've got mince garlic", "give me mince garlic", "mine mince garlic",
  ];
  for (const transcript of claimPhrases) {
    const result = parseCommand(transcript, ctx);
    assert.equal(result.intent, "claim", transcript);
    assert.equal(result.stepId, "mince_garlic", transcript);
  }

  const startPhrases = [
    "start Dice onion", "starting Dice onion", "begin Dice onion", "let's go Dice onion", "on it Dice onion", "go Dice onion",
  ];
  for (const transcript of startPhrases) {
    const result = parseCommand(transcript, ctx);
    assert.equal(result.intent, "start", transcript);
    assert.equal(result.stepId, "dice_onion", transcript);
  }
});

test("parseCommand: English completion, skip, drop, and undo phrases keep their intents", () => {
  for (const transcript of ["done", "finished", "complete", "completed", "got it", "that's it"]) {
    const result = parseCommand(transcript, ctx);
    assert.equal(result.intent, "done", transcript);
    assert.equal(result.stepId, "dice_onion", transcript);
  }
  for (const transcript of ["skip", "forget that", "forget it", "not doing", "cancel that"]) {
    const result = parseCommand(transcript, ctx);
    assert.equal(result.intent, "skip", transcript);
    assert.equal(result.stepId, "dice_onion", transcript);
  }
  for (const transcript of [
    "drop", "put it back", "put this back", "someone else can take", "someone else take", "give it back", "give this up",
  ]) {
    const result = parseCommand(transcript, ctx);
    assert.equal(result.intent, "drop", transcript);
    assert.equal(result.stepId, "dice_onion", transcript);
  }
  for (const transcript of ["undo", "never mind", "oops", "wait no", "wait, no", "I didn't"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "undo", transcript);
  }
});

test("parseCommand: bare 'finish' completes the active step", () => {
  const result = parseCommand("finish", ctx);
  assert.equal(result.intent, "done");
  assert.equal(result.stepId, "dice_onion");
});

test("parseCommand: all English pause, resume, finish, status, score, and help phrases match", () => {
  for (const transcript of ["pause", "hold on", "take a break", "take five", "time out", "timeout"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "pause", transcript);
  }
  for (const transcript of ["resume", "unpause", "back on", "keep going"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "resume", transcript);
  }
  for (const transcript of [
    "we're done", "we are done", "all done", "finish the cook", "finish cook", "end the cook", "dinner's up",
  ]) {
    assert.equal(parseCommand(transcript, ctx).intent, "finish_run", transcript);
  }
  for (const transcript of ["status", "what's next", "what now", "where are we", "how long", "how much"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "status", transcript);
  }
  for (const transcript of ["score", "scores", "point", "points", "leaderboard", "leader board", "who's winning", "am I winning"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "score", transcript);
  }
  for (const transcript of ["help", "command", "commands", "what can I say", "what can you do"]) {
    assert.equal(parseCommand(transcript, ctx).intent, "help", transcript);
  }
});

test("isBareResume: a short resume counts without the agent's name, talk about resuming does not", () => {
  for (const said of ["resume", "Resume.", "okay resume", "goose resume", "keep going", "let's keep going", "back on", "unpause", "继续", "继续吧", "我们继续"]) {
    assert.equal(isBareResume(said), true, said);
  }
  for (const said of [
    "we'll resume after the call", "don't resume yet", "not yet", "resume later", "wait before you resume",
    "等会再继续", "先不继续", "pause", "done", "status", "", "I think we should probably resume the cook now",
  ]) {
    assert.equal(isBareResume(said), false, said);
  }
});
