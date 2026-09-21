# Home page — Kitchen Path Agent

Design the **Home page** using the **Kitchen Path Agent Design System v1.0** already on this canvas. Everything visual — color tokens, Scale A type, 4px spacing, radii, the 14-glyph icon sheet, motion tokens, game vocabulary and the component set — comes from that system. Do not introduce any color, font, radius, shadow or icon it doesn't define. This brief only describes **what the page must do and which data it has**, so the result can be wired straight to the existing backend.

Home is a **planning surface**: per the system's own rule it stays calm, white and quiet. Game feel is carried only by vocabulary, the icon set and the reveal/tap/spring motions — no colored cards, no confetti here.

**Deliver:** Desktop 1280 and Mobile 390 artboards of the main state (a resumable run), a strip of the other hero states (B–F below), and the Add-kitchen modal over the desktop page.

---

## 1. Vocabulary (from the system — use everywhere)

| backend / old copy | say instead |
|---|---|
| session, cooking session | **run** |
| "Start cooking" / "Resume cooking" | **Start the run** / **Resume the run** |
| "Discard and start new" | **Abandon run** |
| "Recent sessions" | **Recent runs** |
| difficulty low/medium/high | 1–3 flames (Chip · difficulty) — not shown on Home |
| cooks | players (not stored by the backend yet — see §5) |

Page title: **Tonight's run** (Scale A · 30/700).

## 2. Data the page receives (already fetched; nothing else exists)

```
kitchenProfiles[]   { id, name, burners:int, cuttingBoards:int, pots:int, hasWok:bool, hasOven:bool }

run (session)|null  { id, kitchenProfileId, status:"active", startedAt:ISO,
                      conversation: { complete:bool, questionIndex:0–5,
                                      answers: { dishIdea, servings, diet, targetTime, cooks } },
                      recipes[]: { working:{ title, servings, nodes[]{ estimated_duration_sec, phase } },
                                   approved:object|null },
                      sharedSteps[] }

history[]           { id, dish, servings, kitchenProfileName, startedAt, endedAt,
                      status:"completed"|"abandoned" }
```

Values you may derive and show:
- **Run title** = every `recipes[].working.title` joined with " + " → "Mapo Tofu + Chicken Noodle Soup". Before recipes exist use `conversation.answers.dishIdea`; if that's empty, "Untitled run".
- **Kitchen** = the profile matching `kitchenProfileId` → its `name`.
- **Stage** (the run has 3 stages): `Kitchen` (done once a kitchen is set) → `Conversation` (`questionIndex` of 5 answered; done when `complete`) → `Main line` (the recipe graph; done when every recipe has `approved`).
- **Started** = relative time from `startedAt` → "started 2h ago".
- Once recipes exist: **steps** = total `nodes` across recipes + `sharedSteps`; **time** = Σ `estimated_duration_sec` ÷ 60, always mono ("42:00"); **servings** = `recipes[0].working.servings`.
- Kitchen equipment summary from the five fields only: "2 burners · 1 board · 2 pots · wok" (append "oven" when true).

## 3. Page structure (top → bottom), mapped to system components

The app shell (top bar with the fork-branch mark + "Kitchen Path", and the **VoiceBar** fixed at the bottom in its Listening state) is present on every page — place it, don't redesign it.

1. **Page title** "Tonight's run" — Scale A page title, no boxed band.
2. **Hero** — the run card. This is the piece to design well (states in §4).
3. **list-card "Your kitchens"** — header row: section title + secondary **Button** "Add kitchen". One **ListRow** per profile: leading `burner` glyph (24), title = kitchen name (16/500), meta = equipment summary (13/400, text-secondary), trailing ghost Button "Edit". Empty state (single meta line): "No kitchens yet — add one to start a run."
4. **list-card "Recent runs"** — one **ListRow** per history item: title = `dish` (or "Untitled run"), meta = "{kitchenProfileName} · {servings} servings · {endedAt as 'Sep 14'}"; trailing **Chip · status**: `completed` → Done chip (checkmark-burst, status-done), `abandoned` → Waiting-style neutral chip reading "Abandoned". Empty state: "Nothing here yet — your first run shows up after you finish or abandon one."

