// Tying AssemblyAI's speaker labels to the cooks in the kitchen.
//
// Streaming diarization puts a `speaker_label` ("A", "B") on every Turn
// and a `speaker` on every final word. It tells voices APART; it does
// not know whose they are, and there is no enrollment step for it. So
// the label alone can never say "Mia" — but it only has to be bound
// once, and the voice-binding page is already a moment where one named
// cook reads one line on purpose.
//
// After that binding, A *is* Mia for the rest of the session. That
// matters most in the deployment, where the TitaNet sidecar does not run
// at all and the alternative is the on-screen speaker toggle, i.e.
// whoever tapped it last.
//
// What the docs warn about, and why the rules below are cautious:
//
//   - Accuracy improves over a session as the model accumulates embedding
//     context, so the earliest turns are the least reliable. Binding on a
//     deliberately-read line is the best case available.
//   - A cook who only ever says "done" may not earn a distinct label at
//     all; their words get attributed to whichever embedding is closest.
//     So a label is evidence, never proof, and a one-word turn is the
//     weakest evidence there is.
//
// Pure: no DOM, no React. The live buffer that feeds it is
// src/voice/speakerLabelTap.js.

/** A label belongs to exactly one cook. @returns {string|null} */
export function cookForLabel(cooks, label) {
  if (!label) return null;
  return (cooks || []).find((c) => c.speakerLabel === label)?.id ?? null;
}

/**
 * Bind `label` to `cookId`, taking it off anyone else who held it.
 *
 * Re-recording is how a cook fixes a bad binding, and two cooks holding
 * the same label would make every lookup a coin flip — so the newest
 * claim wins and the old one is cleared rather than left to collide.
 */
export function withLabelBound(cooks, cookId, label) {
  if (!label) return cooks;
  return (cooks || []).map((c) => {
    if (c.id === cookId) return { ...c, speakerLabel: label };
    return c.speakerLabel === label ? { ...c, speakerLabel: null } : c;
  });
}

/** Forget one cook's label, or everyone's. Mirrors clearVoice. */
export function withLabelsCleared(cooks, cookId = null) {
  return (cooks || []).map((c) =>
    cookId === null || c.id === cookId ? { ...c, speakerLabel: null } : c,
  );
}

// How much of a recording has to agree before the label is taken as
// this cook's. Enrollment is one person reading one line, so anything
// close to a split means the room was talking over them and the binding
// would be a guess.
const DOMINANCE = 0.67;

/**
 * The label a cook was speaking under, from the turns heard while they
 * recorded.
 *
 * @param {Array<{label: string, at: number}>} samples turns, any order
 * @param {number} from wall-clock ms, inclusive
 * @param {number} to   wall-clock ms, inclusive
 * @returns {{label: string|null, share: number, total: number, reason: string}}
 */
export function dominantLabel(samples, from, to) {
  const inWindow = (samples || []).filter(
    (s) => s && s.label && s.at >= from && s.at <= to,
  );
  if (!inWindow.length) return { label: null, share: 0, total: 0, reason: "nothing heard" };

  const counts = new Map();
  for (const { label } of inWindow) counts.set(label, (counts.get(label) || 0) + 1);

  const [label, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = count / inWindow.length;
  // A tie between two labels is not a winner, whatever the sort says.
  const tied = [...counts.values()].filter((n) => n === count).length > 1;
  if (tied || share < DOMINANCE) {
    return { label: null, share, total: inWindow.length, reason: "more than one voice" };
  }
  return { label, share, total: inWindow.length, reason: "ok" };
}

/**
 * Who a live turn belongs to, given the bindings.
 *
 * Deliberately separate from decideSpeaker in speakerMatch.js: that one
 * judges a voiceprint score, this one reads a binding. The live cook
 * tries them in order — voiceprint, then label, then the toggle, then
 * asking — so each stays answerable on its own.
 *
 * @param {object} turn   a finished Turn ({ speaker_label, words })
 * @param {Array}  cooks
 * @param {number} [minWords] below this a turn is too short to trust
 * @returns {{cookId: string|null, label: string|null, reason: string}}
 */
export function cookFromTurn(turn, cooks, minWords = 2) {
  const label = turn?.speaker_label ?? null;
  if (!label) return { cookId: null, label: null, reason: "no label" };

  const cookId = cookForLabel(cooks, label);
  if (!cookId) return { cookId: null, label, reason: "label not bound" };

  // "done" on its own may never have earned its own embedding, and the
  // docs say short replies land on whichever speaker is closest. Acting
  // on that silently is how the wrong cook gets credited.
  const words = turn?.words?.length ?? 0;
  if (words && words < minWords) return { cookId: null, label, reason: "too short to trust" };

  return { cookId, label, reason: "ok" };
}
