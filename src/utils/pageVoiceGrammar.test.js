// Transcript coverage for the phrase arrays imported by the page handlers.
// This registers each production grammar in the real page-command matcher;
// changing a handler's matcher therefore changes the test target too.
import test from "node:test";
import assert from "node:assert/strict";
import { NUMBER_TOKEN } from "./understanding.js";
import { ORDINAL } from "./cookVoice.js";
import { normalizeUtterance } from "./navCommands.js";
import { clearVoiceCommands, matchPageCommand, registerVoiceCommands } from "./voicePageCommands.js";
import {
  HOME_VOICE,
  CONVERSATION_VOICE,
  INVENTORY_VOICE,
  ingredientVoicePhrases,
  parseAddTaskSpeech,
  KITCHEN_PROFILE_VOICE,
  ADD_STEP_VOICE,
  EDIT_STEP_VOICE,
  DELETE_STEP_VOICE,
  SCHEDULE_VOICE,
  VOICE_BINDING_VOICE,
  RECORDING_VOICE,
  AVATAR_PICKER_VOICE,
} from "./pageVoiceGrammar.js";

function hear(phrases, transcript) {
  clearVoiceCommands();
  registerVoiceCommands([{ phrases, run: () => {} }], { priority: 10, exclusive: true });
  return matchPageCommand(normalizeUtterance(transcript));
}

function assertMatches(phrases, transcripts) {
  for (const transcript of transcripts) {
    assert.ok(hear(phrases, transcript), `expected to match: ${transcript}`);
  }
}

function assertCapture(phrases, transcript, expected) {
  const match = hear(phrases, transcript);
  assert.ok(match, `expected to match: ${transcript}`);
  assert.equal(match.match[1], expected, transcript);
}

test("Home and completed Conversation page commands match their advertised transcripts", () => {
  assertMatches(HOME_VOICE.addKitchen, ["add a kitchen", "add another kitchen", "new kitchen"]);
  assertMatches(HOME_VOICE.start, ["start the run", "start cooking", "start the session"]);
  assertMatches(HOME_VOICE.resume, ["resume", "carry on with the run"]);
  assertMatches(HOME_VOICE.abandon, [
    "abandon the run", "abort this cooking session", "discard session", "cancel cook",
  ]);
  assertMatches(HOME_VOICE.cancelPicker, ["cancel", "never mind", "go back"]);
  assertMatches(CONVERSATION_VOICE.continueInventory, [
    "check inventory", "continue to the inventory", "go to inventory",
  ]);
});

test("Conversation start over and go back match only as the whole utterance", () => {
  assertMatches(CONVERSATION_VOICE.startOver, [
    "start over", "start again", "let's start over", "lets start over", "can we start over",
    "start from scratch", "start from the beginning", "begin again", "restart", "please start over",
  ]);
  assertMatches(CONVERSATION_VOICE.goHome, [
    "go back", "take me back", "please go back", "go back home", "go home", "go to home", "take me home",
    "take me back home", "back to home", "go back to the home page", "go to the start",
  ]);
  assertMatches(CONVERSATION_VOICE.previousQuestion, [
    "go back to the last question", "go back to last question", "back to the previous question",
    "can we go back to the last question", "go back a question", "go back one question", "last question",
    "previous question", "redo the last answer", "change my last answer", "take me back to the previous one",
  ]);
  assert.equal(hear(CONVERSATION_VOICE.goHome, "go back to the last question"), null, "not home");
  assert.equal(hear(CONVERSATION_VOICE.previousQuestion, "go back home"), null, "not the last question");
  // Heard while the page takes dictation, so an answer that merely
  // contains the words has to stay an answer.
  for (const answer of [
    "start over with pasta instead", "i want the restart soup", "go back to basics", "go back to my mum's recipe",
    "the last question my mum asked was about noodles", "home made dumplings",
  ]) {
    assert.equal(hear(CONVERSATION_VOICE.startOver, answer), null, answer);
    assert.equal(hear(CONVERSATION_VOICE.goHome, answer), null, answer);
    assert.equal(hear(CONVERSATION_VOICE.previousQuestion, answer), null, answer);
  }
});