Rows enter with the **reveal** motion; every Button/row action carries **tap**.

## 4. Hero states

**A. Resumable run — the main state.** Answer "what am I resuming and how far along is it?" at a glance, on bg-secondary, no shadow.
- Section title (18/700): the **run title**.
- Meta line (13/400): "{kitchen} · {servings} servings · started {relative}" and, once recipes exist, " · {steps} steps · {mono time}".
- **Stage indicator**: the three stages Kitchen → Conversation → Main line as a compact row. Finished stages get the Done chip treatment (checkmark-burst, `--kp-status-done`); the current stage is in `--kp-accent` and shows its progress ("2 of 5" for Conversation); future stages use `--kp-status-waiting`. Reuse the SessionProgress bar underneath if it helps; keep it to one indicator.
- Actions: primary **Button lg** "Resume the run", danger/ghost **Button md** "Abandon run".
- Desktop: text left, actions right, one row. Mobile: stack, primary Button full-width.

**B. Ready to start** (no run, ≥1 kitchen): primary Button lg "Start the run" with the meta line "Cooking in {kitchen name}" when there is exactly one kitchen. With 2+ kitchens the button opens **C**.

**C. Pick a kitchen** (inline swap of the hero): section title "Which kitchen?", one secondary Button per kitchen name (wrapping row), ghost "Add a new kitchen", ghost "Cancel".

**D. No kitchen yet**: meta "A run needs a kitchen first." + primary Button lg "Add your first kitchen".

**E. Loading**: a single meta line "Loading your run…" / "Loading your kitchens…" (text-tertiary). No skeleton needed.

**F. Kitchen server unreachable**: Error tint block (`--kp-error-bg/-text`) "Couldn't reach the kitchen server: {message}" + secondary Button "Retry".

## 5. Add / Edit kitchen — Modal · KitchenProfileForm

Use the system's Modal (radius 12, the one allowed shadow). **Only the five backend fields exist**, so the form is:
- "Kitchen name" text field, placeholder "e.g. Flat 3 galley". Error state (empty on save): `--kp-error-text` message "Give this kitchen a name before continuing."
- Three **NumberSteppers** in a row, mono values: "Stove burners" (1–8, default 2) with `burner` glyph, "Cutting boards" (1–6, default 1) with `cutting-board`, "Pots" (0–6, default 2) with `pot`.
- Two **ToggleSwitch** rows: "Wok" (`wok` glyph, default on), "Oven" (`oven` glyph, default off).
- Optional warning block (`--kp-warning-bg/-text`) above the fields when the modal was opened from "Start the run": "A run needs a kitchen first."
- Footer: primary "Save kitchen", ghost "Cancel"; in edit mode add danger "Delete kitchen" on the far left.
- The system's KitchenProfileForm sample shows a rice cooker and a "Players in this kitchen" row — **leave both out**; the backend has no rice-cooker field and no player model yet.

## 6. Rules

- Copy in this brief is final; the app is English-only.
- Mono (JetBrains Mono) for every number: durations, servings counts, stepper values, dates in rows.
- Icons only from the 14-glyph sheet (`burner`, `cutting-board`, `pot`, `wok`, `oven`, `checkmark-burst`, `timer`, `fork-branch`, `mic` are the ones this page needs). No emoji, no other icon set.
- Red (`--kp-critical`) never appears on Home; the only red-family use is the Error tint block in state F.
- Mobile 390: single column, 16px gutters, 44px targets, primary actions full-width, no horizontal scrolling.
- prefers-reduced-motion: per the system, every motion becomes a 200ms fade.
