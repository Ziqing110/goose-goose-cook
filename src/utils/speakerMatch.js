// Decide whether a speaker-identification result is trustworthy enough to
// act on. The sidecar reports raw cosine scores; what counts as a match is
// a judgement about the app, not the model, so it lives here where it can
// be tested and tuned against real voices.
//
// A wrong answer costs more than no answer: no answer falls back to the
// speaker toggle, while a wrong one silently credits somebody else with
// the step. So all three checks must pass.
//
// Measured on the real pair rather than guessed. scripts/speaker-eval.mjs
// enrolls both cooks from the kitchen recordings and marks 34 turns from
// five other scenes against the sheet that says who read each line:
//
//   score  margin | right  wrong  unsure
//    0.50   0.10  |   24      2       8
//    0.55   0.10  |   23      1      10   <- here
//    0.60   0.10  |   18      1      15   <- the old guess
//    0.60   0.25  |   14      1      19
//
// 0.6 was leaving five turns a scene to the speaker toggle for no gain:
// the same single error survives every threshold above 0.5, because it
// is a confident wrong match (0.62 score, 0.37 margin) and no floor
// catches it. Going below 0.55 buys one more right answer and a second
// wrong one, which is the wrong trade — a wrong answer silently credits
// somebody else with the step, while no answer just falls back.
//
// Re-measure if the pair or the room changes. Both voiceprints and
// marked turns here come from the same mic in the same kitchen, so these
// figures are the optimistic case.
export const SPEAKER_THRESHOLDS = {
  minScore: 0.55, // how alike the turn is to the best-matching cook
  minMargin: 0.1, // how much closer it is to them than to the runner-up
  minSeconds: 1.0, // shorter clips make noisy embeddings
};

/**
 * @param {{cook:string|null, score:number|null, margin:number|null, seconds:number}} result
 * @returns {{cookId:string|null, reason:string}}
 */
export function decideSpeaker(result, thresholds = SPEAKER_THRESHOLDS) {
  if (!result?.cook) return { cookId: null, reason: "nobody enrolled" };
  if (result.seconds < thresholds.minSeconds) return { cookId: null, reason: "too short" };
  if (result.score < thresholds.minScore) return { cookId: null, reason: "not close to anyone" };
  // With one enrolled cook there is no runner-up, so the score decides.
  if (result.margin != null && result.margin < thresholds.minMargin) return { cookId: null, reason: "too close to call" };
  return { cookId: result.cook, reason: "ok" };
}

// Two cooks inside one turn.
//
// The streaming API's diarization labels a turn with ONE speaker even
// when two people are in it, so the label alone cannot catch the case
// that matters: "Goose, done with—" "no way, that's mine!" arrives as a
// single turn credited to whoever won, and half of it is wrong.
//
// The per-word speaker confidence does catch it. On the one genuinely
// merged turn in the kitchen recordings it steps down exactly at the
// handover, and holds flat everywhere else:
//
//   Goose,/1.00 done/1.00 with—/1.00 no/0.63 way,/0.63 that's/0.63 mine./0.63
//
// Measured across four scenes: drop 0.37 on the merged turn, 0.00 on all
// nineteen single-speaker turns. It is the DROP that separates them, not
// the level — clean turns sit anywhere from 0.50 to 1.00 and are none
// the worse for it, so a floor on absolute confidence would fire on
// perfectly good speech.
//
// Not caught, and deliberately: both cooks saying the same words at the
// same instant ("Goose, status" in chorus) holds flat too. Nothing needs
// clarifying there — they asked for the same thing.
const MIN_HANDOVER_DROP = 0.25;

/**
 * @param {Array<{speaker_confidence?:number}>} words a turn's words
 * @returns {boolean} true when the turn changed speaker part-way through
 */
export function hasHandover(words, minDrop = MIN_HANDOVER_DROP) {
  const confidences = (words || [])
    .map((w) => w.speaker_confidence)
    .filter((c) => Number.isFinite(c));
  // Fewer than two words says nothing, and no diarization says nothing
  // either — both are "we don't know", not "one speaker".
  if (confidences.length < 2) return false;
  return Math.max(...confidences) - Math.min(...confidences) >= minDrop;
}
