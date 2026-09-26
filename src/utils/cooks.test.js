import test from "node:test";
import assert from "node:assert/strict";
import { voiceLinesFor, VOICE_LINES_PER_COOK } from "./cooks.js";
import { RECORDING_VOICE, VOICE_BINDING_VOICE } from "./pageVoiceGrammar.js";
import { normalizeUtterance } from "./navCommands.js";

const scripts = [0, 1, 2].map((i) => voiceLinesFor(i, "Zeina"));

test("enrollment: every cook reads the same number of lines, with their name in the first", () => {
  for (const lines of scripts) {
    assert.equal(lines.length, VOICE_LINES_PER_COOK);
    assert.match(lines[0], /^I'm Zeina,/);
    assert.ok(lines.every((l) => !l.includes("{name}")));
  }
});

test("enrollment: two cooks never read the same line", () => {
  const all = scripts.flat();
  assert.equal(new Set(all).size, all.length);
  // The fourth cook would wrap round; the page caps it at two.
  assert.deepEqual(voiceLinesFor(3, "Zeina"), scripts[0]);
});

test("enrollment: no line says what ends or cancels a recording", () => {
  // Reading "... that's it ..." would stop the recording mid-script.
  const stoppers = [...RECORDING_VOICE.save, ...RECORDING_VOICE.cancel];
  for (const line of scripts.flat()) {
    const said = normalizeUtterance(line);
    const hit = stoppers.find((p) => p.test(said));
    assert.equal(hit, undefined, `"${line}" matches ${hit}`);
  }
});

test("enrollment: only the first line is a name, so the rest cannot rename anybody", () => {
  for (const lines of scripts) {
    for (const line of lines.slice(1)) {
      assert.equal(VOICE_BINDING_VOICE.nameSelf.some((p) => p.test(normalizeUtterance(line))), false, line);
    }
  }
});
