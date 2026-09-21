Design the **Schedule page** (session step 6 of 7 — the game plan before going live) using the **Kitchen Path Agent Design System v1.0** already on this canvas. Everything visual — color tokens, Scale A type, 4px spacing, radii, the 14-glyph icon sheet, motion tokens, game vocabulary and the component set — comes from that system. Do not introduce any color, font, radius, shadow or icon it doesn't define. This brief only describes **what the page must do and which data it has**, so the result can be wired straight to the existing backend and the existing scheduler.

Schedule is the **last planning surface** before Live cook: still white and calm, but it is the page where the run's *two players* and *per-player colors* appear for the first time, and where the **critical path** (the one legitimate red on a planning page) is drawn. Game feel comes from vocabulary, the glyph sheet, mono numbers, player colors and the reveal/tap/spring motions. No confetti, no score — scoring only starts on Live cook.

The player's job here, in order: **1) pick a mode, 2) read the plan the agent made for that mode, 3) go live.** Nothing on this page is edited by hand — the plan is computed, not authored.

**Deliver:** Desktop 1280 and Mobile 390 artboards of the main state (**A · Co-op plan**), a strip of the other states (B–F below), and a desktop close-up of one timeline lane with a selected task and its detail panel open.

---

## 1. Vocabulary (from the system — use everywhere)

| backend / old copy | say instead |
|---|---|
| session | **run** |
| cooks | **players** (the player's own name is used wherever it exists) |
| mode `cooperation` | **Co-op** |
| mode `competition` | **Versus** |
| "Start cooking" | **Go live →** |
| "Resume cooking" | **Back to the cook →** |
| "Throw away this cook" | **Abandon this cook** |
| makespan, "Estimated N min" | **Finish in {mono}** |
| "optimal" / "best of ≥ N" | not shown — see §2 |
| critical path | **critical path** (keep — it's the system's own term) |
| "Waiting for the cutting board" | **Waiting · cutting board** |
| Opening tasks (Versus) | **Opening hand** |
| Unclaimed pool | **Up for grabs** |
| locked (blocked by dependencies) | **Not yet** |

If the system already defines a word for any of these, the system wins over this table.

Page title: **Schedule** (Scale A · 30/700) — it must match the stage label in the session chrome. Session chrome reads **"Step 6 of 7 · Schedule"** (Kitchen → Conversation → Inventory → Main line → Players → **Schedule** → Live cook).

## 2. Data the page receives (already computed; nothing else exists)

```
run (session)     { id, kitchenProfileId, mode: null|"cooperation"|"competition",
                    cooks[]: { id, name, bound:true },            // ALWAYS exactly 2 players in this MVP, names already set
                    run: null | { startedAt, endedAt, mode, … } } // non-null = a cook is already in progress

approved          { title, servings, nodes[] }   // the approved main line, every dish merged
node              { id, label, description, phase, estimated_duration_sec, difficulty:"low"|"medium"|"high",
                    required_equipment[]: "cutting_board"|"stove_burner"|"wok"|"pot"|"oven",
                    depends_on[], _recipeId, _shared:bool }

kitchenProfile    { name, burners, cuttingBoards, pots, hasWok, hasOven }

schedule          { steps[]: { id, cookId, startSec, endSec, dependsReadySec,
                               requiredEquipment[],
                               startCause: { type:"dependency"|"equipment"|"cook", refStepId, equipmentType? } },
                    makespanSec, soloMakespanSec, savedSec,
                    criticalStepIds: Set<id>, unscheduledIds[]: id,
                    optimal:bool, lowerBoundSec }

opening           { bundles[]: { cookId, stepIds[], totalSec }, poolIds[], lockedIds[], contested:bool, skewSec }

missingEquipment  []: "wok"|"oven"|…   // equipment the plan uses that the kitchen says it doesn't have
```

Values you may derive and show:

- **Run title** = `approved.title` ("Mapo Tofu + Chicken Noodle Soup"). **Dish** of a step = the recipe it belongs to, or "Shared".
- **Player color** = by index in `cooks[]`: player 1 → `--kp-cook-a`, player 2 → `--kp-cook-b`. Never stored, never chosen. There is no player 3. **PlayerAvatar** = the system's colored circle with the name's first letter.
- **Finish time** = `makespanSec` as mono "34:00". **Solo baseline** = `soloMakespanSec`; **Saved** = `savedSec` → "12:00 faster than solo" (only when > 0).
- **Per-player load** = Σ (endSec − startSec) of that player's steps → mono "18:30 busy" + step count.
- **Wait gaps** = for each player, any gap between one step's `endSec` and the next step's `startSec`. Label from the next step's `startCause`: `equipment` → "Waiting · {equipment}" plus " — {holder's name} has it" when `refStepId` resolves to another player's step; `dependency` → "Waiting on "{step label}""; anything else → "Waiting".
- **Critical** step = `criticalStepIds.has(id)`.
- **Ticks** on the time ruler: whole minutes, mono, spaced so labels never collide (1 / 2 / 5 / 10 / 15 / 30 min steps as zoom changes).
- **Do not show** `optimal`, `lowerBoundSec` or any "px / min" readout. The solver's proof status is engineering telemetry, not a game stat; if you want it at all, it is a tooltip on the finish-time tile reading "Nothing can beat {lowerBound}" — nowhere else.

