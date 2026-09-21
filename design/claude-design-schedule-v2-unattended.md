Update the **Schedule page** already on this canvas (Kitchen Path · Schedule, the Co-op timeline) so it shows **unattended steps** — things that cook on their own while the player does something else. This is an **incremental change on top of the existing artboards**: keep the page structure, the mode picker, the HUD, the footer, the sample run (Mia & Leo, Mapo Tofu + Chicken Noodle Soup), the zoom control and every rule from the original Schedule brief. Only the timeline, its legend, the task-detail panel and one HUD number change. Everything visual still comes from the **Kitchen Path Agent Design System** on this canvas — no new color, font, radius, shadow or icon.

**Why:** today a 8-minute "Build the chicken broth" is drawn as one solid block, as if Leo stood at the pot for 8 minutes. He doesn't. He starts it (30s), skims it twice (20s each), pulls it off (30s), and is **free in between** to chop. The timeline must show *where in the step the player's hands are actually needed*, so a player can read at a glance "I'm free from 6:00 to 8:30 even though my broth is on."

**Deliver:** the Desktop 1280 **A · Co-op plan** artboard updated in place; the desktop **close-up** updated so the selected task is an unattended step with its detail panel open; Mobile 390 A updated; plus one small **anatomy** frame showing a single unattended step drawn at three widths (wide / medium / narrow — see §4). No new page states.

---

## 1. The data (new, per step)

Every step now has a **tending** kind. Backend name → what the page says:

| `tending` | say | meaning |
|---|---|---|
| `hands_on` | *(nothing — the default, unchanged)* | the player is on it for the whole span |
| `tended` | **Check on it** | runs alone, but needs a few checks (stir, skim, flip) |
| `timed` | **Timed** | runs alone, start it and come back at the end |
| `set_and_forget` | **Leave it** | start it and walk away; there is no "end" moment (pressing tofu, soaking rice) |

Every non-hands-on step also carries its **hands-on moments**, already computed as absolute times on the plan:

```
moments[]: { kind: "initial" | "checkpoint" | "ending", index, atSec, endSec }
```

