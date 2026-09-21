Second fix pass on **Live cook v3**. The previous pass landed: real run everywhere, Schedule's descriptions and equipment names, the Schedule's rail-and-moment axis, no double Done in Finish, Versus claim gating, and J's continuity. Six things remain — one is a regression.

## 1. Regression — the "Leave it" row lost its Done

01 · A and 02 · A: Mia's "Press the tofu" row reads **Ready** with no button, and the footnote says a Leave it row "is closed from the card". It can't be: the card's Done belongs to **Dice the tofu**, a different step, and a Leave it step has no Finish moment, so the engine will never make it Mia's focus again. **The row's ghost md "Done" is the only way to mark a Leave it step done.** Restore it (right column: "Ready" then the Done beneath / beside, as in the first v3). The "Done never appears twice in one card" rule applies only when the row is **the same step** as the card's focus (the Finish-phase card) — not to any row while the card has a primary.

## 2. Versus header wraps at 1280

06 · D: the title-case run title pushes the HUD onto three lines ("7 / 19", "The plan" and the drift chip all wrap). The HUD never wraps: the title truncates with an ellipsis first (min-width for the HUD group, `flex-shrink: 0`), same as the Co-op header which fits. Also: **there is no drift chip in Versus** — drift comes from the Co-op plan and Versus has no plan. Remove "0:45 behind plan" from D; that alone frees the room.

## 3. Paused state doesn't match A

07 · E: Leo's paused card shows a greyed **primary Done** and no "Cooking on its own" list, though in A he is mid-Check (no primary, ghost row, one list row). Paused cards are **exactly the A cards, disabled** — phase chip, instruction, both clocks frozen, ghost row greyed, the list rows frozen with no pulse. And the clock: E reads 12:48 with the broth at 3:02, but A is 09:16 with the broth at 3:04. Make E a pause a few seconds after A: **09:20**, broth **3:08**, tofu **1:13**.

## 4. Planned time in Service done

10 · H says "planned 36:00". The Schedule's plan is **34:00**. Fix the number.

## 5. Copy

- 04 · B Leo: 'Waiting on "Dice the tofu" for the cutting board, about 0:40 left.' — the engine's copy is 'Waiting on "{step}", about {eta} left.' with no cause clause. Drop "for the cutting board".
- 08 · F: the caption says Leo "held two steps" but offers three buttons, and "Poach the chicken" can't be held while the broth is unfinished. Offer two — Build the chicken broth, Slice ginger & scallion — and keep Cancel.

## 6. Small

- 03 four-variant close-up, Waiting: Mia's card waits on "Dice the tofu" with Leo's avatar — that's Mia's own step. Make the waiting variant Leo's card, or wait on Leo's "Bone the chicken thighs".
- 02 · A mobile: the "Press the tofu" row also needs the restored Done, full-width under the axis as the footnote already specifies.
