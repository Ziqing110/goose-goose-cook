import chefGooseSheet from "../assets/chef-goose-schedule-loading-v1.png";
import { GoosePrint } from "./GooseMarks.jsx";
import "./ChefWorkingScreen.css";


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
          <div className="chef-working-goose" style={{ backgroundImage: `url(${chefGooseSheet})` }} role="img" aria-label="Chef goose arranging recipe cards" />
        </div>

        <div className="chef-working-copy">
          <h1 className="chef-working-title">{title}</h1>
          <p className="chef-working-desc">{desc}</p>
        </div>

        <span className="chef-working-live" role="status">
          {/* The goose's own prints stepping left to right while the chef
              works — not bars, which read as the VoiceBar's mic meter —
              and a check once it's done. Toes point right, the way it
              walks; the middle print is the other foot, a touch higher. */}
          <span className="chef-working-loader" aria-hidden="true">
            {done ? (
              <svg viewBox="0 0 16 16" className="chef-working-check">
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
            ) : (
              [0, 1, 2].map((i) => (
                <GoosePrint key={i} size={11} rotate={90} style={{ marginTop: i === 1 ? -4 : 2, animationDelay: `${i * 260}ms` }} />
              ))
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
