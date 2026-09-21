Fix pass on **Schedule v2** (the canvas with unattended steps). The rail + moment drawing, the equipment lanes, the detail panel and the anatomy frame are right — keep them. What's below is a list of defects; change only what each item names.

## 1. Unattended steps have no label on the player's lane

On 01 · A, 03 and 03b, Leo's broth and Mia's tofu/sauce show a rail and moment blocks but **no step name anywhere on the player's lane** — a player reading Leo's lane can't tell what's cooking without tapping. Rule: draw the step label as **unboxed text, 12/500, in the player's color**, vertically centered in the block zone above the rail, placed in the **first gap between moments that is ≥ 64px wide and not covered by a hands-on block**; ellipsis if the gap is between 64px and the label's width; **no label** if no gap qualifies (the equipment lane still carries the name). At Fit on 01 · A that puts "Build the chicken broth" between Slice ginger and Check 1/2, and "Press the tofu" gets nothing. Update the anatomy frame 03b so all three widths show where the label lands (or that it drops).

## 2. The sample plan contradicts itself

Mia's wait block at 8:00–11:00 reads "Waiting on "Build the chicken broth"" and her sauce starts at 11:00 — but the broth now runs until **14:00**. A dependency can't be satisfied before the step it waits on ends. Fix by moving the broth earlier, not by relabeling:

- **Build the chicken broth**: 2:00 → 10:30 (still 8:30, still critical). Start 2:00–2:30 · Check 1/2 5:00–5:20 · Check 2/2 7:30–7:50 · Finish 10:00–10:30.
- **Bone the chicken thighs**: 0:00–2:00 unchanged (it ends when the broth starts).
- **Slice ginger & scallion**: 8:00–10:00 (after Check 2/2, before Finish; the board is free — Mia's mince ends 6:30). This keeps the hands-on-inside-the-rail picture.
- Leo between 2:30 and 8:00: hatched waits only where there is a real cause — "Waiting · cutting board — Mia has it" while Mia's dice/mince hold the board (2:30–6:30), plain "Waiting" for 6:30–7:30 (a 2:00 slice doesn't fit before the check). Never a hands-on block across a moment.
- **Simmer the mapo sauce** may start at 10:30 (when the broth actually finishes) — then Mia's wait is 8:00–10:30 and "Slide in the tofu" 12:30–14:30. Keep "Thicken with slurry" at 19:00 so the finish stays **34:00**.
- Re-flow Leo's later steps (Poach → Shred → …) forward from 10:30, and re-check every wait label on both lanes against what actually holds the board or the dependency at that time. Recompute both "busy" values (hands-on only) and the two HUD chips.

Then propagate the same times to the close-up 03 and the anatomy 03b.

## 3. Versus numbers disagree with Co-op

The Opening hand (04 · B) shows **Build the chicken broth 09:00**, **Press the tofu 03:30**, **Bone the chicken thighs 05:00**. The Co-op timeline says 08:30, 02:00, 02:00. A step's duration is a property of the step, not of the mode. Use the Co-op durations everywhere in Versus (bundle rows, "to open" totals, the Up-for-grabs chip durations and the 35:30 total). Who holds which opening task may differ from Co-op — that part is fine.

## 4. States D, E, F still show the old timeline

07 · E and 08 · F (and D) draw rails and moments but their legend still has only "Critical path · Waiting" and they have **no Equipment lane group**. Every Co-op timeline on the canvas must be the same drawing as 01 · A: four legend items, equipment lanes, same sample plan (after §2). F keeps its two looped steps absent from the lanes.

## 5. Selected + critical

On 03 the selected broth still shows the critical red on its rail and moments. When a step is both selected and critical, **selected wins on the timeline**: accent outline on the rail and every moment; the red survives only as the "On the critical path" line in the detail panel. Say so in the 03b footnote.

## 6. Small things

- 02 · A mobile: the HUD chips read "Mia 10 · 17:30" — keep the word "steps" ("10 steps · 17:30") or drop the count; a bare "10" reads as minutes.
- The anatomy frame's 1× row labels the checks with bare "0:30"-style durations on Start/Finish but nothing on the checks — that is the intended rung, just annotate it ("checks go bare before Start/Finish do, because they're narrower").
