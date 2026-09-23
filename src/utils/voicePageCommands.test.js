// English page-command registry (voicePageCommands.js) — zoom-style phrases
// and filler padding, without mounting React.
import test from "node:test";
import assert from "node:assert/strict";
import {
  registerVoiceCommands,
  matchPageCommand,
  clearVoiceCommands,
  registerVoiceDictation,
  getVoiceDictation,
} from "./voicePageCommands.js";
import { normalizeUtterance as navNormalize } from "./navCommands.js";

// voicePageCommands matches against text VoiceBar already normalized via
// navCommands.normalizeUtterance — use the same helper in these tests.
const said = (s) => navNormalize(s);

test.afterEach(() => clearVoiceCommands());

test("page command: zoom in / out match registered phrases", () => {
  let zoom = 0;
  registerVoiceCommands([
    {
      phrases: [/\bzoom in\b/, /\bzoom (?:in )?closer\b/],
      run: () => {
        zoom += 5;
      },
    },
    {
      phrases: [/\bzoom out\b/],
      run: () => {
        zoom -= 5;
      },
    },
  ]);

  const inn = matchPageCommand(said("zoom in"));
  assert.ok(inn);
  inn.run(inn.match);
  assert.equal(zoom, 5);

  const out = matchPageCommand(said("please zoom out"));
  assert.ok(out, "filler words should still match");
  out.run(out.match);
  assert.equal(zoom, 0);
});

test("page command: top layer wins over a lower-priority page layer", () => {
  const hits = [];
  registerVoiceCommands([{ phrases: [/\bresume\b/], run: () => hits.push("page") }], { priority: 0 });
  registerVoiceCommands([{ phrases: [/\bresume\b/], run: () => hits.push("modal") }], { priority: 10 });

  const hit = matchPageCommand(said("resume"));
  assert.ok(hit);
  hit.run(hit.match);
  assert.deepEqual(hits, ["modal"]);
});

test("page command: capture groups reach run()", () => {
  let captured = null;
  registerVoiceCommands([
    {
      phrases: [/\bset burners to (.+)$/],
      run: (m) => {
        captured = m[1];
      },
    },
  ]);
  const hit = matchPageCommand(said("set burners to four"));
  assert.ok(hit);
  hit.run(hit.match);
  assert.equal(captured, "four");
});

test("page command: unknown utterance returns null", () => {
  registerVoiceCommands([{ phrases: [/\bzoom in\b/], run: () => {} }]);
  assert.equal(matchPageCommand(said("pass the salt")), null);
});

test("dictation forwards partial and final English transcript only on its route", () => {
  const partials = [];
  const finals = [];
  const unregister = registerVoiceDictation({
    route: "/session/conversation",
    onPartial: (text) => partials.push(text),
    onFinal: (text) => finals.push(text),
  });

  try {
    const dictation = getVoiceDictation("/session/conversation");
    assert.ok(dictation);
    dictation.onPartial("we are making ramen");
    dictation.onFinal("we are making ramen");
    assert.equal(getVoiceDictation("/session/schedule"), null);
    assert.deepEqual(partials, ["we are making ramen"]);
    assert.deepEqual(finals, ["we are making ramen"]);
  } finally {
    unregister();
  }

  assert.equal(getVoiceDictation("/session/conversation"), null);
});
