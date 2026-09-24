// Mic -> AssemblyAI Streaming STT, as a hook.
//
// Ported from the voice-lab bench, minus the instrumentation. The lab
// exists to expose every parameter; this exists to do one job reliably
// and stay quiet.
//
// Connection lifecycle is driven by `enabled` (in practice: VoiceBar's
// mute toggle). Unmuting opens a socket, muting closes it. That matters
// for more than tidiness — AssemblyAI bills for the time the socket is
// open, not the audio sent, so an idle connection is a real charge.
import { useCallback, useEffect, useRef, useState } from "react";
import { audioTap } from "../voice/audioTap.js";
import { API_ORIGIN } from "../api/client.js";

const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const CHUNK_MS = 50;
const TERMINATE_GRACE_MS = 3000;

// Idle handling exists because billing is per second of open socket, and
// the obvious guard does not work: the server's `inactivity_timeout`
// resets on any audio or message, not on speech, and we stream silent
// PCM continuously while unmuted. It would never fire for someone who
// unmuted and walked away — the case we actually care about. So idle is
// detected here, from the signal.
//
// The server param is still set, as a backstop for a wedged client that
// has stopped sending at all; that is the only case it catches.
//
// Idle means "no words heard", not "no sound heard". It used to mean the
// latter, keyed off the level meter, which was wrong in exactly the room
// this app is built for: an extractor fan sits above any sane audio
// threshold indefinitely, so a loud empty kitchen never went idle and
// never stopped billing.
// Default only. Pages override it via config.idleMs, because the right
// quiet period is not the same everywhere: mid-cook someone can silently
// watch a pan for a long time, while a page that only takes commands has
// no reason to hold a billing socket open for someone who has left.
const IDLE_MS = 120_000;
const IDLE_SERVER_BACKSTOP_S = 300;
const IDLE_CHECK_MS = 5_000;

// A socket can close without anyone asking it to: the session hits its
// max duration, wifi drops, the server restarts. Until this existed that
// was silent — onclose tore the audio down and set status idle, so the
// mic simply stopped working mid-cook with nothing on screen to say so.
//
// Each attempt is a FULL reconnect, token fetch included, because
// AssemblyAI tokens are single-use: reusing one is an instant reject.
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8_000;
// Below this, a connection counts as flapping rather than working, so
// its attempt budget is NOT refilled. Without this an open/close loop
// would retry forever, opening a billable session each time.
const STABLE_MS = 10_000;

// Background noise can read as speech to the VAD, and a turn that never
// stops hearing "speech" never reaches the silence that would end it. It
// stays open, transcribes nothing, and the app waits on a turn that is
// never coming.
//
// So: if a turn has been open this long and has still not produced a
// single word, stop waiting for silence and end it ourselves. Real
// speech is exempt by construction — it produces a partial within about
// a second, and any partial at all resets this.
const EMPTY_TURN_MS = 9_000;

/**
 * @param {object}   options
 * @param {boolean}  options.enabled      open the connection when true
 * @param {function} options.onTurn       (turn) => void, on each finalized turn
 * @param {object}   options.config       connection params (see buildParams)
 * @param {function} options.onError      (message, {fatal}) => void. fatal
 *   means listening has stopped for good and only the user can restart it;
 *   otherwise the hook is still trying and the socket may yet recover.
 * @param {function} options.onIdle       () => void, after config.idleMs of no speech
 *
 * `config.idleMs` overrides how long "no words heard" runs before onIdle.
 *
 * status is idle|connecting|live|reconnecting|closing|error. `reconnecting`
 * means the socket dropped on its own and is being reopened; the caller
 * should say so rather than look muted.
 */
