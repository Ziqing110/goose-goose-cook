// English page-command phrases shared by the React handlers and transcript
// tests. Keep matching grammar here so tests exercise the patterns the app uses.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
};

export const INVENTORY_VOICE = {
  everythingOnHand: [
    /\beverything(?:'s| is)? on hand\b/,
    /\bmark everything on hand\b/,
    /\ball on hand\b/,
  ],
  addTask: [/\badd (?:a |another )?task\b(.*)$/, /\badd (?:a |another )?step\b(.*)$/],
  showIngredients: [
    /\bshow (?:me )?(?:the )?ingredients\b/,
    /\bingredients tab\b/,
    /\bgo to (?:the )?ingredients\b/,
  ],
  showGraph: [
    /\bshow (?:me )?(?:the )?(?:recipe graph|board)\b/,
    /\brecipe graph\b/,
    /\bgo to (?:the )?(?:recipe graph|board)\b/,
  ],
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

export function ingredientVoicePhrases(name) {
  const escaped = escapeRe(name);
  return {
    out: [
      new RegExp(`\\bno (?:more )?${escaped}\\b`),
      new RegExp(`\\bout of ${escaped}\\b`),
      new RegExp(`\\b${escaped} is out\\b`),
      new RegExp(`\\b(?:don't|dont) have (?:any )?${escaped}\\b`),
      new RegExp(`\\bmark ${escaped} out\\b`),
    ],
    onHand: [
      new RegExp(`\\bgot (?:the |some )?${escaped}\\b`),
      new RegExp(`\\bhave (?:the |some )?${escaped}\\b`),
      new RegExp(`\\bfound (?:the |some )?${escaped}\\b`),
      new RegExp(`\\b${escaped} is (?:back|on hand)\\b`),
      new RegExp(`\\bmark ${escaped} on hand\\b`),
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

const equipmentToggle = (thing, article) => ({
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
