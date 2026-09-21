Design the **Inventory page** (session step 3 — the materials check) using the **Kitchen Path Agent Design System v1.0** already on this canvas. Everything visual — color tokens, Scale A type, 4px spacing, radii, the 14-glyph icon sheet, motion tokens, game vocabulary and the component set — comes from that system. Do not introduce any color, font, radius, shadow or icon it doesn't define. This brief only describes **what the page must do and which data it has**, so the result can be wired straight to the existing backend.

Inventory is a **planning surface** like Home: calm, white, quiet. Game feel comes only from vocabulary, the glyph sheet, mono numbers and the reveal/tap/spring motions. It is the one page where **red is allowed** (`--kp-critical`) — but only for the "blocked" count and blocked step rows, because those are literally the critical path.

The player's single job here: **tell the agent which ingredients they don't have, and see what that does to the run.** Everything is on hand by default; unchecking is the only input.

**Deliver:** Desktop 1280 and Mobile 390 artboards of the main state (**B · Some ingredients out**), a strip of the other states (A, C–F below), and one desktop close-up of an ingredient row in its four visual states (on hand / out / shared-across-dishes expanded / newly added by the player).

---

## 1. Vocabulary (from the system — use everywhere)

| backend / old copy | say instead |
|---|---|
| session | **run** |
| materials, "Required materials" | **ingredients** (page title: **Inventory**) |
| recipe graph | **main line** |
| "unavailable", unchecked | **out** — the row reads "Out" |
| "impossible" step | **blocked** |
| "affected" step | **at risk** |
| "All steps covered" | **Full inventory — every step is craftable** |
| "Not doable as-is" | **Run blocked** |
| phases prep / cook / plate | keep as is (`--kp-phase-prep/-cook/-plate`) |

If the system already defines a word for any of these, the system wins over this table.

Page title: **Inventory** (Scale A · 30/700). Session chrome above it reads **"Step 3 of 4 · Inventory"** (this page is being inserted between Conversation and the Main line, so the run now has 4 stages: Kitchen → Conversation → Inventory → Main line).

## 2. Data the page receives (already fetched; nothing else exists)

```
run (session)      { id, kitchenProfileId, status:"active",
                     conversation: { answers: { dishIdea, servings, diet, targetTime, cooks } },
                     recipes[]: { id, working:{ title, servings, nodes[] },
                                  custom_materials: { [materialId]: { label, category, amount, unit } } },
                     sharedSteps[]: { id, working: node } }

node               { id, label, description, phase:"prep"|"cook"|"plate",
                     estimated_duration_sec, difficulty:"low"|"medium"|"high",
                     required_equipment[]:"cutting_board"|"stove_burner"|"wok"|"pot"|"oven",
                     required_materials[]: materialId,
                     material_usage?: { [materialId]: { amount, unit } },     // only on some steps
                     usage_breakdown?: [{ title:dishTitle, material_usage }], // only on shared steps
                     depends_on[]: nodeId }

catalog[]          { id, label, category:"protein"|"seafood"|"vegetable"|"grain"|"pantry"|"other",
                     amount, unit }                                          // GET /api/materials

kitchenProfile     { name, burners, cuttingBoards, pots, hasWok, hasOven }

outIds: Set<materialId>   // the ONLY thing this page writes — ingredients the player marked "Out"
```

Values you may derive and show:

