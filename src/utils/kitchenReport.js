// The three questions a cook with their back to the screen keeps asking:
// what can I take, where is everyone, and does anything on the stove need
// me. Each answer is a sentence written to be SPOKEN — no clock digits,
// no lists — because the whole point is that nobody is looking.
//
// The page answers these itself, before the agent's model gets a look in
// (see LiveCookPage's voice handler). A model can reply empty, be rate
// limited, or decide the question was room talk; a cook who asked "what's
// left?" with raw chicken on their hands should never get silence. The
// model has matching tools too, for the phrasings the patterns miss.
//
// Pure: no DOM, no React.
import { activeStepFor, passiveStepsFor, readyStepIds, unattendedPhaseNow } from "./liveCook.js";
import { unattendedEvents } from "./scheduleLayout.js";
import { isAttended } from "./tending.js";

// Names read out before "and N more". A fourth is where a spoken list
// stops being information and starts being a recital.
const MAX_NAMED = 3;

/** "about 3 minutes", "under a minute" — for the ear, not the eye. */
export function spokenDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 50) return "under a minute";
  const min = Math.round(s / 60);
  if (min < 60) return `about ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `about ${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minutes` : ""}`;
}

function listOut(labels) {
  const named = labels.slice(0, MAX_NAMED);
  const rest = labels.length - named.length;
  const joined = named.length <= 1 ? named.join("") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return rest > 0 ? `${joined}, plus ${rest} more` : joined;
}

// Same arithmetic as unattendedPhaseNow: paused time is not cooking time.
function elapsedSec(record, now) {
  if (!record?.startedAt) return 0;
  return Math.round((now - Date.parse(record.startedAt)) / 1000) - (record.pausedSec || 0);
}

const nodeList = (nodes) => (Array.isArray(nodes) ? nodes : Object.values(nodes || {}));

/** Pending, ready, and nobody's name on it: what anyone could take now. */
export function openStepIds(nodes, run) {
  return readyStepIds(nodeList(nodes), run).filter((id) => !run.steps[id]?.cookId);
}

/**
 * "What's available?" — the steps anyone could take right now, or, when
 * there are none, why not and what opens up next.
 */
export function availableLine({ nodes, run }) {
  const list = nodeList(nodes);
  const byId = Object.fromEntries(list.map((n) => [n.id, n]));
  const open = openStepIds(list, run);
  if (open.length) {
    return `Up for grabs: ${listOut(open.map((id) => byId[id].label))}.`;
  }
  const remaining = list.filter((n) => run.steps[n.id]?.status === "pending");
  const active = list.filter((n) => run.steps[n.id]?.status === "active");
  if (!remaining.length) {
    return active.length ? "Nothing left to take — everything's under way." : "That's everything. Dinner's up.";
  }
  // Nothing free: say what is holding it up, so "wait for the beef"
  // is an answer rather than a shrug.
  const waitingOnActive = remaining.find((n) =>
    (n.depends_on || []).every((d) => ["done", "skipped", "active"].includes(run.steps[d]?.status)),
  );
  if (waitingOnActive) {
    const blockers = (waitingOnActive.depends_on || []).filter((d) => run.steps[d]?.status === "active").map((d) => byId[d]?.label).filter(Boolean);
    return `Nothing's free right now. ${waitingOnActive.label} opens up once ${listOut(blockers)} ${blockers.length > 1 ? "are" : "is"} done.`;
  }
  return "Nothing's free right now — the next steps are waiting on the ones in progress.";
}

/**
 * "Where is everyone?" — what each cook has their hands on, what they
 * have cooking on its own, and how far the whole cook has got.
 */
export function whereLine({ nodes, run, cooks, now = Date.now() }) {
  const list = nodeList(nodes);
  const byId = Object.fromEntries(list.map((n) => [n.id, n]));
  const parts = cooks.map((c) => {
    const busy = activeStepFor(c.id, run, list, now);
    const cooking = passiveStepsFor(c.id, run, list).filter((id) => id !== busy).map((id) => byId[id]?.label).filter(Boolean);
    const onIt = busy ? `${c.name} is on ${byId[busy].label}, ${spokenDuration(elapsedSec(run.steps[busy], now))} in` : `${c.name} is free`;
    return cooking.length ? `${onIt}, with ${listOut(cooking)} cooking` : onIt;
  });
  const done = list.filter((n) => ["done", "skipped"].includes(run.steps[n.id]?.status)).length;
  return `${parts.join(". ")}. ${done} of ${list.length} done.`;
}

/**
 * Every running hands-off step with what it needs and when, soonest first.
 * [{ stepId, label, cook, dueNow, kind, inSec }]
 *   dueNow  a check or the finish is happening now
 *   kind    "checkpoint" | "ending" | "initial" | "ready"
 *   inSec   seconds until that moment (0 when due now)
 */
export function checkups({ nodes, run, cooks, now = Date.now() }) {
  const list = nodeList(nodes);
  const nameOf = (id) => cooks.find((c) => c.id === id)?.name ?? "someone";
  return list
    .filter((n) => !isAttended(n) && run.steps[n.id]?.status === "active")
    .map((n) => {
      const record = run.steps[n.id];
      const { phase } = unattendedPhaseNow(n, record, now);
      const elapsed = elapsedSec(record, now);
      const base = { stepId: n.id, label: n.label, cook: nameOf(record.cookId) };
      if (phase === "checkpoint" || phase === "ending" || phase === "initial") {
        return { ...base, dueNow: true, kind: phase, inSec: 0 };
      }
      const next = unattendedEvents(n, 0).find((m) => m.atSec > elapsed && m.kind !== "initial");
      if (next) return { ...base, dueNow: false, kind: next.kind, inSec: next.atSec - elapsed };
      return { ...base, dueNow: false, kind: "ready", inSec: Math.max(0, (n.estimated_duration_sec || 0) - elapsed) };
    })
    .sort((a, b) => Number(b.dueNow) - Number(a.dueNow) || a.inSec - b.inSec);
}