test("Inventory ingredient, tab, zoom, pan, step, approval, and notice commands match", () => {
  const ingredients = ingredientVoicePhrases("spring onion");
  assertMatches(ingredients.out, [
    "no spring onion", "no more spring onion", "out of spring onion", "spring onion is out",
    "don't have spring onion", "dont have any spring onion", "mark spring onion out",
  ]);
  assertMatches(ingredients.onHand, [
    "got spring onion", "got the spring onion", "got some spring onion", "have spring onion",
    "have the spring onion", "have some spring onion", "found spring onion", "found the spring onion",
    "found some spring onion", "spring onion is back", "spring onion is on hand", "mark spring onion on hand",
  ]);
  assert.equal(hear(ingredients.out, "spring onion"), null, "bare ingredient names are not commands");
  // Bringing one back, the ways people say it.
  assertMatches(ingredients.onHand, [
    "add spring onion back", "add back the spring onion", "add the spring onion", "put the spring onion back",
    "bring back the spring onion", "spring onion back", "mark the spring onion as on hand", "check spring onion",
    "spring onion is here", "we're not out of spring onion",
  ]);
  assertMatches(ingredients.out, [
    "we ran out of spring onion", "spring onion is gone", "haven't got any spring onion", "uncheck the spring onion",
    "mark the spring onion as out",
  ]);
  // A shopping trip is not a restock; not being out is not being out.
  assert.equal(hear(ingredients.onHand, "we need to get spring onion"), null, "get alone is not back on hand");
  assert.equal(hear(ingredients.out, "we're not out of spring onion"), null, "not out of is not out");

  assertMatches(INVENTORY_VOICE.addTask, [
    "add a task", "add another task", "add a step", "add another step", "add task called Toast seeds",
  ]);
  assertMatches(INVENTORY_VOICE.showIngredients, [
    "show ingredients", "show me the ingredients", "ingredients tab", "go to the ingredients",
    // How people actually leave the graph. "back to the ingredients"
    // used to be a bare "back" and left the page.
    "back to the ingredients", "go back to ingredients", "switch to ingredients", "switch back to the ingredients",
    "open the ingredients", "show the ingredient list", "ingredient list", "ingredients",
  ]);
  assertMatches(INVENTORY_VOICE.showGraph, [
    "show the recipe graph", "show me the board", "recipe graph", "go to the recipe graph", "go to board",
    "back to the graph", "go back to the board", "switch to the graph", "open the recipe board", "graph tab",
  ]);
  for (const other of ["no ginger", "got the ginger", "ingredients look fine", "the board is a mess"]) {
    assert.equal(hear(INVENTORY_VOICE.showIngredients, other), null, other);
    assert.equal(hear(INVENTORY_VOICE.showGraph, other), null, other);
  }
  assertMatches(INVENTORY_VOICE.restoreLast, ["put it back", "add it back", "bring that back", "undo that", "I have it"]);
  assertMatches(INVENTORY_VOICE.zoomIn, ["zoom in", "zoom closer", "zoom in closer"]);
  assertMatches(INVENTORY_VOICE.zoomOut, ["zoom out"]);
  assertMatches(INVENTORY_VOICE.fit, ["fit the board", "fit graph", "reset zoom", "zoom to fit"]);
  assertMatches(INVENTORY_VOICE.panRight, ["scroll right", "scroll to the right", "pan right", "pan to the right"]);
  assertMatches(INVENTORY_VOICE.panLeft, ["scroll left", "scroll to the left", "pan left", "pan to the left"]);
  assertMatches(INVENTORY_VOICE.panVertical, ["scroll up", "scroll down", "pan up", "pan down"]);
  assertCapture(INVENTORY_VOICE.findStep, "find the step dice onion", "dice onion");
  assertCapture(INVENTORY_VOICE.findStep, "scroll to step dice onion", "dice onion");
  assertCapture(INVENTORY_VOICE.findStep, "show me the step dice onion", "dice onion");
  assertCapture(INVENTORY_VOICE.editStep, "open the step dice onion", "dice onion");
  assertCapture(INVENTORY_VOICE.editStep, "edit step dice onion", "dice onion");
  assertCapture(INVENTORY_VOICE.editStep, "select the step dice onion", "dice onion");
  assertMatches(INVENTORY_VOICE.approve, ["approve", "approve the plan"]);
  assertMatches(INVENTORY_VOICE.revise, ["revise", "unapprove", "go back to editing"]);
  assertMatches(INVENTORY_VOICE.removeBlocked, ["remove blocked step", "remove the blocked steps", "drop blocked steps"]);
  assertMatches(INVENTORY_VOICE.editKitchen, ["edit kitchen profile", "edit the kitchen", "edit my kitchen"]);
  assertMatches(INVENTORY_VOICE.cookAnyway, ["cook it anyway"]);
});

