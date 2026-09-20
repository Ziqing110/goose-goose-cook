# Kitchen Path

React + Vite frontend, Node/Express + SQLite backend, for the Kitchen
Path Agent hackathon build. Home is a real entry point (start/resume a
cooking session, manage kitchens, see recent sessions) rather than
step 0 of a wizard; a "session" then walks through conversational
elicitation → recipe graph draft/review → cook voice binding →
schedule preview + mode select, with live cook / diary stubbed as
future stages.

## Run it

You need both the frontend (Vite) and the backend (Express API +
SQLite) running — kitchens are stored in the database, not the
browser.

```bash
npm install
npm run dev:full
```

Opens the app at `http://localhost:5173` and the API at
`http://localhost:3001` (Vite proxies `/api/*` to it, so the frontend
never needs CORS config). `dev:full` runs both together via
`concurrently`; use `npm run dev` (frontend only) or `npm run server`
(backend only) if you want them in separate terminals.

The SQLite file lives at `server/data.sqlite` and is **not** in the
repo — it's created and seeded automatically on first run, so a clone
is `npm install && npm run dev:full` with no setup steps. The seed
(`seedIfEmpty` in `server/db.js`) gives you a demo kitchen, the two
demo dishes and the materials catalog, which is everything the app
needs to be clicked through end to end. It's safe to delete the file
at any point to get back to a clean demo.

The seed is placeholder content standing in for real generation. When
the recipe API lands, `TEMPLATE_SEED` stops being the source of dishes
and the seed shrinks back to the kitchen and the materials catalog.

## Setting up on a new machine

The app, the AssemblyAI voice features and the agent's brain need only
this:

1. Install a recent **Node** (developed on 24; the server script relies on
   `--env-file-if-exists`). On a fresh Windows laptop `npm install` may
   need the C++ build tools, because `better-sqlite3` is a native module.
