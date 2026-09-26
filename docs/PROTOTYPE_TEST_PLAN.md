# Prototype test plan — four tracks, four people

Four tracks that don't overlap, so we can run them at the same time and
not trip over each other. Pick one each. Each is written to be done
alone, in one sitting, on your own machine.

The point is not to confirm it works. It is to find where it doesn't
before someone else does.

---

## Before anyone starts

**Everyone on their own laptop and their own server** — which is how we
are set up, and worth keeping that way. Storage is one SQLite file per
checkout (`server/data.sqlite`, gitignored) with no per-user scoping,
and the API guarantees *at most one active session*: starting a run
abandons every other active one. Pointed at a shared box we would
abandon each other's runs mid-test and blame the app. So: no shared
server, and no testing against someone else's machine to "compare".

```
npm run dev        # web only          :5173
npm run dev:full   # web + API         :5173 + :3001
npm run dev:voice  # web + API + speaker sidecar (:3103) — needs .venv-voice
```

**These already pass, so don't spend the day re-checking them:**

```
npm test            # 170 unit tests
npm run test:e2e    # live cook, headless
VOICE_E2E_BASE=http://localhost:5173 npm run test:voice-e2e
```

The `VOICE_E2E_BASE` bit is not optional on Windows: Vite binds
`localhost` but not `127.0.0.1`, and the script defaults to the latter.

**Shortcuts so you're not clicking through the whole flow every time:**

| | |
|---|---|
| `/jump/schedule` | schedule, no mode picked |
| `/jump/coop`, `/jump/versus` | live cook, run already going |
| `/jump/coop-done`, `/jump/versus-done` | the results screen |
| `?preview=loading`, `?preview=done` | pin a loading screen |
| `?goose=idle\|listening\|thinking\|speaking\|warning` | pin a goose pose |

All dev-only, stripped from production builds.

**Two things cost money.** Unmuting opens an AssemblyAI socket and the
billing is on connection-open time, not audio sent — an idle unmuted mic
is a real charge. And recipe generation is a large model call. Tracks A
and B will spend more than C and D; mute when you stop to write notes.

---

## How each track splits

Every track has a **frontend half** (drive the screens) and a **backend
half** (hit `:3001` directly with `curl` — no auth, no browser). Do both.
The point of owning both halves of one area is that when something looks
wrong you can tell which side it came from yourself, instead of handing a
screenshot to whoever owns the API.

Coverage is lopsided and worth knowing before you start. The frontend has
19 unit-test files plus two e2e suites. The server has **3,490 lines
across 24 endpoints and three test files** — `agent/turn`, `agent/pending`
and one slice of recipe generation. Everything else on the server has
never been tested by anything but a person clicking. The backend halves
below are aimed squarely at that.

The endpoints are grouped so each person owns the API behind the screens
they are already testing:

| Track | Frontend | Backend it sits on |
|---|---|---|
| A | voice in a real room | `voice.js`, `agent/gateway.js`, speaker sidecar |
| B | two cooks, live | `reviewPlan.js` — 400 lines, no tests |
| C | cold start to the board | `recipes.js` — 1,148 lines, generation |
| D | breakage and memory | `sessions.js`, `kitchens.js`, the database |

---

## Track A — Real voice, real room

*The premise of the product, and the least tested thing in it.*

Every automated voice test mocks the websocket and injects a perfect
transcript. Nothing has ever checked what real speech does. This track
is the one most likely to find something that changes the demo.

**Run** `npm run dev:voice`, real microphone, somewhere with kitchen
noise if you can manage it — a tap running, a fan, a radio, a second
person talking who isn't addressing the goose.

**Push on:**

- Say every command in [VOICE_COMMANDS.md](VOICE_COMMANDS.md) on the page
  that owns it. Note which ones need a second try.
- Speak with the noise on. Voice Focus is set to `far-field` for laptop
  mics across a counter — does that hold up?
- Code-switch mid-sentence. English and Mandarin are both declared and
  it is supposed to transcribe, not translate.
- Talk over the goose while it is speaking (barge-in).
- Say something to a person in the room that happens to contain a
  command word. It should not fire.
- Names: a kitchen called "Flat 3 galley" has ordinary gaps in it. Does
  it come back whole, or as "Flat"?

**Known soft spots**, from the recordings already analysed in
[VOICE_FINDINGS.md](VOICE_FINDINGS.md) — worth re-checking rather than
rediscovering: turn splits after the agent's name, the confidence floor
at 0.4, and two cooks landing in one turn.

