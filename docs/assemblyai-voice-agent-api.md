<!--
  VENDOR DOCUMENT — reproduced verbatim.
  Source: AssemblyAI's published coding-agent instructions for the
  Voice Agent API (https://www.assemblyai.com/docs/coding-agent-prompts).
  Captured 2026-09-16.

  This is AssemblyAI's text, not ours. Do not edit it to match our
  opinions — if it goes stale, re-fetch it. Our decisions about how to
  use this API live in VOICE_PLAN.md (Stage C7).

  Applies to the **Voice Agent API** only. The live-cook path uses
  Streaming STT, which has a different endpoint, different auth, and a
  different audio transport. Do not generalize rules between them.

  KNOWN STALE below: the "Live docs" section names the docs MCP server as
  https://mcp.assemblyai.com/docs. That server is deprecated — its own
  tool descriptions say so and point at https://www.assemblyai.com/docs/mcp,
  which is what .mcp.json uses. Everything else here checked out against
  the live API.
-->

# AssemblyAI Voice Agent API, Coding Agent Instructions

You are helping a developer integrate AssemblyAI's Voice Agent API into their app. The Voice Agent API is a managed, full-duplex speech-in / speech-out endpoint over a single WebSocket. STT, LLM, TTS, turn detection, and tool calling are all handled by AssemblyAI. Use this when "speech in, speech out" is the whole product. If the developer wants to bring their own LLM and TTS, they should use AssemblyAI Streaming STT instead, not this API.

The developer creates their key at https://www.assemblyai.com/dashboard/api-keys.

**Live docs.** Two ways to wire your coding agent up to current docs (both layer):

1. Project instructions: add to CLAUDE.md, .cursorrules, AGENTS.md, or equivalent:

   "Always fetch https://www.assemblyai.com/docs/llms.txt before writing AssemblyAI code. The API has changed. Do not rely on memorized parameter names."

2. Docs MCP server: `https://mcp.assemblyai.com/docs` (Streamable HTTP transport). Provides search_docs, get_pages, list_sections, get_api_reference.

## Operating rules

1. Discovery first, code later. Before writing code, know: language and framework, where audio is coming from (browser mic, Twilio, SIP, etc.), what the agent should actually do.
2. One question per message during discovery. Wait for the answer.
3. Plan before you build. Post a written recommendation (model, endpoint, parameters, auth pattern, code skeleton) and wait for explicit approval before generating code.
4. **Authorization header is `Bearer YOUR_API_KEY` for the Voice Agent API.** This is the exception. AssemblyAI's other products (Streaming STT, pre-recorded) take the raw key with no Bearer prefix. Do not generalize either rule across products.
5. Never expose the API key in client-side code. For browser or mobile, mint a temporary token server-side and pass it as `?token=...` on the WebSocket URL.
6. Verify parameters against live docs before recommending. Pull the current reference rather than memorizing.

## Endpoint and auth

- WebSocket: `wss://agents.assemblyai.com/v1/ws`
- Token endpoint (for browser / mobile clients):

```bash
curl -s "https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640" \
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY"
# { "token": "..." }
```

- `expires_in_seconds`: 1 to 600 (how long the token can be redeemed for).
- `max_session_duration_seconds`: 60 to 10800 (caps the resulting session, defaults to the 3-hour max).
- Tokens are single-use per session. Get a fresh one for every reconnect, including `session.resume`.

## Audio format

PCM16 mono **24 kHz**, base64-encoded inside JSON events (not raw binary frames; this is different from Streaming STT). About 50ms chunks (2,400 bytes) is fine. The server buffers continuously, so exact chunk size does not matter.

Output `encoding` accepts `audio/pcm` (24 kHz, default), `audio/pcmu` (G.711 mu-law, 8 kHz), or `audio/pcma` (G.711 A-law, 8 kHz). Use the G.711 variants for telephony bridges (Twilio, etc.) so you do not have to resample.

## Lifecycle (the events that matter)

1. Client connects, sends `session.update` immediately (do not wait for `session.ready`):

```json
{
  "type": "session.update",
  "session": {
    "system_prompt": "You are a helpful assistant.",
    "greeting": "Hi! How can I help?",
    "input": {
      "format": { "encoding": "audio/pcm" },
      "turn_detection": {
        "vad_threshold": 0.5,
        "min_silence": 200,
        "max_silence": 1000,
        "interrupt_response": true
      }
    },
    "output": {
      "voice": "anna",
      "format": { "encoding": "audio/pcm" }
    },
    "tools": [ /* see Tool calling below */ ]
  }
}
```

2. Server replies with `session.ready` (capture `session_id` for `session.resume` if you reconnect within 30 seconds of a disconnect).
3. **Only after `session.ready`**, start streaming mic audio:

```json
{ "type": "input.audio", "audio": "<base64 PCM16 24kHz>" }
```

4. Server emits, in roughly this order, per turn:
   - `input.speech.started` and `input.speech.stopped` (VAD).
   - `transcript.user.delta` (partials) and `transcript.user` (final).
   - `reply.started`, `reply.audio` (multiple base64 PCM16 chunks, write directly into an output buffer at 24 kHz), `transcript.agent`, `reply.done`.
5. **Field-name asymmetry, easy to miss:** `input.audio` carries audio in the `audio` field. `reply.audio` carries audio in the `data` field. Copying `event["audio"]` from input handling will silently return nothing on output.

## Tool calling

Tool definitions in `session.tools` use a **flat** schema. NOT OpenAI's nested `{type: "function", function: {...}}` form.

```json
{
  "type": "function",
  "name": "get_weather",
  "description": "Get the current weather for a city.",
  "parameters": {
    "type": "object",
    "properties": { "location": { "type": "string" } },
    "required": ["location"]
  }
}
```

Server sends `tool.call` with `{call_id, name, arguments}`. Send `tool.result` with the matching `call_id` *after* `reply.done` fires. If `reply.done.status == "interrupted"` (user barge-in), discard pending tool results.

## Voices

Set `session.output.voice` to one of these exact ids. Invented or remembered names will silently fail at `session.update`. Default: `anna`. Switch voices mid-call by sending another `session.update`.

**English (US):** alba, eve, george, jane, jean, mary, michael.

**English (UK):** anna, charles, paul, vera.

**Language-specific** (native accent in the named language; code-switches with English): giovanni (Italian), lola (Spanish), juergen (German), rafael (Portuguese), estelle (French).

## Playback gotcha

Don't sleep-schedule audio chunks. Write each `reply.audio` PCM directly to an OS audio buffer (`sounddevice.OutputStream.write()` in Python, an `AudioBufferSourceNode` chain in the browser). The OS drains at exactly 24 kHz and absorbs network jitter. Sleep-based timing drifts and produces pops or gaps.

On `reply.done.status == "interrupted"`, flush the output buffer (e.g. `speaker.abort(); speaker.start()`) so the user does not hear stale agent speech.

## Recommended integration: browser

Browser is the path AssemblyAI recommends for most apps. Hardware echo cancellation, noise suppression, and AGC are handled by `getUserMedia`, which removes a class of bugs you would otherwise have to solve yourself (the agent's TTS leaking back into the mic and being interpreted as user speech). Server-side mic capture (e.g. Python `pyaudio`) does not get those features for free.

A complete, self-contained HTML quickstart lives in the dashboard at `/dashboard/code?product=voice-agent` (the "Code" page). Direct the developer there if they want to copy and run a working file. The structure below is the same flow, condensed.

### Browser sketch (HTML + JS, the structure that matters)

```js
const RATE = 24_000;

// 1) Inline AudioWorklet that converts Float32 mic samples to PCM16
//    and posts each frame back to the main thread. The browser's audio
//    engine resamples the input to whatever the AudioContext's sampleRate
//    is, so creating the context at 24 kHz means we capture at 24 kHz.
const workletUrl = URL.createObjectURL(new Blob([`
  class P extends AudioWorkletProcessor {
    process(inputs) {
      const ch = inputs[0]?.[0];
      if (ch) {
        const buf = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++)
          buf[i] = Math.max(-32768, Math.min(32767, ch[i] * 32767));
        this.port.postMessage(buf.buffer, [buf.buffer]);
      }
      return true;
    }
  }
  registerProcessor("pcm", P);
`], { type: 'application/javascript' }));

async function start({ token, systemPrompt, greeting, voice = 'anna' }) {
  const ctx = new AudioContext({ sampleRate: RATE });
  await ctx.resume();
  await ctx.audioWorklet.addModule(workletUrl);

  // 2) Mic with hardware AEC + NS + AGC. This is the browser's killer feature
  //    for voice agents: TTS bleed-through into the mic stops being a problem.
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const source = ctx.createMediaStreamSource(mic);
  const worklet = new AudioWorkletNode(ctx, 'pcm');

  const url = new URL('wss://agents.assemblyai.com/v1/ws');
  url.searchParams.set('token', token); // single-use temp token from your server
  const ws = new WebSocket(url);

  let ready = false;
  let playT = 0; // monotonic playback head for seamless reply.audio scheduling

  worklet.port.onmessage = ({ data }) => {
    if (!ready || ws.readyState !== 1) return;
    const b = new Uint8Array(data);
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    ws.send(JSON.stringify({ type: 'input.audio', audio: btoa(s) }));
  };
  source.connect(worklet).connect(ctx.destination);

  ws.onopen = () => ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      system_prompt: systemPrompt,
      greeting,
      output: { voice },
    },
  }));

  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    switch (m.type) {
      case 'session.ready':
        ready = true; // only now is it safe to stream input.audio
        break;

      case 'reply.audio': {
        // Decode base64 PCM16 -> Float32, schedule it on the AudioContext.
        // Don't sleep-schedule chunks; chain them onto a monotonic timeline
        // (playT) so playback drains continuously without pops.
        const raw = atob(m.data);
        const pcm = new Int16Array(raw.length / 2);
        for (let i = 0; i < pcm.length; i++)
          pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
        const f32 = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
        const buf = ctx.createBuffer(1, f32.length, RATE);
        buf.getChannelData(0).set(f32);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination);
        playT = Math.max(playT, ctx.currentTime);
        src.start(playT); playT += buf.duration;
        break;
      }

      case 'reply.done':
        // On user barge-in, reset the playback head so stale agent audio
        // doesn't continue draining out of the speakers.
        if (m.status === 'interrupted') playT = ctx.currentTime;
        break;

      case 'transcript.user':  console.log('user:', m.text);  break;
      case 'transcript.agent': console.log('agent:', m.text); break;
      case 'session.error':    console.error('agent error:', m.message); break;
    }
  };
}
```

### Server endpoint for the temp token

Browser flow needs a tiny server endpoint that mints a token using your secret API key:

```js
// Node / Next.js route handler
export async function GET() {
  const r = await fetch(
    'https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640',
    { headers: { authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } },
  );
  return Response.json(await r.json()); // { token: "..." }
}
```

The browser fetches `/api/voice-agent/token` (or whatever you name it) and passes the returned token into `start({ token, ... })` above. Mint a fresh token for every reconnect.

### Server-side language (optional, secondary)

If the developer specifically needs to run the agent loop on a server (no browser involved) and accepts that they will lose hardware AEC, the same flow translates to Python with `websockets` + `sounddevice`. Note up front that the agent's TTS leaking back into a server-side mic via the speakers is a real problem to solve at the application level. Recommend the browser path unless they have a hard reason otherwise.

## Quick gotchas to flag during review

- Authorization header is `Bearer YOUR_API_KEY` (Voice Agent only). The rest of AssemblyAI takes the raw key.
- Audio format is PCM16 mono **24 kHz**, base64-encoded inside JSON events (not binary frames).
- Send `session.update` immediately on connect, do not wait for `session.ready`. But do not stream mic audio until `session.ready` arrives.
- `input.audio` uses the `audio` field. `reply.audio` uses the `data` field.
- Tool schema is flat (`{type, name, description, parameters}`), not OpenAI nested.
- Voice ids are exact strings. Invented names fail.
- Tokens are single-use per session. Mint a fresh one on every reconnect, including `session.resume`.
