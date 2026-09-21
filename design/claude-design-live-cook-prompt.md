Design the **Live cook page** (session step 7 of 7 — the run in play) using the **Kitchen Path Agent Design System v1.0** already on this canvas. Everything visual — color tokens, Scale A type, 4px spacing, radii, the 14-glyph icon sheet, motion tokens, game vocabulary, the goose PlayerAvatars and the component set — comes from that system. Do not introduce any color, font, radius, shadow or icon it doesn't define. This brief only describes **what the page must do and which data it has**, so the result can be wired straight to the existing run engine.

Live cook is the system's **one play surface**. Everything the planning pages were forbidden — colored player cards, the accent rail, chamfers/extrusions, large mono numbers "in play", the ScoreCounter, one celebration — is allowed **here and only here**, exactly as the system defines it. It is still not a casino: two players, two big cards, one agent.

**Context that drives every decision:** this screen is propped on the kitchen counter and **shared by both players**, read from ~1.5 m with wet hands. Big type, 64px targets, no hover-only affordance, and **every voice command has a button next to the thing it acts on** — the button and the voice path are the same action.

**Deliver:** Desktop 1280 (the counter screen) and Mobile 390 artboards of the main state (**A · Co-op, both players mid-step**), a strip of the other states (B–I below), and a desktop close-up of one PlayerFocusCard in its four variants (cooking / up next / waiting / all done).

---

## 1. Vocabulary (from the system — use everywhere)

| backend / old copy | say instead |
|---|---|
| session | **run** |
| cooks | **players** (always their own names) |
| mode `cooperation` / `competition` | **Co-op** / **Versus** |
| "Cooking" (active step) | **On it** |
| "Up next" (assigned) | **Up next** |
| "Blocked — pick this up?" (idle_fill) | **Free hands? Take this** |
| "Waiting" | **Waiting** |
| "All done" | **Done for the night** |
| "Skip step" | **Skip** |
| "Put it back" (drop) | **Put it back** |
| "Up for grabs" / "still blocked" | **Up for grabs** / **Not yet** |
| "behind plan" | **behind plan** (keep) |
| "Finish cooking" / "Finish early" | **Dinner's up →** / **Call it early →** |
| "Save & see the card" | **See the cook card →** |
| "See the plan" | **The plan** |
| "Talk to the agent" | the agent's name from the system (the agent goose) |

If the system already defines a word for any of these, the system wins over this table. Agent lines quoted in §2 and §4 are **final copy** — they are what the engine actually says.

Page title is the **run title** (Scale A · 30/700) with a mode chip next to it — there is no "Live cook" heading; the session chrome already reads **"Step 7 of 7 · Live cook"**.

## 2. Data the page receives (already computed by the run engine; nothing else exists)

```
cooks[]      { id, name }                       // ALWAYS exactly 2 players
approved     { title, nodes[] }                 // the approved main line
node         { id, label, description, phase, estimated_duration_sec, difficulty:"low"|"medium"|"high",
               required_equipment[], depends_on[] }

run          { startedAt, endedAt:null|ISO, mode:"cooperation"|"competition",
               pausedAt:null|ISO, pausedSec,
               steps: { [nodeId]: { status:"pending"|"active"|"done"|"skipped",
                                    cookId, startedAt, endedAt, skipReason, pausedSec } },
               plan: null | { makespanSec, order:{ [cookId]: nodeId[] }, startSecById },   // Co-op only
               transcript[]: { id, at, speaker:"agent"|cookId, text } }                    // last 40 lines

progress     { total, done, skipped, active, pending, pct, elapsedSec, estimatedTotalSec, remainingEstSec, driftSec }
board[]      { cookId, name, points, doneCount, skippedCount, activeStepId }   // sorted, points desc
ready[]      nodeId   // pending + every dependency done/skipped
blocked[]    nodeId   // pending, still gated
variance     per active step: { estSec, actualSec, deltaSec, over:bool }

assignments  Co-op only — per player: { stepId, reason:"active"|"assigned"|"idle_fill"|"waiting"|"finished",
                                        waitingOnStepId, waitingOnCookId, etaSec }
suggestions  Versus only — per player: up to 3 nodeIds they should claim next

POINTS       low 10 · medium 20 · high 35   (Versus only; a skipped step scores 0)
UNDO_WINDOW  60 s, and only while nothing downstream has started
```

