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

### What this project uses

Two AssemblyAI products, with different rules. **Never generalize a rule
from one to the other.**

| | **Streaming STT** (every page's mic) | **LLM Gateway** (every model call) |
|---|---|---|
| Endpoint | `wss://streaming.assemblyai.com/v3/ws` | `https://llm-gateway.assemblyai.com/v1/chat/completions` |
| Auth | token from `https://streaming.assemblyai.com/v3/token`, minted with the **raw key**, no prefix | **raw key** in `authorization`, server-side only |
| Payload | **raw binary PCM frames**; config as URL query params | OpenAI-style chat completions JSON |
| Code | `src/hooks/useStreamingTranscript.js`, `server/routes/voice.js` | `server/llm.js` (the only caller of the gateway) |

The Voice Agent API (`agents.assemblyai.com`, `Bearer` auth, base64 audio
in JSON) is **not** used here; don't apply its rules to either of these.

### Gotchas that cost real time

- Wrapping Streaming STT audio in JSON or base64 → silence, no error.
- Streaming tokens are single-use: mint a fresh one on every reconnect.
- Voice Focus is `universal-3-5-pro` only, and silently no-ops elsewhere.
- Streaming bills on **connection-open time**, not audio sent. Always
  send `Terminate` / close on unmount.

### Secrets

`ASSEMBLYAI_API_KEY` lives in `.env` at the repo root (gitignored;
template in `.env.example`). It is **server-only** — the browser gets a
short-lived token from our own endpoint, never the key. Scripts load it
via Node's built-in `--env-file-if-exists`; there is no `dotenv`
dependency and we don't want one.

## Where things are

- `README.md` — what the app does, the stages, and where each lives
- `docs/API_FLOW.md` — every external call, what triggers it, what it costs
- `docs/VOICE_COMMANDS.md`, `docs/VOICE_COMMAND_TESTS.md` — the voice grammar and how it is tested
- `docs/VOICE_FINDINGS.md`, `docs/VOICE_RECORDING_SCRIPTS.md` — replayable kitchen recordings and what they showed
- `internal-design/` — local only, gitignored: `DESIGN_BASE.md` (design
  tokens and visual language) and `GOOSE_PERSONA.md` (the goose's voice)

## Conventions

- Plain CSS with the tokens in `src/styles/tokens.css`. Don't hardcode
  colors; light and dark variants are already wired.
- Derived display values are computed, not stored (see
  `graphLayout.js`, `cooks.js`).
- Pure logic lives in `src/utils/` with no DOM or React imports, so it
  stays testable.
