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

const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const CHUNK_MS = 50;
const TERMINATE_GRACE_MS = 3000;

/**
 * @param {object}   options
 * @param {boolean}  options.enabled      open the connection when true
 * @param {function} options.onTurn       (turn) => void, on each finalized turn
 * @param {object}   options.config       connection params (see buildParams)
 * @param {function} options.onError      (message) => void
 */
export function useStreamingTranscript({ enabled, onTurn, config = {}, onError } = {}) {
  const [status, setStatus] = useState("idle"); // idle|connecting|live|closing|error
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const streamRef = useRef(null);
  const terminateRef = useRef(null);

  // Held in refs so a re-render with new callbacks doesn't tear down the
  // socket. The connection should outlive prop identity changes.
  const onTurnRef = useRef(onTurn);
  const onErrorRef = useRef(onError);
  const configRef = useRef(config);
  onTurnRef.current = onTurn;
  onErrorRef.current = onError;
  configRef.current = config;

  const teardownAudio = useCallback(() => {
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    nodeRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setLevel(0);
    setPartial("");
  }, []);

  /** Push keyterms / turn settings without reconnecting. */
  const updateConfig = useCallback((patch) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "UpdateConfiguration", ...patch }));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    (async () => {
      setStatus("connecting");

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
          onErrorRef.current?.(`Microphone unavailable: ${err.message}`);
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
        await ctx.audioWorklet.addModule("/pcm-processor.js");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.(`Audio worklet failed to load: ${err.message}`);
        }
        return;
      }

      let token;
      try {
        const res = await fetch("/api/voice/stt-token");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Token request failed (${res.status})`);
        token = body.token;
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.(err.message);
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
          }
        };

        source.connect(node);
        // Terminating node so the worklet is actually pulled; gain 0
        // keeps the mic out of the speakers and out of its own transcript.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        node.connect(sink).connect(ctx.destination);
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
              );
            }
            break;

          case "Turn":
            if (msg.end_of_turn) {
              setPartial("");
              onTurnRef.current?.(msg);
            } else {
              setPartial(msg.transcript || "");
            }
            break;

          case "Termination":
            clearTimeout(terminateRef.current);
            ws.close();
            break;

          case "Error":
            setStatus("error");
            onErrorRef.current?.(`${msg.error_code}: ${msg.error}`);
            break;

          default:
            break;
        }
      };

      ws.onerror = () => {
        if (!cancelled) {
          setStatus("error");
          onErrorRef.current?.("Connection failed.");
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        teardownAudio();
        setStatus((s) => (s === "error" ? "error" : "idle"));
      };
    })();

    return () => {
      cancelled = true;
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
  }, [enabled, teardownAudio]);

  return { status, partial, level, updateConfig };
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

  if (cfg.voiceFocus) {
    // universal-3-5-pro only, and it no-ops SILENTLY on anything else
    // because unrecognized params are ignored rather than rejected.
    if ((cfg.speechModel || "universal-3-5-pro") !== "universal-3-5-pro") {
      throw new Error("voiceFocus requires universal-3-5-pro; it would be silently ignored.");
    }
    p.set("voice_focus", cfg.voiceFocus);
  }

  if (cfg.speakerLabels) {
    p.set("speaker_labels", "true");
    if (cfg.maxSpeakers) p.set("max_speakers", String(cfg.maxSpeakers));
  }

  // Up to 100 terms, 50 chars each; longer ones are dropped by the API.
  const keyterms = (cfg.keyterms || []).filter((t) => t && t.length <= 50).slice(0, 100);
  if (keyterms.length) p.set("keyterms_prompt", JSON.stringify(keyterms));
  if (cfg.prompt) p.set("prompt", cfg.prompt);

  for (const [key, value] of Object.entries(cfg.turnDetection || {})) {
    if (value !== undefined && value !== null && value !== "") p.set(key, String(value));
  }

  return p;
}
