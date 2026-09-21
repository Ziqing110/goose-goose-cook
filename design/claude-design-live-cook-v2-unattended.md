Update the **Live cook page** already on this canvas (Kitchen Path · Live cook, the counter screen) so it handles **unattended steps** — things that cook on their own while the player does something else. This is an **incremental change on top of the existing artboards**: keep the run header, the HUD, the two PlayerFocusCards, the Versus leaderboard and pool board, the VoiceBar, the footer, the sample run (Mia & Leo, Mapo Tofu + Chicken Noodle Soup) and every rule from the original Live cook brief. Only the focus card gains a phase, each card gains a small "cooking on its own" list, and the Versus pool tiles get one chip. Everything visual still comes from the **Kitchen Path Agent Design System** on this canvas — no new color, font, radius, shadow or icon. The vocabulary for tending kinds and moments is the one the Schedule v2 brief introduced; reuse it exactly.

**Why:** an 8-minute broth is not 8 minutes of Leo's hands. He starts it (30s), skims it twice (20s each), pulls it off (30s), and in between the engine already gives him other work. The page must (1) tell him **which of those moments he's in** when the broth is his current focus, (2) keep every pot he has going **visible with its next moment counting down** while he's chopping something else, and (3) **pull his attention** the second a check or the finish comes due — this is the screen on the counter, read from 1.5 m.

**Deliver:** Desktop 1280 **A** updated in place (see §6 for the new sample situation); Mobile 390 A updated; a desktop **close-up of one PlayerFocusCard in its three phase variants** (Start / Check / Finish) next to the existing four; and a small **anatomy frame** of one "cooking on its own" row in its four states (running / due now / finish due / late). One new page state, **J · Finish due**.

---

## 1. The data (new, per step)

Same as Schedule v2. Every step has a tending kind, said as: `hands_on` → *(nothing)* · `tended` → **Check on it** · `timed` → **Timed** · `set_and_forget` → **Leave it**. Every unattended step has **moments** — **Start** (always), **Check {i}/{n}** (Check on it only, never closer than 2:00 apart), **Finish** (everything but Leave it). Each moment has a duration (20–40 s typically).

New for a **live** run, per active unattended step, derived every tick from when the step was actually started (not from the plan):

```
phase        "idle" | "initial" | "waiting" | "checkpoint" | "ending"   + index for checkpoint
             // idle = not started (or a hands-on step); waiting = it's cooking, nobody needs to touch it
moments[]    { kind, index, atSec, endSec }  // offsets from the step's real startedAt, so a
                                             // time axis can be drawn from 0 → estimated_duration_sec
```

Two rules the engine already enforces — design to them, don't re-derive them:

- A player is **busy** exactly during Start / Check / Finish, and **free** while a step is merely `waiting`. So `assignments` / claim gating already send a player new hands-on work between checks, and already refuse a claim mid-check. The card and the pool board just render what they're told.
- A moment that passes untouched **simply passes** — there is no "acknowledge", no "missed" state, no penalty. The **Finish** window, once reached, **stays open** until the step is marked Done: a late finish keeps reading as "Finish — now", it never goes quiet.

The engine has no "checkpoint done" intent. Don't invent one: a check ends on the clock. The only actions on an unattended step are still **Start** (begins it), **Done** (ends it), **Skip**, and in Versus **Put it back**.

## 2. PlayerFocusCard — three new variants of "On it"

When a player's current focus is an unattended step **in a moment**, the card is still the **On it** variant (eyebrow "On it", title = step label 24/700, description, tags, step timer 40/500 running for the whole step) with these changes:

- A **phase chip** trailing the title, system Chip in the player's color: **Start** · **Check 1/2** · **Finish**. This is the one thing that must be legible from across the kitchen — if the system's Chip is too quiet at 1.5 m, use the eyebrow instead ("On it · Check 1/2") and annotate why.
- An **instruction line** 16/500 under the description, one of:
  - Start: **"Get it going — {mono 0:30}."** then a meta line 13/400 "Then it runs on its own. Next: Check 1/2 in {mono 3:00}." (Leave it: "Then it runs on its own — nothing to come back for.")
  - Check: **"Check on it — {mono 0:20}."** meta "Next: Check 2/2 in {mono 2:30}." / "Next: Finish in {mono 2:30}."
  - Finish: **"Pull it off — now."** no meta. If the step's timer is already past its estimate, the timer is in warning as today; nothing else turns red.
