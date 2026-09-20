// Has someone finished speaking?
//
// Voice binding used to stop after a fixed amount of captured audio, which
// is measured from the click, not from when the cook began to read. Someone
// who takes a moment to start, or reads slowly, was cut off mid-line and
// told "Got your voice". This finds the speech itself instead: it ends when
// there has been enough of it and then a real pause.
//
// Works on per-chunk loudness, not on a transcript: the recogniser's turns
// are owned by the voice bar and arrive late. The floor is adaptive so a
// steady extractor fan doesn't read as speech, and capped so someone who
// talks without pausing doesn't raise the bar above their own voice.
//
// Pure: no DOM, so the thresholds can be tested.

/**
 * @param {number[]} levels   RMS per chunk, oldest first
 * @param {number} chunkMs
 * @returns {{voicedMs:number, trailingSilenceMs:number, done:boolean,
 *            firstVoiced:number, lastVoiced:number, threshold:number}}
 */
export function speechActivity(
  levels,
  chunkMs = 50,
  { minVoicedMs = 3000, endSilenceMs = 1200, floorMult = 3, minThreshold = 250, maxFloor = 800 } = {},
) {
  // A quiet percentile of the window is the noise floor. Capped, because
  // when the whole window is speech that percentile is the speech.
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted.length >= 6 ? Math.min(sorted[Math.floor(sorted.length * 0.2)], maxFloor) : 0;
  const threshold = Math.max(minThreshold, floor * floorMult);

  let voiced = 0;
  let first = -1;
  let last = -1;
  levels.forEach((level, i) => {
    if (level < threshold) return;
    voiced += 1;
    if (first === -1) first = i;
    last = i;
  });

  const voicedMs = voiced * chunkMs;
  const trailingSilenceMs = (last === -1 ? levels.length : levels.length - 1 - last) * chunkMs;
  return {
    voicedMs,
    trailingSilenceMs,
    done: voicedMs >= minVoicedMs && trailingSilenceMs >= endSilenceMs,
    firstVoiced: first,
    lastVoiced: last,
    threshold,
  };
}
