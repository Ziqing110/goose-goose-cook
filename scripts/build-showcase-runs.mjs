// Builds the two example runs pinned to Home (src/data/exampleRuns.json,
// and the rows Home lists them by, src/data/exampleRunRows.json).
//
//   node scripts/build-showcase-runs.mjs
//
// Each one goes through the app's own pipeline, the same calls the pages
// make: template -> recipe instance -> schedule -> createRun -> a cook
// replayed tick by tick through arbitrateClaim / applyStart / applyDone
// (so the kitchen's burners, boards and pots are enforced exactly as they
// are live) -> endRun -> buildSummary. Nothing is written to the database.
//
// Deterministic: ids and clocks are seeded, so a rerun writes the same
// file. The one exception is the story on the cook card, which a model
// writes; it is asked for once (POST /api/agent/narrate on a running
// `npm run server`) and kept from the existing file after that. Pass
// --restory to ask again.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/data/exampleRuns.json");
const ROWS_OUT = path.join(ROOT, "src/data/exampleRunRows.json");
const API = process.env.SHOWCASE_API || "http://127.0.0.1:3001/api";
const TICK_SEC = 5;

// --- a seeded clock and seeded ids, installed before the app code runs ---

const RealDate = Date;
let clockMs = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [clockMs]));
  }
  static now() {
    return clockMs;
  }
};

