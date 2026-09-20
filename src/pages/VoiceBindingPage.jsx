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
import { audioTap } from "../voice/audioTap.js";
import { speechActivity } from "../utils/speechActivity.js";
import { enrollVoice, clearVoice, speakerHealth } from "../api/speaker.js";
import { ORDINAL, ordinalIndex, resolveCookRef, cleanSpokenName } from "../utils/cookVoice.js";

// Binding is real: the line is read into the app's one microphone and the
// audio goes to the local speaker service, which keeps a voiceprint for
// that cook (never the audio, never off this machine). The live cook then
// uses it to tell who is speaking.
//
// It stops when the cook has actually finished the line: enough speech,
// then a real pause (see utils/speechActivity.js). Not after a fixed time,
// which is counted from the click and cut off anyone who started late or
// read slowly. Only the speech itself, with a little room either side, is
// kept for the voiceprint.
const MIN_SPEECH_MS = 2000; // pressing Stop with less than this leaves too little to go on
const SPEECH_MARGIN_MS = 300;
const MAX_RECORDING_MS = 25_000; // stop waiting for a pause after this
const MIC_WAIT_MS = 15_000; // give up if the mic never comes on

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
  const intervalRef = useRef(null);
  const recordStartRef = useRef(0);
  // True when starting to read is what switched the mic on, so it is
  // switched off again afterwards rather than left listening.
  const micWasMutedRef = useRef(false);
  // What the last recording came to, shown in place of the status line.
  const [enrollNote, setEnrollNote] = useState(null); // { cookId, text, tone }
  // Is the local speaker service up, and whose voice does it hold? null
  // until the first answer. A cook can be "bound" (their line was read)
  // without a voiceprint, e.g. bound before the service existed.
  const [service, setService] = useState(null); // { up, enrolled: {cookId: samples} }
  const refreshService = () =>
    speakerHealth()
      .then((h) => setService({ up: true, enrolled: h.enrolled || {} }))
      .catch(() => setService({ up: false, enrolled: {} }));
  useEffect(() => {
    refreshService();
  }, []);

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
      clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    const hint = locked
      ? { line: "Your cook is still running — say “take me back” any time." }
      : {
          line: "Say “call the first cook Mia”, “pick a chef”, or “start reading”.",
          sub: "Also “add a second cook”, “remove the second cook”, “continue to scheduling”.",
        };
    dispatch({ type: "voice/setHint", payload: { hint } });
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
    clearVoice(id).catch(() => {}); // their voiceprint goes with them
    setCooks(cooks.filter((c) => c.id !== id));
    if (recordingCookId === id) stopRecording();
  };

  const stopRecording = () => {
    clearInterval(intervalRef.current);
    setRecordingCookId(null);
    setRecordingProgress(0);
    if (micWasMutedRef.current) {
      micWasMutedRef.current = false;
      dispatch({ type: "voice/setMuted", payload: { muted: true } });
    }
  };

  // Bind from the newest cooks, not the closure's: this runs after an
  // await, by which time the list may have changed under it.
  const bindCook = (id) =>
    setCooks(voiceRef.current.cooks.map((c) => (c.id === id ? { ...c, bound: true } : c)));

  // What has been said since recording began, and where it sits in time.
  const heardSoFar = () => {
    const { levels, startWall } = audioTap.levelsSince(recordStartRef.current);
    return { ...speechActivity(levels), startWall };
  };

  const completeRecording = async (id) => {
    const activity = heardSoFar();
    stopRecording();
    if (activity.voicedMs < MIN_SPEECH_MS) {
      setEnrollNote({
        cookId: id,
        text: activity.voicedMs
          ? `I only heard ${(activity.voicedMs / 1000).toFixed(1)}s of you. Read the whole line.`
          : "I didn't hear anything. Check the mic.",
        tone: "is-accent",
      });
      return;
    }
    // Just the speech, not the silence around it.
    const clip = audioTap.sliceWall(
      activity.startWall + activity.firstVoiced * 50 - SPEECH_MARGIN_MS,
      activity.startWall + (activity.lastVoiced + 1) * 50 + SPEECH_MARGIN_MS,
    );
    if (!clip) {
      setEnrollNote({ cookId: id, text: "I lost the recording. Try again.", tone: "is-accent" });
      return;
    }
    try {
      // Re-recording replaces the old voiceprint rather than adding to it.
      await clearVoice(id).catch(() => {});
      await enrollVoice({ cookId: id, pcm: clip.pcm, rate: clip.rate });
      setEnrollNote({ cookId: id, text: "Got your voice", tone: "is-done" });
      refreshService();
    } catch (err) {
      // The speaker service isn't running. Binding still completes: the
      // live cook falls back to its speaker toggle, so nobody is stuck.
      console.info("[speaker] not enrolled:", err.message);
      setEnrollNote({
        cookId: id,
        text: "Got your line, but the speaker service is off, so I can't learn your voice yet",
        tone: "is-accent",
      });
      refreshService();
    }
    bindCook(id);
  };

  const startRecording = (id) => {
    clearInterval(intervalRef.current);
    setEnrollNote(null);
    setRecordingCookId(id);
    setRecordingProgress(0);
    if (state.voice.muted) {
      micWasMutedRef.current = true;
      dispatch({ type: "voice/setMuted", payload: { muted: false } });
    }
    recordStartRef.current = Date.now();
    const startedAt = Date.now();
    intervalRef.current = setInterval(() => {
      const activity = heardSoFar();
      // Filled by speech, not by the clock; 99 until it is actually saved.
      setRecordingProgress(Math.min(99, (activity.voicedMs / 3000) * 100));
      const elapsed = Date.now() - startedAt;
      if (activity.done || (elapsed > MAX_RECORDING_MS && activity.voicedMs >= MIN_SPEECH_MS)) {
        completeRecording(id);
      } else if (elapsed > MIC_WAIT_MS && audioTap.secondsSince(recordStartRef.current) < 0.5) {
        stopRecording();
        setEnrollNote({ cookId: id, text: "The mic never came on. Try again.", tone: "is-accent" });
      } else if (elapsed > MAX_RECORDING_MS) {
        stopRecording();
        setEnrollNote({ cookId: id, text: "I didn't hear enough. Try again.", tone: "is-accent" });
      }
    }, 100);
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

  // Voice. Everything a button here does, a command does — the commands
  // read the latest state through a ref so the layer is registered once
  // rather than torn down on every keystroke of a rename.
  const voiceRef = useRef();
  voiceRef.current = {
    cooks, ready, canAdd, locked, navigate,
    renameCook, addCook, removeCook, openPicker, startRecording, completeRecording, stopRecording,
  };

  // Layer 0: the page itself. Under the recording and picker layers,
  // which are exclusive and sit above it.
  useEffect(() => {
    const v = () => voiceRef.current;
    const ref = (text) => resolveCookRef(text, v().cooks);
    const label = (cook) => cook.name.trim() || `cook ${v().cooks.indexOf(cook) + 1}`;

    // A ref that names nobody is said out loud, not dropped.
    const which = "Which cook? Say “first”, “second”, or their name.";

    if (locked) {
      // The hint promises this exact phrase; nothing else on a locked
      // page has anything to say.
      return registerVoiceCommands([
        {
          phrases: [/\btake me back\b/, /\bback to the cook\b/, /\bgo back to the cook\b/],
          run: () => v().navigate("/session/live-cook"),
        },
        {
          phrases: [/\bcontinue to scheduling\b/, /\bgo to scheduling\b/],
          run: () => v().navigate("/session/schedule"),
        },
      ]);
    }

    const setName = (cook, spoken) => {
      const name = cleanSpokenName(spoken);
      if (!name) return "I didn’t catch a name — try “call the first cook Mia”.";
      const taken = v().cooks.some((c) => c.id !== cook.id && c.name.trim().toLowerCase() === name.toLowerCase());
      v().renameCook(cook.id, name);
      return taken ? `${name} is already taken — pick a different name.` : `Cook ${v().cooks.indexOf(cook) + 1} is ${name}.`;
    };

    return registerVoiceCommands([
      {
        phrases: [/\bcontinue to scheduling\b/, /\bgo to scheduling\b/],
        run: () => {
          if (!v().ready) return "Not yet — every cook needs a chef, a name and a voice.";
          v().navigate("/session/schedule");
        },
      },
      {
        phrases: [new RegExp(`\\b(?:call|name) (?:the )?(?:cook )?(${ORDINAL})(?: cook)? (?:is |as )?(.+)$`)],
        run: ({ 1: slot, 2: spoken }) => {
          const cook = v().cooks[ordinalIndex(slot)];
          return cook ? setName(cook, spoken) : "There’s no second cook yet — say “add a second cook”.";
        },
      },
      {
        phrases: [new RegExp(`\\bcook (${ORDINAL}) (?:is|=) (.+)$`)],
        run: ({ 1: slot, 2: spoken }) => {
          const cook = v().cooks[ordinalIndex(slot)];
          return cook ? setName(cook, spoken) : "There’s no second cook yet — say “add a second cook”.";
        },
      },
      {
        // "I'm Mia" starts with a subject word, which the bar would
        // otherwise take for conversation.
        allowSubject: true,
        phrases: [/\b(?:i'm|i am|my name is|this is) ([a-z' -]+)$/],
        run: ({ 1: spoken }) => {
          const cook = v().cooks.find((c) => !c.name.trim());
          if (!cook) return "Both cooks have names — say “call the first cook…” to change one.";
          return setName(cook, spoken);
        },
      },
      {
        phrases: [/\b(?:pick|choose|select|change|open)(?: (?:my|the|a|your))? (?:chef|bird|avatar)(?: (?:for|of))?(?: (.+))?$/],
        run: ({ 1: who }) => {
          const cook = who ? ref(who) : v().cooks.find((c) => !c.avatar) ?? v().cooks[0];
          if (!cook) return which;
          v().openPicker(cook);
        },
      },
      {
        phrases: [/\bstart (?:reading|recording)(?: (?:for|of))?(?: (.+))?$/, /\brecord again(?: (?:for|of))?(?: (.+))?$/],
        run: ({ 1: who }) => {
          const ready = (c) => c.name.trim() && c.avatar;
          const cook = who ? ref(who) : v().cooks.find((c) => ready(c) && !c.bound) ?? v().cooks.find(ready);
          if (!cook) return who ? which : "Give a cook a name and a chef first.";
          if (!ready(cook)) return `${label(cook)} needs a name and a chef first.`;
          v().startRecording(cook.id);
          return `Listening to ${label(cook)} — read the line, then say “stop and save”.`;
        },
      },
      {
        phrases: [/\badd (?:a |another |the )?(?:second |2nd )?cook\b/],
        run: () => {
          if (!v().canAdd) return "Two cooks is the most one kitchen takes.";
          v().addCook();
          return "Added a second cook.";
        },
      },
      {
        // Losing a name and a recorded voice is not undone by saying it
        // again, so it asks first.
        phrases: [/\b(?:remove|delete) (?:the )?(?:cook )?(.+)$/],
        confirm: "Remove that cook and their voice?",
        run: ({ 1: who }) => {
          const cook = ref(who);
          if (!cook) return which;
          if (v().cooks.length <= 1) return "You need at least one cook.";
          v().removeCook(cook.id);
          return `Removed ${label(cook)}.`;
        },
      },
    ]);
  }, [locked, navigate]);

  // Layer 10 while a voice is being taken. The line each cook reads out
  // starts "I'm Mia…" — exactly what the naming command listens for — so
  // for these seconds the only things heard are the two ways out.
  useEffect(() => {
    if (!recordingCookId) return undefined;
    return registerVoiceCommands(
      [
        {
          phrases: [/\bstop(?: and save| recording| reading)?\b/, /\bsave(?: it)?\b/, /\bdone reading\b/, /\bthat'?s it\b/],
          label: "Saved.",
          run: () => voiceRef.current.completeRecording(recordingCookId),
        },
        {
          phrases: [/\bcancel\b/, /\bnever ?mind\b/, /\bdiscard\b/],
          label: "Cancelled — nothing saved.",
          run: () => voiceRef.current.stopRecording(),
        },
      ],
      { priority: 10, exclusive: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingCookId]);

  let note = "Every cook needs a chef, a name and a voice to carry on.";
  let noteClass = "is-accent";
  if (locked) [note, noteClass] = ["The line-up is locked until this cook finishes.", ""];
  else if (duplicates.size > 0) [note, noteClass] = ["Give each cook a different name to carry on.", "is-crit"];
  else if (service && !service.up) [note, noteClass] = ["Speaker service is off. Run npm run speaker so I can learn voices.", "is-accent"];
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
              else if (isBound && service?.up && !service.enrolled[cook.id]) [status, statusClass] = ["Line recorded, but I haven't learned your voice. Record again", "is-accent"];
              else if (isBound) [status, statusClass] = ["Got your voice", "is-done"];
              else if (name) [status, statusClass] = ["Ready when you are", "is-accent"];
              if (enrollNote?.cookId === cook.id && !isRecording) [status, statusClass] = [enrollNote.text, enrollNote.tone];

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
  const { dispatch } = useAppState();
  const picked = selected ? chefAvatar(selected) : null;
  // Draws from the birds nobody else holds, skipping the current pick so
  // every press visibly changes something.
  const available = CHEF_AVATARS.filter((a) => !taken.has(a.id));
  const pool = available.length > 1 ? available.filter((a) => a.id !== selected) : available;
  const pickRandom = () => {
    if (pool.length) onPick(pool[Math.floor(Math.random() * pool.length)].id);
  };

  // Exclusive, like the other dialogs: while the picker is open the only
  // way out is one of its own commands. A bird is named by its name or
  // its colour ("Whisk", "the orange one").
  const actionsRef = useRef();
  actionsRef.current = { taken, onPick, pickRandom, onCancel, onConfirm };
  useEffect(() => {
    const byWord = (word) => CHEF_AVATARS.find((a) => a.name.toLowerCase() === word || a.hue?.toLowerCase() === word);
    const words = CHEF_AVATARS.flatMap((a) => [a.name, a.hue]).filter(Boolean).map((w) => w.toLowerCase());
    return registerVoiceCommands(
      [
        {
          phrases: [/\bthat'?s me\b/, /\bconfirm\b/, /\bthis one\b/, /\blooks good\b/, /\bsave\b/, /\bdone\b/],
          run: () => {
            if (!selectedRef.current) return "Pick a bird first — say a name or a colour.";
            actionsRef.current.onConfirm();
            return null;
          },
        },
        {
          phrases: [/\brandom\b/, /\bsurprise\b/, /\broll (?:the )?dice\b/],
          run: () => {
            actionsRef.current.pickRandom();
            return "Random pick — say “that’s me” to keep it, or “random” again.";
          },
        },
        {
          phrases: [/\bcancel\b/, /\bnever ?mind\b/, /\bclose\b/, /\bgo back\b/],
          run: () => {
            actionsRef.current.onCancel();
            return null;
          },
        },
        {
          phrases: [new RegExp(`\\b(${words.join("|")})\\b`)],
          run: ({ 1: word }) => {
            const bird = byWord(word);
            if (actionsRef.current.taken.has(bird.id)) return `${bird.name} is taken — pick another.`;
            actionsRef.current.onPick(bird.id);
            return `Chef ${bird.name}. Say “that’s me” to confirm.`;
          },
        },
      ],
      { priority: 10, exclusive: true },
    );
  }, []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say a bird’s name or colour — “Whisk”, “the orange one” — or “random”.",
          sub: "Then “that’s me”, or “cancel”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);
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