**Also never exercised:** the speaker-identification sidecar. `/identify`
on :3103 has never once been up during a test run — the e2e suites have
only ever seen it refuse the connection and fall back to the manual
toggle. `npm run speaker:eval` exists. Nobody has looked at its output.

**Backend half — the voice plumbing** (`server/routes/voice.js`, 101
lines, no tests; `server/agent/gateway.js`, 127 lines, no tests):

- `GET /api/voice/stt-token` and `/agent-token`. Call each twice — are
  tokens single-use, and does a stale one fail cleanly?
- **The API key must never leave the server.** Grep the browser's network
  tab for it. This is the one backend check that is a security bug if it
  fails, not a papercut.
- Empty the `ASSEMBLYAI_API_KEY` in `.env` and call the token routes.
  A 500 with a stack trace is a finding; a clear error is not.
- `POST /api/agent/turn` with junk: no transcript, a 5,000-word one, one
  in Mandarin only. It has tests for the happy path and none for these.
- The sidecar on `:3103` — `npm run speaker:eval`, and `/identify` with
  two candidate ids and a real PCM clip.

**Write down:** the phrase, what you expected, what the bubble said, and
whether a second attempt worked. A command that works four times in five
is worse than one that never works, because we'll ship it.

---

## Track B — Two cooks, live

*The payoff screen, and the only one with two people acting at once.*

Best with an actual second person. Failing that, a phone on speaker and
two voices is closer to the real thing than clicking both cards.

**Run** `npm run dev:voice`, then `/jump/coop` and `/jump/versus`.

**Push on:**

- Co-op: does the plan actually re-cut when someone finishes early or
  late? Finish things out of order. Finish nothing for two minutes.
- Versus: claim the same step at the same moment, in both voices. Claim
  something the kitchen can't honour. Claim something already taken.
- Say "done" holding nothing. Say it holding two things.
- Pause mid-step and leave it paused. Does every clock actually stop?
- "Call it early" from both modes, and the results screen after.
- Two people talking in one turn — there is handover detection for this,
  and it has only ever been tested on recordings.
- The same step name said two ways ("dice the ginger" / "ginger dicing").

**Watch for:** timers that keep counting through a pause, a step claimed
by both cooks, the board disagreeing with the score strip, and any
browser `confirm()` dialog appearing on Live Cook — there should never
be one there.

**Backend half — the re-planner** (`server/routes/reviewPlan.js`, 400
lines, **zero tests** — the largest untested thing on the server after
generation, and co-op leans on it after every single "done"):

- POST a plan where steps finished out of order.
- The same step finished twice. A step finished that was never started.
- One cook doing everything, the other nothing.
- A step whose dependency is still pending — does it re-cut, or produce a
  plan that cannot be executed?
- Compare what it returns against what the board then draws. The screen
  agreeing with itself is not evidence the plan is sound.

**Write down:** what each cook said, in order, with rough timings. Most
bugs here are races and won't reproduce without the sequence.

---

## Track C — Cold start to the board

*What a stranger walks through, on a machine that knows nothing.*

The automated tests seed their way past all of this. Nobody has walked
it cold in a while.

**Run** `npm run dev:full`, then clear it out first — stop the server,
delete `server/data.sqlite`, restart. No kitchens, no sessions, nothing.

**Push on:**

- Set up a kitchen from nothing. Try to break the form: empty name, a
  very long name, zero burners, duplicate names (now refused — check the
  message reads like a sentence).
- Answer the conversation as a real person would: vaguely, changing your
  mind, answering two questions at once, saying "actually, no".
- Ask for dishes we have never tried. Three dishes. One dish nobody
  could cook. Something not food.
- **Watch the generation screen honestly.** It takes about 29s for three
  dishes and the client gives up at 150s. The checkpoints and the
  countdown are an estimate, not a report — does the estimate feel like
  a lie at any point?
- If it falls back to the seeded templates you get Mapo Tofu and Chicken
  Noodle Soup, which is somebody else's dinner. Nothing on screen says
  so. How obvious is it that you got the wrong thing?
- "Start over" on the conversation, answer differently, confirm the menu
  actually changes.
- Walk forward and back through every step with the buttons, then again
  by voice.

**Backend half — generation** (`server/routes/recipes.js`, 1,148 lines,
one test file covering only unattended steps):