2. `npm install`
3. Copy `.env.example` to `.env` and set `ASSEMBLYAI_API_KEY`. That one key
   covers streaming speech-to-text, the LLM gateway (recipe generation and
   the live-cook agent's brain) and everything else that calls AssemblyAI.
   It stays on the server: the browser only ever gets short-lived tokens.
4. `npm run dev:full`, then open `http://localhost:5173` in **Chrome or
   Edge** and allow the microphone when asked.

Things the key does not cover:

- **Gateway model access depends on the account.** The agent defaults to
  `gpt-4.1` (`AAI_AGENT_MODEL`). A "no access" error means the account
  doesn't have it; pick another from `.env.example`. A free-tier account
  may only have a small fallback model.
- **The agent's voice** runs in the browser on WebGPU (Kokoro-82M) and
  needs a working GPU and internet on first use: the library loads from a
  CDN and the model (about 300 MB) from Hugging Face, then it is cached.
  Without WebGPU it falls back to the browser's built-in voice.
- **Speaker identification is optional and separate** (see below). Without
  it everything works, and the live cook uses its speaker toggle.

## Voice agent

The live cook has an agent, currently named **Goose** (`AGENT_NAME` in
`src/voice/agentVoice.js`; the one place to rename it). Say its name first:
"Goose, I'm done with the onion". It only acts when addressed, and typed
commands in the agent box work the same way. Turn the mic on in the voice
bar to speak; it starts muted.

| Piece | Where | Notes |
|---|---|---|
| Speech in | `src/components/VoiceBar.jsx`, `src/hooks/useStreamingTranscript.js` | AssemblyAI streaming STT, one mic for the whole app |
| Brain | `server/routes/agent.js`, `server/agent/` | `POST /api/agent/turn`; the model proposes tool calls, the server checks them, the page applies them through the same handlers a tap uses |
| Voice out | `src/voice/agentVoice.js` | Kokoro-82M on WebGPU; the voice settings are in `AGENT_VOICE` |
| Who is speaking | `speaker-sidecar/`, `src/api/speaker.js` | local TitaNet service, optional |

Checks and tools:

```bash
npm run agent:calibrate                       # test the agent against a table of utterances
npm run agent:calibrate -- --models a,b       # compare gateway models
node --test src/utils/*.test.js server/agent/*.test.js   # unit tests
npm run tts-lab                               # voice bench at http://localhost:3101
```

### Speaker identification (optional)

One mic, two cooks: a local service identifies who spoke by comparing each
turn's audio with a voiceprint recorded on the chef assignment page.
Voiceprints never leave the machine; audio is turned into numbers and
discarded, and they are kept in `speaker-sidecar/voiceprints.json`
(gitignored).

```bash
npm run speaker        # http://127.0.0.1:3103, or run everything: npm run dev:voice
```

It needs the Python environment `.venv-voice` (Python 3.13, CUDA torch,
NVIDIA NeMo, `soundfile`, `soxr`, `librosa`) and the
`nvidia/speakerverification_en_titanet_large` model, which downloads on
first use. That environment is not in the repo and has to be created on
each machine; the steps have not been tested from a clean install. If the
GPU is short of memory it falls back to CPU (`SPEAKER_DEVICE=cpu` forces
it). Delete one cook's voiceprint by removing the cook on the chef page, or
everyone's with `DELETE http://127.0.0.1:3103/voiceprints`.

On the chef assignment page, tapping "Start reading" records the cook
reading their line and enrols it. The recording ends when they stop
speaking, not after a fixed time.

## What's real vs. stubbed

- **Kitchen profiles** — full CRUD (`src/components/KitchenProfileForm*`),
  persisted in SQLite via `server/routes/kitchens.js` and
  `src/api/kitchens.js`. A session can't start without at least one
  kitchen; Home gates on this and prompts you to add one.
- **Sessions** (`src/state/AppStateContext.jsx`, `server/routes/sessions.js`)
  — conversation, recipe instances, shared steps, cooks and mode all
  persisted in SQLite. The reducer stays synchronous/optimistic and a
  debounced effect syncs to the API in the background. One in-progress
  session at a time; past sessions show as history on Home.
- **Navigation, the recipe graph editor** (phase-grouped step cards,
  drawer step editor, dependency-graph view, add/delete steps,
  draft-vs-approved diff) — fully working. A session can hold more
  than one dish: steps from every dish render merged into the same
  phase columns and dependency graph, tagged by dish.
- **Voice input** (`src/components/VoiceInput.jsx`, `VoiceBar.jsx`,
  `src/pages/VoiceBindingPage.jsx`) — real AssemblyAI streaming STT
  through the one mic in the voice bar. Voice binding records the cook
  reading their line for real and, if the speaker service is running,
  enrols their voice. See "Voice agent" above.
- **Recipe generation** — dish templates and the materials catalog are
  seeded rows in SQLite (`server/db.js`), served via
  `/api/recipe-templates` and `/api/materials`. Two demo dishes (Mapo
  Tofu, with a vegetarian variant, and Chicken Noodle Soup) are
  instantiated into every session together. `matchTemplates` in
  `RecipeGraphPage` is the seam where an LLM tool call replaces
  template lookup.
- **Shared steps** — steps flagged `is_shareable` with a matching
  `share_key` across dishes (today: mincing garlic) are folded into one
  session-owned `shared_steps` row instead of duplicated per dish, with
  combined quantities and a per-dish breakdown.
- **Schedule** (`src/pages/SchedulePage.jsx`, `src/utils/scheduleLayout.js`)
  — the game plan before going live, on the v4 design system
  (`design/claude-design-schedule-prompt.md`): Co-op / Versus mode
  picker, a plan HUD, then either a two-lane timeline (critical path,
  waits, task detail) or the Versus opening hand + "up for grabs" pool,
  all computed by the resource-constrained scheduler. Mode is session
  state; "Go live" writes the run and hands off to Live cook.
- **Live cook** (`src/pages/LiveCookPage.jsx`, `src/utils/liveCook.js`)
  — built. Takes typed or spoken commands through the agent, with the
  old keyword grammar (`src/utils/voiceCommands.js`) as the fallback when
  the agent is slow or unreachable. Not yet run end to end with a real
  microphone.

## Project structure

```
server/
  index.js                    # Express app entry (CORS, JSON, mounts the routers)
  db.js                       # SQLite connection, schema, demo dish/materials seed
  routes/kitchens.js          # kitchens CRUD API
  routes/sessions.js          # sessions + recipe instances + shared steps API
  routes/recipeTemplates.js   # read-only dish templates + materials catalog
  data.sqlite                 # created on first run (see note above about tracking)

src/
  api/                        # fetch clients: client.js (shared wrapper), kitchens,
                               # sessions, recipeTemplates
  state/AppStateContext.jsx   # app-wide store (React context + reducer); hydrates
                               # kitchens + the active session from the API and
                               # syncs changes back on a debounce
  data/dishes.js              # generic content/helpers: elicitation questions,
                               # equipment/difficulty/phase options, id + slug helpers
  utils/graphLayout.js        # pure DAG helpers (layout, diff, phase grouping, merging
                               # dishes + shared steps, material totals) — no DOM/React
  utils/scheduleLayout.js     # pure resource-constrained scheduler + critical path
  utils/cooks.js              # cook colors, bound-check, per-cook voice lines
  components/                 # reusable UI: AppShell, VoiceBar, VoiceInput, StepCard,
                               # GraphCanvas, NodeEditorPanel, Drawer, Modal,
                               # KitchenProfileForm*, SessionProgress, NumberStepper,
                               # ToggleSwitch
  pages/                      # HomePage, SessionLayout, SessionKitchenSetupPage,
                               # ConversationPage, RecipeGraphPage, VoiceBindingPage,
                               # SchedulePage
  styles/tokens.css           # design tokens + shared primitives (buttons, cards, fields, bands)
```

Routing lives in `src/App.jsx`. `/` (Home) is always reachable — it's
the entry point, not a wizard step. Everything else lives under
`/session/*` and requires an in-progress session (`RequireSession`);
per-step guards (`RequireKitchenProfile`, `RequireConversationComplete`,
`RequireRecipeApproved`, `RequireCooksBound`) send you to wherever you
actually left off if you land somewhere out of order — e.g.
`/session/schedule` bounces back to `/session/voice-binding` if the
cooks aren't bound yet, and `/session/recipe-graph` bounces back to
`/session/conversation` if that isn't complete.

## Data shapes

`server/db.js` and `src/state/AppStateContext.jsx` follow the schemas in
the project brief (`RecipeGraph`, etc.) directly, so swapping
placeholder logic for real API/AssemblyAI calls later is a drop-in
change rather than a restructure. Kitchen profiles' shape is defined by
`server/db.js`'s schema and mirrored by `KitchenProfileForm`.

Step (node) objects carry a few flags worth knowing about, all set in
the seed data and expected from any future generator: `is_end_step`
pins a dish's final step to the last column of the dependency graph;
`is_shareable` + `share_key` mark a step as foldable into a
session-level shared step when two dishes both need it;
`material_usage` states how much of a material that one step consumes,
which is what lets shared steps report a real combined total.
