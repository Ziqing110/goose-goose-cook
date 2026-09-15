// Design-system line icons: 24px grid, round caps/joins, stroke only.
// Ported from the Icon component in the Kitchen Path v4 design reference.
//
// TODO: merge with KpIcon.jsx (added on main for the Home v4 page). Both
// are near-identical ports of the same design-system icon set; keep one
// component and point the conversation page and Home at it.
const GLYPHS = {
  flame: [
    ["path", { d: "M11.6 2.2c.5 2.3 2 3.3 3.6 4.9 1.3 1.3 2 2.7 2 4.4a5.2 5.2 0 0 1-10.4 0c0-1.7.7-2.9 1.9-4.1.4 1.3 1 1.8 1.6 1.8.9 0 1.5-1 1.3-2.6-.1-1.3-.4-2.7-.6-4.4z" }],
    ["path", { d: "M12 12.9c1.3 1.1 1.9 1.9 1.9 2.9a1.9 1.9 0 0 1-3.8 0c0-1 .6-1.8 1.9-2.9z" }],
  ],
  burner: [
    ["circle", { cx: 12, cy: 12, r: 8.6 }],
    ["circle", { cx: 12, cy: 12, r: 3.3 }],
    ["path", { d: "M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2" }],
  ],
  "cutting-board": [
    ["rect", { x: 4, y: 2.6, width: 16, height: 14.8, rx: 3.4 }],
    ["path", { d: "M9.6 17.4v2.8a1.8 1.8 0 0 0 1.8 1.8h1.2a1.8 1.8 0 0 0 1.8-1.8v-2.8" }],
    ["path", { d: "M8.2 6.6h7.6" }],
  ],
  pot: [
    ["path", { d: "M5 9.4h14v5.2a4.6 4.6 0 0 1-4.6 4.6H9.6A4.6 4.6 0 0 1 5 14.6V9.4z" }],
    ["path", { d: "M2.6 9.4h18.8" }],
    ["path", { d: "M5 11.6H3.2M19 11.6h1.8" }],
    ["path", { d: "M9.6 3.2c-.9 1.1-.9 2.2 0 3.3M14.4 3.2c-.9 1.1-.9 2.2 0 3.3" }],
  ],
  wok: [
    ["path", { d: "M3.2 10.6h17.6c0 4.8-3.9 8.2-8.8 8.2s-8.8-3.4-8.8-8.2z" }],
    ["path", { d: "M20.4 10.6l2.4-2.4M3.6 10.6L1.2 8.2" }],
  ],
  "rice-cooker": [
    ["path", { d: "M4 10.6h16v6.4a3.4 3.4 0 0 1-3.4 3.4H7.4A3.4 3.4 0 0 1 4 17v-6.4z" }],
    ["path", { d: "M3.4 10.6a8.6 8.6 0 0 1 17.2 0" }],
    ["rect", { x: 9.2, y: 13.6, width: 5.6, height: 3.6, rx: 1.2 }],
  ],
  oven: [
    ["rect", { x: 3, y: 2.8, width: 18, height: 18.4, rx: 3.4 }],
    ["path", { d: "M3 9.4h18" }],
    ["circle", { cx: 7.2, cy: 6.1, r: 0.9 }],
    ["circle", { cx: 10.6, cy: 6.1, r: 0.9 }],
    ["path", { d: "M7.6 13.2h8.8" }],
  ],
  timer: [
    ["circle", { cx: 12, cy: 13.6, r: 7.9 }],
    ["path", { d: "M12 13.6V9.6M12 13.6h3.2" }],
    ["path", { d: "M9.8 2.4h4.4M12 2.4v3.3" }],
  ],
  "checkmark-burst": [
    ["path", { d: "M7.4 12.4l3.2 3.2 6-6.6" }],
    ["path", { d: "M12 1.6v2.4M12 20v2.4M1.6 12H4M20 12h2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M19.4 4.6l-1.7 1.7M6.3 17.7l-1.7 1.7" }],
  ],
  mic: [
    ["rect", { x: 9, y: 2.4, width: 6, height: 10.4, rx: 3 }],
    ["path", { d: "M5.4 11.4a6.6 6.6 0 0 0 13.2 0" }],
    ["path", { d: "M12 18v3.4M8.6 21.4h6.8" }],
  ],
  waveform: [["path", { d: "M3.4 10.8v2.4M7.7 7.4v9.2M12 4.4v15.2M16.3 8.6v6.8M20.6 10.8v2.4" }]],
  trophy: [
    ["path", { d: "M7.8 3.2h8.4v4.6a4.2 4.2 0 0 1-8.4 0V3.2z" }],
    ["path", { d: "M7.8 5.2H5.2a3.2 3.2 0 0 0 3.1 3.2M16.2 5.2h2.6a3.2 3.2 0 0 1-3.1 3.2" }],
    ["path", { d: "M12 12v3.6M8.4 20.6h7.2M10.2 20.6l.6-5M13.8 20.6l-.6-5" }],
  ],
  lightning: [["path", { d: "M13.4 2.4L6.2 13.6h4.9l-1.1 8 7.8-11.6h-5l.6-7.6z" }]],
  "fork-branch": [
    ["circle", { cx: 6.2, cy: 5.2, r: 2.3 }],
    ["circle", { cx: 6.2, cy: 18.8, r: 2.3 }],
    ["circle", { cx: 18, cy: 12, r: 2.3 }],
    ["path", { d: "M6.2 7.5v9M6.6 9.8c.4 2.4 2.6 2.2 9 2.2" }],
  ],
};

export default function Icon({ glyph, size = 24, color = "currentColor", stroke = 1.75, className }) {
  const parts = GLYPHS[glyph] ?? GLYPHS.flame;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "0 0 auto" }}
    >
      {parts.map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} />
      ))}
    </svg>
  );
}
