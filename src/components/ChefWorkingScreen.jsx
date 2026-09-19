import chefGooseSheet from "../assets/chef-goose-schedule-loading-v1.png";
import "./ChefWorkingScreen.css";

// Full-page beat while the chef is doing real work off screen — today
// that is the recipe generation on Inventory, which runs the better
// part of a minute. (From exports/kitchen-path-loading-white.html on
// the v4 tokens: sans only, accent for the live line, --success for
// the "chef at work" tag. The topbar already carries the session
// steps, so only the main band is rendered.)
//
// The goose sprite loops its three "working" frames — reading the
// cards, sorting, shuffling — and snaps to the fourth (thumbs up) when
// `done` flips; the caller keeps rendering it for one more beat so the
// fade-out plays, then swaps in the real page.
export default function ChefWorkingScreen({
  done = false,
  eyebrow,
  doneEyebrow,
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
        <span className="chef-working-eyebrow">
          <span className="chef-working-dot is-accent" aria-hidden="true" />
          {done ? doneEyebrow : eyebrow}
        </span>

        <div className="chef-working-art">
          <span className="chef-working-halo" aria-hidden="true" />
          <div className="chef-working-goose" style={{ backgroundImage: `url(${chefGooseSheet})` }} role="img" aria-label="Chef goose arranging recipe cards" />
          <span className="chef-working-tag">
            <span className="chef-working-dot" aria-hidden="true" />
            {done ? "Done" : "Chef at work"}
          </span>
        </div>

        <h1 className="chef-working-title">{title}</h1>
        <p className="chef-working-desc">{desc}</p>

        <span className="chef-working-live" role="status">
          <span className="chef-working-loader" aria-hidden="true">
            <i />
            <i />
            <i />
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
          <span className="chef-working-eyebrow">From your chef</span>
          <span className="chef-working-quote">&ldquo;{quote}&rdquo;</span>
        </footer>
      )}
    </section>
  );
}
