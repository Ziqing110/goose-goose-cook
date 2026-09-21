Turn up the **game layer** on the **Live cook** canvas (v3, with unattended steps). Everything that is wired — the data, the phases, the "Cooking on its own" list, the claim gating, the copy, the agent lines — stays exactly as it is. This pass changes **how it feels**: Live cook is the one play surface in the system and right now it reads like a planning page with bigger numbers. The system explicitly *reserves* colored card fills, the accent/player rail, chamfers and extrusions, and the one celebration for this page; the v3 canvas removed them. Bring them back, on purpose, and add the four levers below. **Versus first** — it should feel like a match; Co-op should feel like a shared shift, warm but calm.

Ground rules that still hold: read from 1.5 m with wet hands (text always on a white or near-white panel; the color goes *around* the panels, never under body text); 64px primaries; no emoji, no icon set outside the 14-glyph sheet; geese are the system's line-art geese (single-weight charcoal outline, one dot eye, one fill = the neckerchief in the player's color; personality is neck posture + a held object); no confetti; at most **three things loop at once** on the screen (the run clock, one due-pulse, one ambient), everything else is event-driven; reduced motion collapses all of it to 200 ms fades.

**Deliver:** 06 · D Versus desktop and 01 · A Co-op desktop rebuilt on this layer (mobile 390 of D); a **card-state close-up** — On it / Up next / Up for grabs / Waiting / Free hands / Done for the night / Due — with the goose slot in each; a **goose posture sheet** (slots G1–G8, placeholder line-art is fine, posture described in one line each — the final drawings are produced elsewhere in the system's style); a **motion sheet** listing every animation with trigger, duration, easing token, and its reduced-motion fallback; and a 3-frame **"score moment" storyboard** (Done pressed → points fly → leaderboard shifts → field seam moves).

---

## 1. The field — the background is the scoreboard

The page background stops being paper.

- **Versus: the split field.** The whole page behind the panels is split into two areas in the two player tints (`--kp-cook-a-bg` / `--kp-cook-b-bg`), meeting at a **soft diagonal seam**. The seam's position is `pointsA / (pointsA + pointsB)` — the leader's color literally takes more of the kitchen. At 65:45 the seam sits ~59 % across. On a score change the seam **slides** (spring, ~600 ms) — that motion *is* the leaderboard update. Tie: dead center. A player with 0 points still gets a 20 % minimum so nobody's color disappears. The seam breathes very slowly (the one ambient loop) — a 6 s ease, ±4 px; never faster.
- **Co-op: the shared shift.** One warm tint over the whole background (the system's bg-secondary pushed one step warmer, or a very low cook-a/cook-b blend — pick one, annotate the token). It warms slightly as `progress.pct` climbs (three stops: 0 / 50 / 100 %) — the kitchen heats up as dinner nears. When `driftSec` is showing ("behind plan") the warmth tips into `--kp-warning-bg` at the edges only, a vignette, never under the cards.
- Panels (cards, leaderboard, pool tiles, transcript) stay white and sit **on** the field with the system's extrusion/chamfer treatment — that's what makes them read as game pieces rather than form cards.

## 2. Cards as game pieces — each state must look different from 3 m away

Today "On it" and "Up for grabs" are the same white card with different chips. Give each state its own silhouette, not just a label:

- **On it** — the *hot* card. Full **player-color rail** on the left (8px, not 3) and the card's top edge chamfered in the player color; the timer block gets the player tint; the goose (G1) is at the pot. The step timer is the largest thing on the card and gets a thin **heat ring** around its block that fills as `actualSec / estSec` climbs, turning `--kp-warning` past 100 % — the over-time state is visible without reading digits.
- **Up next** (Co-op) — a *dealt* card: white, no rail, a dashed inset border, slightly lifted (extrusion 4px), Start button; goose G2 wing raised, ready.
- **Up for grabs** (Versus) — the *offer*: the card is visibly **not yet the player's** — no rail, the suggestion sits on a card-within-the-card that is rotated −2° and lifted, like a card being slid across the counter; "Take it" is the primary and **pulses once every 4 s** (the due-pulse budget is free here because nothing is due). Goose G6 eyeing the offer. The points chip is big here (mono 24) — this is where a player decides.
- **Waiting** — the *cool* card: bg-secondary fill, no rail, everything text-secondary, goose G3 leaning on the counter with its neck slumped; the countdown is the only dark element.
- **Free hands? Take this** — Up next's silhouette with the warning-tinted eyebrow and the goose G4 with both wings up.
- **Done for the night** — status-done tinted top edge, goose G5 asleep, head tucked under a wing; the checkmark-burst.
- **Due (moment due on a card or a row)** — the card's rail and top chamfer flash to `--kp-warning` with one **shake** (±3 px, 300 ms, the only shake in the system) and the goose snaps to G7 — neck straight up, beak open — for as long as the moment is due. This is the alarm; it replaces nothing, it adds to the row treatment already designed.

## 3. Geese — where they live

Each PlayerFocusCard gets a **64px goose slot** in the head row (replacing the 40px avatar circle there; the circle stays everywhere else). The posture is the state (G1–G7 above), the neckerchief is the player color. Two more slots:

- **G8 · the agent goose (Toque)** in the VoiceBar and the transcript column: idle = neutral; **speaking** (an agent line arriving) = neck extended toward the player it addresses, 400 ms, then back. Listening = the existing state dot; don't animate the goose for listening.
- **Leaderboard as a race.** Each bar carries its goose (32px) standing at the bar's end, walking forward when points change (the bar extends under it; the goose doesn't animate its legs — it slides, deadpan). The leader gets the trophy glyph as today. On a lead change the two geese swap order with a 300 ms crossfade, and the field seam (§1) slides at the same time.

Postures, one line each, for the sheet: G1 leaning over a pot, spatula in wing · G2 upright, one wing raised · G3 slumped on the counter, neck horizontal · G4 both wings up · G5 head tucked under a wing · G6 head tilted, one eye on the card · G7 neck straight up, beak open (the honk) · G8 chef's toque, neutral / extended. Test every one at 32px; if a posture doesn't survive, change the posture, not the size.

## 4. Urgency — make time physical

- **Moment countdown** (the 24/500 number beside "Check on it — 0:20"): under 10 s it grows to 32 and ticks (a 1 px vertical nudge per second, the system's tap motion at 0.98). Under 5 s it takes the warning color.
- **Run clock**: put it in a **scoreboard strip** — a dark band (the VoiceBar's surface) across the top of the play area holding the clock at 40/500, the "{done} / {total}" and, in Versus, both scores in their player colors. The header title moves above it, smaller. Two dark bands (this + the VoiceBar) frame the play area like a cabinet.
- **Points fly.** On Done in Versus, "+20" (mono 24, player color) rises out of the card and lands on the player's score in the scoreboard strip (600 ms, the spring), the ScoreCounter rolls, the leaderboard goose walks, the seam slides. Four things from one press — that is the reward loop. Co-op has no points; on Done the "{done} / {total}" counter rolls and the card's title crosses to the Done chip (already specced).
- **Claim moment** (Versus pool): a claim slides the tile into the claimant's color with the extrusion pressing down (tap), and a one-line toast in the transcript "Mia took Chop spring onion." — the other player *sees* the steal.
- **Behind plan** (Co-op): the drift chip in the scoreboard strip, and the field vignette from §1. Nothing else — never "ahead".

## 5. The one celebration — state G

Everything done: the field goes fully warm (both tints merge to the accent tint for 800 ms then settle), both geese to a **G9 · victory** posture (neck up, wings out — the only time both wings and neck are up), the scores roll to final, "That's everything. Dinner's up." in the transcript, footer flips to "Dinner's up →". In Versus the winner's goose gets the trophy glyph above its head and the seam slides fully to their side. No confetti, no loop; after the 800 ms it is a still frame.

## 6. Don't

- Don't color the text panels. Body text sits on white.
- Don't animate the geese's legs, eyes or beaks except G7's open beak and G8's neck — deadpan is the brand.
- Don't add sound iconography, "combo", "streak" or any stat the engine doesn't produce.
- Don't let more than three loops run at once; list them on the motion sheet per state.
- Don't use `--kp-critical` anywhere on this page. Urgency is warning-amber and the player's own color.
- Mobile 390: the split field still works (seam runs top-to-bottom behind stacked cards); the scoreboard strip is 56px; goose slots drop to 48px; the shake is replaced by the flash.
