import test from "node:test";
import assert from "node:assert/strict";
import { pickCookQuote } from "./cookQuotes.js";

test("picks a real line over a bare command", () => {
  const transcript = [
    { speaker: "c1", text: "Hey Goose, start the garlic" },
    { speaker: "c1", text: "Oh no, the garlic is on fire, this is a disaster!" },
    { speaker: "c1", text: "done" },
  ];
  assert.equal(pickCookQuote("c1", transcript), "Oh no, the garlic is on fire, this is a disaster!");
});

test("nothing fun said returns null", () => {
  const transcript = [
    { speaker: "c1", text: "Hey Goose, start the garlic" },
    { speaker: "c1", text: "done" },
    { speaker: "c1", text: "Goose" },
  ];
  assert.equal(pickCookQuote("c1", transcript), null);
});

test("ignores other cooks and the agent", () => {
  const transcript = [
    { speaker: "agent", text: "That's quite a fire you've got going there!" },
    { speaker: "c2", text: "This is honestly the best meal I have ever cooked in my life" },
  ];
  assert.equal(pickCookQuote("c1", transcript), null);
});

test("ties keep whichever was said first", () => {
  const transcript = [
    { speaker: "c1", text: "This is going surprisingly well so far tonight" },
    { speaker: "c1", text: "This is going surprisingly well so far, actually" },
  ];
  assert.equal(pickCookQuote("c1", transcript), "This is going surprisingly well so far tonight");
});

test("no transcript at all is fine", () => {
  assert.equal(pickCookQuote("c1", undefined), null);
  assert.equal(pickCookQuote("c1", []), null);
});