## 3. Page structure (top → bottom), mapped to system components

The app shell (top bar with the fork-branch mark + "Kitchen Path", the session chrome "Step 6 of 7 · Schedule" with its Exit-to-Home ghost Button, and the **VoiceBar** fixed at the bottom) is present on every session page — place it, don't redesign it. VoiceBar copy for this page, one line + one AI line: **"Say 'co-op' or 'versus', then 'go live'."** / **"Plan's ready — {finish} with {n} players."**

1. **Page title** "Schedule" + quiet meta line (13/400, text-secondary): "{run title} · {servings} servings · {N} steps · {kitchen name}".

2. **Mode picker** — comes **first**, because everything below it changes with the choice. Two large selectable cards side by side (the system's selectable card / segmented pattern; if the system has neither, two secondary Buttons xl with the selected one in accent outline — nothing invented):
   - **Co-op** — glyph `fork-branch` (24) · title 18/700 · body 13/400: "Follow the agent's assignment. Every 'done' re-plans the rest. Goal: fastest dinner."
   - **Versus** — glyph `trophy` (24) · title · body: "Only the opening hand is dealt. Claim the rest by voice. Score on difficulty."
   - Selected card: accent border (2px `--kp-accent`) + a Done-style chip "Selected" (spring pop). Unselected: bg-secondary.
   - Both cards are always enabled — a run always has exactly two players, so Versus is never disabled and nothing is pre-selected.
   - Once a cook is in progress (`run != null`) both cards are locked (disabled, selected one keeps its chip) with a meta line under them: "Mode is locked while a cook is in progress."

3. **Plan HUD** — the hero for the chosen mode, on bg-secondary, no shadow.
   - **Co-op**: three stat tiles (value mono 24/500, label 13/400 text-secondary): **{finish}** with the `timer` glyph "finish in" · **{saved}** "faster than solo" (tile omitted when savedSec = 0) · **{N}** "steps". To the right, one small **player chip** per player: PlayerAvatar (20) + name + mono "{k} steps · {busy}".
   - **Versus**: one tile — **{N}** "steps up for grabs" — plus the same player chips but with mono "{opening total} to open" instead of step counts (from `opening.bundles`).
   - Tile numbers **roll up** once on load (ScoreCounter spring), then stay still.

4. **Warnings** (only when their data is non-empty; each a Warning tint block `--kp-warning-bg/-text`, full width, above the plan):
   - `missingEquipment` non-empty: "Planned with a {wok} {kitchen name} doesn't have — timings assume you'll manage one. Real waits will be longer." Trailing ghost Button "Edit kitchen" (opens the Kitchen modal from Home).
   - `unscheduledIds` non-empty: this is an **Error** tint block (`--kp-error-bg/-text`), not a warning: "{n} steps depend on each other in a loop — there's no order that works. Break the loop on the main line: {labels joined with ', '}." Trailing secondary Button "Back to the main line". The primary footer button is disabled while this block is showing.

5. **The plan** — one list-card, its content depends on the mode.

   **5a. Co-op → Timeline** ("Who does what, when").
   - Card header: section title + legend on the right: swatch + "Critical path" (`--kp-critical` 2px outline swatch), hatched swatch + "Waiting". Then a **zoom** control: the system's segmented control with three stops "Fit · 1× · 2×" — not a slider, no pixel readout.
   - Body: a **fixed left column** of player lane labels (PlayerAvatar 32 + name 16/500 + mono "{busy} busy") and a **horizontally scrolling track**. Top of the track: the minute ruler (mono 12, text-tertiary, tick marks every chosen step; the first tick sits flush left).
   - One **lane** per player (60px tall). Blocks are absolutely positioned on time:
     - **Task block**: player's color as a tint (`--kp-cook-a-bg`, text in `--kp-cook-a`), radius from the system, 1px inset of the same color. Label 13/500 = step label; second line mono 12 = duration + " · {first equipment}". Progressive truncation as blocks get narrow: name + meta → name only → duration only → bare bar. Never clip mid-word.
     - **Critical task**: same block with a 2px `--kp-critical` outline — the only red on the page.
     - **Wait block**: hatched bg-secondary, dashed 1px `--kp-border`, label 13/400 text-secondary = the wait label from §2. Never clickable.
     - **Selected task**: accent outline 2px + the block lifts nothing (no shadow); `tap` on click.
   - Below the track: **Task detail** panel (bg-secondary, inside the card) for the selected block, else a single meta line "Tap any task for its exact timing." Detail panel: eyebrow = dish (mini-title), title = step label (18/700), description (13/400), then a 3×2 grid of mini-title + value: **Starts** mono "4:30" · **Ends** mono "8:30" · **Takes** mono "4:00" · **Player** PlayerAvatar + name · **Equipment** text · **Difficulty** Chip · difficulty (1–3 flames). Optional last lines: a Warning-toned meta "⚠ {wait label}" when the step started later than its dependencies allowed; and a `--kp-critical` meta "On the critical path — if this runs late, dinner runs late." Ghost Button "Close" top-right.
   - Blocks enter with **reveal** left-to-right per lane (40ms stagger). Selecting is `tap`.

   **5b. Versus → Opening hand.**
   - Card header: "Opening hand" + mono meta on the right "{skew} apart at the start" when `skewSec > 0` and not contested.
   - Intro line (13/400): "Everyone opens with a roughly equal chunk of work, and no two opening tasks fight over the same tool. After that, nothing is assigned — claim by voice."
   - One **bundle card** per player (bg-secondary, a 3px left rail in the player's color — this is the one page where the system permits the cook-color rail): PlayerAvatar 32 + name + mono "{total} to open"; then a list of ListRows: step label (16/500), trailing mono duration, meta = dish.
   - **Contested** (`opening.contested`): no bundle cards; instead a single Warning tint block: "Only {n} task(s) can start right now — not enough to deal everyone their own. First to claim it by voice gets it."
   - **Up for grabs**: a chip cloud. Ready tasks (`poolIds`) = neutral chips "{label} · {mono duration}"; not-yet tasks (`lockedIds`) = Waiting-style chips (text-tertiary) "{label}". Header: "Up for grabs · {mono total}" + meta "{ready} ready now · {locked} not yet".

6. **Footer band** (the system's band-footer, sticky above the VoiceBar on mobile):
   - Left: the mono tag for the mode — Co-op: "Co-op · finish in {finish}"; Versus: "Versus · {N} steps to claim". If no mode is selected yet: text-secondary "Pick Co-op or Versus to go live."
   - Right: primary **Button lg** **"Go live →"**, disabled until a mode is selected and `unscheduledIds` is empty. When `run != null`: the primary becomes **"Back to the cook →"** and a ghost/danger Button md **"Abandon this cook"** sits to its left; its confirm (system Modal, not a browser dialog): title "Abandon this cook?", body "You lose {done} completed steps and {elapsed} on the clock. This can't be undone.", danger "Abandon", ghost "Keep cooking".

Desktop 1280: title, mode picker (two cards, 50/50), HUD, warnings, plan card full width, footer. Mobile 390: mode cards stack (full width each), HUD tiles in one row, player chips wrap, the timeline keeps the fixed lane-label column at 96px and scrolls horizontally inside its own container (the page never scrolls sideways), task detail panel becomes a bottom sheet, footer primary full-width.

## 4. Page states

**A. Co-op plan — the main state.** Mia and Leo, 19 steps, finish 34:00, 12:00 faster than solo, two lanes with a couple of "Waiting · cutting board — Leo has it" gaps, three critical blocks, one task selected with the detail panel open. Design this one first.

**B. Versus.** Same run; opening hand dealt (Mia: one 9-min task; Leo: a 5 and a 4), "0:30 apart at the start", chip cloud of 14 up-for-grabs tasks with 6 "not yet".

**C. Nothing picked yet**: both mode cards unselected, HUD and plan card **not rendered** (the page is short), footer meta "Pick Co-op or Versus to go live." with the primary disabled.

**D. Cook already in progress**: mode cards locked, footer "Back to the cook →" + "Abandon this cook". Everything else as A.

**E. Missing equipment**: A plus the Warning block "Planned with a wok Flat 3 galley doesn't have…".

**F. Dependency loop**: the Error block with two step labels, plan card still rendered (the loop's steps simply absent from lanes), primary disabled.

**Loading** (approved plan not ready yet): page title + meta "Building your plan…" (text-tertiary) with the pulsing mono "…". No skeleton.

## 5. What this page does NOT do

- **No drag-and-drop, no manual reassignment, no editing durations** — the schedule is solved, not authored. If a player wants a different plan, they change the main line or the players.
- **No live progress here** — this page never shows what's done; that's Live cook. Even with a cook in progress it shows the *original* plan, locked.
- **No scoring, no leaderboard, no points** — Versus scoring exists only on Live cook and the summary.
- **No time-of-day** ("ready by 19:45") — the backend has no target clock time; every time is a mono elapsed duration from the start.
- **No solo and no third player** — this MVP is exactly two players, always. Don't design a one-lane timeline or a cook-c; "faster than solo" is a computed baseline, not a playable mode.
- Don't surface solver internals: no "optimal", no lower bound, no node budget, no "px / min", and no "hands-off steps aren't modeled yet" footnote — that's a dev note, not player copy.

## 6. Rules

- Copy in this brief is final; the app is English-only.
- Mono (JetBrains Mono) for every number: finish time, durations, busy totals, ruler ticks, start/end clocks, step counts, "apart at the start".
- Icons only from the 14-glyph sheet (`timer`, `fork-branch`, `trophy`, `checkmark-burst`, `mic`, `flame` for the difficulty chip, and the equipment glyphs `cutting-board`, `burner`, `pot`, `wok`, `oven` if you choose to show equipment as a glyph in the task detail). No emoji, no other icon set.
- `--kp-critical` appears only as: the critical-path outline on timeline blocks, the legend swatch, and the "On the critical path" line in the task detail. Never as a fill, never on a button. The Error block for a dependency loop uses `--kp-error-*`, not critical.
- Player colors are the only chromatic fills on the page (block tints, avatar circles, bundle rails). Accent is reserved for the selected mode card, the selected block outline and the primary button.
- Mobile 390: single column, 16px gutters, 44px targets, timeline in its own horizontal scroll container, primary action full-width.
- prefers-reduced-motion: per the system, every motion becomes a 200ms fade; the roll-up counters render their final value immediately.
