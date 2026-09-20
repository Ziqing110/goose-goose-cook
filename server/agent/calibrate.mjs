// Calibration for the live-cook agent: run a table of things a cook might
// say through the real gateway path and score what comes back.
//
//   npm run agent:calibrate                        # AAI_AGENT_MODEL
//   npm run agent:calibrate -- --models a,b,c      # compare models
//   npm run agent:calibrate -- --repeat 3          # models are not deterministic
//   npm run agent:calibrate -- --only two-action   # id substring filter
//
// Each case names the calls it expects, order aside. `step` may be a list
// of acceptable ids; null in the list means "no step given, the client
// falls back to the speaker's current one", which is only listed where
// that current step is the expected one. `orClarify` also accepts making
// no call and asking a question, for requests a person would ask about.
import { requestTurn } from "./gateway.js";

const AGENT = "Goose";
const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const models = (arg("models", process.env.AAI_AGENT_MODEL || "gemini-2.5-flash-lite")).split(",");
const repeat = Number(arg("repeat", 1));
const only = arg("only", "");

// Lindy is speaking; Zeina holds the rice; Lindy holds the yellow onion.
const KITCHEN = {
  speakerName: "Lindy",
  mode: "coop",
  paused: false,
  cooks: [{ name: "Lindy" }, { name: "Zeina" }],
  steps: [
    { id: "s1", label: "Chop the garlic", status: "pending", ready: true, holder: null },
    { id: "s2", label: "Boil the rice", status: "active", ready: true, holder: "Zeina" },
    { id: "s3", label: "Cut the yellow onion", status: "active", ready: true, holder: "Lindy" },
    { id: "s4", label: "Cut the red onion", status: "pending", ready: true, holder: null },
    { id: "s5", label: "Plate up", status: "pending", ready: false, holder: null },
  ],
  history: [],
};

const call = (name, step) => ({ name, step });

const CASES = [
  // Single actions, said the way people say them.
  { id: "done-named", say: "Goose I'm done with the onion", calls: [call("done", [null, "s3"])] },
  { id: "done-bare", say: "Goose done", calls: [call("done", [null, "s3"])] },
  { id: "claim-loose", say: "Goose I'll take the garlic", calls: [call("claim", ["s1"])] },
  { id: "claim-by-meaning", say: "Goose I'll do the chopping one", calls: [call("claim", ["s1"])] },
  { id: "claim-only-candidate", say: "Goose take the onion", calls: [call("claim", ["s4"])], orClarify: true },
  { id: "skip", say: "Goose skip the garlic", calls: [call("skip", ["s1"])] },
  { id: "drop", say: "Goose give the onion back", calls: [call("drop", [null, "s3"])] },
  { id: "undo", say: "Goose undo that", calls: [call("undo")] },
  { id: "pause", say: "Goose pause", calls: [call("pause")] },
  { id: "status", say: "Goose what's next", calls: [call("status")] },
  { id: "score", say: "Goose who's winning", calls: [call("score")] },
  { id: "finish-run", say: "Goose we're all done, dinner's up", calls: [call("finish_run")] },
  { id: "finish-step-not-run", say: "Goose I'm finished with the onion", calls: [call("done", [null, "s3"])] },

  // The known miss: two actions in one breath.
  { id: "two-action", say: "Goose done with the onion and pause everything", calls: [call("done", [null, "s3"]), call("pause")] },
  { id: "two-claims", say: "Goose take the garlic and the red onion", calls: [call("claim", ["s1"]), call("claim", ["s4"])] },

  // Garbled name still lands; a wrong step must not.
  { id: "misheard-name", say: "Goos done with the onion", calls: [call("done", [null, "s3"])] },
  { id: "invented-step", say: "Goose start the soup", calls: [], reply: true },

  // Not for the agent, or not a command.
  { id: "no-name", say: "I'm done with this wine", addressed: false, calls: [] },
  { id: "to-someone-else", say: "Goose hold on, Zeina pass me the salt", calls: [] },
  { id: "off-topic", say: "Goose what's the weather", calls: [], reply: true },
  { id: "ambiguous", say: "Goose take the thing", calls: [], reply: true },

  // Answering the agent's question: the name is not repeated.
  {
    id: "engaged-followup",
    say: "the garlic",
    engaged: true,
    history: [{ speaker: "agent", text: "Which step do you want me to take, Lindy?" }],
    calls: [call("claim", ["s1"])],
  },
  { id: "engaged-yes-no-question", say: "yes", engaged: true, history: [{ speaker: "agent", text: "Did you mean Cut the red onion?" }], calls: [call("claim", ["s4"])] },
];

const key = (c) => c.name;
function score(c, turn) {
  const problems = [];
  const wantAddressed = c.addressed ?? true;
  if (turn.addressed !== wantAddressed) problems.push(`addressed=${turn.addressed}`);
  if (c.orClarify && !turn.calls.length && turn.reply) return problems;
  const got = turn.calls.map((x) => ({ ...x }));
  const want = c.calls;
  const remaining = [...got];
  for (const w of want) {
    const i = remaining.findIndex((g) => g.name === w.name && (!w.step || w.step.includes(g.stepId)));
    if (i === -1) problems.push(`missing ${w.name}${w.step ? `(${w.step.join("|")})` : ""}`);
    else remaining.splice(i, 1);
  }
  for (const extra of remaining) problems.push(`extra ${key(extra)}(${extra.stepId})`);
  if (c.reply && !turn.reply) problems.push("no reply");
  return problems;
}

const pad = (s, n) => String(s).padEnd(n);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

// A 429 is the gateway's rate limit, not the model getting it wrong, so it
// is retried with backoff and reported separately. Scoring a throttled call
// as a failure once made a good model look broken.
async function turnWithRetry(args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestTurn(args);
    } catch (err) {
      if (err.status !== 429 || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

let exitCode = 0;
for (const model of models) {
  console.log(`\n=== ${model} ===`);
  const times = [];
  let pass = 0;
  let total = 0;
  let errors = 0;
  for (const c of CASES.filter((x) => x.id.includes(only))) {
    for (let r = 0; r < repeat; r++) {
      total += 1;
      let problems;
      let turn;
      try {
        turn = await turnWithRetry({
          apiKey: API_KEY,
          model,
          text: c.say,
          agentName: AGENT,
          engaged: Boolean(c.engaged),
          snapshot: { ...KITCHEN, history: c.history || [] },
          timeoutMs: 15000,
        });
        problems = score(c, turn);
        if (turn.ms) times.push(turn.ms);
      } catch (err) {
        problems = [`error: ${err.message}`];
      }
      if (problems[0]?.startsWith("error:")) errors += 1;
      else if (!problems.length) pass += 1;
      const seen = turn ? turn.calls.map((x) => `${x.name}${x.stepId ? `(${x.stepId})` : ""}`).join(", ") || "-" : "-";
      console.log(
        `${problems.length ? "FAIL" : " ok "} ${pad(c.id, 24)} ${pad(turn?.ms ?? "", 5)}ms  calls: ${pad(seen, 28)} ${turn?.reply ? `"${turn.reply}"` : ""}${problems.length ? `  <- ${problems.join("; ")}` : ""}`,
      );
    }
  }
  console.log(`--- ${model}: ${pass}/${total - errors} passed${errors ? ` (${errors} errored, excluded)` : ""}, median ${median(times)}ms`);
  if (pass !== total - errors || errors) exitCode = 1;
}
process.exit(exitCode);