test("Inventory add-task placement phrases are parsed into names and positions", () => {
  for (const prefix of ["to", "called", "named", "for"]) {
    const match = hear(INVENTORY_VOICE.addTask, `add a task ${prefix} Toast seeds`);
    assert.ok(match, `add task ${prefix} Toast seeds`);
    assert.deepEqual(parseAddTaskSpeech(match.match[1].trim()), {
      name: "toast seeds", before: null, between: null,
    });
  }
  assert.deepEqual(parseAddTaskSpeech("before Dice onion"), {
    name: "", before: "Dice onion", between: null,
  });
  assert.deepEqual(parseAddTaskSpeech("called Toast seeds before Dice onion"), {
    name: "Toast seeds", before: "Dice onion", between: null,
  });
  assert.deepEqual(parseAddTaskSpeech("named Sauce between Chop onion and Boil noodles"), {
    name: "Sauce", before: null, between: ["Chop onion", "Boil noodles"],
  });
  assert.deepEqual(parseAddTaskSpeech("some unconnected words"), {
    name: "", before: null, between: null,
  });
});

test("Kitchen Profile dialog matches name, count, nudge, switch, save, and cancel commands", () => {
  assertMatches(KITCHEN_PROFILE_VOICE.name, [
    "call it Flat 3", "name it Flat 3", "call this kitchen Flat 3", "the name is Flat 3",
  ]);
  for (const field of ["burners", "cutting boards", "pots"]) {
    assertMatches(KITCHEN_PROFILE_VOICE.count(field, NUMBER_TOKEN), [
      `set ${field} to four`, `four ${field}`, `make it four ${field}`, `make that four ${field}`,
    ]);
    const one = field === "cutting boards" ? "cutting board" : field === "burners" ? "burner" : "pot";
    assertMatches(KITCHEN_PROFILE_VOICE.increase(one), [`add ${one}`, `one more ${one}`, `another ${one}`]);
    assertMatches(KITCHEN_PROFILE_VOICE.decrease(one), [
      `remove ${one}`, `drop ${one}`, `one less ${one}`, `one fewer ${one}`,
    ]);
  }
  for (const [thing, article] of [["wok", "a"], ["oven", "an"]]) {
    assertMatches(KITCHEN_PROFILE_VOICE.toggleOn(thing, article), [
      `${thing} on`, `yes ${thing}`, `turn the ${thing} on`, `turn on the ${thing}`,
      `add ${article} ${thing}`, `enable the ${thing}`, `with ${article} ${thing}`,
    ]);
    assertMatches(KITCHEN_PROFILE_VOICE.toggleOff(thing, article), [
      `${thing} off`, `no ${thing}`, `turn the ${thing} off`, `turn off the ${thing}`,
      `remove ${article} ${thing}`, `drop the ${thing}`, `disable ${article} ${thing}`, `without ${article} ${thing}`,
    ]);
  }
  assertMatches(KITCHEN_PROFILE_VOICE.save, ["save the kitchen", "save this kitchen", "save it", "that's it"]);
  assertMatches(KITCHEN_PROFILE_VOICE.cancel, [
    "cancel", "close the form", "close this form", "never mind", "discard this",
  ]);
});

test("Add Task dialog matches task fields, equipment, dependencies, submit, and cancel", () => {
  assertMatches(ADD_STEP_VOICE.name, ["call it Toast seeds", "name it Toast seeds", "for Toast seeds"]);
  assertMatches(ADD_STEP_VOICE.duration(NUMBER_TOKEN), [
    "set duration to four minutes", "set the time to four minute", "make it four minutes", "four minutes",
  ]);
  assertMatches(ADD_STEP_VOICE.difficulty, [
    "difficulty low", "set difficulty to medium", "make it high", "make it low difficulty",
  ]);
  assertMatches(ADD_STEP_VOICE.phase, ["phase prep", "set phase to cook", "mark it plate", "mark it as prep"]);
  for (const [word, article] of [["cutting board", "a"], ["stove burner", "a"], ["wok", "a"], ["pot", "a"], ["oven", "an"]]) {
    const { on, off } = ADD_STEP_VOICE.equipment(word, article);
    assertMatches(on, [`add ${article} ${word}`, `with the ${word}`, `${word} on`]);
    assertMatches(off, [`remove ${article} ${word}`, `drop the ${word}`, `without ${article} ${word}`, `${word} off`]);
  }
  assertCapture(ADD_STEP_VOICE.after, "runs after Dice onion", "dice onion");
  assertCapture(ADD_STEP_VOICE.after, "run after Dice onion", "dice onion");
  assertCapture(ADD_STEP_VOICE.after, "waits on Dice onion", "dice onion");
  assertCapture(ADD_STEP_VOICE.after, "waiting on Dice onion", "dice onion");
  assertCapture(ADD_STEP_VOICE.before, "runs before Dice onion", "dice onion");
  assertCapture(ADD_STEP_VOICE.before, "run before Dice onion", "dice onion");
  assertMatches(ADD_STEP_VOICE.submit, [
    "add it to the board", "add this to the board", "add the task to the board", "add the task", "create the step", "that's it",
  ]);
  assertMatches(ADD_STEP_VOICE.cancel, ["cancel", "close the form", "close this form", "never mind"]);
});