Values you may derive and show:

- **Clock** = `progress.elapsedSec` as mono "12:48", ticking once a second; frozen while paused. **Planned** = `estimatedTotalSec` (Co-op only). **Drift** = `driftSec` → "0:45 behind plan" only when > 30 s; never show "ahead".
- **Player color** by index in `cooks[]`: `--kp-cook-a`, `--kp-cook-b`. **PlayerAvatar** = the goose with the neckerchief in that color. The agent = the agent goose (`--kp-ai`).
- **Step timer** on an active step = `variance.actualSec` mono, turns `--kp-warning-text` when `over`; second line "est {estSec}" and " · {deltaSec} over" when over.
- **Points chip** (Versus) = "+{POINTS[difficulty]}" on any pending/ready step; **score** = `board[].points`.
- **Waiting copy** (Co-op): "Waiting on "{step}", about {mono etaSec} left." — drop the ETA clause when `etaSec` is null.
- **Everything's done** = every step done or skipped → the agent has already said **"That's everything. Dinner's up."**

## 3. Page structure (top → bottom), mapped to system components

The app shell top bar and the session chrome are present but **minimal** on this page — it's a play surface; the chrome must not compete with the two player cards. The **VoiceBar** is fixed at the bottom and is the page's voice input (see §3.6).

1. **Run header** — one row. Left: run title (30/700) + mode chip (Co-op with `fork-branch` / Versus with `trophy`). Right: the **HUD**: `timer` glyph + mono clock **32/500** (the largest number on the page), "{done} / {total}" mono, drift chip in `--kp-warning-*` when present, then two ghost Buttons md: **Pause** (becomes primary **Resume** while paused) and **The plan**. No progress bar here — the count is the progress.

2. **Paused banner** — only while `pausedAt` is set. Warning tint block, full width: "Paused — every clock is stopped and the break won't count against anyone. Nothing can be started or finished until you resume." Every action button on the page is disabled while it shows.

3. **Leaderboard** — Versus only, above the cards. Two rows, sorted by points: PlayerAvatar 32 + name + a bar in the player color (width = points / top) + mono points **24/500** on the right (ScoreCounter roll on change). The leader's row gets the `trophy` glyph (16, accent) after the name. Tie: no trophy.

4. **PlayerFocusCards** — the hero. Two cards side by side, **equal height**, each in its player's color treatment (the system's play-surface card: color tint background or the color rail — whichever the system defines; both cards use the same treatment). Every variant renders the same skeleton — eyebrow, title, body, then an action block pinned to the bottom — so the two cards line up even when one is waiting.
   - **Head**: PlayerAvatar 40 + name 18/700; Versus adds mono "{points} pts".
   - **Variant · On it** (`active`): eyebrow "On it"; title = step label **24/700**; description 16/400; **step timer** mono **40/500** with "est 4:00 · 1:12 over" beneath; tags: Chip · difficulty (flames), equipment chips (glyphs from the sheet), Versus adds "worth +20". Actions: primary **Button xl** (64px) **"Done"** in `--kp-status-done`, full card width; beneath, ghost "Skip" and (Versus only) ghost "Put it back"; ghost "Undo" on the far right of that row (only enabled inside the 60 s window).
   - **Variant · Up next** (`assigned`): eyebrow "Up next"; same title/description; tags: difficulty + mono duration (+ points in Versus). Action: primary Button xl **"Start"**.
   - **Variant · Free hands** (`idle_fill`): eyebrow "Free hands? Take this" in accent; identical to Up next but the primary reads **"Take it"**. The card must read as an *offer*, not an order — the system's warning-tinted eyebrow, no colored fill change.
   - **Variant · Waiting** (`waiting`): eyebrow "Waiting"; body = the waiting copy from §2 with the other player's PlayerAvatar 20 inline when `waitingOnCookId` is set; if `etaSec` exists, a mono countdown **24/500**. Action block empty but reserved.
   - **Variant · Done for the night** (`finished`): eyebrow "Done for the night"; body "Nothing left for you." with the `checkmark-burst` glyph 32 in status-done. Action block empty.
   - **Versus, no active step**: eyebrow "Up for grabs"; body = the player's top suggestion (label + duration + points) with primary **"Take it"**; the full pool is the board below.
   - Motion: "Done" → the card's title crosses to the Done chip treatment with **spring**, then the next step **reveals** in. Timer digits do not animate. Reduced motion: 200 ms fade.

