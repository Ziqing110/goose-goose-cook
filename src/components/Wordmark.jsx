import { WORDMARK_LABEL, wordmarkGeometry, wordmarkSize } from "../utils/wordmark.js";

// The product name as drawn lettering. `variant` is "hand" (brand pass
// direction A, the default) or "mono" (direction B, caps); `cap` is the
// capital height in px. Ink follows currentColor, so it takes whatever
// text colour its container has.
export default function Wordmark({ cap, variant = "hand", className = "" }) {
  const { glyphs, stroke, viewBox } = wordmarkGeometry(variant);
  const { width, height } = wordmarkSize(cap, variant);
  return (
    <svg
      className={className}
      role="img"
      aria-label={WORDMARK_LABEL}
      viewBox={viewBox.join(" ")}
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flex: "none", overflow: "visible" }}
    >
      {glyphs.map((g, i) => (
        <path key={i} transform={`translate(${g.x} 0)`} d={g.d} />
      ))}
    </svg>
  );
}