let rand = () => 0;
function seed(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  // mulberry32
  rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
globalThis.crypto.randomUUID = uuid;

const { buildNamespacedGraph, toRecipeInstance } = await import("../src/utils/recipeInstances.js");
const { extractSharedSteps, cloneGraph, mergeRecipesForDisplay } = await import("../src/utils/graphLayout.js");
const { computeSchedule, computeOpeningAssignment } = await import("../src/utils/scheduleLayout.js");
const live = await import("../src/utils/liveCook.js");
const { buildSummary } = await import("../src/utils/summaryCard.js");
const { runTimeline } = await import("../src/utils/cookTimeline.js");
const { ELICITATION_QUESTIONS } = await import("../src/data/dishes.js");
const { isOneShot } = await import("../src/utils/tending.js");

// --- inputs ---

// Both examples cook in the same kitchen: two burners, two boards, two pots.
const KITCHEN = {
  id: "example-kitchen",
  name: "2 burners, 2 boards, 2 pots",
  burners: 2,
  cuttingBoards: 2,
  pots: 2,
  hasWok: true,
  hasOven: true,
};

// No template cooks rice, so the rice is written here the way a generated
// recipe would carry it: rinse, a lidded pot left alone, fluff to serve.
const RICE = {
  id: "steamed-rice-none",
  title: "Steamed Rice",
  dish_idea_raw: "rice",
  diet: "none",
  servings_default: 2,
  nodes: [
    {
      id: "rice_rinse",
      label: "Rinse the rice",
      description: "Rinse 1 cup of jasmine rice in a bowl until the water runs almost clear, then drain.",
      estimated_duration_sec: 120,
      difficulty: "low",
      required_equipment: [],
      required_materials: ["rice"],
      material_usage: { rice: { amount: 1, unit: "cups" } },
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "rice_cook",
      label: "Cook the rice in a lidded pot",
      description: "Rice and 1¼ cups water in a pot. Boil, then lid on, lowest heat for 15 minutes. Leave it alone.",
      estimated_duration_sec: 960,
      difficulty: "low",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: ["rice_rinse"],
      status: "pending",
      phase: "cook",
      tending: "set_and_forget",
      unattended: { initial: { duration_sec: 60, difficulty: "low" }, checkpoints: null, ending: null },
    },
    {
      id: "rice_fluff",
      label: "Fluff the rice & serve",
      description: "Fluff with a fork and spoon into two bowls.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: [],
      required_materials: [],
      depends_on: ["rice_cook"],
      status: "pending",
      phase: "plate",
      is_end_step: true,
    },
  ],
};

const CASES = [
  {
    id: "example-coop-chicken-noodle-soup",
    mode: "cooperation",
    startedAt: "2026-09-27T10:30:00.000Z",
    templates: ["chicken-noodle-soup-none"],
    said: ["Chicken noodle soup", "Just the two of us", "No restrictions", "Normal detail, please", "An hour"],
    answers: { dishIdea: ["chicken noodle soup"], servings: "2", diet: "none", skill: "regular", targetTime: "60" },
    display: ["Chicken noodle soup", "2 servings", "No restrictions", "Normal detail", "1 hour"],
    cooks: [
      { name: "Mia", avatar: "spoon" },
      { name: "Leo", avatar: "whisk" },
    ],
    // How quickly each cook works against the estimate, and how long they
    // take to pick up the next thing.
    pace: { low: 0.72, spread: 0.26, gapMax: 14 },
    // [cook index, when, words]. "start:veg_chop+8" is 8 seconds after
    // that step started; a line that started or finished a step marks it
    // as done by voice.
    lines: [
      [0, "start:chicken_trim", "Goose, I'm on the chicken"],
      [1, "start:veg_chop", "Goose, I'll do the onion, carrot and celery"],
      [1, "done:veg_chop+12", "Two boards, zero fights over the knife. Best teamwork ever!"],
      [0, "done:shred_chicken", "Goose, done with the shredding"],
      [0, "start:cook_noodles+95", "The whole kitchen smells like a sick day, in the best possible way!"],
      [1, "done:plate_serve", "Goose, soup's in the bowls"],
    ],
  },
  {
    id: "example-versus-mapo-tofu-rice",
    mode: "competition",
    startedAt: "2026-09-26T11:00:00.000Z",
    templates: ["mapo-tofu-none", RICE],
    said: ["Mapo tofu and rice", "Two", "No restrictions", "Just the essentials", "An hour"],
    answers: { dishIdea: ["mapo tofu", "rice"], servings: "2", diet: "none", skill: "confident", targetTime: "60" },
    display: ["Mapo tofu + Rice", "2 servings", "No restrictions", "Just the essentials", "1 hour"],
    cooks: [
      { name: "Avery", avatar: "tomato" },
      { name: "Kai", avatar: "flip" },
    ],
    pace: { low: 0.8, spread: 0.45, gapMax: 22 },
    lines: [
      [1, "start:mince_garlic", "Goose, mine, the garlic"],
      [0, "start:boil_water", "Goose, I'll get the water going"],
      [1, "start:rice_rinse", "Take the rice"],
      [1, "done:tofu_blanch+6", "Rice is on, tofu's blanched, no way I'm losing this!"],
      [0, "start:aromatics_saute+70", "The doubanjiang is popping everywhere and I'm not even scared!"],
      [0, "done:thicken_garnish", "Goose, done, look at that gloss"],
      [1, "done:rice_fluff", "Goose, rice is in the bowls"],
    ],
  },
];

// --- the cook, replayed ---

function unit(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// How long a step actually takes. Pots take what they take; hands vary.
function actualSec(c, node) {
  const est = node.estimated_duration_sec || 60;
  if (node.unattended) return Math.round(est * (0.97 + unit(`${c.id}:${node.id}`) * 0.08));
  return Math.round(est * (c.pace.low + unit(`${c.id}:${node.id}`) * c.pace.spread));
}

function replay(c, nodes, cooks, startMs) {
  const at = (sec) => new RealDate(startMs + sec * 1000).toISOString();
  const schedule = computeSchedule(nodes, cooks, KITCHEN);
  const opening = computeOpeningAssignment(nodes, cooks, KITCHEN);
  clockMs = startMs;
  let run = live.createRun({ nodes, mode: c.mode, schedule, opening, now: new RealDate(startMs) });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const endsAt = {};
  const lookUpAt = Object.fromEntries(cooks.map((k) => [k.id, 0]));
  const open = () => nodes.some((n) => ["pending", "active"].includes(run.steps[n.id].status));

  let t = 0;
  let last = 0;
  while (open()) {
    if (t > 4 * 3600) throw new Error(`${c.id}: the cook never finished`);
    clockMs = startMs + t * 1000;
    // Everything whose time is up, in the order it came up. A pot left
    // alone (set and forget) finishes itself, as the live page does.
    Object.entries(endsAt)
      .filter(([id, end]) => end <= t && run.steps[id].status === "active")
      .sort((a, b) => a[1] - b[1])
      .forEach(([id, end]) => {
        const holder = run.steps[id].cookId;
        const auto = isOneShot(byId[id]);
        const source = auto ? "auto" : unit(`${c.id}:done:${id}`) < 0.55 ? "voice" : "tap";
        run = live.applyDone({ run, stepId: id, cookId: holder, at: at(end), source });
        if (!auto) lookUpAt[holder] = Math.max(lookUpAt[holder], end + Math.round(4 + unit(`${c.id}:gap:${id}`) * c.pace.gapMax));
        last = Math.max(last, end);
      });
    // Whoever is free takes what the app offers them.
    const order = t % (2 * TICK_SEC) === 0 ? cooks : [...cooks].reverse();
    for (const cook of order) {
      if (t < lookUpAt[cook.id]) continue;
      if (live.activeStepFor(cook.id, run, nodes, clockMs)) continue;
      const offered =
        c.mode === "cooperation"
          ? [live.resolveAssignments({ nodes, run, cooks, now: clockMs }).byCook[cook.id]]
              .filter((a) => a && ["assigned", "idle_fill"].includes(a.reason))
              .map((a) => a.stepId)
          : live.claimSuggestions({ nodes, run, cookId: cook.id, limit: nodes.length });
      for (const stepId of offered) {
        const verdict = live.arbitrateClaim({ run, nodes, cooks, stepId, cookId: cook.id, at: at(t), kitchenProfile: KITCHEN });
        if (!verdict.ok) continue;
        run = live.applyStart({ run, stepId, cookId: cook.id, at: at(t), source: unit(`${c.id}:src:${stepId}`) < 0.6 ? "voice" : "tap" });
        endsAt[stepId] = t + (isOneShot(byId[stepId]) ? byId[stepId].estimated_duration_sec : actualSec(c, byId[stepId]));
        break;
      }
    }
    t += TICK_SEC;
  }

  // What they said, woven in where it was said. A line that started or
  // finished a step is what did it, so that step went by voice.
  let said = run;
  const stepOf = (key) => nodes.find((n) => n.id.endsWith(`::${key}`))?.id;
  c.lines.forEach(([who, when, text]) => {
    const [, type, key, plus] = when.match(/^(start|done):(\w+)(?:\+(\d+))?$/) || [];
    const stepId = stepOf(key);
    const event = said.events.find((e) => e.type === type && e.stepId === stepId);
    if (!event) throw new Error(`${c.id}: no ${type} for ${key}`);
    if (!plus) {
      said = {
        ...said,
        events: said.events.map((e) => (e === event ? { ...e, source: "voice" } : e)),
        steps: type === "start" ? { ...said.steps, [stepId]: { ...said.steps[stepId], source: "voice" } } : said.steps,
      };
    }
    const sec = (RealDate.parse(event.at) - startMs) / 1000 + Number(plus || 0);
    said = live.appendTranscript(said, { at: at(sec), speaker: cooks[who].id, text, via: "voice" });
  });
  said = { ...said, transcript: [...said.transcript].sort((a, b) => a.at.localeCompare(b.at)) };
  clockMs = startMs + last * 1000;
  return live.endRun({ run: said, nodes, at: at(last) });
}

async function narrate(record) {
  try {
    const res = await fetch(`${API}/agent/narrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "Goose", record }),
    });
    if (!res.ok) return "";
    return (await res.json()).story || "";
  } catch {
    return "";
  }
}

// --- build ---

const db = new Database(path.join(ROOT, "server/data.sqlite"), { readonly: true });
const template = (id) => {
  const row = db.prepare("SELECT * FROM recipe_templates WHERE id = ?").get(id);
  if (!row) throw new Error(`no template ${id}`);
  return { ...row, nodes: JSON.parse(row.nodes_json) };
};

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const restory = process.argv.includes("--restory");
const sessions = [];

for (const c of CASES) {
  seed(c.id);
  const startMs = RealDate.parse(c.startedAt);
  // Planning happened before the cook: the conversation, then the plan.
  clockMs = startMs - 25 * 60 * 1000;

  const transcript = [];
  const understanding = {};
  ELICITATION_QUESTIONS.forEach((q, i) => {
    transcript.push({ speaker: "agent", text: q.agentText });
    transcript.push({ speaker: "cook", text: c.said[i] });
    understanding[q.id] = { value: c.answers[q.id], display: c.display[i], status: "confirmed" };
  });
  transcript.push({ speaker: "agent", text: "Got it — drafting your recipe graph now." });

  const graphs = c.templates.map((t) => buildNamespacedGraph(typeof t === "string" ? template(t) : t, c.answers, uuid()));
  const { recipes: split, sharedSteps: shared } = extractSharedSteps(graphs);
  const recipes = split.map((graph) => {
    const recipe = toRecipeInstance(graph);
    return { ...recipe, approved: cloneGraph(recipe.working) };
  });
  const sharedSteps = shared.map((node) => ({ id: node.id, draft: node, working: cloneGraph(node), approved: cloneGraph(node) }));
  const cooks = c.cooks.map((k) => ({ id: uuid(), name: k.name, bound: true, avatar: k.avatar }));

  const approved = mergeRecipesForDisplay(recipes, sharedSteps).approved;
  const nodes = approved.nodes;
  const run = replay(c, nodes, cooks, startMs);

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const dishOf = (n) => {
    if (!n) return null;
    if (n._shared) return "Shared step";
    return recipes.find((r) => r.id === n._recipeId)?.approved?.title || null;
  };
  const summary = buildSummary({
    outcome: live.runOutcome(run, nodes, cooks),
    cooks,
    dish: approved.title,
    mode: run.mode,
    dishOfStep: (s) => dishOf(byId[s.id]),
    transcript: run.transcript,
  });

  const session = {
    id: c.id,
    example: true,
    kitchenProfileId: null,
    kitchenProfileName: KITCHEN.name,
    kitchenProfile: KITCHEN,
    status: "completed",
    startedAt: new RealDate(startMs - 25 * 60 * 1000).toISOString(),
    endedAt: run.endedAt,
    conversation: { complete: true, transcript, answers: c.answers, understanding, questionIndex: ELICITATION_QUESTIONS.length },
    selectedNodeId: null,
    cooks,
    mode: c.mode,
    run,
    outMaterialIds: [],
    nodePositions: {},
    summary,
    recipes,
    sharedSteps,
  };

  const kept = previous.find((p) => p.id === c.id)?.summary?.story;
  if (kept && !restory) {
    summary.story = kept;
  } else {
    const timeline = runTimeline(run, nodes, cooks).filter((k) => k.actions.length);
    summary.story = await narrate({ dish: summary.dish, mode: summary.mode, totalSec: summary.totalSec, estimatedSec: summary.estimatedSec, cooks: timeline });
  }
  sessions.push(session);

  const board = summary.cooks.map((k) => `${k.name} ${k.points}pts/${k.doneCount} steps`).join(", ");
  console.log(`${c.id}: ${nodes.length} steps, ${Math.round(summary.totalSec / 60)} min (plan ${Math.round((summary.estimatedSec || 0) / 60)}), ${board}`);
  console.log(`  headline: ${summary.headline}`);
  console.log(`  quotes: ${summary.cooks.map((k) => `${k.name}: ${k.quote ?? "(quips) " + k.quips.join(" / ")}`).join(" | ")}`);
  console.log(`  story: ${summary.story || "(none)"}`);
}

// Home only lists them, so it gets the compact row the server's
// ?view=list returns (plus the cook's clock) and never loads the rest
// until a card is opened.
const rows = sessions.map((s) => ({
  id: s.id,
  example: true,
  kitchenProfileId: null,
  kitchenProfileName: s.kitchenProfileName,
  status: s.status,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  dish: s.summary.dish,
  servings: s.recipes[0].working.servings,
  hasSummary: true,
  run: { startedAt: s.run.startedAt, endedAt: s.run.endedAt },
}));

writeFileSync(OUT, `${JSON.stringify(sessions, null, 2)}\n`);
writeFileSync(ROWS_OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, ROWS_OUT)}`);
