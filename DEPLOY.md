# Deploying for the demo

Two halves, because the front end can be public and the API cannot.

| | Where | Why |
|---|---|---|
| Static app (`dist/`) | GitHub Pages, `https://ziqing110.github.io/goose-goose-cook/` | free, HTTPS out of the box (the mic needs it) |
| API (`server/`) | Render free web service | holds `ASSEMBLYAI_API_KEY`; anything on Pages is readable by anyone |

Nothing persists. Render's free tier has no disk, so the container's
`server/data.sqlite` is rebuilt from scratch on every boot —
`seedIfEmpty()` in `server/db.js` recreates the schema and the demo
kitchens, dish templates and materials. Whatever a visitor cooks lives
until the next restart and then is gone. That is deliberate: the summary
card is rendered on the client and downloaded as a PNG
(`utils/summaryCard.js`), so sharing a cook needs no stored data.

## 1. The API, on Render

New > Web Service, point it at this repo:

- Build command `npm ci`
- Start command `npm run server`
- Instance type Free

Environment variables — copy from `.env.example`, at minimum:

```
ASSEMBLYAI_API_KEY=...          # never commit this
ALLOWED_ORIGINS=https://ziqing110.github.io
```

`PORT` is injected by Render and already respected by `server/index.js`.

Note the service URL it gives you, e.g.
`https://goose-goose-cook.onrender.com`.

## 2. The front end, on Pages

- Settings > Pages > Source: **GitHub Actions**
- Settings > Secrets and variables > Actions > **Variables**: add
  `VITE_API_BASE` = the Render URL, scheme and host, **no trailing slash**

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
