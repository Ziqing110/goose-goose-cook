# Unattended-task frontend handoff

The backend (`server/routes/recipes.js`, `src/utils/tending.js`) now breaks
every `tended` / `timed` / `set_and_forget` step into a fixed bundle of
hands-on moments instead of one opaque duration. This doc is the list of
frontend work needed to actually use that — across Inventory, Schedule and
Live Cook, both Co-op and Versus.

**Update:** the two logic pieces section 2 originally called out as missing
— schedule-time event placement and live-run phase tracking — are now
built, tested, and merged (`src/utils/scheduleLayout.js`,
`src/utils/liveCook.js`). Section 2 below describes what's actually there
now, not a proposal. Sections 4-6 are unblocked — this is real UI/rendering
work from here.

## 1. The data you now have

Every node that is not `hands_on` carries:

```js
node.tending; // "hands_on" | "tended" | "timed" | "set_and_forget"
node.unattended = {
  initial:     { duration_sec, difficulty },        // always present
  checkpoints: { count, interval_sec, duration_sec, difficulty } | null, // "tended" only
  ending:      { duration_sec, difficulty } | null,  // null only for "set_and_forget"
};
```

- `initial` — the hands-on act of starting it (seasoning, browning, dumping
  rice in water). Small, always there.
- `checkpoints` — only on `tended` steps. `count` checks, evenly spaced
  `interval_sec` apart (spacing is computed server-side, never asked of the
  model — see the comment above `attachUnattended` in `recipes.js`).
  `interval_sec` is never below `LEAVABLE_GAP_SEC` (120s, exported from
  `src/utils/tending.js`) — anything that would need checking more often
  than that gets reclassified `hands_on` at generation time, so you will
  never see a sub-2-minute checkpoint gap in real data.
- `ending` — the hands-on act of finishing it (pulling it off, plating,
  fishing something out of an ice bath). Absent only for `set_and_forget`
  (nobody collects rice soaking on a schedule — see `isOneShot`).

`node.estimated_duration_sec` stays the step's whole wall-clock length, same
as always — inventory totals and the scheduler's critical path keep reading
that field untouched. `unattended` is additive detail on top of it.

Helpers already in `src/utils/tending.js` — use these, don't re-derive:

| Helper | Meaning |
|---|---|
| `tendingOf(node)` | the corrected tending kind (see the check-gap self-correction above) |
| `isAttended(node)` / `runsAlone(node)` | does this step occupy a cook for its whole span? |
| `hasDeadline(node)` | is running late a failure (false only for `set_and_forget`) |
| `isOneShot(node)` | scored once, at start, with no end moment (`set_and_forget`) |
| `rewardsTimeliness(node)` | is hitting the end moment worth anything (`tended`/`timed`) |
| `checkCount(node)` | `unattended.checkpoints.count`, or 0 |
| `unattendedOf(node)` | `node.unattended`, or `null` |

## 2. The two logic pieces underneath the UI

### 2a. `unattendedEvents(node, startSec)` — `src/utils/scheduleLayout.js`

Turns `unattended` + a step's planned `startSec` (from `scheduleSteps`)
into absolute moments on the SCHEDULE PAGE's timeline:

```js
unattendedEvents(node, startSec)
// -> [{ kind: "initial"|"checkpoint"|"ending", index, atSec, endSec, difficulty }]
```

`[]` for a `hands_on` step (its whole span already IS the hands-on moment
— nothing further to place) or a step with no `unattended` breakdown.
Checkpoint spacing matches exactly how the server derived `interval_sec`
in the first place (evenly, counting from when `initial` ends), so the
schedule page and the generator can never disagree about where a tick
falls. This is planned time, not real time — it answers "where would this
land if the plan runs exactly as scheduled," which is what section 5's
static timeline needs. It does not know about pauses, running late, or
anything else that only exists once a run is actually happening.

### 2b. `unattendedPhaseNow(node, record, now)` and the updated `activeStepFor` — `src/utils/liveCook.js`