test("Edit Step dialog matches rename, shared fields, dependency removal, delete, save, and cancel", () => {
  assertMatches(EDIT_STEP_VOICE.name, ["call it Dice onion", "rename it Dice onion", "name it Dice onion"]);
  assertMatches(EDIT_STEP_VOICE.duration(NUMBER_TOKEN), ["set duration to four minutes", "make it four minutes", "four minutes"]);
  assertMatches(EDIT_STEP_VOICE.difficulty, ["set difficulty high", "make it low"]);
  assertMatches(EDIT_STEP_VOICE.phase, ["set phase cook", "mark it as plate"]);
  for (const [word, article] of [["cutting board", "a"], ["stove burner", "a"], ["wok", "a"], ["pot", "a"], ["oven", "an"]]) {
    const { on, off } = EDIT_STEP_VOICE.equipment(word, article);
    assertMatches(on, [`add ${article} ${word}`, `${word} on`]);
    assertMatches(off, [`remove ${article} ${word}`, `without ${article} ${word}`, `${word} off`]);
  }
  assertCapture(EDIT_STEP_VOICE.after, "runs after Dice onion", "dice onion");
  assertCapture(EDIT_STEP_VOICE.after, "waiting on Dice onion", "dice onion");
  assertCapture(EDIT_STEP_VOICE.stopWaiting, "stop waiting on Dice onion", "dice onion");
  assertCapture(EDIT_STEP_VOICE.stopWaiting, "remove Dice onion from runs after", "dice onion");
  assertCapture(EDIT_STEP_VOICE.stopWaiting, "don't wait on Dice onion", "dice onion");
  assertCapture(EDIT_STEP_VOICE.stopWaiting, "dont wait on Dice onion", "dice onion");
  assertMatches(EDIT_STEP_VOICE.delete, ["delete this step", "delete it", "remove this step"]);
  assertMatches(EDIT_STEP_VOICE.save, ["save the step", "save it", "that's it"]);
  assertMatches(EDIT_STEP_VOICE.cancel, ["cancel", "close this step", "close the editor", "never mind"]);
});

test("Delete Step dialog matches each dependency choice, confirmation, and cancellation phrase", () => {
  assertMatches(DELETE_STEP_VOICE.inherit, [
    "move them to what it was waiting on", "move them to what this step was waiting on", "inherit",
    "move it to its dependencies", "move them onto the old dependencies",
  ]);
  assertMatches(DELETE_STEP_VOICE.choose, ["choose for each", "let me choose", "pick them myself"]);
  assertMatches(DELETE_STEP_VOICE.drop, ["just drop the link", "drop the link", "drop links"]);
  assertMatches(DELETE_STEP_VOICE.confirm, ["remove the step", "delete the step", "confirm"]);
  assertMatches(DELETE_STEP_VOICE.cancel, ["keep it", "cancel", "never mind"]);
});

