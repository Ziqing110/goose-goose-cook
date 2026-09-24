// Matcher coverage for live-cook voice commands.
//
// The tests above are the happy path: a phrase, the intent it should
// produce, the step it should land on. The ones below the divider are the
// kitchen cases -- two cooks, look-alike steps, a named step that is not
// yours, Mandarin, and a cook holding nothing at all. They exist because
// every one of them acts on the run, so being wrong is worse than being
// unsure.
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
// ---------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------

// Two steps whose names overlap, one held and two claimable: the shape
// that makes a dumb matcher guess.
const busy = {
  byId: {
    dice_onion: { label: "Dice onion" },
    mince_garlic: { label: "Mince garlic" },
    mince_ginger: { label: "Mince ginger" },
  },
  activeStepId: "dice_onion",
  claimable: ["mince_garlic", "mince_ginger"],
  ownQueue: ["dice_onion"],
  agentName: "Goose",
};

test("parseCommand: naming a step that is not yours does not complete the one that is", () => {
  // The regression this guards: the no-name fallback fired whenever the
  // spoken name matched nothing, so a cook holding the onion who said
  // "done with the ginger" finished the ONION and was told so. Silence
  // here is correct -- LiveCookPage turns a null stepId into "Which one
  // did you finish?" rather than acting on a guess.
  for (const said of ["done with mince ginger", "skip the mince garlic", "drop the mince ginger"]) {
    const result = parseCommand(said, busy);
    assert.equal(result.stepId, null, said);
  }
});

test("parseCommand: saying nothing but the intent still acts on what you hold", () => {
  // The other half of the rule above: no name at all is not ambiguity,
  // it is shorthand for the step in your hands.
  for (const [said, intent] of [
    ["done", "done"], ["finish", "done"], ["got it", "done"], ["that's it", "done"],
    ["skip", "skip"], ["drop", "drop"], ["drop it", "drop"], ["put it back", "drop"],
  ]) {
    const result = parseCommand(said, busy);
    assert.equal(result.intent, intent, said);
    assert.equal(result.stepId, "dice_onion", said);
  }
});

test("parseCommand: a name that fits two steps asks instead of picking", () => {
  // "mince" covers both mince steps completely, so the honest answer is
  // both of them, not the first or the shortest.
  for (const said of ["claim mince", "take the mince"]) {
    const result = parseCommand(said, busy);
    assert.equal(result.intent, "claim", said);
    assert.equal(result.stepId, null, said);
    assert.deepEqual([...result.candidates].sort(), ["mince_garlic", "mince_ginger"], said);
  }
});

test("parseCommand: each intent only sees the steps it could mean", () => {
  // Claiming is scoped to what is claimable, so a step already yours is
  // not claimable again...
  assert.equal(parseCommand("claim dice onion", busy).stepId, null);
  // ...while starting looks at your queue and the pool together.
  assert.equal(parseCommand("start mince ginger", busy).stepId, "mince_ginger");
  assert.equal(parseCommand("start dice onion", busy).stepId, "dice_onion");
});

test("parseCommand: a cook holding nothing gets no step, not someone else's", () => {
  const idle = { ...busy, activeStepId: null, ownQueue: [] };
  for (const said of ["done", "skip", "drop", "start"]) {
    const result = parseCommand(said, idle);
    assert.equal(result.stepId, null, said);
  }
});

test("parseCommand: the agent's name is addressing, not part of the step name", () => {
  // Leaving "Goose" in dilutes every score by a word, which dropped a
  // clear two-word match under the floor and turned it into a question.
  const named = parseCommand("Goose, take the mince ginger", busy);
  assert.equal(named.intent, "claim");
  assert.equal(named.stepId, "mince_ginger");
  assert.equal(named.confidence, "exact");
});

test("parseCommand: Mandarin run controls carry the same intents as English", () => {
  // detectIntent matches on a loose normalizer for exactly this reason:
  // the ASCII-only one erases Chinese, so every one of these came back
  // "unknown" and the fallback path was useless in the case where it
  // matters most -- the model being the thing that is unavailable.
  for (const [said, intent] of [
    ["暂停", "pause"],
    ["继续", "resume"],
    ["都做完了", "finish_run"],
    ["还要多久", "status"],
  ]) {
    assert.equal(parseCommand(said, busy).intent, intent, said);
  }
});

test("parseCommand: Mandarin acts on the step in hand", () => {
  assert.equal(parseCommand("好了", busy).stepId, "dice_onion"); // "done"
  assert.equal(parseCommand("开始", busy).stepId, "dice_onion"); // "start"
});

test("parseCommand: a Mandarin step NAME does not resolve (known limitation)", () => {
  // Step labels are English and the name matcher is ASCII-only, so a
  // spoken Chinese ingredient resolves to nothing. The intent still
  // lands, so the cook is asked which step rather than ignored. If the
  // matcher ever learns Chinese, this test should start failing.
  const result = parseCommand("我来做蒜蓉", busy); // "I'll do the garlic"
  assert.equal(result.intent, "claim");
  assert.equal(result.stepId, null);
});

test("parseCommand: junk and missing input are unknown, not a crash", () => {
  for (const said of ["", "   ", "!!!", null, undefined]) {
    const result = parseCommand(said, busy);
    assert.equal(result.intent, "unknown", JSON.stringify(said));
    assert.equal(result.stepId, null, JSON.stringify(said));
  }
});

test("parseCommand: ordinary kitchen talk is not a command", () => {
  // The live cook hands every turn to this parser, so anything said near
  // the microphone reaches it. Chatter has to fall through.
  for (const said of ["pass the salt", "this smells great", "where are the plates"]) {
    assert.equal(parseCommand(said, busy).intent, "unknown", said);
  }
});