For REAL time during a live run, phase is derived, not stored — same as
every other piece of run state in this file (scores, ready pools, elapsed
time: see the header comment). No new field was added to the step run
record; `unattendedPhaseNow` computes the current phase purely from
`record.startedAt`, elapsed time minus `pausedSec`, and the step's own
`unattended` numbers:

```js
unattendedPhaseNow(node, record, now)
// -> { phase: "idle"|"initial"|"waiting"|"checkpoint"|"ending", index }
```

`"idle"` covers a `hands_on` step (nothing to derive) and one that hasn't
started. A missed checkpoint just passes — there's no separate
"acknowledged" state, the same way a `set_and_forget` step has none. The
`"ending"` window, once reached, stays open rather than closing after
`ending.duration_sec` — a late finish should keep reading as "ending due,"
not silently drop to nothing.

`activeStepFor(cookId, run, nodes, now)` now uses this: a cook is occupied
by an unattended step exactly during its `initial`/`checkpoint`/`ending`
phases, never while merely `"waiting"`. `now` is a new 4th argument,
defaulting to `Date.now()` — pass the caller's own ticked `now` state when
rendering, so a phase check agrees with everything else drawn that tick
(`LiveCookPage.jsx` already does this at every call site that has `now` in
scope). `passiveStepsFor` is unchanged — it was already whole-step based
("is any of my active work unattended at all"), which is still correct;
it's `activeStepFor` that needed the phase awareness.

## 3. Claim / assignment exclusivity — already correct, nothing to build

`activeStepFor` is the single source of truth for "is this cook occupied
right now," and both `resolveAssignments` (Co-op) and `arbitrateClaim`
(Versus claims, via `TaskPoolBoard`) already call it — so extending it
once in 2b covers both modes automatically. `arbitrateClaim` passes the
claim's own timestamp (`Date.parse(at)`) as `now`, so a claim is checked
against the instant it was made, not whenever the check code happens to
run.

The rule in practice: a cook mid-checkpoint, mid-initial or mid-ending is
exactly as busy as one doing `hands_on` work and cannot be assigned or
claim anything else; a cook merely waiting on a pot (no active phase)
can. No frontend change needed for this section — it was the reason 2b
existed.

## 4. Inventory page (`src/pages/InventoryPage.jsx`, `src/components/NodeEditorPanel.jsx`) Leave for zeina

- **Visual differentiation.** `InventoryPage.jsx:107` already has a binary
  `is-unattended` style off `step.attended`. Replace with a 3-or-4-way
  treatment (hands_on / tended / timed / set_and_forget) using
  `tendingOf(node)`, so a congee reads differently from an ice bath.
- **Editing.** `NodeEditorPanel.jsx` currently has NO tending field at all
  — only duration (`:109`) and difficulty (`:122`). Add:
  - a tending selector (hands_on / tended / timed / set_and_forget)
  - when not hands_on: a sub-form for `initial{duration,difficulty}`,
    `checkpoints{count,interval_sec,duration,difficulty}` (tended only),
    `ending{duration,difficulty}` (everything but set_and_forget)
  - client-side validation matching the server's `validate()` rules —
    reuse `LEAVABLE_GAP_SEC` from `tending.js` to warn (rather than silently
    accept) when a chosen checkpoint interval is under 2 minutes, since
    generation would reclassify it to `hands_on` at that point.

## 5. Schedule page — Co-op timeline (`src/pages/SchedulePage.jsx`, `scheduleLayout.js`)

- **Equipment lane time axis.** The equipment lane already draws the whole
  unattended block (`gearLanes`, `SchedulePage.jsx:221`). Call
  `unattendedEvents(node, step.startSec)` per step and add tick marks on
  that block at each returned moment (initial at the start, one per
  checkpoint, ending at the end) — this is "which point in the task the
  chef is occupied."
- **Swimlane labels.** The cook's own lane currently excludes unattended
  steps entirely (`lanes`, `SchedulePage.jsx:202-216`, filtered on
  `isAttended`). For each unattended step, place small labeled blocks on
  its OWNING cook's lane at the `initial`/`checkpoint`/`ending` moments
  from `unattendedEvents` — not the whole step span, just those slivers.
  The full step still gets its one block on the equipment lane as today;
  this adds a second, much smaller presence on the cook's own lane.