test("Schedule matches modes, live navigation, board, kitchen, zoom, details, and free-time commands", () => {
  assertMatches(SCHEDULE_VOICE.cooperation, ["co-op", "coop", "cooperation", "cooperative"]);
  assertMatches(SCHEDULE_VOICE.competition, ["versus", "competition", "competitive", "vs"]);
  assertMatches(SCHEDULE_VOICE.live, ["go live", "start the cook", "start cooking"]);
  assertMatches(SCHEDULE_VOICE.backToCook, ["go live", "back to the cook", "see the result", "show the result"]);
  assertMatches(SCHEDULE_VOICE.abandon, [
    "abandon the cook", "abort this run", "discard session", "abandon this session",
  ]);
  assertMatches(SCHEDULE_VOICE.recipeGraph, [
    "back to the recipe graph", "go to recipe board", "open the recipe graph", "show the recipe board", "fix the loop",
  ]);
  assertMatches(SCHEDULE_VOICE.editKitchen, ["edit the kitchen", "edit kitchen profile"]);
  assertMatches(SCHEDULE_VOICE.fit, [
    "zoom to fit", "zoom fit", "fit the timeline", "fit plan", "fit schedule", "fit screen", "fit", "reset zoom",
  ]);
  assertMatches(SCHEDULE_VOICE.zoomIn, ["zoom in", "zoom closer"]);
  assertMatches(SCHEDULE_VOICE.zoomOut, ["zoom out"]);
  assertMatches(SCHEDULE_VOICE.closeDetails, [
    "close details", "hide the panel", "dismiss the sheet", "close step",
  ]);
  assertCapture(SCHEDULE_VOICE.showDetails, "select Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "open task Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "show details for the step Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "show details on Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "show details of Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "details for task Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "details on Dice onion", "dice onion");
  assertCapture(SCHEDULE_VOICE.showDetails, "details of Dice onion", "dice onion");
  assertMatches(SCHEDULE_VOICE.freeTime, [
    "when am I free", "when are we free", "when do I get a break", "when do we be a free",
    "when can I get free", "when can we be a break", "when is Mia free", "when is Mia get a break",
    "free time", "who's free", "who is free",
  ]);
});

test("Voice Binding page, recording layer, and avatar drawer match their commands", () => {
  assertMatches(VOICE_BINDING_VOICE.continueSchedule, ["continue to scheduling", "go to scheduling"]);
  assertMatches(VOICE_BINDING_VOICE.lockedBack, ["take me back", "back to the cook", "go back to the cook"]);
  assertCapture(VOICE_BINDING_VOICE.nameByOrdinal(ORDINAL), "call the first cook Mia", "first");
  assertCapture(VOICE_BINDING_VOICE.nameByOrdinal(ORDINAL), "name second cook as Mia", "second");
  assertCapture(VOICE_BINDING_VOICE.nameByOrdinal(ORDINAL), "call cook 2 is Mia", "2");
  assertCapture(VOICE_BINDING_VOICE.nameCook(ORDINAL), "cook one is Mia", "one");
  assertCapture(VOICE_BINDING_VOICE.nameCook(ORDINAL), "cook 2 is Mia", "2");
  assertMatches(VOICE_BINDING_VOICE.nameSelf, ["I'm Mia", "I am Mia", "my name is Mia", "this is Mia"]);
  assertCapture(VOICE_BINDING_VOICE.chooseAvatar, "pick a chef for Mia", "mia");
  assertMatches(VOICE_BINDING_VOICE.chooseAvatar, ["choose my avatar", "select bird", "change the chef of Mia", "open your avatar"]);
  assertMatches(VOICE_BINDING_VOICE.randomAvatar, ["surprise me", "surprise", "roll the dice", "random", "random chef", "random bird"]);
  assertMatches(VOICE_BINDING_VOICE.record, [
    "start reading", "start recording for Mia", "start recording of Mia", "record again", "record again for Mia",
  ]);
  assertMatches(VOICE_BINDING_VOICE.addCook, ["add cook", "add a cook", "add another cook", "add the second cook", "add 2nd cook"]);
  assertCapture(VOICE_BINDING_VOICE.removeCook, "remove cook Mia", "mia");
  assertCapture(VOICE_BINDING_VOICE.removeCook, "delete the second", "second");
  assertMatches(RECORDING_VOICE.save, [
    "stop", "stop and save", "stop recording", "stop reading", "save", "save it", "done reading", "that's it",
  ]);
  assertMatches(RECORDING_VOICE.cancel, ["cancel", "never mind", "discard"]);

  const avatarWords = ["spoon", "blue", "whisk", "orange", "slurp", "green", "tomato", "violet", "booky", "red", "roller", "rose", "flip", "yellow", "stir", "stone"];
  assertMatches(AVATAR_PICKER_VOICE.avatarName(avatarWords), avatarWords);
  assertMatches(AVATAR_PICKER_VOICE.confirm, ["that's me", "confirm", "this one", "looks good", "save", "done", "close"]);
  assertMatches(AVATAR_PICKER_VOICE.random, ["random", "surprise", "surprise me", "roll the dice"]);
  assertMatches(AVATAR_PICKER_VOICE.cancel, ["cancel", "never mind", "go back"]);
});