/** "Does anything need checking?" */
export function checkupLine(ctx) {
  const items = checkups(ctx);
  if (!items.length) return "Nothing's cooking on its own right now.";
  const said = items.slice(0, MAX_NAMED).map((c) => {
    if (c.dueNow) {
      if (c.kind === "ending") return `${c.cook}, ${c.label} needs finishing now`;
      if (c.kind === "initial") return `${c.cook} is still getting ${c.label} going`;
      return `${c.cook}, check on ${c.label} now`;
    }
    if (c.kind === "checkpoint") return `${c.label}: next check in ${spokenDuration(c.inSec)}`;
    if (c.kind === "ending") return `${c.label}: comes off in ${spokenDuration(c.inSec)}`;
    return `${c.label}: nothing to do, ready in ${spokenDuration(c.inSec)}`;
  });
  const lead = items.some((c) => c.dueNow) ? "" : "Nothing needs you yet. ";
  return `${lead}${said.join(". ")}.`;
}

// Something they want done, not asked about. "I'm done, what's next?"
// is a done first; the agent path owns that, and has these same answers
// as tools for the question half.
const ACTION = /\b(?:i'?m done|we'?re done|done with|i(?:'ve| have) (?:done|finished)|finished|i'?ll (?:take|do|start|grab|get)|let me (?:take|do|start)|skip|drop|undo|pause|resume)\b|我来|做好了|暂停|继续/;

// Question-shaped on purpose. The goose's own answers ("Up for grabs:
// …", "Nothing's cooking on its own right now") must never match if the
// microphone picks them back up, or it would answer itself.
const QUESTIONS = [
  {
    kind: "checkup",
    patterns: [
      /\b(?:any(?:thing)?|does anything|is anything|what) (?:that )?(?:needs?|need to be|to) (?:a )?(?:check|checking|checked|looking at|attention|stirring)\b/,
      /\b(?:any(?:thing)?|what'?s|what is|is (?:anything|something)) (?:cooking|going|running) on its own\b/,
      /\b(?:any|what) (?:unattended|hands[- ]off) (?:steps?|tasks?|things?)\b/,
      /\b(?:should|do|can) (?:i|we) (?:check|stir|look at)\b/,
      /\bwhat'?s (?:cooking|on the (?:stove|heat|go))\b/,
      /\bcheck ?-?ups?\b.*\?|\bany check ?-?ups?\b/,
      /需要看|要检查|要不要看|该看一下/,
    ],
  },
  {
    kind: "available",
    patterns: [
      /\bwhat(?:'s| is| are)? (?:steps? |tasks? |things? )?(?:are )?(?:available|up for grabs|left|open|free)\b/,
      /\b(?:any(?:thing)?|are there any) (?:steps? |tasks? )?(?:available|free|open|left|up for grabs)\b/,
      /\bwhat (?:can|could|should) (?:i|we) (?:do|take|grab|start|work on)\b/,
      /\bwhat(?:'s| is) next\b/,
      /\bwhich (?:steps?|tasks?) (?:can|could) (?:i|we)\b/,
      /还有什么|能做什么|有什么可以|接下来做什么/,
    ],
  },
  {
    kind: "where",
    patterns: [
      /\bwhere (?:are|is) (?:we|everyone|everybody|they|things|it at)\b/,
      /\bwho(?:'s| is) (?:doing|on) what\b/,
      /\bwhat(?:'s| is) (?:everyone|everybody|each of us) (?:doing|on)\b/,
      /\bhow (?:far|are we doing|far along)\b/,
      /\b(?:status|progress)(?: (?:update|check|report))?\b/,
      /到哪了|进度|大家在做什么/,
    ],
  },
];

/**
 * "available" | "where" | "checkup" | null for a turn that is only one of
 * those questions. Checkup first: "is anything left cooking?" is about
 * the stove, not the pool.
 */
export function matchKitchenQuestion(text) {
  const t = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'");
  if (!t.trim() || ACTION.test(t)) return null;
  return QUESTIONS.find(({ patterns }) => patterns.some((p) => p.test(t)))?.kind ?? null;
}

/** The spoken answer for a kind matchKitchenQuestion returned. */
export function kitchenAnswer(kind, ctx) {
  if (kind === "available") return availableLine(ctx);
  if (kind === "checkup") return checkupLine(ctx);
  if (kind === "where") return whereLine(ctx);
  return null;
}

/**
 * What finishing something just opened up, for versus: nobody is dealt
 * a ticket there, so with their backs to the screen the only way a cook
 * learns there is something new to race for is being told. "" when
 * nothing new opened.
 */
export function newlyOpenLine(nodes, before, after) {
  const list = nodeList(nodes);
  const byId = Object.fromEntries(list.map((n) => [n.id, n]));
  const was = new Set(openStepIds(list, before));
  const fresh = openStepIds(list, after).filter((id) => !was.has(id));
  return fresh.length ? `Now up for grabs: ${listOut(fresh.map((id) => byId[id].label))}.` : "";
}
