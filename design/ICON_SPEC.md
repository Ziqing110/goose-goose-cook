# Icon spec: GOOSE! GOOSE! COOK!

This is the one standard for every brand icon file. The source is the hand-drawn chef goose holding a baguette, with the hand-lettered wordmark below it (`icon.png`, 1122×1402).

## 1. What the source can and can't do

Measured on the source file:

| | Value | Consequence |
|---|---|---|
| Canvas | 1122×1402, portrait | Not square. Every icon slot below is square. |
| Background | Opaque #fefefe, no alpha | It can't sit on a tinted or dark ground without leaving a white box. |
| Goose ink bbox | 286×802 (about 1:2.8) | It's very tall and thin. Fitted into a square, the goose fills about a third of the width. |
| Stroke | About 7–8px | At 32px the full-body stroke is about 0.3px, so it disappears. |
| Format | Raster only | There's no vector master, so each size is a resample of a resample. |

Downscale test (same source, Lanczos):

- **Full body:** fine at 180, thin at 64, **unreadable at 32**.
- **Head crop** (toque + head + beak): good at 64, **passable at 32**, lost at 16.

So one drawing can't cover every size. There are three tiers, and each is drawn for its own size range rather than shrunk from the one above it.

## 2. The three artwork tiers

| Tier | Content | Used at | Stroke rule |
|---|---|---|---|
| **L · Lockup** | Full goose + wordmark | ≥ 400px tall: OG image, posters, README, splash | As drawn (7–8px at 1402 tall ≈ 0.55% of height) |
| **M · Mark** | Full goose, no wordmark | 96–400px tall: empty states, loading, about page | Redraw so the stroke is **≥ 2px at display size** |
| **S · Head** | Toque + head + beak, cropped at the neck | ≤ 64px: favicon, top bar, app icons | **2px at 32px** (1/16 of the canvas); at 16px, 1.5px |

Rules for **S · Head**:
- A square artboard. The head is centered optically, not by its bounding box, since the beak pulls it left.
- At 16px, drop to **one eye dot** and simplify the toque to three bumps. Two dots 1px apart merge into a smudge.
- No wordmark below 400px. Hand lettering at icon sizes is noise.

## 3. Color

- Line: `--kp-text` **#1a1a1a**, not pure black, matching the app's text.
- Ground: transparent in SVG and favicon. Where the platform forces an opaque tile, use `--kp-bg` **#ffffff**.
- Dark mode: in `favicon.svg`, the line flips to #f7f6f3 via `@media (prefers-color-scheme: dark)`, and the toque and head keep a white fill so they don't turn into a hole.
- **No accent and no player colors in the icon.** A single-color line mark is what reads in a browser tab.

## 4. Files to produce

Put these in `public/`. In the Pages build the site lives under `/goose-goose-cook/`, so after `npm run build`, check in `dist/index.html` that the icon hrefs carry that prefix.

| File | Size | Tier | Background | Required? |
|---|---|---|---|---|
| `favicon.svg` | vector, 32×32 viewBox | S | transparent, dark-mode aware | **Required**: modern browsers |
| `favicon.ico` | 16 + 32 + 48 in one file | S (16 uses the simplified head) | transparent | **Required**: fallback, bookmarks, Windows |
| `apple-touch-icon.png` | 180×180 | S | **opaque #ffffff** (iOS turns transparency black) | **Required**: iOS/iPadOS home screen. No rounded corners; iOS rounds them itself. Mark at about 70% of the canvas. |
| `og-image.png` | 1200×630 | L, laid out horizontally (goose left, wordmark right) | #ffffff | **Required**: link previews (Slack, WeChat, X). Keep content inside the central 1200×600. |
| `icon-192.png`, `icon-512.png` | 192, 512 | S | transparent | Only if we add a web manifest / PWA |
| `icon-maskable-512.png` | 512 | S | opaque #ffffff | Only with a manifest. Mark inside the central circle of 410px diameter (the 80% safe zone). |

Master files live in `design/brand/`, not `public/`:
- `goose-lockup.svg` (L), `goose-mark.svg` (M), `goose-head.svg` (S), `goose-head-16.svg` (S, simplified).
- Every SVG uses `stroke="currentColor"` and `fill="var(--kp-bg, #fff)"` on the closed shapes, so one file serves light and dark in the app.

## 5. In-app sizes

| Where | Tier | Display size | Notes |
|---|---|---|---|
| Top bar brand mark | S | **28px** tall, inline SVG | Replaces the 22px node-graph glyph in `AppShell.jsx`. The wordmark next to it is live text, not part of the image. |
| Empty state / loading | M | 120–200px | |
| Journal / summary card header | M | 96px | |

Player and Toque avatars are a **separate system** and aren't covered here. They stay 1254×1254 transparent PNGs, displayed at 44 / 28 / 20.

## 6. HTML

```html
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:image" content="https://ziqing110.github.io/goose-goose-cook/og-image.png" />
<title>Goose! Goose! Cook!</title>
```

`og:image` must be an absolute URL, because crawlers don't resolve relative paths.

## 7. Acceptance check

- [ ] Each S file checked at actual size (1×) on white **and** on #202124 (the dark Chrome tab strip).
- [ ] At 16px you can still tell it's a bird wearing a hat.
- [ ] Nothing is resampled from the 1122×1402 raster below 180px. Small sizes come from the S masters.
- [ ] `dist/index.html` icon paths start with `/goose-goose-cook/`.
