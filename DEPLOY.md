# Deploying for the demo

Two halves, because the front end can be public and the API cannot.

| | Where | Why |
|---|---|---|
| Static app (`dist/`) | GitHub Pages, `https://ziqing110.github.io/goose-goose-cook/` | free, HTTPS out of the box (the mic needs it) |
| API (`server/`) | Render free web service | holds `ASSEMBLYAI_API_KEY`; anything on Pages is readable by anyone |

## Several people, one deployment

There is no login, and the demo URL is one shared server. Sessions are
therefore scoped to the browser that made them, by a `client_id` the
client generates and sends in `X-Kitchen-Client`.

**This is a demo measure, not security.** The value is asserted by the
client, never proven, so it separates honest visitors from each other and
nothing else. Fetching a session by id is deliberately left open, so a
shared link keeps working.

It exists because two visitors otherwise collide badly: they see each
other's cooks on the home screen, and — worse — starting a run abandoned
every other active session, so one person opening the page ended
someone else's demo mid-kitchen.

Rows with no owner stay visible to everyone, which is what `npm run seed`
creates: seeded demo content is meant to be shared.

Nothing persists. Render's free tier has no disk, so the container's
`server/data.sqlite` is rebuilt from scratch on every boot —
`seedIfEmpty()` in `server/db.js` recreates the schema and the demo
kitchens, dish templates and materials. Whatever a visitor cooks lives
until the next restart and then is gone — and on the free plan that
includes waking from sleep, not just a redeploy.

Note what this does and does not mean: a visitor's data **is** written to
SQLite while they use the app. It is not kept because the disk is
thrown away, not because nothing is stored. That is deliberate: the summary
card is rendered on the client and downloaded as a PNG
(`utils/summaryCard.js`), so sharing a cook needs no stored data.

## 1. The API, on Render

**Render > New > Blueprint**, point it at this repo. `render.yaml` already
declares the runtime, the build and start commands, the health check and
`ALLOWED_ORIGINS`, so the only thing it asks for is
**`ASSEMBLYAI_API_KEY`**. Paste it there; it must never be committed.

(New > Web Service by hand works too — build `npm ci --omit=dev`, start
`npm run server`, plan Free — but then that config lives in a dashboard
instead of the repo.)

`PORT` is injected by Render and already respected by `server/index.js`.

The service URL will be `https://goose-goose-cook.onrender.com`, which is
what the Pages build already expects. Render adds a suffix if that name is
taken globally — if yours differs, set the `VITE_API_BASE` repository
variable to the real URL.

Check it with `curl https://<your-url>/api/health` — `{"ok":true,"key":true}`
means the service is up and can see its API key.

## 2. The front end, on Pages

- Settings > Pages > Source: **GitHub Actions**. Do this before the first
  run, or the deploy step fails with nothing to publish to.
- Only if your Render URL is not `goose-goose-cook.onrender.com`:
  Settings > Secrets and variables > Actions > **Variables**, add
  `VITE_API_BASE` = the real URL, scheme and host, **no trailing slash**.

Push to `main`, or run the *Deploy to GitHub Pages* workflow by hand.

The two values point at each other and are easy to swap by mistake:
`VITE_API_BASE` is the API's URL (Pages needs to call it),
`ALLOWED_ORIGINS` is the Pages URL (the API needs to accept it).

The repo must be **public** — Pages on a free plan requires it. Keep
`.env` out of every commit.

## On the day

**Warm the API before you present.** Render's free tier sleeps after ~15
minutes idle and takes roughly 50 seconds to wake — which looks exactly
like a hung app. Load the site a few minutes early, or point a free
uptime pinger at it.

What costs money is AssemblyAI, not hosting: roughly **$0.65 per
hour-long cook** — $0.45 of that is Streaming STT at
`universal-3-5-pro`, the rest is LLM Gateway. Streaming bills on
**socket-open time, not audio**, so `AAI_MAX_SESSION_SECONDS` defaults to
5400 (90 min) to bound what an abandoned tab can cost — $0.68 rather than
the $1.35 it would run to the 3h ceiling. Note that LLM Gateway is
**not** covered by the $50 of new-account credits; streaming is.

There is no access gate. Don't post the URL anywhere public, and glance at
the AssemblyAI dashboard afterwards.

## What does not ship

The speaker-identification sidecar (`speaker-sidecar/`) stays local — it
wants torch and a GPU. `src/api/speaker.js` treats every failure as "carry
on without it", so voiceprint matching is simply absent in the deployed
build and nothing errors.
