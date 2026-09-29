import BabyGoose from "./BabyGoose.jsx";

// The goose reacting at the card's bottom-right corner, under the text
// (z-index below the content, above the panel fill). The card's action
// block leaves room for it. `motion` is the wrapper's loop — bob,
// honk, or none — layered on the sprite's own frame cycle.
export default function CardGoose({ pose, size = 128, paused, motion = "bob" }) {
  return (
    <span className={`lc-goose is-${motion}`} aria-hidden="true">
      <BabyGoose pose={pose} size={size} paused={paused} decorative />
    </span>
  );
}
