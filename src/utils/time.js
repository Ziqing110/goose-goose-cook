// How durations are written on screen. Seconds in, text out.

const wholeSeconds = (sec) => Math.max(0, Math.round(Number(sec) || 0));
const pad2 = (n) => String(n).padStart(2, "0");

/** "4:05": a step's length, or any clock on the play surface. */
export function clock(sec) {
  const s = wholeSeconds(sec);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** "04:05": fixed-width minutes and seconds, for totals and timelines. */
export function timer(sec) {
  const s = wholeSeconds(sec);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
