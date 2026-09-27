# Goose! Goose! Cook! — brand icon package

Source of truth: `../ICON_SPEC.md`. Selected art: `../goose-goose-cook-logo-options/chef-goose-baguette-doodle-v2.png` (1122×1402), **the goose hugging a baguette**, not any later frying-pan variant.

## Artwork

| File | Tier | Use |
| --- | --- | --- |
| `goose-lockup.svg` | L | Portrait goose + original hand-lettering; display ≥400px high |
| `goose-mark.svg` | M | Full goose without text; display 96–400px high |
| `goose-head.svg` | S | 32-unit head with two eyes; 2-unit stroke |
| `goose-head-16.svg` | S | Dedicated 16-unit, one-eye drawing; 1.5-unit stroke |
| `og-layout.svg` | L | Horizontal 1200×630 layout used for OG export |
| `wordmark-paths.svg` | L fragment | Original lettering outline-traced into real paths; no font dependency |

These are editable vector artwork, **not raster images embedded in SVG**. The goose was manually redrawn from the selected illustration, so it is not a pixel-identical automatic trace. `geometry.mjs` holds its editable centerlines. Only the lettering was contour-traced from the raster, at original resolution. No raster is used in small-icon exports.

M uses `vector-effect="non-scaling-stroke"` on every stroked path, keeping it at 2 CSS px over its entire size range. Closed shapes use `fill="var(--kp-bg, #fff)"`; outlines use `stroke="currentColor"`. In-app inline SVG inherits the app tokens. External SVG images cannot inherit CSS variables from their parent page; inline them when theming is needed.

## Production files in `public/`

- `favicon.svg`: transparent outer canvas, white head/toque, charcoal lines in light mode and #f7f6f3 lines in dark mode. Eye dots stay charcoal for contrast on the white head. At a viewport ≤20px, it switches to the one-eye 16px drawing.
- `favicon.ico`: independent transparent 16, 32 and 48px frames. The 16px frame uses the small master, not a downsample of the 32px frame. PNG-compressed ICO frames have been decoded and checked individually.
- `apple-touch-icon.png`: 180×180, fully opaque #ffffff, no pre-rounded corners. Artwork occupies approximately 70% of the tile height.
- `og-image.png`: 1200×630, fully opaque #ffffff, goose left and original wordmark right. Artwork stays inside y=15…615.

No manifest or PWA icons were added: the repository has no PWA manifest. Player and Toque avatar assets are untouched.

## In-app component

`src/components/BrandGoose.jsx` is generated from the same geometry, avoiding a second independently edited drawing.

- Default `BrandGoose`: 28px head, used in `AppShell`. The adjacent name is live text.
- Named `BrandGooseMark({ size = 120, className = "" })`: full-body M mark. Used at 120px in Home's loading state and at 96px in the cook journal header.
- Decorative inline SVGs use `aria-hidden` and `focusable="false"`; visible headings provide the name. No new focus targets or animation.
- Existing narrative loading animations and all player/Toque avatar systems remain separate and unchanged.

## Reproduce

From the repository root (Node dependencies installed; Python needs OpenCV and Pillow):

```sh
# Only necessary if the original hand-lettering changes:
python3 design/brand/trace-wordmark.py
node design/brand/build-masters.mjs
node design/brand/render-assets.mjs
python3 design/brand/package-ico.py
npm run build
# With this workspace's Vite server running on 127.0.0.1:5186:
node design/brand/verify-browser.mjs
```

`BRAND_QA_URL` can point the last command at a different local **development** server. Browser tests intercept backend calls and never write to real sessions. Browser launch may need OS permission outside a restricted sandbox.

## Review

Open `preview.html` at 100% zoom for the actual-size light/dark samples, including every ICO frame and the Apple tile. `qa/` contains screenshots and the browser check result. The contact sheet is for overview; don't assess 16px readability from a scaled-down contact sheet.

The 16px art retains a hat, beak and single eye, but the likeness is necessarily simpler than the full-body illustration. The favicon dark outline is intentionally near-white per the spec, with dark eyes retained to prevent them vanishing.

The HTML uses Vite's `%BASE_URL%` for local icon links. Production builds must resolve all three links to `/goose-goose-cook/…`; OG uses the absolute public URL. Local generation and testing do not publish the site.

### Verified 2026-09-27

- Actual-size SVG favicon 16/28/32/48/64 and ICO 16/32/48 reviewed on white and #202124. The 16px variant retains a single eye, hat and beak.
- ICO decoded frames match the independently rendered PNGs byte-for-byte. Apple 180² and OG 1200×630 have fully opaque white backgrounds.
- Actual app checked at 1920 and 1280px viewport widths with isolated backend fixtures: header head is 28px; journal mark is 96px with no title overlap; Home loading mark is 120px. No page exceptions.
- At 375px, the existing desktop-only screen-size guard is displayed. Mobile application layout was not enabled or changed.
- Production build succeeds; all icon hrefs carry `/goose-goose-cook/`; OG URL is absolute. Targeted ESLint and `git diff --check` pass. Vite retains its existing >500kB bundle-size warning.
- Browser evidence: `qa/browser-result.json`, `qa/topbar-*.png`, `qa/journal-*.png`, `qa/loading-desktop.png`. Backend data was not changed. No commit or deployment performed.
