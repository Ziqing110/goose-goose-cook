#!/usr/bin/env node
// Grade a voice-lab session log against the round script it was recorded
// from, and print the results table VOICE_TEST_PLAN.md asks for.
//
//   node scripts/score-voice-log.mjs <log.json> [more-logs.json ...]
//   node scripts/score-voice-log.mjs --json <log.json>     # machine-readable
//
// Why this exists: scoring ~200 utterances by hand across nine rounds is
// slow and inconsistent, and an inconsistent score is worse than none —
// Stage B decisions get made on these numbers.
//
// Two rules this file follows deliberately:
//
//  1. It imports the REAL `parseCommand` from src/utils/voiceCommands.js.
//     Grading against a reimplementation would measure the wrong thing.
//     This is also why the scorer lives in scripts/ and not voice-lab/ —
//     the lab's claim to import nothing from src/ stays true.
//  2. Per-turn expectations come from the `_expected` stamp in the log,
//     not from rounds.json. The stamp records what was actually on the
//     prompter when the words were spoken, which is the truth of that
//     session; rounds.json may have been edited since. rounds.json is
//     used for the utterance-count tripwire (which warns you when the two
//     have diverged) and to build the parser's candidate list.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseCommand } from "../src/utils/voiceCommands.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const ROUNDS = JSON.parse(readFileSync(join(REPO, "voice-lab", "rounds.json"), "utf8"));

const COOKS = ["Lindy", "Zeina"];

// ------------------------------------------------------------------ text

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Levenshtein over words — the standard WER numerator. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function wer(expected, actual) {
  const e = norm(expected).split(" ").filter(Boolean);
  const a = norm(actual).split(" ").filter(Boolean);
  if (e.length === 0) return a.length === 0 ? 0 : 1;
  return editDistance(e, a) / e.length;
}

/**
 * Did a cook's name survive transcription?
 *
 * Exact match first, then a fuzzy fallback, because the Stage C2 parser is
 * specced to fuzzy-match against a two-name candidate list — counting
 * "Zeina" → "Zena" as a miss would understate what the real system can do.
 *
 * The tolerance scales with name length (1 edit for short names, 2 for
 * 5+ characters) because a name like "Zeina" is unusual enough in English
 * STT vocabularies that it can come back two characters off. To stop that
 * tolerance from stealing a name from the other cook, a fuzzy hit only
 * counts when ONE name is clearly closer than the other.
 */
function findCook(text) {
  const tokens = norm(text).split(" ").filter(Boolean);

  // Scan the utterance left to right, NOT the cook list. "Zeina, ask Lindy
  // to start" is addressed to Zeina — whoever is named first is the
  // speaker. Iterating the cook list instead would hand every such line to
  // whichever name happens to sit earlier in the array.
  for (const t of tokens) {
    const hit = COOKS.find((c) => c.toLowerCase() === t);
    if (hit) return { cook: hit, exact: true };
  }

  for (const t of tokens) {
    if (t.length < 3) continue;
    let best = null;
    let bestD = Infinity;
    let runnerUp = Infinity;
    for (const cook of COOKS) {
      const c = cook.toLowerCase();
      const tol = c.length >= 5 ? 2 : 1;
      // Length guard. Without it a 2-edit budget on a 5-letter name
      // matches short unrelated words — "lid" lands on "Lindy" — and a
      // wake word that fires on ordinary kitchen nouns is worse than no
      // wake word at all. A real mishearing keeps roughly the length.
      const d =
        Math.abs(t.length - c.length) <= 1 && editDistance([...t], [...c]) <= tol
          ? editDistance([...t], [...c])
          : Infinity;
      if (d < bestD) {
        runnerUp = bestD;
        bestD = d;
        best = cook;
      } else if (d < runnerUp) runnerUp = d;
    }
    // Ambiguous between the two cooks is no better than hearing no name.
    if (best && bestD < runnerUp) return { cook: best, exact: false };
  }

  return { cook: null, exact: false };
}

// ------------------------------------------------------------- parser ctx

