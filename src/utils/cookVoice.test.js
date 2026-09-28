// Tests for the spoken cook references on the voice-binding page.
// Run with: node --test src/utils/cookVoice.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { ORDINAL, ordinalIndex, resolveCookRef, cleanSpokenName, nearestCook, joinSpelledLetters } from "./cookVoice.js";
import { MAX_COOK_NAME_LENGTH } from "./cooks.js";

const two = [{ name: "Mia" }, { name: "" }];
const named = [{ name: "Mia" }, { name: "Leo" }];

test("ordinalIndex maps words, digits and recognizer mishearings", () => {
  for (const w of ["first", "1st", "one", "1"]) assert.equal(ordinalIndex(w), 0);
  for (const w of ["second", "2nd", "two", "too", "2", "Second"]) assert.equal(ordinalIndex(w), 1);
  assert.equal(ordinalIndex("third"), null);
  assert.equal(ordinalIndex("to"), null);
});

test("ORDINAL does not treat bare 'to' as a slot", () => {
  assert.equal(new RegExp(`\\b(${ORDINAL})\\b`).test("add a cook to the kitchen"), false);
});

test("resolveCookRef by slot", () => {
  assert.equal(resolveCookRef("the first cook", two), two[0]);
  assert.equal(resolveCookRef("cook two", two), two[1]);
  assert.equal(resolveCookRef("the second cook", [{ name: "Mia" }]), null);
});

test("resolveCookRef by name, whole word only", () => {
  assert.equal(resolveCookRef("mia", named), named[0]);
  assert.equal(resolveCookRef("leo please", named), named[1]);
  assert.equal(resolveCookRef("miami", named), null);
});

test("resolveCookRef refuses an ambiguous or empty reference", () => {
  assert.equal(resolveCookRef("mia and leo", named), null);
  assert.equal(resolveCookRef("", named), null);
  assert.equal(resolveCookRef("nobody", two), null);
});

test("resolveCookRef escapes regex characters in names", () => {
  assert.equal(resolveCookRef("c++", [{ name: "C++" }]), null); // no crash; \b can't anchor after '+'
  assert.doesNotThrow(() => resolveCookRef("x", [{ name: "(" }]));
});

test("cleanSpokenName capitalizes and trims pleasantries", () => {
  assert.equal(cleanSpokenName("mia"), "Mia");
  assert.equal(cleanSpokenName("mia please"), "Mia");
  assert.equal(cleanSpokenName("mary jane"), "Mary Jane");
  assert.equal(cleanSpokenName("o'brien"), "O'brien");
});

test("cleanSpokenName rejects non-names", () => {
  assert.equal(cleanSpokenName("ready"), null);
  assert.equal(cleanSpokenName("done"), null);
  assert.equal(cleanSpokenName(""), null);
  assert.equal(cleanSpokenName("a very long sentence here"), null);
});

test("cleanSpokenName caps at the input's limit", () => {
  assert.ok(cleanSpokenName("a".repeat(100)).length <= MAX_COOK_NAME_LENGTH);
});

// --- edge cases ------------------------------------------------------------

test("resolveCookRef tolerates missing input and empty line-ups", () => {
  assert.equal(resolveCookRef(undefined, named), null);
  assert.equal(resolveCookRef(null, named), null);
  assert.equal(resolveCookRef("   ", named), null);
  assert.equal(resolveCookRef("the first cook", []), null);
  assert.equal(resolveCookRef("mia", []), null);
});

test("resolveCookRef ignores case and surrounding whitespace, in the reference and the name", () => {
  assert.equal(resolveCookRef("  THE FIRST COOK ", named), named[0]);
  assert.equal(resolveCookRef("LEO", named), named[1]);
  assert.equal(resolveCookRef("mia", [{ name: "  Mia  " }, { name: "Leo" }]).name, "  Mia  ");
});

test("resolveCookRef never matches an unnamed cook by name", () => {
  const cooks = [{ name: "" }, { name: "   " }];
  assert.equal(resolveCookRef("anyone", cooks), null);
  assert.equal(resolveCookRef("", cooks), null);
});

test("resolveCookRef: two cooks with the same name is ambiguous, not a coin flip", () => {
  const dupes = [{ name: "Sam" }, { name: "sam" }];
  assert.equal(resolveCookRef("sam", dupes), null);
  // ...but a slot still disambiguates.
  assert.equal(resolveCookRef("the second cook", dupes), dupes[1]);
});

test("resolveCookRef: a slot word wins over a name in the same utterance", () => {
  assert.equal(resolveCookRef("leo the first cook", named), named[0]);
});

test("resolveCookRef: multi-word names need the whole name", () => {
  const cooks = [{ name: "Mary Jane" }, { name: "Leo" }];
  assert.equal(resolveCookRef("mary jane", cooks), cooks[0]);
  assert.equal(resolveCookRef("mary", cooks), null);
});

test("resolveCookRef: short names don't match inside longer words", () => {
  const cooks = [{ name: "Al" }, { name: "Bo" }];
  assert.equal(resolveCookRef("also", cooks), null);
  assert.equal(resolveCookRef("bob", cooks), null);
  assert.equal(resolveCookRef("al", cooks), cooks[0]);
});