- A **moment countdown**: mono 24/500 next to the instruction, counting the current moment's window down (0:20 → 0:00). Not the 40/500 step timer — that keeps counting the whole step. Two clocks on one card is deliberate: big = the step, small = this moment.
- **Actions**, by phase (this is where it differs from a hands-on step):
  - **Start** and **Check**: **no primary**. The action block holds the ghost row only — "Skip", (Versus) "Put it back", "Undo" — plus a ghost **"Done"** on the left of that row for the case where the player wants to end the step early. The card must read "do the thing, then walk away", not "press a button".
  - **Finish**: the primary **Button xl "Done"** in `--kp-status-done`, full width, exactly as a hands-on step. The card pulses **once** when the Finish window opens (the system's attention motion — spring on the primary, or a single tint pulse; whichever the system defines for "needs you"; reduced motion: nothing).
- Everything below the action block — the "cooking on its own" list (§3) — stays visible in all variants.

When the player's focus is **not** an unattended step (they're On it on a hands-on step, or Up next, or Waiting, or Free hands) the card is unchanged — the unattended step they have going appears only in the list (§3).

## 3. "Cooking on its own" list — new, inside every PlayerFocusCard

Pinned at the bottom of the card, under the action block, separated by the system's divider. Header mini-title **"Cooking on its own"** + mono "{n}". Rendered only when the player has at least one unattended step running; otherwise the card ends at the action block as today (the two cards no longer have to be equal height — annotate that the previous equal-height rule is relaxed for this list only; the action blocks still line up).

One **row** per running unattended step, 56px min, whole row tappable (44px target) but tapping does nothing yet — annotate "reserved: tap → agent says the next moment". Row anatomy, left → right:

1. Step label 16/500 + tending Chip (Check on it / Timed / Leave it), one line, truncate with ellipsis.
2. A **time axis**: the same rail-and-moments drawing as the Schedule v2 timeline but **live**: a 6px rail from 0 → `estimated_duration_sec`, the elapsed part filled in the player's color, the rest in the player's tint; a small full-height block at every moment (10px minimum); a 2px **now** marker in text-primary. Past moments drop to the tint; the current or next moment is in the player's color. Width fills the row; mono 12 clock labels only at the two ends ("0:00", "8:30").
3. Right column, mono, right-aligned: **the next moment** — "Check 1/2 in **1:40**" (12/400 label, 20/500 number); Leave it with nothing left: "Ready in **1:40**" then "Ready" and a ghost md **"Done"** button, because a Leave it step has no Finish moment and still needs to be marked done — this button is the only way.

Row states (the anatomy frame shows all four):

