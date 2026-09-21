Fix pass on **Live cook v3** (the canvas with unattended steps). The phase variants, the "Cooking on its own" list, the due-row treatment, the transcript hook lines and the Versus tile copy are right — keep them. The defects below are almost all **coherence with the Schedule v2 canvas**: Live cook is the same run, minutes later, and every name, number and description must come from that plan. Change only what each item names.

## 1. Use the real run — every step, everywhere

The run is **Mapo Tofu + Chicken Noodle Soup, 19 steps**, exactly as on Schedule v2. Its steps (duration · tending · equipment):

Mapo Tofu — Press the tofu 2:00 · Leave it · — | Dice the tofu 2:30 · board | Mince garlic & ginger 2:00 · board | Bloom the doubanjiang 1:30 · wok | Simmer the mapo sauce 2:00 · Timed · wok | Slide in the tofu 2:00 · wok | Thicken with slurry 2:00 · wok | Chop spring onion 2:00 · board | Toast the sichuan pepper 2:00 · burner | Plate the mapo 2:30 · —
Chicken Noodle Soup — Bone the chicken thighs 2:00 · board | Build the chicken broth 8:30 · Check on it (2 checks) · pot | Slice ginger & scallion 2:00 · board | Poach the chicken 2:30 · pot | Shred the chicken 2:00 · board | Simmer the noodles in broth 3:30 · pot | Blanch the greens 2:00 · pot | Season the broth 2:00 · pot | Plate the noodle soup 3:00 · —

These steps **do not exist** and must be replaced wherever they appear (03 four-variant close-up, 04 · B, 05 · C, 06 · D and its pool, 07 · E, 08 · F, 09 · G, 10 · H): Sauté onion carrot & celery · Blanch tofu · Reduce the stock · Measure stock bay leaf & thyme · Slice spring onion · Fry the chili oil · Warm the bowls · Steam the rice · Strain the stock · Cook the noodles · Crisp the tofu · Finish with chili oil · Plate the bowls. Suggested swaps:

- 03 close-up: cooking = "Dice the tofu" 1:07 / est 2:30; up next = "Bloom the doubanjiang" (1:30, wok); waiting = 'Waiting on "Dice the tofu", about 0:40 left.'; all done unchanged.
- 04 · B: Mia On it "Dice the tofu"; Leo Waiting on "Dice the tofu" (he needs the board) with the 0:40 countdown.
- 05 · C: Mia On it "Bloom the doubanjiang" 0:48 / est 1:30; Leo "Free hands? Take this" → "Chop spring onion" (2:00, board, difficulty 1). Note "Reduce the stock" as a 12:00 hands-on step contradicted the whole brief — nothing that long is hands-on in this run.
- 06 · D Versus: Mia On it "Thicken with slurry" (+35); Leo "Up for grabs" suggestion "Toast the sichuan pepper" (2:00, +10). Pool: claimable = Chop spring onion, Blanch the greens, Season the broth, Build the chicken broth (Check on it · "1:20 hands-on of 8:30 · +20"); taken = Simmer the mapo sauce (Mia, Timed, "Finish in 0:20"), Poach the chicken (Leo, 1:10); not yet = Plate the mapo "needs Thicken with slurry", Simmer the noodles in broth "needs Build the chicken broth", Plate the noodle soup "needs Season the broth", Slide in the tofu "needs Simmer the mapo sauce", Shred the chicken "needs Poach the chicken", Toast the sichuan pepper "needs Chop spring onion".
- 07 · E paused: the two cards show whatever A shows, greyed.
- 08 · F disambiguation buttons: "Build the chicken broth", "Slice ginger & scallion", "Poach the chicken".
- 10 · H step list: the 19 real steps.

## 2. Copy that must match Schedule v2 letter for letter

- Run title: **"Mapo Tofu + Chicken Noodle Soup"** (title case, as on Schedule and the cook card) — currently "Mapo tofu + chicken noodle soup".
- Step descriptions are the node's own text; use the Schedule's: "Dice the tofu" → "Even 2 cm cubes so they hold their shape in the sauce." (not "Two-centimetre cubes. Wet the knife, no rush."); "Build the chicken broth" → "Bones, aromatics, cold water. Skim once it comes up, then leave it alone." (not "Bones, water, ginger. Bare simmer, lid ajar."); "Shred the chicken" → "Two forks, along the grain, while it is still warm." Check every other card against the Schedule data.
- Equipment chips use the system's five names only: **Cutting board · Wok · Pot · Burner · Oven** — not "Board", not "Burner 2", not "Stock pot". The backend has no instance numbers and no pot sizes.

## 3. The time axis must be the Schedule's drawing

The row axis in the "Cooking on its own" list (01 · A, 03b, 03c, 12 · J) draws moments as 8px squares on a thick bar. Schedule v2 draws an unattended step as a **6px rail with small outlined moment blocks standing on it** — same color family, block taller than the rail. Use that exact language here, scaled to the row: rail 6px, moment blocks ~16px tall × 10px minimum, player-color outline, **past moments in the tint, the current/next moment filled**, the Start moment included at 0:00. Keep the two live-only additions — elapsed fill along the rail and the 2px now marker. A player should recognise the pot they saw on the Schedule.

## 4. Finish variant shows Done twice

In the 03b phase close-up (Finish) and in 12 · J the card has the primary green **Done** *and* the ghost **Done** on the left of the Skip/Undo row. In the Finish phase the ghost Done goes away — the primary is the Done. The ghost Done exists only in Start and Check, where there is no primary.

## 5. Versus claim gating

06 · D: Mia is On it, yet her claim button on the "Build the chicken broth" tile is enabled (blue). A player holding an active step — hands-on, or an unattended step in a moment — has **every** claim button disabled, with the "{name} is still on something" tooltip. Only Leo's buttons are live in that state.

## 6. Timeline continuity between A and J

01 · A is at 09:14 with Mia 1:07 into "Dice the tofu". 12 · J is at 13:32 with Mia at 2:12 of the same step — four minutes later she has moved 1:05. Per the plan she is on **"Slide in the tofu"** at 13:32 (started 13:00): show 0:32 / est 2:00, description "Push, never stir — the spatula goes under the cubes.", wok chip; her tofu row is gone (annotate "marked Done at 12:58" as you already do). Also make the desktop and mobile A clocks agree (09:14 vs 09:12).

## 7. Small things

- 01 · A Leo's card: the difficulty chip renders as a flame with no count — should read as the system's 1–3 flame chip (broth is difficulty 2 → two flames).
- Versus taken tile "Leo · Finish in 0:20" is the right copy; the same right-column phrasing ("Check 1/2 in 1:40", "Finish — now") should appear on every taken unattended tile, never a plain running time.
- The illustration placeholder "Slot 3 · chef leaning on a pot" in the Waiting variant: keep as a placeholder only if the system defines that illustration slot; otherwise remove it — Waiting cards in the v1 brief had an empty, reserved action block, nothing else.