export function useStreamingTranscript({ enabled, onTurn, config = {}, onError, onIdle } = {}) {
  const [status, setStatus] = useState("idle"); // idle|connecting|live|closing|error
  const [partial, setPartial] = useState("");
  // Speech was detected but has not resolved into words yet. The API
  // sends SpeechStarted before a turn's first transcript, and it only
  // fires once the model has an actual transcript, so it means "someone
  // is talking", not "the room is loud". It exists so the UI can say
  // "heard you" in ~300ms instead of waiting for text.
  const [hearing, setHearing] = useState(false);
  const [level, setLevel] = useState(0);

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const streamRef = useRef(null);
  const terminateRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retriesRef = useRef(0);
  const openedAtRef = useRef(0);
  // A close we should not fight: an Error the server will just repeat
  // (bad token, bad config). Network drops and session expiry are not
  // this, and are exactly what the retry is for.
  const fatalRef = useRef(false);
  // Bumping this re-runs the connect effect, which is the reconnect.
  const [retryTick, setRetryTick] = useState(0);

  // Held in refs so a re-render with new callbacks doesn't tear down the
  // socket. The connection should outlive prop identity changes.
  const onTurnRef = useRef(onTurn);
  const onErrorRef = useRef(onError);
  const onIdleRef = useRef(onIdle);
  const configRef = useRef(config);
  const lastVoiceRef = useRef(0);
  // When the turn currently in progress started, and whether it has
  // produced any transcript yet. Together they distinguish "someone is
  // talking" from "the room is loud".
  const turnStartedRef = useRef(0);
  const wordsThisTurnRef = useRef(false);
  // Wall-clock time of stream time zero (the first audio chunk), so a
  // word's `start` (ms into the stream) converts to when it was spoken.
  const streamStartRef = useRef(0);
  const firstWordAtRef = useRef(0);
  onTurnRef.current = onTurn;
  onErrorRef.current = onError;
  onIdleRef.current = onIdle;
  configRef.current = config;

  const teardownAudio = useCallback(() => {
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    audioTap.stop();
    nodeRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setLevel(0);
    setPartial("");
    setHearing(false);
  }, []);

  /** Push keyterms / turn settings without reconnecting. */
  const updateConfig = useCallback((patch) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "UpdateConfiguration", ...patch }));
    return true;
  }, []);

  // Poll rather than a single timer: the deadline moves every time
  // someone speaks, and rescheduling a timeout on every 50ms audio chunk
  // would be far more work than one check every few seconds.
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      // A turn the server opened on noise and can't close on its own.
      // ForceEndpoint ends it immediately and returns its final Turn,
      // which unblocks anything waiting on end_of_turn.
      const openFor = Date.now() - turnStartedRef.current;
      if (turnStartedRef.current && !wordsThisTurnRef.current && openFor >= EMPTY_TURN_MS) {
        turnStartedRef.current = Date.now();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ForceEndpoint" }));
        }
      }

      if (!lastVoiceRef.current) return;
      if (Date.now() - lastVoiceRef.current >= (configRef.current.idleMs ?? IDLE_MS)) {
        lastVoiceRef.current = 0; // fire once, not every tick
        onIdleRef.current?.();
      }
    }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // Muting and unmuting is a fresh start: clear anything the last run
  // was retrying or refusing to retry.
  useEffect(() => {
    if (enabled) return undefined;
    retriesRef.current = 0;
    fatalRef.current = false;
    clearTimeout(retryTimerRef.current);
    return undefined;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    (async () => {
      setStatus((s) => (s === "reconnecting" ? s : "connecting"));

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            // Voice Focus runs server-side and does this better, but
            // leaving the browser's DSP on is the safer default in a
            // real kitchen where we can't control the room.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.(`Microphone unavailable: ${err.message}`, { fatal: true });
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      try {
        // public/ file, so Vite leaves the path alone: it must carry the
        // base path itself or the Pages build 404s here and the whole mic
        // pipeline dies with nothing but this console error.
        await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-processor.js`);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.(`Audio worklet failed to load: ${err.message}`, { fatal: true });
        }
        return;
      }

      let token;
      try {
        const res = await fetch(`${API_ORIGIN}/api/voice/stt-token`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Token request failed (${res.status})`);
        token = body.token;
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.(err.message, { fatal: true });
        }
        return;
      }
      if (cancelled) return;

      const ws = new WebSocket(`${WS_BASE}?${buildParams(token, ctx.sampleRate, configRef.current)}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        const chunkSamples = Math.round((ctx.sampleRate * CHUNK_MS) / 1000);
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "pcm-processor", {
          processorOptions: { chunkSamples },
        });
        nodeRef.current = node;

        node.port.onmessage = ({ data }) => {
          setLevel(data.peak);
          if (ws.readyState === WebSocket.OPEN) {
            // Raw binary frame. Wrapping this in JSON or base64 is the
            // single most common way to get silence back from this API.
            ws.send(data.pcm.buffer);
            // The same audio, kept for a few seconds so a turn's clip can
            // be cut out by its word timestamps (speaker identification).
            // Only chunks actually sent, so the ring's clock is the
            // recogniser's.
            audioTap.push(data.pcm);
          }
        };

        source.connect(node);
        // Terminating node so the worklet is actually pulled; gain 0
        // keeps the mic out of the speakers and out of its own transcript.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        node.connect(sink).connect(ctx.destination);
        lastVoiceRef.current = Date.now();
        turnStartedRef.current = Date.now();
        streamStartRef.current = Date.now();
        audioTap.reset(ctx.sampleRate, streamStartRef.current);
        wordsThisTurnRef.current = false;
        openedAtRef.current = Date.now();
        setStatus("live");
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "Begin":
            // Unrecognized query params are ignored rather than rejected,
            // so this echo is the only evidence the model we asked for is
            // the model we got — and model-gated features (Voice Focus)
            // silently do nothing otherwise.
            if (msg.configuration?.model && configRef.current.speechModel &&
                msg.configuration.model !== configRef.current.speechModel) {
              onErrorRef.current?.(
                `Model mismatch: asked for ${configRef.current.speechModel}, got ${msg.configuration.model}.`,
                { fatal: false },
              );
            }
            break;

          case "SpeechStarted":
            setHearing(true);
            break;

          case "Turn": {
            const heard = (msg.transcript || "").trim();
            if (msg.end_of_turn) {
              setPartial("");
              setHearing(false);
              turnStartedRef.current = Date.now();
              wordsThisTurnRef.current = false;
              // Only words count as someone being here. Noise used to
              // reset this via the level meter, which meant a loud empty
              // kitchen never went idle and never stopped billing.
              if (heard) lastVoiceRef.current = Date.now();
              // A forced endpoint on pure noise lands here with nothing
              // in it. Pass it on anyway — every consumer already ignores
              // an empty transcript, and swallowing it would hide the
              // watchdog from anyone debugging this later.
              // When the first word was SPOKEN, not when this arrived. The
              // audio clock is exact; the first partial is the fallback.
              const firstMs = msg.words?.[0]?.start;
              const startedAt = Number.isFinite(firstMs) && streamStartRef.current
                ? streamStartRef.current + firstMs
                : firstWordAtRef.current || Date.now();
              firstWordAtRef.current = 0;
              onTurnRef.current?.({ ...msg, startedAt });
            } else {
              setPartial(heard);
              if (heard && !wordsThisTurnRef.current) firstWordAtRef.current = Date.now();
              if (heard) {
                wordsThisTurnRef.current = true;
                lastVoiceRef.current = Date.now();
              }
            }
            break;
          }

          case "Termination":
            clearTimeout(terminateRef.current);
            ws.close();
            break;

          case "Error":
            // 3006 + inactivity is the server backstop doing its job —
            // expected housekeeping, not something to alarm the user with.
            if (msg.error_code === 3006 && /inactivity/i.test(msg.error || "")) {
              onIdleRef.current?.();
              break;
            }
            // Whatever this is, reopening would hit it again — a retry
            // loop here just bills sessions to fail the same way.
            fatalRef.current = true;
            setStatus("error");
            onErrorRef.current?.(`${msg.error_code}: ${msg.error}`, { fatal: true });
            break;

          default:
            break;
        }
      };

      ws.onerror = () => {
        if (!cancelled) {
          // Not fatal on its own: onclose follows and decides whether
          // this is worth another attempt.
          setStatus("error");
          onErrorRef.current?.("Connection failed.", { fatal: false });
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        teardownAudio();

        // `cancelled` means WE closed it — muting, unmounting, or the
        // Termination that answers our own Terminate. Nothing to do.
        if (cancelled) return;

        // A connection that lasted a while earned its budget back; one
        // that died immediately did not (see STABLE_MS).
        if (openedAtRef.current && Date.now() - openedAtRef.current >= STABLE_MS) {
          retriesRef.current = 0;
        }
        openedAtRef.current = 0;

        // Already reported (the Error branch set this and said why).
        if (fatalRef.current) {
          setStatus("error");
          return;
        }
        if (retriesRef.current >= MAX_RETRIES) {
          setStatus("error");
          onErrorRef.current?.("Lost the connection to the transcriber.", { fatal: true });
          return;
        }

        const wait = Math.min(RETRY_BASE_MS * 2 ** retriesRef.current, RETRY_CAP_MS);
        retriesRef.current += 1;
        setStatus("reconnecting");
        retryTimerRef.current = setTimeout(() => setRetryTick((t) => t + 1), wait);
      };
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        setStatus("closing");
        ws.send(JSON.stringify({ type: "Terminate" }));
        // Do NOT close immediately. Closing the socket the instant
        // Terminate goes out silently discards the last transcript and
        // any SpeakerRevision. Wait for Termination, with a timeout so a
        // dropped connection can't hang this forever.
        terminateRef.current = setTimeout(() => ws.close(), TERMINATE_GRACE_MS);
      } else {
        ws?.close();
        teardownAudio();
      }
    };
  }, [enabled, teardownAudio, retryTick]);

  return { status, partial, level, hearing, updateConfig };
}

/**
 * Connection params. Everything goes on the URL query string — that is
 * what AssemblyAI means by "connection parameters"; there is no separate
 * config message at open time.
 */
function buildParams(token, sampleRate, cfg) {
  const p = new URLSearchParams();
  p.set("token", token);
  p.set("encoding", "pcm_s16le");
  p.set("sample_rate", String(sampleRate));
  p.set("speech_model", cfg.speechModel || "universal-3-5-pro");
  p.set("format_turns", String(cfg.formatTurns ?? true));
  if (cfg.mode) p.set("mode", cfg.mode);

  // How the turn updates while someone is still talking. Both are
  // universal-3-5-pro only, and both matter here because speaker_labels
  // quietly changes their defaults: with diarization on, the server
  // disables continuous partials, so a turn emits ONE early partial and
  // then nothing at all until it ends. On a five-second sentence that
  // reads as the app having stopped listening.
  //
  // interruption_delay is the wait before that first partial, and the
  // server adds 300ms of its own on top (0 -> ~300ms, the balanced
  // preset's 500 -> ~800ms).
  if (cfg.continuousPartials != null) {
    p.set("continuous_partials", String(cfg.continuousPartials));
  }
  if (cfg.interruptionDelay != null) {
    p.set("interruption_delay", String(cfg.interruptionDelay));
  }

  if (cfg.voiceFocus) {
    // universal-3-5-pro only, and it no-ops SILENTLY on anything else
    // because unrecognized params are ignored rather than rejected.
    if ((cfg.speechModel || "universal-3-5-pro") !== "universal-3-5-pro") {
      throw new Error("voiceFocus requires universal-3-5-pro; it would be silently ignored.");
    }
    p.set("voice_focus", cfg.voiceFocus);
    if (cfg.voiceFocusThreshold != null) {
      p.set("voice_focus_threshold", String(cfg.voiceFocusThreshold));
    }
  }

  // How much evidence the VAD needs before calling a frame speech. The
  // default is low (the docs give 0.2 in one table and 0.3 in another,
  // which is itself a reason to set it rather than inherit it), and a low
  // threshold in a loud room is what lets noise open turns that then
  // never close. Raise it and the room stops talking.
  if (cfg.vadThreshold != null) p.set("vad_threshold", String(cfg.vadThreshold));

  if (cfg.speakerLabels) {
    p.set("speaker_labels", "true");
    if (cfg.maxSpeakers) p.set("max_speakers", String(cfg.maxSpeakers));
  }

  // Up to 100 terms, 50 chars each; longer ones are dropped by the API.
  const keyterms = (cfg.keyterms || []).filter((t) => t && t.length <= 50).slice(0, 100);
  if (keyterms.length) p.set("keyterms_prompt", JSON.stringify(keyterms));
  if (cfg.prompt) p.set("prompt", cfg.prompt);

  // universal-3-5-pro is multilingual by default and code-switches
  // mid-sentence with no configuration. Naming the languages we expect
  // doesn't turn that off — it biases the model toward them, which is
  // free accuracy when you already know the pair.
  if (cfg.languageCodes?.length) {
    p.set("language_codes", JSON.stringify(cfg.languageCodes));
  }

  // Backstop only. This fires when the client stops sending entirely —
  // a crashed tab, a wedged worklet — not when someone is simply silent,
  // because silent PCM still counts as traffic. Idle-while-speaking-
  // nothing is handled client-side; see IDLE_MS above.
  p.set("inactivity_timeout", String(cfg.inactivityTimeout ?? IDLE_SERVER_BACKSTOP_S));

  for (const [key, value] of Object.entries(cfg.turnDetection || {})) {
    if (value !== undefined && value !== null && value !== "") p.set(key, String(value));
  }

  return p;
}
