# Kitchen Path

React + Vite frontend, Node/Express + SQLite backend, for the Kitchen
Path Agent hackathon build. Home is a real entry point (start/resume a
cooking session, manage kitchens, see recent sessions) rather than
step 0 of a wizard; a "session" then walks through conversational
elicitation → recipe graph draft/review, with schedule / live cook /
diary stubbed as future stages.

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
on first run. It's gitignored — everyone gets their own local
database until there's a shared dev DB or seed script.

## What's real vs. stubbed

- **Kitchen profiles** — full CRUD (`src/components/KitchenProfileForm*`),
  persisted in SQLite via `server/routes/kitchens.js` and
  `src/api/kitchens.js`. A session can't start without at least one
  kitchen; Home gates on this and prompts you to add one.
- **Sessions** (`src/state/AppStateContext.jsx`) — conversation +
  recipe graph state, persisted to the browser's `localStorage` (no
  session/account backend yet). One in-progress session at a time;
  past sessions are summarized into session history on the Home page.
- **Navigation, the recipe graph editor** (phase-grouped step cards,
  inline edit popover, dependency-graph view, add/delete steps,
  draft-vs-approved diff) — fully working, no backend needed beyond
  kitchens.
- **Voice input** (`src/components/VoiceInput.jsx`, `VoiceBar.jsx`) —
  a mic button / status bar standing in for AssemblyAI realtime STT.
  Swap their internals for a real STT integration; `VoiceInput`'s
  public contract (`onAnswer(value, label)`) can stay the same.
- **Recipe graph generation** (`src/data/dishes.js#generateRecipeGraph`)
  — hand-authored Mapo Tofu graph that already reacts to conversation
  answers (drops the meat nodes if vegetarian/vegan). This is the seam
  where an LLM tool call replaces the placeholder.
- **Schedule / live cook / diary** — not built. `SessionProgress`
  already has their step slots commented in for when they're ready.

## Project structure

```
server/
  index.js                    # Express app entry (CORS, JSON, mounts /api/kitchens)
  db.js                       # SQLite connection + schema
  routes/kitchens.js          # kitchens CRUD API
  data.sqlite                 # gitignored, created on first run

src/
  api/kitchens.js             # fetch client for the kitchens API
  state/AppStateContext.jsx   # app-wide store (React context + reducer);
                               # hydrates kitchens from the API, persists
                               # session/sessionHistory to localStorage
  data/dishes.js              # placeholder "backend": questions + graph generator
  utils/graphLayout.js        # pure DAG helpers (layout, diff, phase grouping) — no DOM/React
  components/                 # reusable UI: AppShell, VoiceBar, VoiceInput, StepCard,
                               # GraphCanvas, NodeEditorPanel, Modal, KitchenProfileForm*,
                               # SessionProgress, NumberStepper, ToggleSwitch
  pages/                      # HomePage, SessionLayout, SessionKitchenSetupPage,
                               # ConversationPage, RecipeGraphPage
  styles/tokens.css           # design tokens + shared primitives (buttons, cards, fields, bands)
```

Routing lives in `src/App.jsx`. `/` (Home) is always reachable — it's
the entry point, not a wizard step. Everything else lives under
`/session/*` and requires an in-progress session (`RequireSession`);
nested guards (`RequireKitchenProfile`, `RequireConversationComplete`)
send you to wherever you actually left off if you land somewhere out
of order — e.g. `/session/recipe-graph` bounces back to
`/session/conversation` if it isn't complete yet.

## Data shapes

`src/data/dishes.js` and `src/state/AppStateContext.jsx` follow the
schemas in the project brief (`RecipeGraph`, etc.) directly, so
swapping placeholder logic for real API/AssemblyAI calls later is a
drop-in change rather than a restructure. Kitchen profiles' shape is
defined by `server/db.js`'s schema and mirrored by `KitchenProfileForm`.
