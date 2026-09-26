// English page-command phrases shared by the React handlers and transcript
// tests. Keep matching grammar here so tests exercise the patterns the app uses.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What each command is for, in words, for the goose.
//
// When nothing on a page matches what was said, the page's live commands
// go to the model with a description and a few ways of saying each (see
// voicePageCommands.interpretationMenu). Kept here, beside the phrases
// they describe, so every page that registers a command gets its help
// without writing it again -- and a phrase that changes has its example
// right next to it.
//
// Keyed by the phrase array itself: pages register `phrases:
// HOME_VOICE.resume`, the very array described below. The generators
// (one array per ingredient, per kitchen field) describe what they make.
const HELP = new WeakMap();
const help = (phrases, description, examples) => {
  HELP.set(phrases, { description, examples });
  return phrases;
};

/** The description and example wordings for a phrase array, or null. */
export function voiceHelp(phrases) {
  return (phrases && HELP.get(phrases)) || null;
}

// Where the Inventory tab commands start. "Back to the ingredients" is the
// natural way to leave the graph, and without it the bare "back" in it
// navigated off the page entirely; "go back to ingredients" named this
// very route and answered "You're already here."
const TAB_VERB = "(?:show (?:me )?|open |see |view |switch (?:back )?to |go (?:back )?to |back to |take me to |jump to )";

export const HOME_VOICE = {
  addKitchen: [/\badd (?:a |another )?kitchen\b/, /\bnew kitchen\b/],
  resume: [/\bresume\b/, /\bcarry on with the run\b/],
  abandon: [/\b(?:abandon|abort|discard|cancel) (?:the |this )?(?:cooking )?(?:run|session|cook)\b/],
  abandonConfirmation: "I want to abort this cooking session",
  cancelPicker: [/\bcancel\b/, /\bnever ?mind\b/, /\bgo back\b/],
  start: [/\bstart (?:the )?(?:run|cooking|session)\b/],
};

