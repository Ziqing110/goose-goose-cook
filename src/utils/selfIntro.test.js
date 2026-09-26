import test from "node:test";
import assert from "node:assert/strict";
import { findSelfIntro } from "./selfIntro.js";

const cooks = [{ id: "leo", name: "Leo" }, { id: "toni", name: "Toni" }];

test("an introduction names the speaker and leaves the instruction behind", () => {
  // The reported failure: said in one breath, the step went to whoever
  // the toggle was on.
  const found = findSelfIntro("I'm Toni, and I'll start by measuring bay leaf and thyme", cooks);
  assert.equal(found.cookId, "toni");
  assert.equal(found.rest, "I'll start by measuring bay leaf and thyme");
});

test("every way a person says who they are", () => {
  for (const said of [
    "I'm Toni",
    "I am Toni",
    "this is Toni",
    "it's Toni",
    "my name is Toni",
    "Toni here",
    "Toni speaking",
  ]) {
    assert.equal(findSelfIntro(said, cooks)?.cookId, "toni", said);
  }
});

test("the joiner between the two halves is dropped", () => {
  // "and I'll start the bay leaf" is not something the step matcher
  // should have to cope with.
  for (const said of [
    "I'm Toni, and start the garlic",
    "I'm Toni. Start the garlic",
    "I'm Toni; then start the garlic",
    "I'm Toni so start the garlic",
    "I'm Toni start the garlic",
  ]) {
    // Case is left alone: a sentence that began after a full stop keeps
    // its capital, and everything downstream is case-insensitive.
    assert.equal(findSelfIntro(said, cooks)?.rest.toLowerCase(), "start the garlic", said);
  }
});

test("an introduction on its own leaves nothing to act on", () => {
  const found = findSelfIntro("I'm Toni", cooks);
  assert.equal(found.cookId, "toni");
  assert.equal(found.rest, "", "the caller acknowledges rather than acting");
});

test("case and punctuation do not matter", () => {
  assert.equal(findSelfIntro("IT'S TONI, start the garlic", cooks)?.cookId, "toni");
  assert.equal(findSelfIntro("i'm toni", cooks)?.cookId, "toni");
});

test("talking ABOUT somebody is not introducing yourself", () => {
  // The patterns anchor at the start for exactly this.
  for (const said of [
    "ask Toni to do it",
    "that's Toni's step",
    "give the garlic to Toni",
    "Toni will take the garlic",
  ]) {
    assert.equal(findSelfIntro(said, cooks), null, said);
  }
});

test("a name belonging to nobody here is not an introduction", () => {
  // A stranger's name is not a reason to reassign anyone's work.
  assert.equal(findSelfIntro("I'm Mallory, start the garlic", cooks), null);
  assert.equal(findSelfIntro("I'm the chef", cooks), null);
});

test("an ambiguous name resolves to nobody rather than guessing", () => {
  const twins = [{ id: "a", name: "Sam" }, { id: "b", name: "Sam" }];
  assert.equal(findSelfIntro("I'm Sam", twins), null);
});

test("ordinals work, since resolveCookRef already understood them", () => {
  assert.equal(findSelfIntro("I'm the second cook", cooks)?.cookId, "toni");
});

test("nothing, or nobody in the kitchen, is not an introduction", () => {
  assert.equal(findSelfIntro("", cooks), null);
  assert.equal(findSelfIntro("   ", cooks), null);
  assert.equal(findSelfIntro(null, cooks), null);
  assert.equal(findSelfIntro("I'm Toni", []), null);
  assert.equal(findSelfIntro("I'm Toni", null), null);
});

test("an ordinary command is untouched", () => {
  for (const said of ["start the garlic", "done", "Goose, what's next?"]) {
    assert.equal(findSelfIntro(said, cooks), null, said);
  }
});
