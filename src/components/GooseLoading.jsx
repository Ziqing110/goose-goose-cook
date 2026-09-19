// Full-stage loading beat with the chef goose flip-book. Same sprite and
// timing as the Schedule page's "dealing the plan" screen, for waits that
// are real (recipe generation) rather than staged.
import chefGooseSheet from "../assets/chef-goose-schedule-loading-v1.png";
import "./GooseLoading.css";

export default function GooseLoading({ title, sub, label = "Chef goose sorting recipe cards" }) {
  return (
    <div className="goose-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="goose-sprite" style={{ backgroundImage: `url(${chefGooseSheet})` }} role="img" aria-label={label} />
      <span className="goose-title">
        {title}
        <span className="goose-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
      {sub && <span className="goose-sub">{sub}</span>}
    </div>
  );
}