test("resolveCookRef: names with apostrophes and hyphens", () => {
  const cooks = [{ name: "O'Brien" }, { name: "Jean-Luc" }];
  assert.equal(resolveCookRef("o'brien", cooks), cooks[0]);
  assert.equal(resolveCookRef("jean-luc", cooks), cooks[1]);
});

test("resolveCookRef: ordinals need word boundaries", () => {
  // "someone" contains "one"; "second-hand" is a real word, but "seconds" is not a slot.
  assert.equal(resolveCookRef("someone", named), null);
  assert.equal(resolveCookRef("seconds", named), null);
  assert.equal(resolveCookRef("tone", named), null);
});

test("ordinalIndex is case-insensitive and null-safe", () => {
  assert.equal(ordinalIndex("FIRST"), 0);
  assert.equal(ordinalIndex(undefined), null);
  assert.equal(ordinalIndex(""), null);
  assert.equal(ordinalIndex("0"), null);
  assert.equal(ordinalIndex("toString"), null); // no prototype leakage
  assert.equal(ordinalIndex("constructor"), null);
});

test("cleanSpokenName is null-safe and rejects filler-only input", () => {
  assert.equal(cleanSpokenName(undefined), null);
  assert.equal(cleanSpokenName(null), null);
  assert.equal(cleanSpokenName("   "), null);
  assert.equal(cleanSpokenName("please"), null);
  assert.equal(cleanSpokenName("ok"), null);
  assert.equal(cleanSpokenName("thank you"), null);
});

test("cleanSpokenName drops punctuation and normalizes case", () => {
  assert.equal(cleanSpokenName("MIA"), "Mia");
  assert.equal(cleanSpokenName("Mia!"), "Mia");
  assert.equal(cleanSpokenName("mia, please"), "Mia");
  assert.equal(cleanSpokenName("mia thank you"), "Mia");
  assert.equal(cleanSpokenName("  mia   "), "Mia");
});

test("cleanSpokenName keeps hyphenated names as one word", () => {
  assert.equal(cleanSpokenName("jean-luc"), "Jean-luc");
});

test("cleanSpokenName rejects every 'I'm ___' that isn't a name", () => {
  for (const w of ["ready", "done", "back", "here", "good", "fine", "sorry", "stuck", "not sure", "going to cook", "trying it"]) {
    assert.equal(cleanSpokenName(w), null, w);
  }
});

test("cleanSpokenName allows at most two words", () => {
  assert.equal(cleanSpokenName("mary jane"), "Mary Jane");
  assert.equal(cleanSpokenName("mary jane watson"), null);
});

test("cleanSpokenName never returns text longer than the input allows, or with a dangling space", () => {
  const long = cleanSpokenName(`${"a".repeat(MAX_COOK_NAME_LENGTH - 2)} bc`);
  assert.ok(long.length <= MAX_COOK_NAME_LENGTH);
  assert.equal(long, long.trim());
});

test("cleanSpokenName strips digits-only 'names' down to something sane or null", () => {
  // Numbers aren't stripped as names, but symbols are.
  assert.equal(cleanSpokenName("@#$%"), null);
});

test("cleanSpokenName: truncating right after a space leaves no trailing space", () => {
  const cut = cleanSpokenName(`${"a".repeat(MAX_COOK_NAME_LENGTH - 1)} bc`);
  assert.equal(cut, cut.trim());
  assert.ok(cut.length <= MAX_COOK_NAME_LENGTH);
});

const pair = [{ id: "L", name: "Lindy" }, { id: "Z", name: "Zeina" }];

test("nearestCook: the recogniser's spelling of a cook's name is that cook", () => {
  assert.equal(nearestCook("Zina", pair)?.id, "Z");
  assert.equal(nearestCook("zeena", pair)?.id, "Z");
  assert.equal(nearestCook("Lindi", pair)?.id, "L");
  assert.equal(nearestCook("Zeina", pair)?.id, "Z", "exact still wins");
});

test("nearestCook: nobody close, a tie, or a word that is not a name is nobody", () => {
  assert.equal(nearestCook("Mallory", pair), null);
  assert.equal(nearestCook("Mina", [{ id: 1, name: "Nina" }, { id: 2, name: "Tina" }]), null);
  assert.equal(nearestCook("ready", pair), null);
  assert.equal(nearestCook("Li", pair), null);
});

test("spelled names: however the recogniser writes the letters, they join back", () => {
  assert.equal(joinSpelledLetters("I'm Z-E-I-N-A, start the eggs"), "I'm Zeina, start the eggs");
  assert.equal(joinSpelledLetters("it's Z E I N A"), "it's Zeina");
  assert.equal(joinSpelledLetters("z. e. i. n. a."), "Zeina");
});

test("spelled names: ordinary words and short letter runs are left alone", () => {
  assert.equal(joinSpelledLetters("I want a tofu"), "I want a tofu");
  assert.equal(joinSpelledLetters("plan B or C"), "plan B or C");
});