- **Run title** = every `recipes[].working.title` joined with " + " → "Mapo Tofu + Chicken Noodle Soup".
- **All nodes** = every recipe's `working.nodes` + every `sharedSteps[].working`. Step count = its length. **Total time** = Σ `estimated_duration_sec` ÷ 60, always mono ("42:00").
- **Ingredient list** = the union of `required_materials` across all nodes — *only ingredients some step actually uses*. Never show the whole catalog.
- **Ingredient info** = `catalog` merged with every recipe's `custom_materials` (player-added ones win). Gives `label`, `category`, `amount`, `unit`.
- **Amount shown** = if any node has `material_usage[id]`, the **sum** of those amounts (e.g. garlic: 3 + 2 = "5 cloves"); otherwise the catalog's own `amount unit`. Always mono.
- **Category groups**, in this fixed order with these exact labels: `protein` **Protein** · `seafood` **Seafood** · `vegetable` **Vegetables** · `grain` **Grains** · `pantry` **Pantry & sauces** · `other` **Other**. Empty groups are not rendered.
- **Reach** of an ingredient = number of steps whose availability it ultimately affects: the steps it is listed on, plus everything downstream of them through `depends_on`. Within a category, sort by reach descending, then by amount descending. Show it as the row's trailing mono figure, "→ 6 steps".
- **Used in** = the labels of the nodes that list the ingredient; **Dishes** = the titles of the recipes those nodes belong to (a shared step counts for every dish in its `usage_breakdown`). Only show dish attribution when the run has 2+ recipes.
- **Step availability** given `outIds` (this logic exists; mirror it, don't reinterpret it):
  - A step is **blocked** when *every* one of its `required_materials` is out, or when *every* one of its `depends_on` steps is blocked (cascades).
  - A step is **at risk** when *some but not all* of its ingredients are out, or when *any* of its dependencies is blocked or at risk (cascades, never escalates to blocked on its own).
  - Everything else is **craftable**.
  - Blocked reason copy: "missing {Tofu}" or "depends on "Cut tofu", which isn't doable". At-risk reason copy: "missing {Ginger}" / "depends on "Mince garlic", which isn't fully available" — joined with "; " when both apply.
- **Coverage summary** (one line, exact copy):
  - no steps blocked or at risk → "Full inventory — every step is craftable"
  - at-risk only → "{n} of {total} steps at risk"
  - any blocked → "Run blocked — {n} of {total} steps can't be done"

## 3. Page structure (top → bottom), mapped to system components

The app shell (top bar with the fork-branch mark + "Kitchen Path", the session chrome "Step 3 of 4 · Inventory" with its Exit-to-Home ghost Button, and the **VoiceBar** fixed at the bottom) is present on every session page — place it, don't redesign it. VoiceBar copy for this page, one line + one AI line: **"Tell me what you're out of — say 'no ginger'."** / **"Everything's on hand until you say otherwise."**

1. **Page title** "Inventory" with the quiet meta line (13/400, text-secondary): "{run title} · {servings} servings · {N} ingredients · {M} steps · {mono total time}".

2. **Coverage HUD** — the hero, on bg-secondary, no shadow. Answer "can I still cook this?" at a glance.
   - Section title (18/700): the **coverage summary** line. Its color: status-done when full inventory; `--kp-warning-text` when at risk only; `--kp-critical` when blocked.
   - Three stat tiles in a row (value mono 24/500, label 13/400 text-secondary underneath): **{on hand} / {N}** "ingredients on hand" · **{at risk}** "steps at risk" · **{blocked}** "steps blocked". The blocked value is `--kp-critical` only when > 0, otherwise text-primary like the others.
   - **Step bar**: a 4px segmented bar of all M steps in cook order — craftable segments `--kp-status-done`, at risk `--kp-warning`, blocked `--kp-critical`. Mono legend "17 craftable · 2 at risk · 0 blocked". This is the run's health bar; it is the only place all three colors sit side by side.
   - Trailing ghost Button "Mark everything on hand" — only rendered when `outIds` is non-empty.

3. **Ingredient groups** — one **list-card** per non-empty category, in the fixed order. Card header: category label (section title 18/700) + mono count "6 · 5 on hand" on the right.
   Each ingredient is one **ListRow**:
   - Leading: the system's **checkbox** control (44px target), checked = on hand. If the system has no checkbox, use ToggleSwitch — nothing invented.
   - Title (16/500): ingredient `label`. Mono amount right after it, text-secondary: "400 g".
   - Meta (13/400, text-secondary): "used in {k} steps" and, multi-dish only, one small neutral chip per dish title ("Mapo Tofu", "Chicken Noodle Soup"). A shared ingredient shows both chips.
   - Trailing: reach, mono 13, text-tertiary: "→ 6 steps".
   - **Out state** (unchecked): title and amount go text-tertiary with strikethrough, a Waiting-style neutral chip "Out" appears after the title, and the reach figure turns `--kp-warning-text` (or `--kp-critical` if unchecking it produced a blocked step). No red row backgrounds.
   - **Expandable detail** (tap anywhere on the row's text, not the checkbox): reveals a nested list of the steps that use it, one line each — mono step number + step label + phase dot in its phase color + mono duration. For a shared step with a `usage_breakdown`, add its per-dish split under the step: "3 cloves — Mapo Tofu · 2 cloves — Chicken Noodle Soup" (mono amounts). Only one row expanded at a time. Close-up artboard shows this.
   - **Player-added ingredient** (present in `custom_materials`): the same row with a small AI-style/neutral chip "Added by you" after the label. It has no dedicated backend flag — it's simply an id that is in `custom_materials` and not in the catalog.
   - Rows enter with **reveal** (60ms stagger within a card); the checkbox carries **tap**; the "Out" chip pops with **spring**.

4. **Impact panel** — list-card titled "What this changes". Desktop: right column beside the ingredient groups (sticky, ~360px). Mobile: below the groups.
   - Two sub-lists, blocked first: each entry = step label (16/500) + mono duration + the reason line (13/400). Blocked entries: `checkmark-burst` glyph slot replaced by a `--kp-critical` "✕"-style mark from the sheet if one exists, otherwise a critical-colored dot; at-risk entries: warning dot. No other icons.
   - Empty state (single meta line, text-tertiary): "Nothing — everything's craftable."
   - Reordering: whenever a checkbox changes, entries enter/leave with reveal; nothing bounces.

5. **Footer band** (the system's band-footer): left = mono tag "{craftable} of {M} steps craftable"; right = primary **Button lg** "Set the main line →". The button is **never disabled** — a blocked run still proceeds, the main line will show the blocked steps greyed out. When blocked > 0 the label becomes "Set the main line anyway →" and a ghost Button md "Mark everything on hand" sits to its left.

Desktop 1280: title + HUD full width; below it a two-column layout, groups left (flexible), impact panel right (360). Mobile 390: single column, HUD stat tiles stay in one row (three narrow tiles), impact panel after the groups, footer band sticky above the VoiceBar with the primary Button full-width.

## 4. Page states

**A. Full inventory** — nothing out. HUD line in status-done, bar all status-done, "What this changes" in its empty state, no "Mark everything on hand" anywhere.

**B. Some ingredients out — the main state.** Ginger and Parsley out: HUD line "2 of 19 steps at risk" in warning, bar shows warning segments, two at-risk entries in the impact panel, two rows in the Out state. Design this one first.

**C. Run blocked.** Tofu out: "Cut tofu" and "Blanch tofu" become blocked, "Combine & simmer" at risk, and everything downstream of it at risk. HUD line "Run blocked — 2 of 19 steps can't be done" in `--kp-critical`, blocked tile red, footer reads "Set the main line anyway →". This is the only artboard where red appears outside the HUD tile.

**D. Loading**: page title + meta line "Loading your ingredients…" (text-tertiary), nothing else. No skeleton.

**E. Ingredient catalog unreachable**: Error tint block (`--kp-error-bg/-text`) "Couldn't load the ingredient catalog: {message}" + secondary Button "Retry". The step count and title still render from the run.

**F. No dishes yet** (the run has no `recipes[]`): meta line "The agent is still setting your dishes…" (text-tertiary) with a pulsing mono "…" — the only loading motion the system allows. No ingredient groups, no footer button.

## 5. What this page does NOT do

- **No adding ingredients here.** Ingredients belong to steps; the "+ New material" form lives in the step editor on the main line. This page only reads `custom_materials`, never writes it.
- **No editing amounts, units or categories.** They come from the catalog / the step's `material_usage` and are display-only.
- **No per-dish toggle** ("skip Chicken Noodle Soup") — the backend has no way to drop a recipe from a run yet.
- **No substitutions, no shopping list, no quantities-per-serving math** — none of that exists in the backend; `servings` is shown but never used to scale amounts.
- Don't show the whole catalog; don't show equipment (that was the Kitchen stage).

## 6. Rules

- Copy in this brief is final; the app is English-only.
- Mono (JetBrains Mono) for every number: amounts, counts, durations, reach figures, step numbers, the "x / N" tile.
- Icons only from the 14-glyph sheet (`checkmark-burst`, `timer`, `fork-branch`, `mic` are the ones this page needs; equipment glyphs only if you choose to hint the equipment a step uses in the expanded detail). If the sheet has no ingredient or category glyphs, category headers are **text-only** — do not invent food icons, no emoji, no other icon set.
- `--kp-critical` appears only in: the HUD summary line and blocked tile (state C), blocked segments of the step bar, blocked entries in the impact panel, and the reach figure of an ingredient whose absence blocks a step. Never as a row background, never on a button.
- `--kp-warning-*` is the at-risk color everywhere; `--kp-status-done` is craftable.
- Mobile 390: single column, 16px gutters, 44px targets, checkbox is the full-height leading target of the row, primary action full-width, no horizontal scrolling.
- prefers-reduced-motion: per the system, every motion becomes a 200ms fade; the pulsing "…" becomes static.
