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