5. **Task pool board** — Versus only, under the cards. Section title "Up for grabs" + meta "{ready} ready · {blocked} not yet". A grid of tiles (min 200px):
   - **Claimable** (in `ready[]`): label 16/500, mono "{duration} · +{points}", and **two claim buttons, one per player** in that player's color (44px, name as label). A player's button is disabled while they hold an active step (tooltip "{name} is still on something"). Two buttons is deliberate — on a shared screen a tap must say who tapped.
   - **Taken** (`active`): tile in the holder's color with PlayerAvatar 20 + name + mono running time.
   - **Not yet** (in `blocked[]`): text-tertiary, mono "needs {dependency labels}".
   - Tiles `reveal` in; a claim `spring`s the tile into its Taken state.

6. **VoiceBar = the agent** — the system's VoiceBar, fixed at the bottom, in its Listening state. This page uses it fully:
   - **Speaker**: the backend cannot tell voices apart yet, so the bar carries a **two-segment speaker toggle** (the two PlayerAvatars 24, selected one in its color) on the left. Everything said is attributed to that player. Mark it in the annotations as "temporary until voice ID lands."
   - **Transcript** above the input: the last lines of `run.transcript`, agent lines with the agent goose 20 + `--kp-ai` text, player lines with their PlayerAvatar 20; newest at the bottom; the panel keeps ~4 lines visible and scrolls. On desktop it may sit as a slim column to the right of the cards instead — pick one, annotate why.
   - **Disambiguation**: when the agent asks "Which one did you finish?" / "Which one are you starting?" / "Which one? Tap it or say the name." / "Which one should I skip?" / "Which one are you putting back?", up to **3 secondary Buttons** (step labels) + ghost "Cancel" appear directly under that line.
   - **Hint line** (13/400, text-tertiary, always visible): 'Say "done", "start", "take <task>", "skip", "status", or "score". Every one of those is also a button.'
   - Recognized intents, for the annotation strip: done · start · take/claim · skip · put it back/drop · undo · status · score · help · pause/resume · "we're done"/"dinner's up" (finish).
   - The typed-text fallback input stays (it is how the demo drives the page today) but is visually secondary to the mic.

7. **Footer band**: left = ghost **"Call it early →"** while steps remain (confirm Modal: title "Call it early?", body "{n} steps aren't done — they'll be marked skipped.", danger "Call it", ghost "Keep cooking"); when everything is done the footer flips: primary **Button lg "Dinner's up →"** on the right, nothing on the left. Never a browser dialog.

Desktop 1280: header; (leaderboard); the two PlayerFocusCards 50/50 with a 24px gutter; (pool board); footer; VoiceBar fixed with the transcript column optional on the right. Mobile 390: cards **stack** — the *speaking* player's card first? No: **fixed order by player index**, always, so nobody's card jumps; the timer size drops to 32/500, primary buttons stay 64px full-width; the pool board becomes a single column; the transcript collapses to the last 2 lines inside the VoiceBar with a "more" ghost.

## 4. Page states

**A. Co-op, both players mid-step — the main state.** Mia "On it" on "Sauté onion, carrot & celery" at 3:42 of est 5:00; Leo "On it" on "Blanch tofu" at 2:31 of est 2:00, **0:31 over** (timer in warning). Clock 12:48, 6 / 19, no drift. Transcript: agent "Timer running on Blanch tofu. Est 2:00." Design this one first.

