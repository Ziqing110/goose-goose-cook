# Kitchen Path — agent instructions

## AssemblyAI

**Always fetch <https://www.assemblyai.com/docs/llms.txt> before writing
AssemblyAI code. The API has changed. Do not rely on memorized parameter
names.** (AssemblyAI's own instruction to coding agents.)

A docs MCP server is configured in `.mcp.json` at
`https://www.assemblyai.com/docs/mcp` (Streamable HTTP).
**Prefer it over web fetching whenever it's connected.** Three tools:

- `search_assembly_ai` — semantic search; start here for conceptual
  questions ("how does turn detection work").
- `query_docs_filesystem_assembly_ai` — read-only shell over a virtual
  FS holding the docs. This is how you read a page; there is no
  "get page" tool. Use it for exact parameter checks.
- `submit_feedback` — report a doc that's wrong or unclear.

Filesystem notes, learned the hard way:

- Paths have **no `/docs` prefix** — it's `/streaming/turn-detection.mdx`,
  not `/docs/streaming/...`. Run `tree / -L 2` first; never guess a path.
- Every page is `.mdx`. A URL path `/some/page` reads as
  `head -200 /some/page.mdx`.
- Its `rg` rejects `--no-heading`. Each call is stateless — `cd` does not
  carry over, so chain with `&&` or use absolute paths.
- A missing path means the guess was wrong, not that the topic is
  undocumented. Fall back to `rg -il "keyword" /`.

Two URL traps, both of which cost us a restart cycle:

- The `www.` is required. `https://assemblyai.com/docs/mcp` returns a
  308 redirect that the MCP client does not follow, so the server
  silently never connects.
- `https://mcp.assemblyai.com/docs` is the **old** server. It still
  answers, but its own tool descriptions carry a deprecation notice
  pointing at the URL above. Don't use it — AssemblyAI's published agent
  instructions still name it, and they're out of date.

### This project uses two different AssemblyAI products

They look similar and share nothing. **Never generalize a rule from one
to the other** — this is the single most common way to waste an hour here.

| | **Streaming STT** (live cook) | **Voice Agent API** (conversation) |
|---|---|---|
| WebSocket | `wss://streaming.assemblyai.com/v3/ws` | `wss://agents.assemblyai.com/v1/ws` |
| Token endpoint | `https://streaming.assemblyai.com/v3/token` | `https://agents.assemblyai.com/v1/token` |
| Auth header | **raw key**, no prefix | **`Bearer <key>`** |
| Audio transport | **raw binary frames** | **base64 inside JSON** events |
| Sample rate | whatever you declare in `sample_rate` | **24 kHz**, fixed |
| Config | query params on the URL | `session.update` message |
| You supply | LLM, TTS, orchestration | nothing — it's managed |

Vendor reference for the Voice Agent API is checked in verbatim at
[docs/assemblyai-voice-agent-api.md](docs/assemblyai-voice-agent-api.md).
Re-fetch it rather than editing it if it goes stale.

### Gotchas that cost real time

- Wrapping Streaming STT audio in JSON or base64 → silence, no error.
- `input.audio` carries audio in `audio`; `reply.audio` carries it in
  `data`. Voice Agent only.
- Voice Agent tool schema is **flat** (`{type, name, description,
  parameters}`), not OpenAI's nested form.
- Voice Agent voice ids are exact strings; invented ones fail silently
  at `session.update`.
- Voice Agent tokens are single-use per session — mint a fresh one on
  every reconnect, including `session.resume`.
- Voice Focus is `universal-3-5-pro` only, and silently no-ops elsewhere.
- Both products bill on **connection-open time**, not audio sent. Always
  send `Terminate` / close on unmount.

### Secrets

`ASSEMBLYAI_API_KEY` lives in `.env` at the repo root (gitignored;
template in `.env.example`). It is **server-only** — the browser gets a
short-lived token from our own endpoint, never the key. Scripts load it
via Node's built-in `--env-file-if-exists`; there is no `dotenv`
dependency and we don't want one.

## Where things are

- `VOICE_PLAN.md` — the staged plan (A explore → B decide → C integrate)
- `VOICE_TEST_PLAN.md` — human voice test rounds and their pass gates
- `voice-lab/` — standalone API bench, `npm run lab`. Imports nothing
  from the app and nothing imports it. Safe to delete when done.
- `HANDOFF.md` — what's built vs. stubbed, and where the seams are
- `DESIGN_BASE.md` — design tokens and visual language

## Conventions

- Plain CSS with the tokens in `src/styles/tokens.css`. Don't hardcode
  colors; light and dark variants are already wired.
- Derived display values are computed, not stored (see
  `graphLayout.js`, `cooks.js`).
- Pure logic lives in `src/utils/` with no DOM or React imports, so it
  stays testable.
