import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import {
  areCooksBound,
  voicePhraseFor,
  duplicateCookNames,
  chefAvatar,
  CHEF_AVATARS,
  MAX_COOK_NAME_LENGTH,
} from "../utils/cooks.js";
import Icon from "../components/Icon.jsx";
import Modal from "../components/Modal.jsx";
import "./VoiceBindingPage.css";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";

// No real audio anywhere in this app — voice binding is simulated the
// same way VoiceInput.jsx simulates "voice" with a styled text input.
// This is purely a staged animation; the name itself is just typed.
const RECORDING_DURATION_MS = 2500;

// Hackathon scope: exactly two cooks max, not the open-ended "add a
// third cook" the reference mockup shows.
const MAX_COOKS = 2;

// Art is a background image over the bird's tint, so a missing file
// still leaves a coloured circle rather than a broken-image glyph.
const avatarStyle = (avatar) => ({ backgroundColor: avatar.bg, backgroundImage: `url(${avatar.src})` });

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
  // { cookId, avatar } while the chef picker is open; `avatar` is the
  // draft pick, committed only on "That's me".
  const [picker, setPicker] = useState(null);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  // Seed default slots once, from the session's cook count — the
  // two-cook default (data/dishes.js) unless an older session answered
  // the "how many cooks" question the conversation no longer asks.
  useEffect(() => {
    if (cooks.length > 0) return;
    const count = Math.min(MAX_COOKS, Math.max(1, Number(state.session.conversation.answers.cooks) || 2));
    const seeded = Array.from({ length: count }, () => ({ id: crypto.randomUUID(), name: "", bound: false, avatar: null }));
    dispatch({ type: "session/update", payload: { cooks: seeded } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooks.length]);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
      clearInterval(intervalRef.current);
    };
  }, []);

  // Voice equivalent of "Continue to scheduling". Only navigation, so
  // no confirmation — and gated on the same `bound` the button is, so
  // saying it early tells you nothing happened rather than nothing
  // happening silently.
  useEffect(() => {
    return registerVoiceCommands([
      {
        phrases: [/\bcontinue to scheduling\b/, /\bgo to scheduling\b/],
        run: () => {
          if (!areCooksBound(cooks)) return;
          navigate("/session/schedule");
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooks, navigate]);

  useEffect(() => {
    if (!locked) return undefined;
    dispatch({ type: "voice/setHint", payload: { hint: { line: "Your cook is still running — say “take me back” any time." } } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [locked, dispatch]);

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
    setCooks([...cooks, { id: crypto.randomUUID(), name: "", bound: false, avatar: null }]);
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

  const openPicker = (cook) => {
    if (!locked) setPicker({ cookId: cook.id, avatar: cook.avatar ?? null });
  };
  const confirmPicker = () => {
    updateCook(picker.cookId, { avatar: picker.avatar });
    setPicker(null);
  };

  const boundCount = cooks.filter((c) => c.name.trim() && c.bound).length;
  const duplicates = duplicateCookNames(cooks);
  const isDuplicate = (cook) => duplicates.has(cook.name.trim().toLowerCase());
  // Route guards only check names and voices (areCooksBound); the chef
  // is this page's own requirement, so older sessions whose cooks
  // predate avatars aren't bounced out of later stages.
  const allPicked = cooks.every((c) => c.avatar);
  const ready = areCooksBound(cooks) && allPicked;
  const canAdd = cooks.length < MAX_COOKS && !locked;

  let note = "Every cook needs a chef, a name and a voice to carry on.";
  let noteClass = "is-accent";
  if (locked) [note, noteClass] = ["The line-up is locked until this cook finishes.", ""];
  else if (duplicates.size > 0) [note, noteClass] = ["Give each cook a different name to carry on.", "is-crit"];
  else if (allPicked) [note, noteClass] = ["Voices stay on this device.", ""];

  return (
    <section className="page voice-binding-page">
      <header className="vb-title-row">
        <div className="vb-title">
          <h1>Who&rsquo;s in the kitchen?</h1>
          <p className="vb-sub">
            Name each cook, then read their line aloud once. That&rsquo;s how I&rsquo;ll know who&rsquo;s shouting
            &ldquo;done&rdquo;.
          </p>
        </div>
        <span className={`vb-count mono${ready ? " is-done" : ""}`}>
          {boundCount}/{cooks.length} bound
        </span>
      </header>

      {locked ? (
        <div className="vb-locked">
          <div className="vb-locked-head">
            <span className="vb-locked-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
            <div className="vb-locked-copy">
              <span className="vb-eyebrow mono">Line-up locked</span>
              <p>A cook is in progress — scores are filed under these two. Finish the run to change who&rsquo;s here.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/session/live-cook")}>
              Back to the cook
            </button>
          </div>
          <div className="vb-locked-rows">
            {cooks.map((cook) => {
              const avatar = chefAvatar(cook.avatar);
              return (
                <div className="vb-locked-row" key={cook.id}>
                  <span className="vb-avatar vb-avatar-sm" style={avatarStyle(avatar)} aria-hidden="true" />
                  <div className="vb-locked-who">
                    <span className="vb-locked-name">{cook.name}</span>
                    {avatar.hue && (
                      <span className="vb-lane mono" style={{ color: avatar.ink }}>
                        {avatar.hue} on the schedule
                      </span>
                    )}
                  </div>
                  <span className="vb-bound-tag">
                    <span className="vb-check">
                      <Icon glyph="checkmark-burst" size={14} />
                    </span>
                    Voice bound
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="vb-panel">
          <div className="vb-panel-head">
            <span className="vb-panel-note">Your colour is your lane on the schedule. Two cooks max, different names.</span>
            {canAdd ? (
              <button type="button" className="btn" onClick={addCook}>
                <span className="vb-plus">+</span> Add a second cook
              </button>
            ) : (
              <span className="vb-cap mono">2 of 2 · the most one kitchen takes</span>
            )}
          </div>

          <div className="cooks-grid">
            {cooks.map((cook, index) => {
              const isRecording = recordingCookId === cook.id;
              const name = cook.name.trim();
              const isBound = Boolean(name) && cook.bound;
              const avatar = chefAvatar(cook.avatar);
              const canStart = Boolean(name) && Boolean(cook.avatar);
              const phrase = voicePhraseFor(index, name);

              let status = "Waiting on a name";
              let statusClass = "";
              if (!cook.avatar) [status, statusClass] = ["Tap the bird to pick your chef", "is-accent"];
              else if (isBound) [status, statusClass] = ["Got your voice", "is-done"];
              else if (name) [status, statusClass] = ["Ready when you are", "is-accent"];

              return (
                <div className={`cook-slot${isRecording ? " is-recording" : ""}`} key={cook.id}>
                  {cooks.length > 1 && (
                    <button type="button" className="cook-slot-remove" onClick={() => removeCook(cook.id)} aria-label="Remove cook">
                      &times;
                    </button>
                  )}
                  <div className="cook-avatar-wrap">
                    <button
                      type="button"
                      className="vb-avatar vb-avatar-lg"
                      style={avatarStyle(avatar)}
                      onClick={() => openPicker(cook)}
                      aria-label={cook.avatar ? `Chef ${avatar.name} — change avatar` : "Pick your chef"}
                    />
                    {isBound && (
                      <span className="cook-avatar-badge">
                        <Icon glyph="checkmark-burst" size={16} />
                      </span>
                    )}
                  </div>

                  <div className="cook-name-field">
                    <input
                      type="text"
                      className={`cook-name-input${isDuplicate(cook) ? " is-invalid" : ""}`}
                      placeholder={`Cook ${index + 1} — name`}
                      value={cook.name}
                      maxLength={MAX_COOK_NAME_LENGTH}
                      aria-invalid={isDuplicate(cook)}
                      onChange={(e) => renameCook(cook.id, e.target.value)}
                    />
                    {isDuplicate(cook) && (
                      <span className="cook-name-error">
                        Two cooks can&rsquo;t share a name — I&rsquo;d never know who&rsquo;s talking.
                      </span>
                    )}
                  </div>

                  <div className="cook-phrase-slot">
                    {!name ? (
                      <div className="cook-phrase is-empty">Add a name to get your line.</div>
                    ) : isBound && !isRecording ? (
                      <div className="cook-phrase is-quiet">
                        <span className="vb-eyebrow mono">Your line</span>
                        <p className="cook-phrase-text">&ldquo;{phrase}&rdquo;</p>
                      </div>
                    ) : (
                      <div className="cook-phrase is-active">
                        <span className="vb-eyebrow mono">Read this aloud</span>
                        <p className="cook-phrase-text">&ldquo;{phrase}&rdquo;</p>
                      </div>
                    )}
                  </div>

                  {isRecording ? (
                    <div className="cook-action-row">
                      <div className="cook-waveform" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span className="cook-waveform-bar" key={i} style={{ animationDelay: `${i * 0.12}s` }} />
                        ))}
                      </div>
                      <span className="cook-progress mono" aria-live="polite">
                        Listening&hellip; {Math.min(99, Math.round(recordingProgress))}%
                      </span>
                      <button type="button" className="btn btn-primary" onClick={() => completeRecording(cook.id)}>
                        Stop and save
                      </button>
                    </div>
                  ) : (
                    <div className="cook-action-row">
                      <span className={`cook-status ${statusClass}`} aria-live="polite">
                        {status}
                      </span>
                      <button type="button" className="btn" disabled={!canStart} onClick={() => startRecording(cook.id)}>
                        {isBound ? "Record again" : "Start reading"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {canAdd && (
              <button type="button" className="cook-invite" onClick={addCook}>
                <span className="cook-invite-plus" aria-hidden="true">
                  +
                </span>
                <span className="cook-invite-title">Add a second cook</span>
                <span className="cook-invite-sub">Two is the max. Cooking alone is fine.</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="vb-footer">
        <span className={`vb-note ${noteClass}`}>{note}</span>
        <button className="btn btn-primary btn-lg" disabled={!ready && !locked} onClick={() => navigate("/session/schedule")}>
          Continue to scheduling
        </button>
      </div>

      {picker && (
        <ChefPicker
          slot={cooks.findIndex((c) => c.id === picker.cookId) + 1}
          selected={picker.avatar}
          taken={new Set(cooks.filter((c) => c.id !== picker.cookId && c.avatar).map((c) => c.avatar))}
          onPick={(avatar) => setPicker((p) => ({ ...p, avatar }))}
          onCancel={() => setPicker(null)}
          onConfirm={confirmPicker}
        />
      )}
    </section>
  );
}

function ChefPicker({ slot, selected, taken, onPick, onCancel, onConfirm }) {
  const picked = selected ? chefAvatar(selected) : null;
  // Draws from the birds nobody else holds, skipping the current pick so
  // every press visibly changes something.
  const available = CHEF_AVATARS.filter((a) => !taken.has(a.id));
  const pool = available.length > 1 ? available.filter((a) => a.id !== selected) : available;
  const pickRandom = () => {
    if (pool.length) onPick(pool[Math.floor(Math.random() * pool.length)].id);
  };
  return (
    <Modal label="Pick your chef" onClose={onCancel} panelClassName="chef-picker ds-v4 ds-v4-layer">
      <div className="chef-picker-head">
        <div>
          <span className="vb-eyebrow mono">Cook {slot} · claim a bird</span>
          <h2>Which chef are you?</h2>
          <p>It&rsquo;s you on the schedule, and it&rsquo;s you every time the kitchen hears your voice.</p>
        </div>
        <button type="button" className="chef-picker-close" onClick={onCancel} aria-label="Close">
          &times;
        </button>
      </div>

      <div className="chef-grid">
        {CHEF_AVATARS.map((a) => {
          const isTaken = taken.has(a.id);
          const isSelected = selected === a.id;
          return (
            <button
              type="button"
              key={a.id}
              className={`chef-tile${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              aria-label={`Chef ${a.name}${isTaken ? " (taken)" : ""}`}
              disabled={isTaken}
              onClick={() => onPick(a.id)}
            >
              {isTaken && <span className="chef-tile-taken mono">Taken</span>}
              <span className="chef-tile-art" style={{ backgroundColor: a.bg }}>
                <span style={{ backgroundImage: `url(${a.src})` }} />
              </span>
              {isSelected && <span className="chef-tile-check">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="chef-picker-foot">
        <div className="chef-picked">
          <span className="chef-picked-art" style={avatarStyle(chefAvatar(selected))} aria-hidden="true" />
          <div>
            <span className="vb-eyebrow mono">You are</span>
            <span className="chef-picked-name">{picked ? `Chef ${picked.name}` : "Nobody yet"}</span>
          </div>
        </div>
        <button type="button" className="btn chef-random-btn" onClick={pickRandom} disabled={!pool.length}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
            <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
          </svg>
          Random
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          That&rsquo;s me
        </button>
      </div>
    </Modal>
  );
}