/**
 * Build the context parseCommand needs. The real app scopes candidates by
 * run state; here every scripted step is claimable, which is the HARDEST
 * case for the matcher — a wider candidate list means more chances to
 * resolve to the wrong step. If it passes here it passes in the app.
 */
function parserContext(round) {
  const labels = new Set();
  const collect = (l) => l?.step && labels.add(l.step);
  (round?.lines || []).forEach(collect);
  (round?.pairs || []).forEach(collect);
  // The seeded graph's other steps, so the matcher has real distractors.
  [
    "Cut tofu into cubes", "Mince garlic", "Mince ginger & scallion",
    "Mix sauce & slurry", "Blanch tofu", "Combine & simmer",
    "Thicken & garnish", "Plate & serve", "Portion & season ground pork",
    "Trim & season chicken", "Dice onion, carrot & celery",
    "Measure stock, bay leaf & thyme", "Sauté onion, carrot & celery",
    "Add chicken & stock, simmer", "Shred the cooked chicken",
    "Cook egg noodles in the broth", "Return chicken & garnish with parsley",
    "Ladle & serve hot",
  ].forEach((l) => labels.add(l));

  const byId = {};
  const ids = [];
  [...labels].forEach((label, i) => {
    const id = `s${i}`;
    byId[id] = { id, label };
    ids.push(id);
  });
  return { byId, ids, idFor: (label) => ids.find((id) => byId[id].label === label) || null };
}

/**
 * Strip a leading cook name, the way Stage C2's `resolveSpeaker` will.
 * Returns the remaining text plus whether the utterance was addressed.
 */
function resolveSpeaker(text) {
  const { cook, exact } = findCook(text);
  if (!cook) return { cook: null, rest: text, addressed: false, exact: false };
  // Remove the first occurrence of the name (and a trailing comma/dash).
  const rest = text.replace(new RegExp(`\\b${cook}\\b[\\s,\\-–—?.]*`, "i"), " ").trim();
  return { cook, rest, addressed: true, exact };
}

/**
 * Can diarization tell these two people apart at all?
 *
 * There is no voice enrollment in AssemblyAI — nothing we send teaches it
 * whose voice is whose. All we can do is watch which anonymous label ("A",
 * "B") it hands each person and check whether that stays consistent. So:
 * learn the dominant label per speaker from the prompter's ground truth,
 * then score every turn against that mapping.
 *
 * If both people map to the SAME label, diarization has not separated them
 * and no amount of tuning downstream will fix it — that outcome sends D1
 * straight to the name-prefix design.
 */
function diarizationReport(graded) {
  const counts = new Map(); // speaker -> Map(label -> n)
  for (const t of graded) {
    const who = t._expected?.speaker;
    const label = t.speaker_label;
    if (!who || !label || label === "PENDING") continue;
    if (!counts.has(who)) counts.set(who, new Map());
    const m = counts.get(who);
    m.set(label, (m.get(label) || 0) + 1);
  }
  if (counts.size < 2) return null;

  const map = {};
  for (const [who, m] of counts) {
    map[who] = [...m].sort((a, b) => b[1] - a[1])[0][0];
  }
  const labels = Object.values(map);
  const collapsed = new Set(labels).size < labels.length;

  let correct = 0;
  let judged = 0;
  for (const t of graded) {
    const who = t._expected?.speaker;
    if (!who || !t.speaker_label || t.speaker_label === "PENDING") continue;
    judged += 1;
    if (t.speaker_label === map[who]) correct += 1;
  }

  const revised = graded.filter((t) => t._speakerRevised).length;

  // How well would diarization have done WITHOUT the end-of-session
  // refinement? That's the number the live app actually gets — it can't
  // wait for a session to end before deciding who claimed a step.
  let liveCorrect = 0;
  let liveJudged = 0;
  for (const t of graded) {
    const who = t._expected?.speaker;
    const live = t._speakerLabelLive ?? t.speaker_label;
    if (!who || !live || live === "PENDING") continue;
    liveJudged += 1;
    if (live === map[who]) liveCorrect += 1;
  }

  return {
    map,
    collapsed,
    revisedTurns: revised,
    liveAgreementPct:
      collapsed || !liveJudged ? null : Number(((liveCorrect / liveJudged) * 100).toFixed(1)),
    // When both people collapse onto one label, "agreement" is trivially
    // 100% and completely meaningless — every turn matches because there
    // is only one label. Report it as null so nobody reads a collapse as
    // a perfect score.
    agreementPct: collapsed ? null : judged ? Number(((correct / judged) * 100).toFixed(1)) : null,
    judged,
  };
}