- **Running** — as above. Quiet.
- **Due now** (phase is Check): row takes the system's "needs you" treatment — warning tint background `--kp-warning-bg`, left rail in the player's color, the right column reads "**Check 1/2** — now" and the moment countdown "0:20" beneath; the row **pulses once** on entering the state. If the player is currently On it on something else, the row is the only alarm — the focus card does not change (the engine will move their focus to this step when it can; don't fake it). Reduced motion: tint only, no pulse.
- **Finish due** (phase is Finish): same treatment as Due now, right column "**Finish** — now", plus a ghost md **"Done"** button in the row so the finish can be marked from here without waiting for the card to switch.
- **Late** (Finish window opened more than 60 s ago, still not Done): as Finish due, the countdown replaced by mono "**+1:12**" in `--kp-warning-text`. No red — `--kp-critical` still doesn't exist on this page.

The list is ordered by **next moment soonest first**; rows re-order with a 200 ms fade, never a slide.

## 4. Alarms — what fires, where

A moment becoming due is the signal; the page already has everything it needs to show it:

- The **row** enters Due now / Finish due (§3).
- The **focus card** enters its Check / Finish variant *only if* the engine has made that step the player's current focus.
- A **transcript line** from the agent in `--kp-ai`: "Leo — check on the broth. 1 of 2." / "Leo — pull the broth off." / "Mia — the tofu's ready when you are." (Leave it). Draw these in the sample transcript and annotate them as **"hook: onMomentDue — spoken later, not wired yet"** — voice output for these is deferred; the line is the design of what it will say.
- Nothing else: no modal, no full-screen flash, no sound iconography.

Two due moments at once (one per player) are both shown; each in its own card. Two due moments for the **same** player are not possible by construction (≥ 2:00 apart, one step in a moment at a time per player) — don't design for it.

## 5. Versus — pool board and leaderboard

- **Claimable tiles** for an unattended step get the tending Chip after the label, and the mono meta becomes "**{hands-on total}** hands-on of {duration} · +{points}" (Leo's broth: "1:20 hands-on of 8:30 · +20"), so a player weighing a claim sees what it actually costs. Hands-on steps keep "{duration} · +{points}".
- **Taken tiles** for an unattended step show the holder's avatar + name as today, and replace the running time with the next-moment countdown ("Check 1/2 in 1:40") — the same right-column copy as §3.
- **Claim buttons**: a player's buttons are disabled while they are **in a moment** (Start / Check / Finish) exactly as they are while on a hands-on step; while their pot is merely cooking they are enabled. Tooltip stays "{name} is still on something".
- **Checkpoints belong to whoever started the step.** There is no claim on a due check and no way for the other player to take it — the pool never lists a moment, only whole steps. Don't add "help out" affordances.
- Leaderboard, points, scoring copy: **unchanged**. A step still scores once, as a whole, on Done. No per-check points, no "missed" deductions — annotate "checkpoint scoring not designed; out of scope."

## 6. Sample situation for state A (replace the current one)

Clock 09:12, 5 / 19, Co-op, no drift.

- **Mia** — On it, hands-on: "Dice the tofu", 1:05 of est 2:30. Her list has one row: **"Press the tofu" · Leave it** — Ready, with the ghost "Done" (she pressed it at 0:00 and it's had its 2:00; she'll mark it when she needs the board). Quiet.
- **Leo** — On it, unattended, **Check 1/2** of **"Build the chicken broth" · Check on it**: step timer 3:00 of est 8:30, instruction "Check on it — 0:20." with the small countdown at 0:14, meta "Next: Check 2/2 in 2:30.", no primary, ghost row with "Done" on the left. His list has that same broth row in **Due now** (the row and the card agree) and nothing else.
- Transcript, newest last: agent "Timer running on Build the chicken broth. Est 8:30." · Leo "start slice ginger" · agent "Leo's on Slice ginger & scallion." · agent "Leo — check on the broth. 1 of 2." (hook-annotated).

**State J · Finish due.** Same run at 13:32: Leo is On it on "Shred the chicken" (hands-on, 0:40 of est 2:00); his broth row is in **Finish due** with the ghost "Done" in the row, right column "Finish — now · 0:28"; transcript ends with agent "Leo — pull the broth off." Mia unchanged from A but her tofu row is gone (marked Done).

**Close-up · phase variants.** Leo's card three times: Start ("Get it going — 0:30." / "Then it runs on its own. Next: Check 1/2 in 3:00.", no primary), Check (as in A), Finish ("Pull it off — now.", primary Done, the once-only pulse frozen at its peak for the still).

## 7. What this page still does NOT do

- No timeline / Gantt — the row's time axis is one step's own 8 minutes, never the run. "The plan" is still the Schedule page.
- No "missed check" state, no penalty, no burnt food — a passed check is just gone.
- No acknowledge / "checked ✓" button on a check — the moment ends on the clock.
- No claiming or handing off a due check to the other player.
- No per-check scoring, no hands-on-time bonus.
- No voice output design beyond the transcript lines and their hook annotation.
- Still exactly two players, two cards, one agent.

## 8. Rules that still hold

- Player colors are the only chromatic fills — rail fill, moment blocks, phase chip, due-row rail. `--kp-warning-*` for due rows, over-time timers and "+1:12" late marks. `--kp-status-done` only on Done buttons and finished states. `--kp-ai` for the agent. `--kp-critical` does not appear.
- Mono for every number and **large in play**: step timer 40 (32 mobile), moment countdown 24, next-moment countdown 20, points 24, run clock 32. Axis end labels 12.
- Targets: Done 64px when primary, 44px as a ghost in a row; every row 44px tall at minimum.
- Icons only from the 14-glyph sheet; no new "pot on" glyph — the rail is the signal, as on Schedule.
- Mobile 390: cards stack in fixed player order; the list stays inside its card; the time axis fills the row width with the right column dropping below it when narrower than 320px; row Done buttons full-width under the axis.
- prefers-reduced-motion: due rows tint without pulsing; re-orders and phase changes are 200 ms fades; countdown digits never animate.
