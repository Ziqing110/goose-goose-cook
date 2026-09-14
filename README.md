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

The SQLite file lives at `server/data.sqlite`, created automatically
on first run and seeded with the demo dish templates + materials
catalog (`server/db.js`). Note: it's listed in `.gitignore` but is
still tracked from an earlier commit, so it shows up as modified
whenever you run the app — `git rm --cached server/data.sqlite` would
make the ignore rule actually take effect.

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
  `src/pages/VoiceBindingPage.jsx`) — mic button / status bar / cook
  voice binding, all standing in for AssemblyAI realtime STT. There is
  no real audio capture anywhere yet: "recording" is a staged
  animation and the name is typed. `VoiceInput`'s public contract
  (`onAnswer(value, label)`) can stay the same when swapped for real STT.
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
  — a Gantt timeline from a greedy resource-constrained scheduler that
  treats kitchen equipment as limited, contended resources, plus
  cooperation/competition mode selection. Mode is persisted but has no
  live behavior yet.
- **Live cook / diary** — not built. `SessionProgress` has their step
  slots commented in for when they're ready, and the schedule page's
  "Start cooking" button is deliberately still disabled.

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
