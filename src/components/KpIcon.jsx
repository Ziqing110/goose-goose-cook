// Kitchen Path glyph sheet — single-weight line icons on a 24px grid,
// stroke = currentColor so the caller sets color via CSS. Home only
// needs these; add glyphs here (not another icon set) when a page
// needs more.
const GLYPHS = {
  "fork-branch": (
    <>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M6 7.2v9.6M6.6 9c1 2.4 4 2.4 9.2 3" />
    </>
  ),
  flame: (
    <path d="M12 3c.6 3 2.6 4.2 4 6 1.3 1.6 1.8 3.1 1.8 4.6a5.8 5.8 0 0 1-11.6 0c0-1.7.6-3 1.9-4.4.5 1.5 1.2 2.1 1.8 2.1 1 0 1.6-1.2 1.4-3-.2-1.5-.5-3.2-.7-5.3Z" />
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4.5l2.8 1.8M9.5 3.5h5M12 3.5V6M18 6.5l1.5-1.5" />
    </>
  ),
  "checkmark-burst": (
    <>
      <path d="M8 12.5l2.8 2.8L16.5 9.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  burner: (
    <>
      <circle cx="12" cy="13" r="3" />
      <circle cx="12" cy="13" r="7" />
      <path d="M12 3v3M4 8l2 1.5M20 8l-2 1.5M12 23v-3" />
    </>
  ),
  "cutting-board": (
    <>
      <rect x="4" y="7" width="16" height="13" rx="1.5" />
      <path d="M10 7V4.5a2 2 0 0 1 4 0V7M12 4.5v1" />
    </>
  ),
  pot: (
    <>
      <path d="M5 10h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6Z" />
      <path d="M2.5 12H5M19 12h2.5M9 10V8.5a3 3 0 0 1 6 0V10M12 5.5V7" />
    </>
  ),
  wok: (
    <>
      <path d="M4 11h16a8 8 0 0 1-16 0Z" />
      <path d="M2 11h2M20 11h2M8 19l-1.5 2.5M16 19l1.5 2.5" />
    </>
  ),
  oven: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M3.5 9h17M7 6.5h1M10 6.5h1M13 6.5h1M7 13h10M7 12v5h10v-5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5.5a1 1 0 0 0-1 1v.5a3 3 0 0 0 3 3M16 6h2.5a1 1 0 0 1 1 1v.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z" />
    </>
  ),
};

export default function KpIcon({ glyph, size = 24, className = "", ...rest }) {
  const paths = GLYPHS[glyph];
  if (!paths) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`kp-icon ${className}`}
      {...rest}
    >
      {paths}
    </svg>
  );
}