// ----------------------------------------------------------------- score

function scoreLog(log) {
  const key = log.roundKey || log.round;
  const def = ROUNDS[key];

  // A log with no usable turns produces a report full of zeros and nulls
  // that reads like a result. Say what's wrong instead.
  if (!Array.isArray(log.turns)) {
    throw new Error(
      `${log._file}: no "turns" array — this isn't a voice-lab log, or the download was truncated.`,
    );
  }
  if (log.turns.length === 0) {
    throw new Error(`${log._file}: the log has zero turns. Nothing was recorded.`);
  }

  const graded = log.turns.filter((t) => !t._discarded);
  if (graded.length === 0) {
    throw new Error(
      `${log._file}: all ${log.turns.length} turns are marked discarded — nothing left to score.`,
    );
  }
  if (!graded.some((t) => t._expected) && def?.mode !== "freeform") {
    throw new Error(
      `${log._file}: no turn carries an _expected stamp. Was a round selected in the ` +
        `prompter before recording? Without the stamp this round can't be auto-scored.`,
    );
  }
  const ctx = parserContext(def?.sameLinesAs ? ROUNDS[def.sameLinesAs] : def);

  const out = {
    file: log._file,
    round: key,
    label: def?.label || "(unknown round)",
    mode: def?.mode || "unknown",
    config: log.sentParams || log.config || {},
    turns: graded.length,
    discarded: (log.turns || []).length - graded.length,
    rows: [],
    metrics: {},
  };

  if (def && log.expectedCount != null && def.mode !== "freeform") {
    const countEntries = (r) => {
      if (r.entries) {
        return r.entries.reduce(
          (n, e) => n + (e.kind === "banner" ? 0 : e.kind === "pair" ? 2 : 1),
          0,
        );
      }
      return (r.lines || []).length || (r.pairs || []).length * 2;
    };
    const expected = countEntries(def.sameLinesAs ? ROUNDS[def.sameLinesAs] : def);
    if (expected !== log.expectedCount) {
      out.warning =
        `rounds.json has ${expected} expected utterances but the log was recorded ` +
        `against ${log.expectedCount}. The round definition changed after recording — ` +
        `these numbers are not trustworthy.`;
    }
  }

  const lat = [];
  let pending = 0;
  let nameHits = 0;
  let nameExact = 0;
  let nameTotal = 0;
  let intentHits = 0;
  let intentTotal = 0;
  let stepHits = 0;
  let stepWrong = 0;
  let stepTotal = 0;
  let ambiguousOk = 0;
  let ambiguousTotal = 0;
  let werSum = 0;
  let werN = 0;
  let falsePositives = 0;
  let wouldHaveFired = 0;
  let trapCount = 0;
  let knownGapTotal = 0;
  let knownGapFixed = 0;

  for (const t of graded) {
    const exp = t._expected;
    const said = t.transcript || "";
    const spk = resolveSpeaker(said);

    if (t._finalizeLagMs != null) lat.push(t._finalizeLagMs);
    if (t.speaker_label === "PENDING") pending += 1;

    const row = {
      turn: t.turn_order,
      durationMs: t._durationMs,
      finalizeMs: t._finalizeLagMs,
      speakerLabel: t.speaker_label ?? null,
      firstWordMs: t._firstWordStartMs,
      expected: exp?.text ?? null,
      actual: said,
      addressed: spk.addressed,
      resolvedCook: spk.cook,
    };

    // --- ambient speech: nothing should be addressed, and we also want to
    // know what WOULD have fired without the wake word. That second number
    // is the whole argument for the name prefix.
    //
    // Two ways to get here: an unstamped turn (a freeform round), or a
    // stamped trap line inside the mixed round.
    if (!exp || exp.kind === "trap") {
      trapCount += 1;
      if (spk.addressed) {
        falsePositives += 1;
        row.flag = "FALSE POSITIVE — contains a cook name";
      }
      const bare = parseCommand(said, { byId: ctx.byId, claimable: ctx.ids, ownQueue: [] });
      row.bareIntent = bare.intent;
      if (bare.intent !== "unknown") wouldHaveFired += 1;
      out.rows.push(row);
      continue;
    }

    // --- scripted rounds
    const w = wer(exp.text, said);
    werSum += w;
    werN += 1;
    row.wer = Number(w.toFixed(3));

    if (exp.addressed !== false) {
      nameTotal += 1;
      if (spk.cook === exp.speaker) {
        nameHits += 1;
        if (spk.exact) nameExact += 1;
      } else {
        row.flag = `name miss — expected ${exp.speaker}, resolved ${spk.cook ?? "none"}`;
      }
    } else if (spk.addressed) {
      // A bare line that came back carrying a name is a hard failure: the
      // rejection signal the whole design leans on isn't reliable.
      falsePositives += 1;
      row.flag = `BARE LINE CARRIES A NAME (${spk.cook}) — must not happen`;
    }

    if (exp.intent) {
      // A line marked knownGap is phrasing we expect today's parser to
      // miss. It's still worth saying out loud — people talk that way —
      // but scoring it as a failure would bury the signal from lines the
      // parser is actually supposed to handle. Counted separately.
      if (exp.knownGap) knownGapTotal += 1;
      else intentTotal += 1;
      const parsed = parseCommand(spk.rest, {
        byId: ctx.byId,
        claimable: ctx.ids,
        ownQueue: ctx.ids,
        activeStepId: null,
      });
      row.intent = parsed.intent;
      row.intentExpected = exp.intent;
      if (exp.knownGap) {
        row.knownGap = exp.knownGap;
        if (parsed.intent === exp.intent) {
          knownGapFixed += 1;
          row.flag = `KNOWN GAP NOW PASSES — "${exp.text}" resolved to ${parsed.intent}`;
        }
      } else if (parsed.intent === exp.intent) intentHits += 1;
      else row.flag = (row.flag ? row.flag + "; " : "") + `intent ${parsed.intent} ≠ ${exp.intent}`;

      // Two kinds of correct. Some references are genuinely ambiguous
      // ("take the tofu" — cut it or blanch it?) or name an ingredient
      // rather than a step. For those the RIGHT answer is candidates, not
      // a resolution, per the test plan's rule that a wrong step is worse
      // than a clarifying question. Scoring them as misses would punish
      // the parser for behaving correctly.
      if (exp.knownGap) {
        // no step expectation on a line we already expect to miss
      } else if (exp.stepExpect === "ambiguous") {
        ambiguousTotal += 1;
        row.stepExpected = "(ambiguous — expect candidates)";
        row.step = parsed.stepId ? ctx.byId[parsed.stepId].label : null;
        row.stepConfidence = parsed.confidence;
        if (!parsed.stepId) ambiguousOk += 1;
        else {
          stepWrong += 1;
          row.flag =
            (row.flag ? row.flag + "; " : "") +
            `RESOLVED AN AMBIGUOUS REFERENCE to "${row.step}" — should have asked`;
        }
      } else if (exp.step) {
        stepTotal += 1;
        const wantId = ctx.idFor(exp.step);
        row.stepExpected = exp.step;
        row.step = parsed.stepId ? ctx.byId[parsed.stepId].label : null;
        row.stepConfidence = parsed.confidence;
        if (parsed.stepId === wantId) stepHits += 1;
        else if (parsed.stepId) {
          // Worse than no answer: the app would act on the wrong step.
          stepWrong += 1;
          row.flag = (row.flag ? row.flag + "; " : "") + `WRONG STEP (${row.step})`;
        } else {
          row.flag = (row.flag ? row.flag + "; " : "") + `no step resolved (candidates only)`;
        }
      }
    }

    if (exp.delivery) row.delivery = exp.delivery;
    out.rows.push(row);
  }

  const pct = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : null);
  lat.sort((a, b) => a - b);
  out.metrics = {
    wer: werN ? Number((werSum / werN).toFixed(3)) : null,
    nameAttributionPct: pct(nameHits, nameTotal),
    nameExactPct: pct(nameExact, nameTotal),
    intentCorrectPct: pct(intentHits, intentTotal),
    knownGaps: knownGapTotal || null,
    knownGapsThatPassed: knownGapTotal ? knownGapFixed : null,
    stepCorrectPct: pct(stepHits, stepTotal),
    ambiguousHandledPct: pct(ambiguousOk, ambiguousTotal),
    stepWrong,
    pendingSpeakerPct: pct(pending, graded.length),
    finalizeMsMedian: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    finalizeMsP90: lat.length ? lat[Math.floor(lat.length * 0.9)] : null,
    falsePositives,
    ambientUtterances: trapCount || null,
    wouldHaveFiredWithoutWakeWord: trapCount ? wouldHaveFired : null,
  };

  const diar = diarizationReport(graded);
  if (diar) {
    out.diarization = diar;
    out.metrics.diarizationAgreementPct = diar.agreementPct;
    out.metrics.diarizationLiveAgreementPct = diar.liveAgreementPct;
    out.metrics.diarizationRevisedTurns = diar.revisedTurns || null;
    out.metrics.diarizationMap = Object.entries(diar.map)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    if (diar.collapsed) out.metrics.diarizationCollapsed = true;
  }

  // Cross-talk: did the earlier first word win, in the staggered pairs?
  if (graded.some((t) => t._expected?.pairRole)) {
    let correct = 0;
    let judged = 0;
    let lost = 0;
    const byPair = new Map();
    for (const t of graded) {
      const e = t._expected;
      if (!e?.pairRole) continue;
      const k = `${e.lineIndex}`;
      if (!byPair.has(k)) byPair.set(k, { stagger: e.stagger, items: [] });
      byPair.get(k).items.push({
        role: e.pairRole,
        start: t._firstWordStartMs,
        // Who the transcript says it was, not who was meant to speak.
        speaker: findCook(t.transcript || "").cook,
      });
    }
    for (const [, p] of byPair) {
      if (p.items.length < 2) {
        lost += 1;
        continue;
      }
      // Both turns arrived, but if they were attributed to the same
      // person the API heard one voice twice and dropped the other —
      // a lost utterance wearing a disguise.
      if (p.items[0].speaker && p.items[0].speaker === p.items[1].speaker) lost += 1;
      if (p.stagger !== "300ms") continue;
      const first = p.items.find((i) => i.role === "first");
      const second = p.items.find((i) => i.role === "second");
      if (first?.start == null || second?.start == null) continue;
      judged += 1;
      if (first.start < second.start) correct += 1;
    }
    out.metrics.staggeredArbitrationCorrect = `${correct}/${judged}`;
    out.metrics.pairsWithLostUtterance = lost;
  }

  return out;
}

