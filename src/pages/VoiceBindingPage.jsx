import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import {
  cookColorKey,
  areCooksBound,
  voicePhraseFor,
  duplicateCookNames,
  MAX_COOK_NAME_LENGTH,
} from "../utils/cooks.js";
import Icon from "../components/Icon.jsx";
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
  // Once a run exists, its steps, claims and scores are all keyed by
  // cook id. Removing a cook here would leave those pointing at someone
  // who no longer exists, and a rename clears `bound`, which would bounce
  // the cook out of the live page mid-cook. So the line-up freezes.
  const locked = Boolean(state.session.run);
  const [recordingCookId, setRecordingCookId] = useState(null);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  // Seed default slots once, from the session's cook count — the
  // two-cook default (data/dishes.js) unless an older session answered
  // the "how many cooks" question the conversation no longer asks.
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

  // The phrase each cook reads has their name in it ("I'm Mia, and..."),
  // so a rename makes the recorded sample say the wrong thing — the
  // binding has to be taken again rather than silently carried over.
  const renameCook = (id, name) => {
    setCooks(
      cooks.map((c) => {
        if (c.id !== id) return c;
        const changed = c.name.trim() !== name.trim();
        return { ...c, name, bound: changed ? false : c.bound };
      })
    );
    if (recordingCookId === id) stopRecording();
  };

  const addCook = () => {
    if (locked || cooks.length >= MAX_COOKS) return;
    setCooks([...cooks, { id: crypto.randomUUID(), name: "", bound: false }]);
  };

  const removeCook = (id) => {
    if (locked || cooks.length <= 1) return;
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
  const duplicates = duplicateCookNames(cooks);
  const isDuplicate = (cook) => duplicates.has(cook.name.trim().toLowerCase());

  return (
    <section className="page voice-binding-page">
      <header className="vb-title-row">
        <div className="vb-title">
          <h1>Who&rsquo;s in the kitchen?</h1>
          <p className="vb-sub">
            Each cook reads their own line out loud — the same words every time makes it easier to tell your voices
            apart when someone shouts &ldquo;done&rdquo; mid-cook.
          </p>
        </div>
        <span className={`vb-count mono${bound ? " is-done" : ""}`}>
          {boundCount}/{cooks.length} bound
        </span>
      </header>

      <div className="vb-panel">
        {/* The intro line lives in the title row above, so the panel
            carries only the locked note (when a cook is running) and
            the slots themselves. */}
        {locked && (
          <div className="cooks-locked-note">
            <span className="cook-phrase-label">Line-up locked</span>
            <p className="cook-status">
              A cook is in progress and every claim and score is filed under these two. Finish or start over from the
              plan to change who&rsquo;s here.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/session/live-cook")}>
              Back to the cook
            </button>
          </div>
        )}
        <div className="cooks-grid">
          {cooks.map((cook, index) => {
            const colorKey = cookColorKey(index);
            const isRecording = recordingCookId === cook.id;
            const hasName = Boolean(cook.name.trim());
            const phrase = voicePhraseFor(index, cook.name.trim());
            return (
              <div className={`cook-slot ${isRecording ? "is-recording" : ""}`} key={cook.id}>
                {cooks.length > 1 && !locked && (
                  <button type="button" className="cook-slot-remove" onClick={() => removeCook(cook.id)} aria-label="Remove cook">
                    &times;
                  </button>
                )}
                <div className={`cook-avatar cook-color-${colorKey}`}>
                  {cook.name.trim() ? cook.name.trim()[0].toUpperCase() : index + 1}
                  {cook.bound && (
                    <span className="cook-avatar-badge">
                      <Icon glyph="checkmark-burst" size={12} stroke={2.25} />
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  className={`cook-name-input ${isDuplicate(cook) ? "is-invalid" : ""}`}
                  placeholder={`Cook ${index + 1} — name`}
                  value={cook.name}
                  maxLength={MAX_COOK_NAME_LENGTH}
                  disabled={locked}
                  aria-invalid={isDuplicate(cook)}
                  onChange={(e) => renameCook(cook.id, e.target.value)}
                />
                {isDuplicate(cook) && (
                  <span className="cook-name-error">Two cooks can&rsquo;t share a name — I&rsquo;d never know who&rsquo;s talking.</span>
                )}
                {(isRecording || (hasName && !cook.bound)) && (
                  <div className={`cook-phrase ${isRecording ? "is-active" : ""}`}>
                    <span className="cook-phrase-label">Read this aloud</span>
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
                    <span className="cook-progress mono">Listening&hellip; {Math.round(recordingProgress)}%</span>
                    <button type="button" className="btn btn-primary" onClick={() => completeRecording(cook.id)}>
                      Stop and save
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="cook-status">
                      {cook.bound ? "Got your voice" : hasName ? "Ready when you are" : "Add a name to get your line"}
                    </span>
                    <button type="button" className="btn" disabled={!hasName || locked} onClick={() => startRecording(cook.id)}>
                      {cook.bound ? "Record again" : "Start reading"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {cooks.length < MAX_COOKS && !locked && (
            <button type="button" className="btn cook-add-btn" onClick={addCook}>
              + Add a cook
            </button>
          )}
        </div>
      </div>

      <div className="vb-footer">
        <span className="vb-note">
          {duplicates.size > 0 ? "Give each cook a different name to carry on." : "Voices stay on this device."}
        </span>
        <button className="btn btn-primary btn-lg" disabled={!bound} onClick={() => navigate("/session/schedule")}>
          Continue to scheduling
        </button>
      </div>
    </section>
  );
}