- `initial` — getting it going. Always present. Say **Start**.
- `checkpoint` — one per check, `index` 1…n, evenly spaced. Only on **Check on it** steps. Never closer than **2:00** apart (guaranteed upstream — don't design for tighter). Say **Check {index}/{n}** (mono numbers).
- `ending` — pulling it off / plating / fishing it out. Absent only on **Leave it**. Say **Finish**.

The step's overall block (`startSec → endSec`) is unchanged and still what the scheduler, the finish time and the critical path are computed on. The moments are detail *inside* that span. Moments of one step never overlap each other, and the scheduler never puts another hands-on task of the same player on top of a moment — if the sample data ends up doing that, fix the sample data, not the drawing.

**Sample data — change these three rows of the existing run** (everything else stays; shift neighbours only as much as needed so nothing collides):

- **Leo · "Build the chicken broth"** (pot) → **Check on it**. Runs **5:30 → 14:00** (8:30). Moments: Start 5:30–6:00 · Check 1/2 at 8:30–8:50 · Check 2/2 at 11:00–11:20 · Finish 13:30–14:00. While it runs, Leo does **"Slice ginger & scallion"** at 6:30–8:30 (hands-on, board) — that's the picture the page exists to show: a hands-on block sitting *inside* an unattended step's span. Keep this step **critical**.
- **Mia · "Press the tofu"** (board) → **Leave it**. Runs 0:00 → 2:00. One moment only: Start 0:00–0:20. Mia's "Dice the tofu" still begins at 2:00.
- **Mia · "Simmer the mapo sauce"** (wok, the pre-selected step) → **Timed**. Runs 11:00 → 13:00. Moments: Start 11:00–11:20 · Finish 12:40–13:00.

## 2. Timeline — what changes on a player's lane

A **hands-on step** is drawn exactly as today (player-tint block, critical outline, progressive truncation). No change.

An **unattended step** is no longer a solid block. It becomes two things drawn together, both in the owning player's color:

1. **The run rail** — the whole `startSec → endSec` span, drawn as a **thin rail along the bottom of the lane** (about 6px tall, player tint fill at low strength, 1px inset of the player color, radius from the system — think "a burner that's on"). It reads as *on, but not occupying the player*. If the step is critical, the rail gets the 2px `--kp-critical` outline instead — the same rule as blocks, so the red still means the same thing. The step's label (13/500) sits on the rail's left end **only if no moment block covers it**; otherwise the label lives on the Start moment.
2. **Moment blocks** — one full-height block (same 44px height and tint as a hands-on block) for each moment, positioned at `atSec`, width from `endSec − atSec`, **minimum width 10px** so a 20-second check never disappears at Fit zoom. Labels, by available width: **Start** / **Check 1/2** / **Finish** as 12/500; below that mono 12 duration ("0:20") when there is room; bare bar when there isn't. The moment blocks visibly sit *on top of* the rail so the eye connects them — same color family, rail underneath.

Both parts are **one selectable thing**: hovering or tapping any part selects the step (accent outline on all moment blocks + on the rail together, `tap` motion once). The rail alone is a small target — on mobile the whole span behaves as a 44px-tall hit area even where only the rail is drawn.

**Free time is not a wait.** The gap between two moments (e.g. Leo 6:00 → 8:30 with only the rail showing) is **not** drawn as a hatched "Waiting" block — it is free, and other hands-on blocks will often sit there. The hatched Waiting block stays reserved for what it means today: the player is idle because a tool or a dependency isn't ready. The two must not be confusable: hatched = stuck, rail = something's cooking.

**Legend** (card header, after "Critical path" and "Waiting"): add **rail swatch + "Cooking on its own"** and **small block swatch + "Hands-on moment"**. Four legend items total; on mobile they wrap to two rows.

## 3. Equipment lanes — new, below the players

Add a second lane group headed **Equipment** (mini-title, text-secondary) under the two player lanes, separated by the system's divider. One 44px lane per tool the plan uses, in this fixed order: **Cutting board · Wok · Pot · Burner · Oven** (only those the run actually uses — this run: board, wok, pot, burner). Lane label = the equipment glyph (20) + name 13/500; no avatar.

Each step that needs the tool puts a block on that tool's lane for its **whole span**, in the **owning player's tint** with a 1px inset of the player color — this is how the page shows *who has the wok at 9:00* and why the other player is "Waiting · wok — Mia has it". On unattended steps the equipment block additionally gets **tick marks**: a 2px vertical line in the player color at each moment's `atSec`, full block height, so the pot lane reads "on from 5:30 to 14:00, touched at 5:30 / 8:30 / 11:00 / 13:30". Label rule and truncation as for player blocks. Equipment blocks are **not** selectable and never critical-outlined (critical is a player-lane thing); tapping one does nothing.

Equipment lanes are quieter than player lanes: lane background bg-secondary, no tint band, no reveal stagger (they appear with the same reveal as the lane above them, not after it).

## 4. Anatomy frame

One small frame, three copies of Leo's broth step (rail + 4 moments) at ~640px, ~320px and ~160px wide, showing exactly how the labels degrade: full ("Start 0:30", "Check 1/2 0:20", …) → short ("Start", "1/2", "2/2", "Finish") → bare bars at the 10px minimum, with the rail and step label still readable. Annotate the minimum width and the rail height. This frame is for the engineer implementing the truncation, not for the app.

## 5. Task detail panel (selected unattended step)

Everything from the original panel stays (Starts · Ends · Takes · Player · Equipment · Difficulty, the critical line, the wait line). Add, between the description and the 3×2 grid:

- A **tending Chip** next to the title: **Check on it** / **Timed** / **Leave it** (system Chip, neutral). Hands-on steps get no chip.
- A **"Hands-on moments"** row (mini-title) — a single line of small inline items, each "**{Start / Check 1/2 / Finish}** · mono {clock} · mono {duration}", e.g. **Start · 5:30 · 0:30 — Check 1/2 · 8:30 · 0:20 — Check 2/2 · 11:00 · 0:20 — Finish · 13:30 · 0:30**. Wrap on mobile. For a Leave it step this row is just the Start item.
- One meta line (13/400 text-secondary) under it: **"Runs on its own for {mono} — you're free in between."** where the value is `endSec − startSec` minus the sum of the moments (Leo's broth: 8:30 − 1:20 = **7:10**). For Leave it: "Runs on its own — nothing to come back for."

**Takes** in the grid stays the whole span (8:30); the free-time line is where the difference is explained. Don't add a second "hands-on total" tile — the moments row already says it.

## 6. HUD — one number changes meaning

The per-player chip currently reads "{k} steps · {busy}". **Busy** now means **hands-on time only**: Σ hands-on step spans + Σ moment durations. Rail time doesn't count — the player isn't busy. Recompute the two sample values accordingly (Leo drops noticeably). The lane-label "{busy} busy" under each avatar uses the same number. Finish time, "faster than solo" and step count are unchanged.

## 7. Versus · Opening hand — minimal

The bundle rows and the Up-for-grabs chips get the same **tending Chip** (Check on it / Timed / Leave it) trailing the step label when the step is unattended, so a player picking an opening hand can see "this one's mostly waiting". **Nothing else** — no rail, no moments, no timeline treatment on the Versus view; it stays a claim list.

## 8. Rules that still hold

- Player colors remain the only chromatic fills; the rail is the player's tint, the ticks are the player's color. Critical red only as an outline (block or rail) and in the legend/detail line. Accent only on the selected step.
- Mono for every number, including moment clocks and "0:20" durations.
- Icons only from the 14-glyph sheet — equipment lane labels use `cutting-board`, `wok`, `pot`, `burner`, `oven`. No new glyph for "unattended"; the rail *is* the signal.
- Don't add checkpoint scoring, alarms, "missed" states or any live progress — this page is still the static plan. Those belong to Live cook.
- Mobile 390: the lane-label column stays 96px; equipment lane labels show the glyph only (name in a tooltip-less abbreviation is not allowed — glyph alone). Moment blocks keep their 10px minimum; the rail stays 6px. Detail panel is still the bottom sheet.
- prefers-reduced-motion: unchanged (200ms fades, no stagger).
