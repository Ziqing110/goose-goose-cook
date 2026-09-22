// Chef Goose's marks — the profile picture, feather and footprints of the
// conversation skin, shared by the transcript and the understanding rail
// so the bird is one drawing rather than three.
//
// Every animated element carries `.anim`, which GooseMarks.css switches
// off under prefers-reduced-motion.
import "./GooseMarks.css";
import gooseProfile from "../assets/check-goose-clipped.png";

// The agent's profile picture: zoomed past the circle already drawn on
// the character art, not out to it — the source image is bigger than
// that circle, so it's shown as a background image sized and positioned
// (in the CSS) to fill the frame with the circle's inside, cropping its
// drawn ring away rather than landing it just inside the frame edge. The
// art already faces right, toward the words beside it, so it's shown
// unflipped. Round frame, with a slight wiggle. Shown at 36px in the
// transcript — a touch smaller than the cook's 40px avatar on the other
// side of the chat, on purpose — and at 22px in the rail header.
export function GooseProfile({ size = 30, delay = 0, className = "", ...rest }) {
  return (
    <span
      className={`goose-profile anim ${className}`}
      style={{ width: size, height: size, animationDelay: `${delay}ms` }}
      {...rest}
    >
      <span className="goose-profile-img" style={{ backgroundImage: `url(${gooseProfile})` }} />
    </span>
  );
}

// Falls across a card the moment its reading is confirmed. Asymmetric on
// purpose — two vanes of unequal width either side of an off-centre
// shaft that runs past the barbs into a bare quill. A symmetric oval
// with a centre line reads as a leaf.
export function GooseFeather() {
  return (
    <span className="goose-feather anim" aria-hidden="true">
      <svg width="24" height="40" viewBox="0 0 46 76" fill="none">
        <path
          d="M33 5c6 16 3 33-6 44-4 5-9 9-13 11 1-13 4-24 8-33"
          fill="#f7f2e6"
          stroke="#8a7a58"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M33 5c-7 12-13 24-16 35-2 8-3 15-3 20"
          fill="#fffdf7"
          stroke="#8a7a58"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path d="M33 5 14 60v12" stroke="#8a7a58" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// One webbed print: three splayed toes with deep rounded notches over a
// tapering heel. Size, rotation and colour are the only variables, so
// other surfaces can vary the count and the direction instead of
// repeating an arrangement.
const PRINT_PATH =
  "M13 3.2c1.6 0 2.2 1.6 2.4 3.4l.5 4.6c.1 1.2 1 1.6 2 1.1l3.6-1.8c1.6-.8 2.8.6 1.7 2L14.9 25c-1 1.3-2.6 1.3-3.5 0L2.9 12.6c-1-1.4.2-2.8 1.8-2l3.5 1.8c1 .5 1.9.1 2-1.1l.5-4.6C10.9 4.8 11.4 3.2 13 3.2Z";

// Size tracks depth: the palest print is the smallest, the deepest the
// largest. Muted warm brown, not black — these are empty states, and at
// full ink the prints pull focus off the copy.
const DEPTHS = {
  deep: { w: 21, h: 23, fill: "#f6cfa6", stroke: "#b08a63" },
  mid: { w: 17, h: 18, fill: "#faddbe", stroke: "#c2a081" },
  pale: { w: 13, h: 14, fill: "#fdeada", stroke: "#d2b79c" },
};

// Two slopes, so two slots side by side read as a bird wandering rather
// than as the same stamp twice. The upper row of each track always holds
// fewer prints than the lower row.
const TRACKS = {
  up: [
    { depth: "pale", right: 78, bottom: 6 },
    { depth: "mid", right: 50, bottom: 4 },
    { depth: "deep", right: 22, bottom: 23 },
  ],
  down: [
    { depth: "deep", right: 82, bottom: 24 },
    { depth: "mid", right: 52, bottom: 5 },
    { depth: "pale", right: 24, bottom: 4 },
  ],
  // Two prints rather than three, for a rail with more empty slots than
  // the two the design shows: five copies of the same track would read
  // as a stamp however the slopes alternate.
  few: [
    { depth: "mid", right: 62, bottom: 6 },
    { depth: "deep", right: 28, bottom: 19 },
  ],
};

const TRACK_ROTATION = { up: -18, down: 18, few: -12 };

export function GooseTracks({ variant = "up" }) {
  const prints = TRACKS[variant] || TRACKS.up;
  const rotation = TRACK_ROTATION[variant] ?? TRACK_ROTATION.up;
  return (
    <span className="goose-tracks" aria-hidden="true">
      {prints.map((print, i) => {
        const depth = DEPTHS[print.depth];
        return (
          <svg
            key={i}
            width={depth.w}
            height={depth.h}
            viewBox="0 0 26 28"
            fill="none"
            style={{ right: print.right, bottom: print.bottom, transform: `rotate(${rotation}deg)` }}
          >
            <path d={PRINT_PATH} fill={depth.fill} stroke={depth.stroke} strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}