- `POST /api/recipes/generate` straight from `curl`, no browser. One
  dish, three, zero, a nonsense string, a dish needing an oven for a
  kitchen with none.
- The server's own ceiling is 120s and the client gives up at 150s, so
  there is a 30s window where the server is still working and nobody is
  listening. Make it time out and see which side notices.
- Does a malformed model response get **rejected**, or passed through to
  be drawn? There is schema validation and a graph-shape check — try to
  get something past them.
- `POST /api/understanding/read` (330 lines, no tests) with vague,
  contradictory and empty answers.
- `GET /api/recipe-templates` and `/api/materials` — the fallback path
  depends on both.

**Write down:** anywhere you had to guess what to do, and anywhere the
app told you something that wasn't true.

---

## Track D — When it breaks, and what it remembers

*Everything the happy path never touches.*

**Run** `npm run dev:full`, and be ready to kill the API mid-flight.

**Push on — refusals and outages:**

- Deny the microphone permission at the browser prompt. Then revoke it
  mid-session.
- Stop the API server while a page is open. Try to act. Restart it.
- Stop it *during* recipe generation.
- Run with no `ASSEMBLYAI_API_KEY` in `.env`.
- Run without the speaker sidecar (this is the normal case — it should
  degrade silently to the manual toggle, and it logs `[speaker]
  unavailable`).
- Delete a kitchen a live run is using. It should refuse, not go quiet.

**Push on — memory and reload:**

- Reload on every single page. Does the app come back where it was?
- Reload mid-generation.
- Two tabs at once. Then start a run in the second one — the first one's
  session is now abandoned, by design. Does the first tab notice?
- Abandon a run and resume. Finish a run and look at the summary.
- Known and unfixed: the goose's dragged position survives a reload, but
  its CC and voice toggles don't. Decide whether that bothers us.

**Push on — the frame itself:**

- 1280×800 (a laptop on a counter), 1440, and 390 wide. There are
  breakpoints for all three.
- Resize slowly with the goose parked in each corner.
- Open every dialog at 390 wide.
- The goose floats *above* the modal dimming, on purpose — a dialog
  takes the mic, so it stays reachable. Does that read as intentional or
  as a bug? It is a genuine open question.

**Backend half — state and storage** (`server/routes/sessions.js`, 363
lines, no tests; `kitchens.js`, 103 lines, no tests):

- The *at most one active session* invariant: `POST /api/sessions` twice
  and confirm the first is abandoned rather than left dangling.
- `DELETE /api/sessions/:id/plan` — new, and what "start over" depends
  on. Call it twice. Call it on a session that has no plan.
- `PATCH` a session with fields that don't exist, wrong types, a null id.
- Sub-resources: `POST`/`PATCH` recipes and shared steps with ids that
  belong to another session. They should not cross over.
- `kitchens.js`: duplicate names (new guard — try unicode and trailing
  whitespace to get past it), and deleting a kitchen an active run is
  using, which should refuse.
- Then look in the database. After a `DELETE /plan`, are there orphan
  rows in `recipe_instances` or `shared_steps`? There are no foreign-key
  cascades on these tables — the deletes are done by hand, so this is
  worth checking rather than assuming.

**Write down:** the exact steps, because half of these are only
reproducible in order.

---

## Reporting

One file per person, `docs/findings-<name>.md`, so nobody edits the same
file. For each finding:

```
What I did        the steps, in order
What happened
What I expected
How often         every time / sometimes / once
Console + network anything red
```

Sort yours worst-first before you share it. "Every time" beats "once",
and anything on the demo path beats anything off it.

## Not covered by any track

Deliberately, so nobody assumes someone else has it: performance under a
long run, accessibility beyond keyboard reachability, any browser other
than Chrome, and load or concurrency past two cooks. Also
`src/utils/` still has no unit tests for `graphLayout`, `inventory`,
`recipeInstances`, `sessionSteps`, `runStats` or `serviceResults` — all
pure logic, all easy to test, and a good use of an hour if your track
finishes early.

If you would rather spend that hour on the server, the same is true
there and matters more: `reviewPlan.js`, `understanding.js`,
`sessions.js` and `kitchens.js` have no tests at all. A handful of
`node --test` cases against any one of them is worth more than another
pass over a screen that already works — `npm test` already picks up
`server/**/*.test.js`, so a new file next to the route is enough.
