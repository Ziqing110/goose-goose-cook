import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { cookColorKey, areCooksBound, voicePhraseFor } from "../utils/cooks.js";
import "./VoiceBindingPage.css";

// No real audio anywhere in this app — voice binding is simulated the
// same way VoiceInput.jsx simulates "voice" with a styled text input.
// This is purely a staged animation; the name itself is just typed.
const RECORDING_DURATION_MS = 2500;

// Hackathon scope: exactly two cooks max, not the open-ended "add a
// third cook" the reference mockup shows.
const MAX_COOKS = 2;

export default function VoiceBindingPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const { cooks } = state.session;
  const [recordingCookId, setRecordingCookId] = useState(null);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  // Seed default slots once, from the conversation's "how many cooks"
  // answer — captured earlier in the flow but otherwise never read.
  useEffect(() => {
    if (cooks.length > 0) return;
    const count = Math.min(MAX_COOKS, Math.max(1, Number(state.session.conversation.answers.cooks) || 2));
    const seeded = Array.from({ length: count }, () => ({ id: crypto.randomUUID(), name: "", bound: false }));
    dispatch({ type: "session/update", payload: { cooks: seeded } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooks.length]);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
      clearInterval(intervalRef.current);
    };
  }, []);

  const setCooks = (nextCooks) => dispatch({ type: "session/update", payload: { cooks: nextCooks } });

  const updateCook = (id, patch) => {
    setCooks(cooks.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCook = () => {
    if (cooks.length >= MAX_COOKS) return;
    setCooks([...cooks, { id: crypto.randomUUID(), name: "", bound: false }]);
  };

  const removeCook = (id) => {
    if (cooks.length <= 1) return;
    setCooks(cooks.filter((c) => c.id !== id));
    if (recordingCookId === id) stopRecording();
  };

  const stopRecording = () => {
    clearTimeout(timeoutRef.current);
    clearInterval(intervalRef.current);
    setRecordingCookId(null);
    setRecordingProgress(0);
  };

  const completeRecording = (id) => {
    stopRecording();
    updateCook(id, { bound: true });
  };

  const startRecording = (id) => {
    clearTimeout(timeoutRef.current);
    clearInterval(intervalRef.current);
    setRecordingCookId(id);
    setRecordingProgress(0);
    const startedAt = Date.now();
    intervalRef.current = setInterval(() => {
      setRecordingProgress(Math.min(100, ((Date.now() - startedAt) / RECORDING_DURATION_MS) * 100));
    }, 100);
    timeoutRef.current = setTimeout(() => completeRecording(id), RECORDING_DURATION_MS);
  };

  const bound = areCooksBound(cooks);
  const boundCount = cooks.filter((c) => c.name.trim() && c.bound).length;

  return (
    <section className="page voice-binding-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>Who&rsquo;s in the kitchen?</h1>
          </div>
        </div>
        <div className="band-header-right">
          <span className={`tag mono ${bound ? "tag-difficulty-low" : ""}`}>
            {boundCount} of {cooks.length} bound
          </span>
        </div>
      </div>

      <div className="card cooks-card">
        <p className="hint">
          Each cook reads their own line out loud — same words every time makes it easier to tell your voices apart
          when someone shouts &ldquo;done&rdquo; mid-cook.
        </p>
        <div className="cooks-grid">
          {cooks.map((cook, index) => {
            const colorKey = cookColorKey(index);
            const isRecording = recordingCookId === cook.id;
            const hasName = Boolean(cook.name.trim());
            const phrase = voicePhraseFor(index, cook.name.trim());
            return (
              <div className={`cook-slot ${isRecording ? "is-recording" : ""}`} key={cook.id}>
                {cooks.length > 1 && (
                  <button type="button" className="cook-slot-remove" onClick={() => removeCook(cook.id)} aria-label="Remove cook">
                    &times;
                  </button>
                )}
                <div className={`cook-avatar cook-color-${colorKey}`}>
                  {cook.name.trim() ? cook.name.trim()[0].toUpperCase() : index + 1}
                  {cook.bound && <span className="cook-avatar-badge">&check;</span>}
                </div>
                <input
                  type="text"
                  className="cook-name-input"
                  placeholder={`Cook ${index + 1} — name`}
                  value={cook.name}
                  onChange={(e) => updateCook(cook.id, { name: e.target.value })}
                />
                {(isRecording || (hasName && !cook.bound)) && (
                  <div className={`cook-phrase ${isRecording ? "is-active" : ""}`}>
                    <span className="mini-title">Read this aloud</span>
                    <p className="cook-phrase-text">&ldquo;{phrase}&rdquo;</p>
                  </div>
                )}

                {isRecording ? (
                  <div className="cook-recording">
                    <div className="cook-waveform">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span className="cook-waveform-bar" key={i} style={{ animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </div>
                    <span className="hint mono">Listening&hellip; {Math.round(recordingProgress)}%</span>
                    <button type="button" className="btn btn-primary" onClick={() => completeRecording(cook.id)}>
                      Stop and save
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="hint">
                      {cook.bound ? "Got your voice" : hasName ? "Ready when you are" : "Add a name to get your line"}
                    </span>
                    <button type="button" className="btn" disabled={!hasName} onClick={() => startRecording(cook.id)}>
                      {cook.bound ? "Record again" : "Start reading"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {cooks.length < MAX_COOKS && (
            <button type="button" className="btn cook-add-btn" onClick={addCook}>
              + Add a cook
            </button>
          )}
        </div>
      </div>

      <div className="band-footer">
        <div className="band-footer-left">
          <span className="hint">Voices stay on this device.</span>
        </div>
        <div className="band-footer-right">
          <button
            className="btn btn-primary btn-lg"
            disabled={!bound}
            onClick={() => navigate("/session/schedule")}
          >
            Continue to scheduling &rarr;
          </button>
        </div>
      </div>
    </section>
  );
}
