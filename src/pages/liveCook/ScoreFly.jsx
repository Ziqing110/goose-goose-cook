import { useLayoutEffect, useRef } from "react";

// The score moment (design §07): "+20" rises out of the card toward the
// player's score — the 44px counter in the card's head on desktop, the
// strip's pill on mobile; whichever is on screen — 600 ms on the
// spring, then the counter rolls. Positions are measured once on mount
// from the elements the page hands over — the flight is a transform,
// so nothing reflows.
export default function ScoreFly({ fly, fromEl, toEls, onDone }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const toEl = toEls.find((el) => el && el.getClientRects().length > 0) || null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fromEl || !toEl) return undefined;
    // Leaves from the card's title, lands on the middle of the counter.
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const fx = from.left + 28;
    const fy = from.top + 72;
    el.style.setProperty("--fx", `${fx}px`);
    el.style.setProperty("--fy", `${fy}px`);
    el.style.setProperty("--dx", `${to.left + to.width / 2 - fx}px`);
    el.style.setProperty("--dy", `${to.top + to.height / 2 - fy}px`);
    // Outlives the flight so the counter's pop (600 ms in) can finish.
    const t = setTimeout(() => doneRef.current(), 1000);
    return () => clearTimeout(t);
  }, [fly, fromEl, toEl]);
  if (!fromEl || !toEl) return null;
  return (
    <span ref={ref} className={`mono lc-fly is-${fly.player}`} aria-hidden="true">
      +{fly.pts}
    </span>
  );
}