**B. Co-op, one waiting.** Leo's card in Waiting: 'Waiting on "Blanch tofu", about 0:40 left.' with Mia's avatar inline and the mono countdown.

**C. Co-op, free hands offer.** Leo's own next step is blocked; his card shows "Free hands? Take this" → "Measure stock, bay leaf & thyme" with "Take it".

**D. Versus.** Leaderboard Mia 65 · Leo 45 (trophy on Mia), both cards with "pts", Leo's card "Up for grabs" suggestion, pool board with 4 claimable tiles (two claim buttons each), 2 taken, 6 not yet.

**E. Paused.** Banner up, Resume as the primary in the header, every action disabled, clocks frozen.

**F. Disambiguation.** Agent line "Which one did you finish?" with three step-label Buttons + Cancel under it in the VoiceBar.

**G. Everything done, not yet finished.** Both cards in "Done for the night", agent line "That's everything. Dinner's up.", footer primary "Dinner's up →". This is where the system's **one celebration** fires (if it defines one — otherwise the `checkmark-burst` spring on both cards). Nothing loops.

**H. Finished (run.endedAt set).** The cards and pool are replaced by a single **Service done** panel: eyebrow "Service done", headline mono "{elapsed} on the clock" + meta "planned {planned}" (Co-op); Versus adds "{winner} wins it" or "Tied — Mia and Leo, 65 each"; two player score tiles (PlayerAvatar + mono points + "{done} done · {skipped} skipped"); then a compact ListRow list of every step: label + mono "est 2:00 · actual 2:31 · 0:31 over" (skipped rows text-tertiary "skipped"). One primary Button lg **"See the cook card →"** ("Saving…" while saving; on failure an Error tint line "{message} Nothing is lost — try again." and the button reads "Try again"). The full shareable card is a separate page — don't design it here.

**I. No run.** Meta "No cook in progress." + primary "Back to the plan". (Reached only by deep link.)

## 5. What this page does NOT do

- **No editing steps, no reordering, no changing the plan** — the engine re-plans by itself after every Done/Skip/Put-it-back. Show the result, never a "re-plan" button.
- **No third player, no spectator** — exactly two cards, always.
- **No per-step photos, notes or ratings** — the run records status and timestamps only.
- **No point breakdown beyond difficulty** — scoring is flat per tier; don't design "speed bonus" or "quality" chips.
- **No "ahead of plan" praise** — the engine only reports being behind.
- **No timeline / Gantt on this page** — that's "The plan" (Schedule); here the plan exists only as "Up next".
- Don't put "Undo" in a global footer — it undoes *one player's* last action, so it lives on that player's card.

## 6. Rules

- Copy in this brief is final; the app is English-only. Agent lines are the engine's own — reproduce them verbatim.
- Mono (JetBrains Mono) for every number, and **large in play**: the run clock 32, step timers 40 (32 on mobile), points 24, countdowns 24. Estimates and deltas 13.
- Icons only from the 14-glyph sheet: `timer`, `checkmark-burst`, `trophy`, `fork-branch`, `mic`, `flame` (difficulty chip), the equipment glyphs (`cutting-board`, `burner`, `pot`, `wok`, `oven`) on tags. No emoji, no other icon set. Avatars are the system's geese only.
- Player colors are the only chromatic fills (cards, claim buttons, leaderboard bars, taken tiles). `--kp-status-done` is reserved for the "Done" button and finished states; `--kp-warning-*` for over-time timers, drift and the paused banner; `--kp-ai` for the agent's lines. `--kp-critical` does **not** appear on this page — nothing here is a critical path.
- Targets: 64px for Done / Start / Take it, 44px for everything else. No hover-dependent affordance anywhere.
- Mobile 390: single column, 16px gutters, fixed player order, no horizontal scrolling.
- prefers-reduced-motion: per the system, every motion becomes a 200 ms fade; the ScoreCounter and celebration render their final state immediately.
