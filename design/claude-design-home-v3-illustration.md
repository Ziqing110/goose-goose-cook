# Home v3 — one illustration, in one state only

Iterate on the existing Home artboards (Desktop 1280 · Mobile 390 · modal · hero
states A–F). Everything from the Kitchen Path Agent Design System v1.0 and from
Home v2 stays as-is. This brief adds exactly **one** new asset and says where it
may and may not appear.

## The asset

A 3:1 line-drawing banner of a kitchen counter: two gas burners (one lit), a wok
hanging from a rail above, a cutting board standing upright, two stacked pots,
and an oven below. Single-weight charcoal outline on the page ground. The lit
burner flame is the only filled shape in the entire illustration; it uses
`--kp-accent`.

It is a **quiet band**, not a hero image. It must never out-weigh the button
underneath it.

## Where it goes — hero state D only

**D · No kitchen yet** is the only state that gets the illustration. The hero
becomes, top to bottom:

1. The banner. `width: 100%`, `max-width: 560px`, centered, aspect ratio 3:1.
   32px above it, inside the hero card.
2. 28px gap.
3. Meta line "A run needs a kitchen first." (13/400, text-secondary).
4. 16px gap.
5. Primary **Button lg** "Add your first kitchen".

**560px is a hard maximum, not a suggestion.** The banner's strokes are drawn at
roughly 4.5px against a 2172px-wide source; below 560px displayed they fall under
one CSS pixel and anti-alias into grey mush instead of charcoal line. Do not
stretch it to the hero card's full inner width (~1092px) either — at 364px tall
it stops being a band and becomes the page.

Mobile 390: the banner takes the card's full inner width (~318px) and its own
proportion. It reads because phone screens are 2–3x DPR; desktop is the case the
560px cap protects.

This replaces the v2 rule "`burner` glyph 32px text-tertiary above the sentence"
— the banner supersedes that single glyph in state D. Every other v2 empty state
keeps its glyph.

## Where it must NOT go

- **State A (resumable run)** — the hero's job there is to answer "what am I
  resuming and how far along" in one glance. An illustration pushes the HUD
  stats and "Resume the run" down and costs more than it gives.
- **States B, C, E, F** — a player who already has a kitchen has seen this
  image; repeating it makes the page decorative rather than informational.
- **The Add / Edit kitchen modal** — the form already carries five controls; the
  illustration would push the footer buttons past the fold.
- **Recent runs empty state** — keeps its `trophy` glyph from v2. Two
  illustrations on one page is one too many.
- **Any page under /session** — the conversation and the recipe graph are work
  surfaces, not welcome surfaces.

## Rules it inherits

- No colored card behind it, no border, no rounded corners of its own. It sits
  directly on the hero's `bg-secondary`, which is also the banner's own ground —
  the two must be the same value so the banner has no visible edge.
- One accent fill only (the flame). No phase colors — those stay reserved for
  the phase bar, where they carry meaning.
- Enters with the **reveal** motion, in sequence with the rest of the hero.
  It never loops, never animates on hover.
- Under `prefers-reduced-motion`, the 200ms fade like everything else.
- It carries no information, so it is `aria-hidden` / decorative — the sentence
  underneath is what a screen reader gets.

## Deliver

The Desktop 1280 and Mobile 390 artboards of **state D** only, updated. Annotate
the illustration's max-width and its vertical rhythm against the meta line and
the button.
