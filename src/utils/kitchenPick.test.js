// The kitchen picker is shared by Home and the replacement-kitchen page.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUtterance } from "./navCommands.js";
import { clearVoiceCommands, matchPageCommand, registerVoiceCommands } from "./voicePageCommands.js";
import { kitchenPickCommands } from "./kitchenPick.js";

const profiles = [
  { id: "flat-3", name: "Flat 3 Galley" },
  { id: "flat-4", name: "Flat 4 Galley" },
  { id: "garden", name: "Garden Annex" },
];

function hear(commands, transcript) {
  clearVoiceCommands();
  registerVoiceCommands(commands);
  return matchPageCommand(normalizeUtterance(transcript));
}

test("kitchen picker: full names and unique words select the matching kitchen", () => {
  const starts = [];
  const commands = kitchenPickCommands(profiles, (id) => starts.push(id));

  for (const [phrase, id] of [
    ["Flat 3 Galley", "flat-3"],
    ["Flat 4 Galley", "flat-4"],
    ["Garden Annex", "garden"],
    ["garden", "garden"],
    ["annex", "garden"],
  ]) {
    const command = hear(commands, phrase);
    assert.ok(command, phrase);
    command.run();
    assert.equal(starts.at(-1), id, phrase);
  }
});

test("kitchen picker: shared words and unrelated speech never guess a kitchen", () => {
  const commands = kitchenPickCommands(profiles, () => {});
  for (const phrase of ["flat", "galley", "kitchen", "start next week"]) {
    assert.equal(hear(commands, phrase), null, phrase);
  }
});

test("kitchen picker: punctuation in profile names is treated literally", () => {
  const command = kitchenPickCommands([
    { id: "r-and-d", name: "R&D Test Kitchen" },
    { id: "q-and-d", name: "Q&D Test Kitchen" },
  ], () => {});
  assert.ok(hear(command, "R D Test Kitchen"));
  assert.equal(hear(command, "RXXD Test Kitchen"), null);
});
