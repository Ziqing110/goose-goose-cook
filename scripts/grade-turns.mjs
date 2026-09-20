// Replay a saved run through the live cook's gates and say what would
// have happened. No network, no key, no model — this reads the JSONL that
// scripts/replay-audio.mjs wrote and applies, in order, the three checks
// that stand between a finalized turn and an action:
//
//   1. the word-confidence floor (MIN_VOICE_CONFIDENCE)
//   2. the name-only carry, which holds the door open for the rest of a
//      sentence the recogniser split after the name
//   3. the addressing gate
//
// The point is to be able to change one of those and re-measure against
// real kitchen audio in a second, instead of re-recording or re-billing.
//
// With --steps it goes one further and resolves each acted-on turn against
// the seeded Mapo Tofu board, so "which step did it think you meant" is
// answerable from the same recordings. That is the keyword grammar, which
// is also what the app falls back to when the model is slow or down.
//
//   node scripts/grade-turns.mjs runs/*.appcfg.jsonl
//   node scripts/grade-turns.mjs runs/*.appcfg.jsonl --steps
//   node scripts/grade-turns.mjs runs/*.jsonl --no-carry   (what it did before)
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { isAddressed, isNameOnlyTurn } from "../src/utils/addressing.js";
import { parseCommand } from "../src/utils/voiceCommands.js";

// Kept in step with LiveCookPage by hand. They are two numbers; a shared
// module for them would be more ceremony than the coupling is worth.
const MIN_VOICE_CONFIDENCE = 0.4;
const NAME_CARRY_MS = 5_000;
const AGENT_NAME = "Goose";

// The seeded Mapo Tofu board, as the live cook would hold it: nothing
// started, so every step is claimable and none is anyone's current one.
// Matching a spoken name against this list is the whole question.
const BOARD = [
  { id: "tofu_cut", label: "Cut tofu into cubes" },
  { id: "mince_garlic", label: "Mince garlic" },
  { id: "aromatics_mince_other", label: "Mince ginger & scallion" },
  { id: "sauce_mix", label: "Mix sauce & slurry" },
  { id: "tofu_blanch", label: "Blanch tofu" },
  { id: "aromatics_saute", label: "Brown pork, then fry doubanjiang & aromatics" },
  { id: "simmer_combine", label: "Combine & simmer" },
  { id: "thicken_garnish", label: "Thicken & garnish" },
  { id: "plate_serve", label: "Plate & serve" },
];
const BY_ID = Object.fromEntries(BOARD.map((n) => [n.id, n]));
const ALL = BOARD.map((n) => n.id);

const argv = process.argv.slice(2);
const carry = !argv.includes("--no-carry");
const withSteps = argv.includes("--steps");
const files = argv.filter((a) => !a.startsWith("--"));

if (!files.length) {
  console.error("usage: node scripts/grade-turns.mjs runs/*.jsonl [--no-carry]");
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}`;

let totalHeard = 0;
let totalActed = 0;
let totalEmpty = 0;

for (const file of files) {
  const finals = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((m) => m.type === "Turn" && m.end_of_turn && (m.transcript || "").trim());

  console.log(`\n${basename(file)}`);
  let openUntil = 0;
  let heard = 0;
  let acted = 0;
  let empty = 0;

  for (const msg of finals) {
    const text = msg.transcript.trim();
    const at = msg.at ?? 0;
    heard += 1;

    const lowest = (msg.words || []).reduce((min, w) => Math.min(min, w.confidence ?? 1), 1);
    if (lowest < MIN_VOICE_CONFIDENCE) {
      console.log(`  ${clock(at)}  drop  ${text}   (confidence ${lowest.toFixed(2)})`);
      continue;
    }

    if (carry && isNameOnlyTurn(text, AGENT_NAME)) {
      openUntil = at + NAME_CARRY_MS;
      console.log(`  ${clock(at)}  wait  ${text}   (name only — holding for the rest)`);
      continue;
    }

    const engaged = at < openUntil;
    if (engaged) openUntil = 0; // one carried turn per name, then it closes
    if (isAddressed(text, AGENT_NAME, engaged)) {
      // A turn that is only the name asks for nothing. Without the carry
      // it still counts as "addressed" and still costs a model call, so
      // it is scored separately — otherwise the totals hide the fix.
      if (isNameOnlyTurn(text, AGENT_NAME)) {
        empty += 1;
        console.log(`  ${clock(at)}  ACT?  ${text}   (nothing asked — a wasted call)`);
      } else {
        acted += 1;
        console.log(`  ${clock(at)}  ACT ${engaged ? "*" : " "} ${text}`);
        if (withSteps) {
          const r = parseCommand(text, { byId: BY_ID, activeStepId: null, claimable: ALL, ownQueue: ALL, agentName: AGENT_NAME });
          const target = r.stepId ? `${BY_ID[r.stepId].label} (${r.confidence})` : r.candidates.length
            ? `unsure between ${r.candidates.map((id) => BY_ID[id].label).join(" / ")}`
            : "no step";
          console.log(`              -> ${r.intent}: ${target}`);
        }
      }
    } else {
      console.log(`  ${clock(at)}  --    ${text}`);
    }
  }

  console.log(`  ${acted}/${heard} acted on${empty ? `, ${empty} wasted on a bare name` : ""}`);
  totalHeard += heard;
  totalActed += acted;
  totalEmpty += empty;
}

console.log(
  `\n${totalActed}/${totalHeard} turns acted on across ${files.length} scene(s)` +
    (totalEmpty ? `, plus ${totalEmpty} model calls spent on a bare name` : ""),
);
console.log(carry ? "(with the name-only carry)" : "(--no-carry: the behaviour before the fix)");
console.log("* = heard only because a name-only turn held the door open");
