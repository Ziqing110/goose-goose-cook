# How this app uses its APIs

Every external call, what triggers it, and who pays for it. Written for
someone picking up the repo who needs to know where the money and the
latency go before changing anything.

Four things to hold onto:

1. **Audio never touches our server.** The browser streams straight to
   AssemblyAI. Our API only mints the token that lets it.
2. **The API key is server-only.** The browser gets a short-lived token
   from `/api/voice/stt-token`; the key itself never leaves the host.
3. **Speaking is free.** The agent's voice is a model running in the
   visitor's own browser, not a paid TTS API.
4. **Every model call goes through one place** — AssemblyAI's LLM
   Gateway, billed on tokens, separately from streaming.

---

## The shape of it

```
                       BROWSER                                    OUR API (Render)            OUTSIDE
                                                                                          
  mic ──┬─────────────────────────────────────────────────────────────────────────────▶  AssemblyAI
        │                                  GET /api/voice/stt-token ──▶ mint w/ raw key       Streaming STT
        │                                  ◀── short-lived token                              $0.45/hr OPEN SOCKET
        │                                                                                     (not per audio)
        ▼
   transcript
        │
        ├── stage 1  Conversation ───────▶ POST /api/understanding/read ──▶ LLM Gateway  claude-sonnet-4-6
        │              (once per answer)                                                  read one spoken answer
        │
        ├── stage 2  Recipe draft ───────▶ POST /api/recipes/generate ────▶ LLM Gateway  gemini-3.8-flash
        │                                        │                                        (fallback: qwen3.5-4b,
        │                                        │                                         one dish at a time)
        │                                        └──── review pass ───────▶ LLM Gateway  claude-sonnet-4-6
        │                                             (reviewPlan.js)                     a DIFFERENT model on
        │                                                                                 purpose: writing a plan
        │                                                                                 and checking one are
        │                                                                                 not the same skill
        │
        └── stage 3  Live cook turn ─────▶ POST /api/agent/turn ──────────▶ LLM Gateway  gpt-4.1 + tools
                       │                         │
                       │                         └── search_web ──────────▶ Tavily      optional, free tier
                       │                              parked, not awaited
                       │                         GET /api/agent/answer/:id ◀── collected later
                       │
                       ├── agent unreachable ──▶ src/utils/voiceCommands.js   local keyword grammar, no network
                       │
                       └── reply spoken ──────▶ Kokoro-82M, WebGPU, IN THE BROWSER      $0
                                                 (falls back to Web Speech)

   POST /speaker/identify ──▶ speaker-sidecar (local Python, TitaNet)   LOCAL ONLY, not deployed
```

---

## Stage by stage

### Speech to text — the whole app

`useStreamingTranscript.js` fetches `/api/voice/stt-token`, then opens
`wss://streaming.assemblyai.com/v3/ws` and sends **raw binary PCM
frames**. Wrapping those in JSON or base64 returns silence with no
error.

Billed on **how long the socket stays open**, idle or not — not on audio
sent. The socket therefore only lives while unmuted (VoiceBar's toggle),
the mic mutes itself after a quiet period (30s off the live cook, 120s
during one), and tokens cap the session at 90 minutes so an abandoned
tab cannot run to the 3-hour ceiling.

### Stage 1 — Conversation

One `POST /api/understanding/read` per spoken answer. Small job with a
person waiting, so latency counts as much as accuracy.

### Stage 2 — Recipe

`POST /api/recipes/generate` drafts the DAG, then a second pass reads it
back and returns corrections rather than a new plan, so it can only
improve things or leave them alone. Set `AAI_RECIPE_REVIEW=off` to skip
it.

The fallback model exists for a free-tier account that cannot reach the
primary. It cannot do the same job: given three dishes at once it merged
them, so the server asks it for one dish at a time and merges the
results. The cost shows in the product — nothing is ever shared, because
no single call sees two dishes.

### Stage 3 — Live cook, one turn

The most interesting path, and the only one with a fallback:

1. A turn lands from STT.
2. **Addressing check** — spoken words must say the agent's name, unless
   it just asked a question. Typed text is aimed at it by definition.
3. **Speaker ID** (optional) — the local sidecar says which cook spoke.
   Absent in the deployment; every call site treats failure as "carry on".
4. `POST /api/agent/turn` with a **snapshot of the run**.
5. The server builds the tool list **from that snapshot**: `step_id` is
   an `enum` of the ids that are actually valid for that action right
   now, so the model cannot start a step that is not ready or finish one
   nobody is on.
6. Tool calls come back and the page applies them.
7. The reply is spoken by Kokoro in the browser.

**If the agent is slow, down or unreachable**, the page falls back to the
local keyword grammar in `src/utils/voiceCommands.js`. No network, works
offline, understands English and Mandarin run controls. It cannot resolve
a Mandarin step *name* — labels are English and the matcher is ASCII —
so it asks which step instead.

**`search_web`** would block the cook for seconds, so it does not. The
server answers immediately with whatever the agent already decided plus
"let me look that up", parks the promise under a `pendingId`, and the
page collects it separately at `GET /api/agent/answer/:id`. Commands
given while it reads still land.

---

## What each turn costs

Roughly, for a one-hour cook (token counts are estimates, the rates are
from AssemblyAI's published tables):

| | |
|---|---|
| Streaming STT, socket open the hour | **$0.45** |
| ~5 conversation answers | ~$0.02 |
| Recipe generation | ~$0.02 |
| Review pass | ~$0.03 |
| ~30 live-cook agent turns | ~$0.14 |
| Text to speech | **$0.00** — runs in the browser |
| Web search | $0.00 — Tavily free tier |
| **Total** | **≈ $0.65** |

Streaming dominates, and it is the one that bills whether anyone is
speaking or not. LLM Gateway is **not** covered by the $50 of new-account
credits; streaming is.

---

## Where the knobs are

All of it is env, no code change — see `.env.example` for the reasoning
behind each default.

| Variable | Picks |
|---|---|
| `AAI_STREAMING_MODEL` | `universal-3-5-pro` ($0.45/hr). English-only streaming is $0.15/hr but loses Voice Focus. |
| `AAI_LLM_GATEWAY_MODEL` | conversation answer reading |
| `AAI_RECIPE_MODEL` / `_FALLBACK_MODEL` | recipe generation |
| `AAI_RECIPE_REVIEW_MODEL` / `AAI_RECIPE_REVIEW` | the review pass |
| `AAI_AGENT_MODEL` | live-cook turns — must support `tools` |
| `AAI_MAX_SESSION_SECONDS` | the streaming cost guard (default 5400) |
| `TAVILY_API_KEY` | absent = the search tool is never offered |
