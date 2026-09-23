import { useEffect, useState } from "react";
import chefGooseSheet from "../assets/chef-goose-schedule-loading-v1.png";
import "./ChefWorkingScreen.css";

// Full-page beat while the chef is doing real work off screen — today
// that is the recipe generation on Inventory, which runs the better
// part of a minute, and the shorter plan pass on Schedule.
//
// Layout is "4a Goose on the receipt" from the Inventory Loading v2
// design doc: one centred column — headline, eyebrow, then the goose
// standing on a printed order ticket. The ticket is the whole status
// display, so there is no separate description or details chip: the
// order lines say what's being cooked, the checklist says where the
// chef is, and the block bar says how far along.
//
// The goose sprite loops its three "working" frames — reading the
// cards, sorting, shuffling — and snaps to the fourth (thumbs up) when
// `done` flips; the caller keeps rendering it for one more beat so the
// fade-out plays, then swaps in the real page.

// 26 cells wide, the width the design's ticket is drawn for.
const BAR_CELLS = 26;

// The checklist lines and the fraction of the wait each one starts at.
// A caller can pass its own; these are the recipe-generation ones.
const DEFAULT_TASKS = [
  { at: 0, line: "Reading what you told me." },
  { at: 0.16, line: "Working out the steps." },
  { at: 0.42, line: "Counting what it needs." },
  { at: 0.68, line: "Planning around your burners." },
  { at: 0.86, line: "Checking it over. Twice." },
];

/** Elapsed seconds since mount, ticking 10× a second, frozen once done. */
function useElapsed(done) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (done) return undefined;
    const iv = setInterval(() => setT((s) => s + 0.1), 100);
    return () => clearInterval(iv);
  }, [done]);
  return t;
}

export default function ChefWorkingScreen({
  done = false,
  title,
  eyebrow = "A menu worth waiting for",
  doneEyebrow = "Ready when you are",
  live,
  doneLive,
  ticket,
  order = [],
  orderNote,
  tasks = DEFAULT_TASKS,
  quote,
  // Roughly how long the real work takes. Only paces the bar — the bar
  // never reaches the end on its own, `done` is what completes it.
  workSeconds = 48,
}) {
  const t = useElapsed(done);

  // Ease out, so the bar moves honestly at the start and slows as it
  // runs past the estimate rather than sitting pinned at the end. The
  // ceiling goes on after the easing, or the ease lifts it back to 99%
  // and the ticket claims to be finished while the chef is still going.
  let p = done ? 1 : 1 - Math.pow(1 - Math.min(1, t / workSeconds), 1.35);
  p = done ? 1 : Math.min(0.96, p);

  // The line the chef is on: the last one whose threshold has passed.
  const current = done ? tasks.length : tasks.reduce((a, x, i) => (p >= x.at ? i : a), 0);
  const secsLeft = Math.max(1, Math.round((1 - p) * workSeconds));
  const filled = Math.round(p * BAR_CELLS);

  return (
    <section className={`page chef-working ${done ? "is-done" : ""}`} aria-live="polite" aria-busy={!done}>
      <div className="chef-working-stage">
        <div className="chef-working-copy">
          <h1 className="chef-working-title">{title}</h1>
          <span className="chef-working-eyebrow">
            <span className="chef-working-eyebrow-dot" aria-hidden="true" />
            {done ? doneEyebrow : eyebrow}
          </span>
        </div>

        {/* The goose stands on the ticket: it overlaps the top edge, so
            it sits above the paper in the stack and eats into its own
            bottom margin. */}
        <div
          className="chef-working-goose"
          style={{ backgroundImage: `url(${chefGooseSheet})` }}
          role="img"
          aria-label="Chef goose arranging recipe cards"
        />

        <div className="chef-working-ticket">
          <div className="chef-working-ticket-head">
            <span className="chef-working-ticket-brand">KITCHEN PATH</span>
            {ticket && <span className="chef-working-ticket-meta">{ticket}</span>}
          </div>

          {(order.length > 0 || orderNote) && (
            <>
              <div className="chef-working-rule" />
              <div className="chef-working-order">
                {order.map((line, i) => (
                  <span className="chef-working-order-line" key={i}>
                    {line.qty != null && <span className="chef-working-qty">{line.qty}&times;</span>}
                    {line.name}
                  </span>
                ))}
                {orderNote && <span className="chef-working-order-note">{orderNote}</span>}
              </div>
            </>
          )}

          <div className="chef-working-rule" />
          {/* The checklist. Dotted leaders run out to a mark on the
              right — OK once past, ... on the line being worked, -- for
              what the chef hasn't reached. */}
          <ul className="chef-working-tasks">
            {tasks.map((task, i) => {
              const state = i < current ? "done" : i === current ? "now" : "next";
              return (
                <li className={`chef-working-task is-${state}`} key={task.line}>
                  <span className="chef-working-task-line">{task.line}</span>
                  <span className="chef-working-leader" aria-hidden="true" />
                  <span className="chef-working-mark" aria-hidden="true">
                    {state === "done" ? "OK" : state === "now" ? "..." : "--"}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="chef-working-rule" />
          <div className="chef-working-bar-group">
            <span
              className="chef-working-blocks"
              role="progressbar"
              aria-label={done ? doneLive : live}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p * 100)}
            >
              {"█".repeat(filled)}
              {"░".repeat(BAR_CELLS - filled)}
            </span>
            <div className="chef-working-bar-row">
              <span className="chef-working-pct">{Math.round(p * 100)}%</span>
              <span className="chef-working-eta">{done ? "Ready" : `${secsLeft} second${secsLeft === 1 ? "" : "s"} left`}</span>
            </div>
          </div>

          {quote && (
            <div className="chef-working-foot">
              <div className="chef-working-rule" />
              <span className="chef-working-quote">{quote}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
