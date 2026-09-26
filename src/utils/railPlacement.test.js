import test from "node:test";
import assert from "node:assert/strict";
import { clampHandleTop, DEFAULT_HANDLE_TOP, HANDLE_HEIGHT, parseHandleTop } from "./railPlacement.js";

test("notes handle: the default spot fits on a 1280×800 counter screen", () => {
  assert.equal(clampHandleTop(DEFAULT_HANDLE_TOP, 800), DEFAULT_HANDLE_TOP);
});

test("notes handle: it can never be dragged off either end", () => {
  assert.equal(clampHandleTop(-500, 800), 12);
  assert.equal(clampHandleTop(5000, 800), 800 - HANDLE_HEIGHT - 12);
});

test("notes handle: a spot saved on a taller window is pulled back onto a shorter one", () => {
  assert.equal(clampHandleTop(900, 600), 600 - HANDLE_HEIGHT - 12);
});

test("notes handle: a stored height that is missing or junk is ignored", () => {
  assert.equal(parseHandleTop("300"), 300);
  assert.equal(parseHandleTop(null), null);
  assert.equal(parseHandleTop(""), null);
  assert.equal(parseHandleTop("nope"), null);
});
