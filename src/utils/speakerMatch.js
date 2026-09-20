// Decide whether a speaker-identification result is trustworthy enough to
// act on. The sidecar reports raw cosine scores; what counts as a match is
// a judgement about the app, not the model, so it lives here where it can
// be tested and tuned against real voices.
//
// A wrong answer costs more than no answer: no answer falls back to the
// speaker toggle, while a wrong one silently credits somebody else with
// the step. So all three checks must pass.
//
// The figures are starting points. Two similar voices (the realistic case
// here) sit closer together than the different-sex pairs most demos use, so
// measure on the real pair and adjust; the sidecar's scores are logged for
// exactly that.
export const SPEAKER_THRESHOLDS = {
  minScore: 0.6, // how alike the turn is to the best-matching cook
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