- **Versus "Opening hand."** The bundle rows there (`SchedulePage.jsx:831`)
  already tag a step `is-unattended` and label it "unattended," but that
  view is about the opening claim, not a per-tick timeline. Whether to also
  surface the first hands-on moment's cost there is an open question (see
  section 8) — don't assume it needs the same tick treatment as the Co-op
  timeline.

## 6. Live Cook page — both modes (`src/pages/LiveCookPage.jsx`)

- **Main focus card** (`PlayerFocusCard`, `:630`). `activeStepFor` (now
  phase-aware, see 2b) already returns the right step id here — `activeId`
  at `:632` is a `hands_on` step OR an unattended step currently in its
  initial/checkpoint/ending phase, never one merely waiting. What's left
  is rendering: when `activeId` is an unattended step, use
  `unattendedPhaseNow(node, run.steps[activeId], now)` to know WHICH phase
  it's in (so the card can say "starting the simmer" vs. "checkpoint 3 of
  8" vs. "pull it off now") instead of treating it like an ordinary
  hands_on step.
- **Per-cook unattended task list.** The existing `focus-queue`/`waiting`
  list (`:680-720`, from `passiveStepsFor` — unchanged, still whole-step
  based) shows one countdown-to-Done per unattended step today. Turn each
  entry into a small time axis: for a step's `estimated_duration_sec`
  window, mark every checkpoint and the ending moment. `unattendedEvents`
  from 2a gives you the same shape, but built from `record.startedAt`
  (real elapsed start) instead of the plan's `startSec` — call it with
  `startSec = 0` and read `atSec`/`endSec` as offsets from when the step
  was actually started, not from the original schedule.
- **Alarms.** `unattendedPhaseNow(...).phase === "checkpoint"` (or
  `"ending"`) IS the due signal — no new detection logic needed, just wire
  it to the same visual pulse the whole-step `.is-due`/`.is-ready`
  treatment already uses (`:694` in the waiting-queue rendering), applied
  per tick on the new time-axis list. Leave a clear hook (e.g. an
  `onCheckpointDue(stepId, index)` callback fired on the phase transition)
  for the voice API to attach to later. **Do not wire voice into this
  pass** — hook point only.
- **Claim gating.** Already enforced by section 3 — `TaskPoolBoard` and the
  Co-op assignment/offer logic both read `activeStepFor`, which is now
  phase-aware. Nothing to add here beyond making sure any NEW claim UI
  keeps calling the existing helpers rather than re-deriving "is this cook
  free" locally.

## 7. Explicitly deferred — do not build this pass

- Voice API integration at alarm points (hook points only, per section 6).
- Checkpoint-level scoring. `scoreStep`/`effectiveDifficulty`
  (`liveCook.js`) still score a whole unattended step in one lump at
  start + finish; per-checkpoint scoring has not been designed. Don't
  invent it — flag it if it comes up.
- Final visual language for the time-axis/tick UI — needs a design pass on
  top of the data wiring, not assumed from this doc.

## 8. Open questions — confirm before starting, don't guess

- **Missed checkpoints.** `unattendedPhaseNow` reports a checkpoint as
  passed once its `duration_sec` window closes — nothing records that it
  was missed. Does anything beyond "it's no longer shown as due" need to
  happen — a penalty, a burn/fail state? Not decided; would need a new
  derivation (e.g. comparing `now` against every past checkpoint window),
  not a stored flag, to stay consistent with how everything else here works.
- **Versus checkpoint ownership.** Can another player claim someone else's
  due checkpoint away from them, or is it locked to whoever started the
  step? `activeStepFor`/`arbitrateClaim` currently just mark the owning
  cook busy during their own checkpoint — there's no concept of a
  checkpoint being claimable by someone else.
- **Versus opening hand.** Does the per-tick timeline treatment (section 5)
  apply to the "Opening hand" bundle view at all, or does it stay a simple
  claim list?