export const CONVERSATION_VOICE = {
  continueInventory: [
    /\bcheck (?:the )?inventory\b/,
    /\bcontinue to (?:the )?inventory\b/,
    /\bgo to (?:the )?inventory\b/,
  ],
  // The three below are heard even while the page takes dictation, so they
  // are anchored to the whole utterance: "start over" is never an answer
  // to anything, "start over with pasta instead" might be.
  startOver: [
    /^(?:(?:can|could) we |let'?s |lets )?(?:start (?:over|again)|start from (?:the )?(?:scratch|beginning|top)|begin again|restart)$/,
  ],
  // "Go back" is not an answer either, and typing it stranded you on the
  // page you asked to leave. It means Home here, the page before the
  // questions, so it does what "go home" does — and both ask first.
  goHome: [
    /^(?:go back|take me back)$/,
    /^(?:go|take me|head) (?:back )?(?:to )?(?:the )?(?:home|start)(?: page| screen)?$/,
    /^back (?:to )?(?:the )?home(?: page| screen)?$/,
  ],
  // Stepping back one question, to answer it again. Said on its own, like
  // the others: "go back to the last question my mum asked" is not it.
  previousQuestion: [
    /^(?:(?:can|could) we |let'?s |lets )?(?:go |take me )?back (?:to )?(?:the )?(?:last|previous) (?:question|one)$/,
    /^(?:(?:can|could) we |let'?s |lets )?go back (?:a|one) question$/,
    /^(?:the )?(?:last|previous) question$/,
    /^(?:redo|change|fix) (?:the |my )?(?:last|previous) (?:question|answer)$/,
  ],
};

export const INVENTORY_VOICE = {
  addTask: [/\badd (?:a |another )?task\b(.*)$/, /\badd (?:a |another )?step\b(.*)$/],
  showIngredients: [
    new RegExp(`\\b${TAB_VERB}(?:the )?(?:ingredients?|ingredient list|checklist)\\b`),
    /\bingredients? (?:tab|list)\b/,
    /^ingredients$/,
  ],
  showGraph: [
    new RegExp(`\\b${TAB_VERB}(?:the )?(?:recipe graph|recipe board|graph|board)\\b`),
    /\brecipe graph\b/,
    /\bgraph tab\b/,
  ],
  // "Put it back" right after "no ginger": the ingredient is the one just
  // marked out, so the cook doesn't have to name it twice.
  restoreLast: [/\b(?:put|bring|add|get) (?:it|that|them) back\b/, /\bundo that\b/, /\bi (?:do )?have (?:it|that)\b/],
  zoomIn: [/\bzoom in\b/, /\bzoom (?:in )?closer\b/],
  zoomOut: [/\bzoom out\b/],
  fit: [/\bfit (?:the )?(?:board|graph)\b/, /\breset zoom\b/, /\bzoom to fit\b/],
  panRight: [/\bscroll (?:to the )?right\b/, /\bpan (?:to the )?right\b/],
  panLeft: [/\bscroll (?:to the )?left\b/, /\bpan (?:to the )?left\b/],
  panVertical: [/\bscroll (?:up|down)\b/, /\bpan (?:up|down)\b/],
  findStep: [
    /\bscroll to (?:the )?step (.+)$/,
    /\bfind (?:the )?step (.+)$/,
    /\bshow me (?:the )?step (.+)$/,
  ],
  editStep: [
    /\bopen (?:the )?step (.+)$/,
    /\bedit (?:the )?step (.+)$/,
    /\bselect (?:the )?step (.+)$/,
  ],
  removeBlocked: [/\bremove (?:the )?blocked steps?\b/, /\bdrop (?:the )?blocked steps?\b/],
  editKitchen: [/\bedit (?:the )?kitchen profile\b/, /\bedit (?:the |my )?kitchen\b/],
  cookAnyway: [/\bcook it anyway\b/],
  revise: [/\brevise\b/, /\bunapprove\b/, /\bgo back to editing\b/],
  approve: [/\bapprove\b/],

  // Moving on once the board is approved. "Continue to schedule" is the
  // button's own wording, and with no command for it the phrase fell
  // through to navigation, where "schedule" resolves to the schedule
  // route — which the session guards refuse, because the cooks have not
  // been picked yet. Saying what the button says was the one phrasing
  // guaranteed not to work.
  continueOn: [
    /\bcontinue(?: to (?:the )?(?:schedule|scheduling|cooks|chefs))?\b/,
    /\bmove on\b/,
    /\bcarry on\b/,
    /\bnext step\b/,
  ],
};

// Both lists are matched with the subject allowed ("I have ginger", "we're
// out of ginger"): each phrase names the ingredient, so the subject is
// part of saying it, not a sign of two people chatting. "Out" is tried
// first, so "don't have ginger" never reads as "have ginger".
export function ingredientVoicePhrases(name) {
  const phrases = ingredientPhrases(name);
  help(phrases.out, `Mark ${name} as out (they do not have it)`, [`no more ${name}`, `out of ${name}`]);
  help(phrases.onHand, `Mark ${name} as on hand again`, [`got ${name}`, `${name} is back`]);
  return phrases;
}

function ingredientPhrases(name) {
  const escaped = escapeRe(name);
  const some = "(?:the |some |any |more )?";
  return {
    out: [
      new RegExp(`\\bno (?:more )?${escaped}\\b`),
      new RegExp(`\\b(?<!not )out of ${some}${escaped}\\b`),
      new RegExp(`\\b${escaped} is (?:out|gone|finished|used up)\\b`),
      new RegExp(`\\b(?:don't|dont|do not|haven't|havent|have not) (?:have|got) ${some}${escaped}\\b`),
      new RegExp(`\\bmark (?:the )?${escaped} (?:as )?out\\b`),
      new RegExp(`\\buncheck (?:the )?${escaped}\\b`),
    ],
    onHand: [
      new RegExp(`\\bgot ${some}${escaped}\\b`),
      new RegExp(`\\bhave ${some}${escaped}\\b`),
      new RegExp(`\\bfound ${some}${escaped}\\b`),
      new RegExp(`\\b${escaped} is (?:back|on hand|here|in stock|available)\\b`),
      new RegExp(`\\bmark (?:the )?${escaped} (?:as )?(?:on hand|back|available)\\b`),
      new RegExp(`\\bnot out of ${some}${escaped}\\b`),
      // Adding it back, which is how people say undoing an "out" — and
      // every one of these has a "back" in it that used to leave the page.
      new RegExp(`\\badd (?:back )?${some}${escaped}(?: back)?\\b`),
      // "Get ginger" alone is a shopping trip, not a restock: these need the back.
      new RegExp(`\\b(?:put|bring|get) back ${some}${escaped}\\b`),
      new RegExp(`\\b(?:put|bring|get) ${some}${escaped} back\\b`),
      new RegExp(`\\b${escaped} back\\b`),
      new RegExp(`\\b(?:re-?)?check (?:the )?${escaped}\\b`),
    ],
  };
}

export function parseAddTaskSpeech(rest) {
  const empty = { name: "", before: null, between: null };
  if (!rest) return empty;
  const named = "(?:(?:to|called|named|for) (.+?) )?";
  const between = new RegExp(`^${named}between (.+) and (.+)$`).exec(rest);
  if (between) return { name: (between[1] || "").trim(), before: null, between: [between[2].trim(), between[3].trim()] };
  const before = new RegExp(`^${named}before (.+)$`).exec(rest);
  if (before) return { name: (before[1] || "").trim(), before: before[2].trim(), between: null };
  const namedOnly = /^(?:to|called|named|for) (.+)$/.exec(rest);
  if (namedOnly) return { name: namedOnly[1].trim(), before: null, between: null };
  return empty;
}

export const KITCHEN_PROFILE_VOICE = {
  name: [/\b(?:call it|name it|call this kitchen|the name is) (.+)$/],
  count: (field, numberToken) => [
    new RegExp(`\\bset ${field} to (${numberToken})\\b`),
    new RegExp(`\\b(${numberToken}) ${field}\\b`),
    new RegExp(`\\bmake (?:it|that) (${numberToken}) ${field}\\b`),
  ],
  increase: (one) => [new RegExp(`\\b(?:add|one more|another) (?:a |an )?${one}\\b`)],
  decrease: (one) => [new RegExp(`\\b(?:remove|drop|one less|one fewer) (?:a |an |the )?${one}\\b`)],
  toggleOn: (thing, article) => [
    new RegExp(`\\b${thing} on\\b`),
    new RegExp(`\\byes ${thing}\\b`),
    new RegExp(`\\bturn (?:the )?${thing} on\\b`),
    new RegExp(`\\bturn on (?:the )?${thing}\\b`),
    new RegExp(`\\b(?:add|enable) (?:${article} |the )?${thing}\\b`),
    new RegExp(`\\bwith (?:${article} |the )?${thing}\\b`),
  ],
  toggleOff: (thing, article) => [
    new RegExp(`\\b${thing} off\\b`),
    new RegExp(`\\bno ${thing}\\b`),
    new RegExp(`\\bturn (?:the )?${thing} off\\b`),
    new RegExp(`\\bturn off (?:the )?${thing}\\b`),
    new RegExp(`\\b(?:remove|drop|disable) (?:${article} |the )?${thing}\\b`),
    new RegExp(`\\bwithout (?:${article} |the )?${thing}\\b`),
  ],
  save: [/\bsave (?:the |this )?kitchen\b/, /\bsave it\b/, /\bthat's? it\b/],
  cancel: [/\bcancel\b/, /\bclose (?:this|the) form\b/, /\bnever ?mind\b/, /\bdiscard this\b/],
};

const equipmentToggle = (thing, article) => describedToggle(thing, article, {
  on: [new RegExp(`\\b(?:add|with) (?:${article} |the )?${thing}\\b`), new RegExp(`\\b${thing} on\\b`)],
  off: [new RegExp(`\\b(?:remove|drop|without) (?:${article} |the )?${thing}\\b`), new RegExp(`\\b${thing} off\\b`)],
});

export const ADD_STEP_VOICE = {
  name: [/\b(?:call it|name it|for) (.+)$/],
  duration: (numberToken) => [
    new RegExp(`\\bset (?:the )?(?:duration|time) to (${numberToken}) minutes?\\b`),
    new RegExp(`\\bmake it (${numberToken}) minutes?\\b`),
    new RegExp(`\\b(${numberToken}) minutes?\\b`),
  ],
  difficulty: [/\b(?:set )?difficulty (?:to )?(low|medium|high)\b/, /\bmake it (low|medium|high)(?: difficulty)?\b/],
  phase: [/\b(?:set )?phase (?:to )?(prep|cook|plate)\b/, /\bmark it (?:as )?(prep|cook|plate)\b/],
  equipment: equipmentToggle,
  after: [/\bruns? after (.+)$/, /\bwait(?:s|ing)? on (.+)$/],
  before: [/\bruns? before (.+)$/],
  submit: [/\badd (?:it |this |the task )?to the board\b/, /\badd (?:the )?task\b/, /\bcreate (?:the )?step\b/, /\bthat's? it\b/],
  cancel: [/\bcancel\b/, /\bclose (?:this|the) form\b/, /\bnever ?mind\b/],
};

export const EDIT_STEP_VOICE = {
  name: [/\b(?:call it|rename it|name it) (.+)$/],
  duration: ADD_STEP_VOICE.duration,
  difficulty: ADD_STEP_VOICE.difficulty,
  phase: ADD_STEP_VOICE.phase,
  equipment: equipmentToggle,
  stopWaiting: [/\bstop waiting on (.+)$/, /\bremove (.+) from runs after\b/, /\bdon'?t wait on (.+)$/],
  after: ADD_STEP_VOICE.after,
  delete: [/\bdelete (?:this )?step\b/, /\bdelete it\b/, /\bremove (?:this )?step\b/],
  save: [/\bsave (?:the )?step\b/, /\bsave it\b/, /\bthat's? it\b/],
  cancel: [/\bcancel\b/, /\bclose (?:this|the) (?:step|editor)\b/, /\bnever ?mind\b/],
};

export const DELETE_STEP_VOICE = {
  inherit: [
    /\bmove them to what (?:it|this step) was waiting on\b/,
    /\binherit\b/,
    /\bmove (?:it|them) (?:to|onto) (?:its|the) (?:old )?dependencies\b/,
  ],
  choose: [/\bchoose for each\b/, /\blet me choose\b/, /\bpick (?:it|them) myself\b/],
  drop: [/\bjust drop (?:the )?link\b/, /\bdrop (?:the )?links?\b/],
  confirm: [/\bremove (?:the )?step\b/, /\bdelete (?:the )?step\b/, /\bconfirm\b/],
  cancel: [/\bkeep it\b/, /\bcancel\b/, /\bnever ?mind\b/],
};

export const SCHEDULE_VOICE = {
  cooperation: [/\bco ?-?op(?:eration)?\b/, /\bcooperat(?:ive|ion)\b/],
  competition: [/\bversus\b/, /\bcompetition\b/, /\bcompetitive\b/, /\bvs\b/],
  live: [/\bgo live\b/, /\bstart (?:the )?(?:cook|cooking)\b/],
  backToCook: [/\bgo live\b/, /\bback to the cook\b/, /\b(?:see|show) (?:the )?result\b/],
  abandon: [/\b(?:abandon|abort|discard) (?:the |this )?(?:cook|run|session)\b/],
  abandonConfirmation: "I want to abandon this cook",
  recipeGraph: [/\b(?:back to|go to|open|show) (?:the )?recipe (?:graph|board)\b/, /\bfix (?:the )?loop\b/],
  editKitchen: [/\bedit (?:the )?kitchen(?: profile)?\b/],
  fit: [/\bzoom (?:to )?fit\b/, /\bfit (?:the )?(?:timeline|plan|schedule|screen)\b/, /^fit$/, /\breset zoom\b/],
  zoomIn: [/\bzoom in\b/, /\bzoom closer\b/],
  zoomOut: [/\bzoom out\b/],
  closeDetails: [/\b(?:close|hide|dismiss) (?:the )?(?:details|panel|sheet|step)\b/],
  showDetails: [/\b(?:select|open|show details (?:for|on|of)|details (?:for|on|of)) (?:the )?(?:step |task )?(.+)$/],
  freeTime: [
    /\bwhen (?:am i|are we|do i|do we|can i|can we|is \S+) (?:get |be )?(?:a )?(?:free|break)\b/,
    /\bfree time\b/,
    /\bwho(?:'s| is) free\b/,
  ],
};

export const VOICE_BINDING_VOICE = {
  continueSchedule: [/\bcontinue to scheduling\b/, /\bgo to scheduling\b/],
  nameByOrdinal: (ordinal) => [new RegExp(`\\b(?:call|name) (?:the )?(?:cook )?(${ordinal})(?: cook)? (?:is |as )?(.+)$`)],
  nameCook: (ordinal) => [new RegExp(`\\bcook (${ordinal}) (?:is|=) (.+)$`)],
  nameSelf: [/\b(?:i'm|i am|my name is|this is) ([a-z' -]+)$/],
  chooseAvatar: [/\b(?:pick|choose|select|change|open)(?: (?:my|the|a|your))? (?:chef|bird|avatar)(?: (?:for|of))?(?: (.+))?$/],
  randomAvatar: [/\b(?:surprise me|surprise)\b/, /\broll (?:the )?dice\b/, /\brandom(?: chef| bird)?\b/],
  record: [/\bstart (?:reading|recording)(?: (?:for|of))?(?: (.+))?$/, /\brecord again(?: (?:for|of))?(?: (.+))?$/],
  addCook: [/\badd (?:a |another |the )?(?:second |2nd )?cook\b/],
  removeCook: [/\b(?:remove|delete) (?:the )?(?:cook )?(.+)$/],
  lockedBack: [/\btake me back\b/, /\bback to the cook\b/, /\bgo back to the cook\b/],
};

export const RECORDING_VOICE = {
  save: [/\bstop(?: and save| recording| reading)?\b/, /\bsave(?: it)?\b/, /\bdone reading\b/, /\bthat'?s it\b/],
  cancel: [/\bcancel\b/, /\bnever ?mind\b/, /\bdiscard\b/],
};

export const AVATAR_PICKER_VOICE = {
  confirm: [/\bthat'?s me\b/, /\bconfirm\b/, /\bthis one\b/, /\blooks good\b/, /\bsave\b/, /\bdone\b/, /\bclose\b/],
  random: [/\brandom\b/, /\bsurprise(?: me)?\b/, /\broll (?:the )?dice\b/],
  cancel: [/\bcancel\b/, /\bnever ?mind\b/, /\bgo back\b/],
  avatarName: (words) => [new RegExp(`\\b(${words.join("|")})\\b`)],
};

// --- help for everything above ------------------------------------------

function describedToggle(thing, article, toggle) {
  help(toggle.on, `This step needs ${article} ${thing}`, [`add ${article} ${thing}`, `with the ${thing}`]);
  help(toggle.off, `This step does not need ${article} ${thing}`, [`remove the ${thing}`, `without the ${thing}`]);
  return toggle;
}

// A generator's output gets described each time it is called.
const described = (make, say) => (...args) => {
  const phrases = make(...args);
  const [description, examples] = say(...args);
  return help(phrases, description, examples);
};

help(HOME_VOICE.addKitchen, "Add a kitchen profile", ["add a kitchen"]);
help(HOME_VOICE.resume, "Resume the cooking run in progress", ["resume"]);
help(HOME_VOICE.abandon, "Abandon the run in progress (asks for a spoken confirmation)", ["abandon the run"]);
help(HOME_VOICE.cancelPicker, "Close the kitchen picker", ["cancel"]);
help(HOME_VOICE.start, "Start a new cooking run", ["start the run"]);

help(CONVERSATION_VOICE.continueInventory, "Continue to the inventory", ["check the inventory"]);
help(CONVERSATION_VOICE.startOver, "Start the questions over, clearing every answer", ["start over"]);
help(CONVERSATION_VOICE.goHome, "Go back to the home page", ["go home"]);
help(CONVERSATION_VOICE.previousQuestion, "Go back to the previous question", ["go back to the last question"]);

help(INVENTORY_VOICE.addTask, "Add a task to the recipe board, optionally named and placed", ["add a task called rinse the rice before cook the rice"]);
help(INVENTORY_VOICE.showIngredients, "Show the ingredient checklist", ["show the ingredients"]);
help(INVENTORY_VOICE.showGraph, "Show the recipe graph", ["show the recipe graph"]);
help(INVENTORY_VOICE.restoreLast, "Put back the ingredient just marked out", ["put it back"]);
help(INVENTORY_VOICE.zoomIn, "Zoom the board in", ["zoom in"]);
help(INVENTORY_VOICE.zoomOut, "Zoom the board out", ["zoom out"]);
help(INVENTORY_VOICE.fit, "Fit the whole board on screen", ["fit the board"]);
help(INVENTORY_VOICE.panRight, "Scroll the board right", ["scroll right"]);
help(INVENTORY_VOICE.panLeft, "Scroll the board left", ["scroll left"]);
help(INVENTORY_VOICE.panVertical, "Scroll the board up or down", ["scroll down", "scroll up"]);
help(INVENTORY_VOICE.findStep, "Scroll to a step on the board, by its name", ["find the step boil the noodles"]);
help(INVENTORY_VOICE.editStep, "Open a step to edit it, by its name", ["edit the step boil the noodles"]);
help(INVENTORY_VOICE.removeBlocked, "Remove the steps blocked by missing ingredients", ["remove the blocked steps"]);
help(INVENTORY_VOICE.editKitchen, "Edit the kitchen profile", ["edit the kitchen"]);
help(INVENTORY_VOICE.cookAnyway, "Cook even though some ingredients are missing", ["cook it anyway"]);
help(INVENTORY_VOICE.revise, "Unlock the approved board to edit it again", ["revise"]);
help(INVENTORY_VOICE.approve, "Approve the board", ["approve"]);
help(INVENTORY_VOICE.continueOn, "Continue to the next stage", ["continue"]);

KITCHEN_PROFILE_VOICE.count = described(KITCHEN_PROFILE_VOICE.count, (field) => [`Set how many ${field} the kitchen has`, [`set ${field} to 4`]]);
KITCHEN_PROFILE_VOICE.increase = described(KITCHEN_PROFILE_VOICE.increase, (one) => [`One more ${one}`, [`add a ${one}`]]);
KITCHEN_PROFILE_VOICE.decrease = described(KITCHEN_PROFILE_VOICE.decrease, (one) => [`One fewer ${one}`, [`remove a ${one}`]]);
KITCHEN_PROFILE_VOICE.toggleOn = described(KITCHEN_PROFILE_VOICE.toggleOn, (thing) => [`The kitchen has a ${thing}`, [`${thing} on`]]);
KITCHEN_PROFILE_VOICE.toggleOff = described(KITCHEN_PROFILE_VOICE.toggleOff, (thing) => [`The kitchen has no ${thing}`, [`no ${thing}`]]);
help(KITCHEN_PROFILE_VOICE.name, "Name or rename the kitchen", ["call it flat 3 galley"]);
help(KITCHEN_PROFILE_VOICE.save, "Save the kitchen", ["save the kitchen"]);
help(KITCHEN_PROFILE_VOICE.cancel, "Close the form without saving", ["cancel"]);

ADD_STEP_VOICE.duration = described(ADD_STEP_VOICE.duration, () => ["Set how long the step takes, in minutes", ["make it 5 minutes"]]);
help(ADD_STEP_VOICE.name, "Name the new task", ["call it rinse the rice"]);
help(ADD_STEP_VOICE.difficulty, "Set the task's difficulty", ["difficulty medium"]);
help(ADD_STEP_VOICE.phase, "Set the task's phase", ["phase prep"]);
help(ADD_STEP_VOICE.after, "The task runs after another step, by name", ["runs after boil the noodles"]);
help(ADD_STEP_VOICE.before, "The task runs before another step, by name", ["runs before plate the bowls"]);
help(ADD_STEP_VOICE.submit, "Add the task to the board", ["add it to the board"]);
help(ADD_STEP_VOICE.cancel, "Close the form without adding", ["cancel"]);

help(EDIT_STEP_VOICE.name, "Rename the step", ["rename it rinse the rice"]);
help(EDIT_STEP_VOICE.stopWaiting, "The step no longer waits on another step, by name", ["stop waiting on boil the noodles"]);
help(EDIT_STEP_VOICE.delete, "Delete this step", ["delete this step"]);
help(EDIT_STEP_VOICE.save, "Save the step", ["save the step"]);
help(EDIT_STEP_VOICE.cancel, "Close the editor without saving", ["cancel"]);

help(DELETE_STEP_VOICE.inherit, "Steps that waited on it wait on what it waited on instead", ["inherit"]);
help(DELETE_STEP_VOICE.choose, "Choose for each waiting step", ["let me choose"]);
help(DELETE_STEP_VOICE.drop, "Just drop the links", ["drop the links"]);
help(DELETE_STEP_VOICE.confirm, "Remove the step", ["remove the step"]);
help(DELETE_STEP_VOICE.cancel, "Keep the step", ["keep it"]);

help(SCHEDULE_VOICE.cooperation, "Cook together, co-op mode", ["co-op"]);
help(SCHEDULE_VOICE.competition, "Cook against each other, versus mode", ["versus"]);
help(SCHEDULE_VOICE.live, "Start the live cook (asks first)", ["go live"]);
help(SCHEDULE_VOICE.backToCook, "Back to the cook in progress", ["back to the cook"]);
help(SCHEDULE_VOICE.abandon, "Abandon the cook (asks for a spoken confirmation)", ["abandon the cook"]);
help(SCHEDULE_VOICE.recipeGraph, "Back to the recipe graph", ["back to the recipe graph"]);
help(SCHEDULE_VOICE.editKitchen, "Edit the kitchen profile", ["edit the kitchen"]);
help(SCHEDULE_VOICE.fit, "Fit the whole timeline on screen", ["zoom to fit"]);
help(SCHEDULE_VOICE.zoomIn, "Zoom the timeline in", ["zoom in"]);
help(SCHEDULE_VOICE.zoomOut, "Zoom the timeline out", ["zoom out"]);
help(SCHEDULE_VOICE.closeDetails, "Close the step details", ["close the details"]);
help(SCHEDULE_VOICE.showDetails, "Show one step's details, by its name", ["show details for boil the noodles"]);
help(SCHEDULE_VOICE.freeTime, "When does each cook get a break", ["who's free"]);

help(VOICE_BINDING_VOICE.continueSchedule, "Move on to scheduling once every cook is set up", ["continue to scheduling"]);
VOICE_BINDING_VOICE.nameByOrdinal = described(VOICE_BINDING_VOICE.nameByOrdinal, () => [
  "Name or rename a cook, by position. Also how a misheard name is corrected.",
  ["call the first cook Zeina", "name the second cook Lindy"],
]);
VOICE_BINDING_VOICE.nameCook = described(VOICE_BINDING_VOICE.nameCook, () => ["Name or rename a cook, by position", ["cook 1 is Zeina"]]);
help(VOICE_BINDING_VOICE.nameSelf, "Give the next unnamed cook a name, said by that cook", ["I'm Zeina"]);
help(VOICE_BINDING_VOICE.chooseAvatar, "Open the chef picker for a cook", ["pick a chef for Zeina"]);
help(VOICE_BINDING_VOICE.randomAvatar, "Give a cook a random chef", ["surprise me"]);
help(VOICE_BINDING_VOICE.record, "Record a cook's voice so the goose can tell who is speaking", ["start recording for Zeina"]);
help(VOICE_BINDING_VOICE.addCook, "Add a second cook", ["add a second cook"]);
help(VOICE_BINDING_VOICE.removeCook, "Remove a cook and their recorded voice", ["remove the second cook"]);
help(VOICE_BINDING_VOICE.lockedBack, "Back to the cook in progress", ["back to the cook"]);

help(RECORDING_VOICE.save, "Save the line being read", ["stop and save"]);
help(RECORDING_VOICE.cancel, "Stop recording without saving", ["cancel"]);

help(AVATAR_PICKER_VOICE.confirm, "Keep the chef shown and close the picker", ["that's me"]);
help(AVATAR_PICKER_VOICE.random, "Pick a random chef", ["surprise me"]);
help(AVATAR_PICKER_VOICE.cancel, "Close the picker", ["cancel"]);
AVATAR_PICKER_VOICE.avatarName = described(AVATAR_PICKER_VOICE.avatarName, (words) => [
  "Pick a chef by its name or colour",
  words.slice(0, 4),
]);
