# Home v2 — turn on the game layer (within the system)

Iterate on the existing Home artboards (Desktop 1280 · Mobile 390 · modal · hero states). Keep the Kitchen Path Agent Design System v1.0 rules: white planning surface, no colored cards, no gradients, no emoji, no confetti. The game feel must come **only** from the four levers the system allows on a planning page — **vocabulary, the 14-glyph sheet, motion, and large mono numbers** — plus data that already exists in the backend. Every addition below is derivable from the data in the original brief; nothing needs a new backend field.

## 1. Hero → a "run card" that reads like a level select

- **Difficulty flames next to the run title.** `max(difficulty)` across all recipe nodes → 1–3 flames (Chip · difficulty, 16px, accent). This is the system's own difficulty language and the first thing a player scans.
- **HUD stats, not a meta sentence.** Replace "19 steps · 42:00" in the meta line with three small stat tiles in a row: `42:00` (timer glyph) · `19` steps · `4` servings — value in **mono 24/500**, label in 13/400 text-secondary underneath. Per the type rule "durations… are always mono — and in play, always large". Keep "Flat 3 galley · started 2h ago" as the quiet meta line above.
- **Phase bar.** Under the stats, a 4px segmented bar split by node count per phase using `--kp-phase-prep / -cook / -plate`, with a mono legend "8 prep · 9 cook · 2 plate". It's the run's "level layout" — the one place phase colors appear on Home.
- **Players chip.** `conversation.answers.cooks` → a chip "2 players" with a stacked pair of 20px PlayerAvatar circles in cook-a / cook-b (no initials — names don't exist yet). Sits with the flames chip.
- **Stage indicator as a path, not a bar.** Drop the continuous progress track under the stage chips; it duplicates them. Instead: three nodes joined by a 2px line (the `fork-branch` language). Done stage = checkmark-burst in status-done; current = accent node with the **pulse ring** (1.6s loop, static ring under reduced-motion) and its mono count "2 of 5"; future = status-waiting dot. Label under each node (13/400).
- **Buttons.** "Resume the run" stays the one loud button. "Abandon run" must not read as a second CTA: ghost, text-secondary, only turns `--kp-error-text` on hover.

## 2. Recent runs → a "run log" / personal leaderboard

- Leading **mono rank numbers** "01 02 03" (ListRow spec), newest first.
- Trailing **mono duration** computed as `endedAt − startedAt` ("38:20") next to the status chip — every finished run becomes a time to beat.
- **Trophy glyph** (20px, accent) after the title of the fastest completed run — the system's Leaderboard treatment, reused.
- Done chips **pop in with the spring**; rows enter with staggered **reveal** (60ms apart).
- Section header gains a mono record line on the right: "3 runs · 2 done · best 38:20".

## 3. Your kitchens → equipment as loadout

- Replace the text summary "2 burners · 1 board · 2 pots · wok" with the system's **equipment chips**: `burner` ×2 chip, `cutting-board` ×1, `pot` ×2, `wok`, `oven` — 16px glyphs, count in mono. Reads like a loadout; the row title stays 16/500.
- The kitchen used by the current run gets a small "In play" status chip (accent tint).

## 4. VoiceBar as the announcer

Keep the layout. Copy in the game voice, one line + one AI line:
- Resumable: "Ready when you are — say 'resume the run'." / "You're 2 of 5 into the conversation; I'll pick it up from there."
- Ready to start: "Say 'start the run' and I'll set the main line." / kitchen name.
- No kitchen: "Tell me about your kitchen and I'll build it." / —

## 5. Motion pass (add to the canvas as annotations)

- Page load: title, hero, kitchens, runs **reveal** in sequence (80ms stagger).
- Hero stat tiles: numbers **roll up** once on load (the ScoreCounter spring), then stay still.
- Current stage node: **pulse**. Nothing else loops.
- Every Button and row: **tap** (scale 0.97). Chips: **spring** pop on first paint.
- Reduced motion: all of the above collapse to the 200ms fade, ring becomes static.

## 6. Empty states get a glyph, not a sentence alone

- D · No kitchen yet: `burner` glyph 32px text-tertiary above "A run needs a kitchen first."
- Recent runs empty: `trophy` glyph 32px text-tertiary above "Your first run shows up here."
- Loading: replace the two text lines with a mono "…" that pulses (the only loading motion).

## 7. Don't

- No colored card backgrounds, no accent left-rails, no chamfers or extrusions (the system reserves those for Live cook).
- No confetti, no score points on Home — there is no scoring backend yet.
- Red stays reserved for the error block in state F.

Deliver the same artboard set, updated. Annotate each new element with the system token or component it uses.
