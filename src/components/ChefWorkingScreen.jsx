import chefGooseSheet from "../assets/chef-goose-schedule-loading-v1.png";
import { GoosePrint } from "./GooseMarks.jsx";
import "./ChefWorkingScreen.css";

// The trail the goose walked in on, oldest first: pale and small far
// off, deepest by the plate (the same size-tracks-depth rule as the
// other tracks). Alternating rows are the left and right feet.
const TRAIL = [
  { depth: "pale", size: 12, left: 0, bottom: 4 },
  { depth: "pale", size: 13, left: 24, bottom: 22 },
  { depth: "mid", size: 15, left: 50, bottom: 10 },
  { depth: "mid", size: 16, left: 76, bottom: 30 },
  { depth: "deep", size: 18, left: 104, bottom: 16 },
];

// Full-page beat while the chef is doing real work off screen — today
// that is the recipe generation on Inventory, which runs the better
// part of a minute. (From exports/kitchen-path-loading-white.html on
// the v4 tokens: sans only, accent for the live line.) The topbar
// already carries the session steps, so there is no eyebrow here, and
// the live line is the one status on screen — no second tag on the art.
//
// The goose sprite loops its three "working" frames — reading the
// cards, sorting, shuffling — and snaps to the fourth (thumbs up) when
// `done` flips; the caller keeps rendering it for one more beat so the
// fade-out plays, then swaps in the real page.
export default function ChefWorkingScreen({
  done = false,
  title,
  desc,
  live,
  doneLive,
  details = [],
  quote,
}) {
  return (
    <section className={`page chef-working ${done ? "is-done" : ""}`} aria-live="polite" aria-busy={!done}>
      <div className="chef-working-stage">
        <div className="chef-working-art">
          <span className="chef-working-halo" aria-hidden="true" />
          <span className="chef-working-trail" aria-hidden="true">
            {TRAIL.map((p, i) => (
              <span key={i} style={{ left: p.left, bottom: p.bottom, animationDelay: `${i * 280}ms` }}>
                <GoosePrint depth={p.depth} size={p.size} rotate={68} />
              </span>
            ))}
          </span>
          <div className="chef-working-goose" style={{ backgroundImage: `url(${chefGooseSheet})` }} role="img" aria-label="Chef goose arranging recipe cards" />
        </div>

        <div className="chef-working-copy">
          <h1 className="chef-working-title">{title}</h1>
          <p className="chef-working-desc">{desc}</p>
        </div>

        <span className="chef-working-live" role="status">
          {/* Typing dots while the chef works — not bars, which read as
              the VoiceBar's mic meter — and a check once it's done. */}
          <span className="chef-working-loader" aria-hidden="true">
            {done ? (
              <svg viewBox="0 0 16 16" className="chef-working-check">
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
            ) : (
              <>
                <i />
                <i />
                <i />
              </>
            )}
          </span>
          {done ? doneLive : live}
        </span>
        {details.length > 0 && (
          <span className="chef-working-details">
            {details.map((d, i) => (
              <span key={i}>
                {i > 0 && <i>·</i>}
                <span>{d}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      {quote && (
        <footer className="chef-working-foot">
          <span className="chef-working-quote">&ldquo;{quote}&rdquo;</span>
          <span className="chef-working-attrib">&mdash; your chef</span>
        </footer>
      )}
    </section>
  );
}