// ---------------------------------------------------------------- output

function printReport(r) {
  const m = r.metrics;
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${r.round}  —  ${r.label}`);
  console.log(`${r.file}`);
  console.log("=".repeat(78));
  if (r.warning) console.log(`\n  ⚠ ${r.warning}\n`);

  const cfg = r.config;
  console.log(
    `config   model=${cfg.speech_model ?? "?"}  mode=${cfg.mode ?? "default"}  ` +
      `voice_focus=${cfg.voice_focus ?? "off"}  speaker_labels=${cfg.speaker_labels ?? "false"}  ` +
      `keyterms=${cfg.keyterms_prompt ? "yes" : "no"}`,
  );
  console.log(`turns    ${r.turns} graded, ${r.discarded} discarded`);

  console.log("\nmetrics");
  const show = (label, value, unit = "") =>
    value === null || value === undefined
      ? null
      : console.log(`  ${label.padEnd(34)} ${value}${unit}`);
  show("word error rate", m.wer);
  show("cook attribution", m.nameAttributionPct, "%");
  show("  of which exact spelling", m.nameExactPct, "%");
  show("intent correct", m.intentCorrectPct, "%");
  show("known parser gaps exercised", m.knownGaps);
  show("step correct", m.stepCorrectPct, "%");
  show("ambiguous refs asked (not guessed)", m.ambiguousHandledPct, "%");
  show("step resolved to WRONG step", m.stepWrong);
  show("speaker_label PENDING", m.pendingSpeakerPct, "%");
  show("diarization label map", m.diarizationMap);
  show("diarization agreement (final)", m.diarizationAgreementPct, "%");
  show("diarization agreement (live)", m.diarizationLiveAgreementPct, "%");
  show("turns revised at session close", m.diarizationRevisedTurns);
  if (m.diarizationCollapsed) {
    console.log("  ⚠ BOTH SPEAKERS GOT THE SAME LABEL — diarization did not");
    console.log("    separate these two voices. Speaker identity has to come from");
    console.log("    the name in the transcript; see D1 in VOICE_PLAN.md.");
  }
  show("finalize latency (median)", m.finalizeMsMedian, "ms");
  show("finalize latency (p90)", m.finalizeMsP90, "ms");
  show("staggered arbitration correct", m.staggeredArbitrationCorrect);
  show("pairs with a lost utterance", m.pairsWithLostUtterance);
  show("ambient lines (no name expected)", m.ambientUtterances);
  show("FALSE POSITIVES", m.falsePositives);
  show("would have fired w/o wake word", m.wouldHaveFiredWithoutWakeWord);

  const flagged = r.rows.filter((row) => row.flag);
  if (flagged.length) {
    console.log(`\nproblems (${flagged.length})`);
    for (const row of flagged) {
      console.log(`  #${String(row.turn).padStart(3)}  ${row.flag}`);
      if (row.expected) console.log(`        expected: “${row.expected}”`);
      console.log(`        actual:   “${row.actual}”`);
    }
  }

  // Hard gates from VOICE_TEST_PLAN.md, evaluated rather than eyeballed.
  const gates = [];
  if (m.ambientUtterances) {
    gates.push([
      `wake word: zero of ${m.ambientUtterances} ambient lines carried a name`,
      m.falsePositives === 0,
    ]);
  } else if (m.falsePositives > 0) {
    gates.push(["bare lines must never carry a name", false]);
  }
  if (m.nameAttributionPct !== null) {
    gates.push(["R2: cook attribution ≥ 95%", m.nameAttributionPct >= 95]);
  }
  if (m.staggeredArbitrationCorrect) {
    const [c, t] = m.staggeredArbitrationCorrect.split("/").map(Number);
    gates.push([`R5: staggered arbitration ${c}/${t}`, t > 0 && c === t]);
  }
  if (gates.length) {
    console.log("\ngates");
    for (const [name, ok] of gates) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
}

// ------------------------------------------------------------------ main

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  console.error(
    "usage: node scripts/score-voice-log.mjs [--json] <log.json> [...]\n\n" +
      "Logs come from the voice lab's Download log button (npm run lab).\n" +
      "Available rounds:\n" +
      Object.entries(ROUNDS)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => `  ${k.padEnd(22)} ${v.label}`)
        .join("\n"),
  );
  process.exit(1);
}

const results = [];
let failed = 0;
for (const f of files) {
  try {
    const log = JSON.parse(readFileSync(resolve(f), "utf8"));
    log._file = f;
    results.push(scoreLog(log));
  } catch (err) {
    // One unusable log shouldn't stop the others from being scored — you
    // often pass four noise conditions at once and only one is bad.
    failed += 1;
    console.error(`
CANNOT SCORE  ${err.message}`);
  }
}
if (results.length === 0) process.exitCode = 1;
else if (failed) console.error(`
(${failed} of ${files.length} logs could not be scored)`);

if (asJson) console.log(JSON.stringify(results, null, 2));
else results.forEach(printReport);
