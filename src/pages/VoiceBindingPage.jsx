import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import {
  areCooksBound,
  voicePhraseFor,
  duplicateCookNames,
  chefAvatar,
  stepChefAvatar,
  defaultChefAvatar,
  CHEF_AVATARS,
  MAX_COOK_NAME_LENGTH,
} from "../utils/cooks.js";
import Icon from "../components/Icon.jsx";
import { GoosePrint } from "../components/GooseMarks.jsx";
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

// The chef picker is a drawer that unfolds inside the cook's own card
// rather than a dialog over the page — claiming a bird is part of
// filling the card in, not a detour away from it. These are the two
// halves of that fold; CLOSE_MS matches the fold-out keyframe so the
// card is not swapped back before it has finished closing.
const DRAWER_CLOSE_MS = 200;
const PICK_SETTLE_MS = 240; // let the chosen tile's pop land before folding away

// The dice deal out birds on a decelerating rhythm: six swaps, each a
// little slower, so it reads as a wheel slowing rather than a flicker.
const ROLL_DELAYS = [80, 95, 115, 140, 175, 220];
const LAND_MS = 320;

// Art is a background image over the bird's tint, so a missing file
// still leaves a coloured circle rather than a broken-image glyph.
const avatarStyle = (avatar) => ({ backgroundColor: avatar.bg, backgroundImage: `url(${avatar.src})` });

// Per-cook presentation state for the avatar: which bird it is turning
// away from, which way, and whether the dice are mid-roll. Kept out of
// session state — it is animation, not a fact about the cook.
const NO_FX = { prev: null, anim: null, nonce: 0, rolling: false, landId: null };

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
  // { cookId, phase } while a chef drawer is unfolded in a card. Only
  // one is ever open — two open drawers would let both cooks reach for
  // the same bird at once.
  const [drawer, setDrawer] = useState(null);
  const drawerRef = useRef(null);
  drawerRef.current = drawer;
  const [fx, setFx] = useState({});
  const intervalRef = useRef(null);
  const recordStartRef = useRef(0);
  // Every setTimeout this page starts, so none of them fire into an
  // unmounted card (the roll alone queues six).
  const timersRef = useRef([]);
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

  const later = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  };

  // Seed default slots once, from the session's cook count — the
  // two-cook default (data/dishes.js) unless an older session answered
  // the "how many cooks" question the conversation no longer asks.
  // Each slot comes with its own bird, so the line-up reads as two chefs
  // before anyone has touched it.
  useEffect(() => {
    if (cooks.length > 0) return;
    const count = Math.min(MAX_COOKS, Math.max(1, Number(state.session.conversation.answers.cooks) || 2));
    const seeded = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      name: "",
      bound: false,
      avatar: defaultChefAvatar(i),
    }));
    dispatch({ type: "session/update", payload: { cooks: seeded } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooks.length]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearInterval(intervalRef.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const hint = locked
      ? { line: "Your cook is still running — say “take me back” any time." }
      : {
          line: "Say “call the first cook Mia”, “pick a chef”, or “start reading”.",
          sub: "Also “surprise me”, “add a second cook”, “continue to scheduling”.",
        };
    dispatch({ type: "voice/setHint", payload: { hint } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [locked, dispatch]);

  const setCooks = (nextCooks) => dispatch({ type: "session/update", payload: { cooks: nextCooks } });

  // The roll writes a bird six times over 700ms, so it has to patch the
  // list as it stands at each tick — not the one captured when the dice
  // were pressed, which would undo a name typed while they were rolling.
  const cooksRef = useRef(cooks);
  cooksRef.current = cooks;

  const updateCook = (id, patch) => {
    setCooks(cooksRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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
    const taken = new Set(cooks.map((c) => c.avatar).filter(Boolean));
    const free = CHEF_AVATARS.find((a) => !taken.has(a.id));
    setCooks([...cooks, { id: crypto.randomUUID(), name: "", bound: false, avatar: free ? free.id : null }]);
  };

  const removeCook = (id) => {
    if (locked || cooks.length <= 1) return;
    clearVoice(id).catch(() => {}); // their voiceprint goes with them
    setCooks(cooks.filter((c) => c.id !== id));
    if (recordingCookId === id) stopRecording();
    if (drawer?.cookId === id) setDrawer(null);
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
    // Reading and choosing are mutually exclusive: the card only has
    // room for one of them, and the line has to be on screen to be read.
    if (drawer) setDrawer(null);
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

  /* ---------------- the bird carousel ---------------- */

  const fxOf = (id) => fx[id] || NO_FX;
  const patchFx = (id, patch) =>
    setFx((prev) => {
      const cur = prev[id] || NO_FX;
      return { ...prev, [id]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } };
    });

  // Birds the *other* cooks hold. Two cooks in the same bird would give
  // the schedule two identical lanes.
  const takenBy = (cookId) => new Set(cooks.filter((c) => c.id !== cookId && c.avatar).map((c) => c.avatar));

  const canChangeBird = (cook) => !locked && recordingCookId !== cook.id && !fxOf(cook.id).rolling;

  const stepBird = (cook, dir) => {
    if (!canChangeBird(cook)) return;
    const next = stepChefAvatar(cook.avatar, dir, takenBy(cook.id));
    if (next === cook.avatar) return;
    patchFx(cook.id, (f) => ({ prev: cook.avatar, anim: dir > 0 ? "next" : "prev", nonce: f.nonce + 1, landId: null }));
    updateCook(cook.id, { avatar: next });
  };

  const rollBird = (cook) => {
    if (!canChangeBird(cook)) return;
    const free = CHEF_AVATARS.filter((a) => !takenBy(cook.id).has(a.id));
    if (free.length < 2) return;
    patchFx(cook.id, { rolling: true, anim: "shuffle", landId: null, prev: null });
    let at = 0;
    let last = cook.avatar;
    ROLL_DELAYS.forEach((delay, n) => {
      at += delay;
      later(() => {
        // Never land on the bird already showing — every tick has to
        // visibly change something or the roll looks stuck.
        const pool = free.filter((a) => a.id !== last);
        const pick = (pool.length ? pool : free)[Math.floor(Math.random() * (pool.length || free.length))].id;
        last = pick;
        const final = n === ROLL_DELAYS.length - 1;
        patchFx(cook.id, (f) => ({
          prev: null,
          anim: final ? "land" : "shuffle",
          nonce: f.nonce + 1,
          rolling: !final,
          landId: final ? pick : null,
        }));
        updateCook(cook.id, { avatar: pick });
        if (final) later(() => patchFx(cook.id, { landId: null }), LAND_MS);
      }, at);
    });
  };

  const pickBird = (cook, id) => {
    if (locked || recordingCookId === cook.id) return;
    patchFx(cook.id, (f) => ({ prev: null, anim: "land", nonce: f.nonce + 1, landId: id, rolling: false }));
    updateCook(cook.id, { avatar: id });
    later(() => closeDrawer(), PICK_SETTLE_MS);
  };

  const openDrawer = (cook) => {
    if (locked || recordingCookId === cook.id) return;
    patchFx(cook.id, { landId: null });
    setDrawer({ cookId: cook.id, phase: "open" });
  };

  // Folding is animated, so the card content swaps back only once the
  // drawer has finished folding away.
  const closeDrawer = () => {
    const open = drawerRef.current;
    if (!open || open.phase !== "open") return;
    const { cookId } = open;
    setDrawer({ cookId, phase: "closing" });
    later(() => {
      setDrawer((cur) => (cur?.cookId === cookId ? null : cur));
      patchFx(cookId, (f) => ({ anim: "pop", nonce: f.nonce + 1, landId: null, prev: null }));
    }, DRAWER_CLOSE_MS);
  };

  /* ---------------- page-level derived state ---------------- */

  const boundCount = cooks.filter((c) => c.name.trim() && c.bound).length;
  const duplicates = duplicateCookNames(cooks);
  const isDuplicate = (cook) => duplicates.has(cook.name.trim().toLowerCase());
  // Route guards only check names and voices (areCooksBound); the chef
  // is this page's own requirement, so older sessions whose cooks
  // predate avatars aren't bounced out of later stages.
  const allPicked = cooks.every((c) => c.avatar);
  const ready = areCooksBound(cooks) && allPicked;
  const canAdd = cooks.length < MAX_COOKS && !locked;

  // The stamp re-slams each time the tally moves, and only then — it is
  // a reaction to being bound, not decoration that replays on every
  // keystroke.
  const [stampNonce, setStampNonce] = useState(0);
  const lastBoundRef = useRef(boundCount);
  useEffect(() => {
    if (lastBoundRef.current === boundCount) return;
    lastBoundRef.current = boundCount;
    setStampNonce((n) => n + 1);
  }, [boundCount]);

  const nameOf = (cook, i) => cook.name.trim() || `Cook ${i + 1}`;
  const recordingIndex = cooks.findIndex((c) => c.id === recordingCookId);
  const pending = cooks.filter((c) => !(c.name.trim() && c.bound));

  // The footer narrates the room rather than restating the tally the
  // stamp already carries: who is reading, or who is still holding
  // everyone up.
  let footerLine;
  if (locked) footerLine = "The line-up is locked until this cook finishes.";
  else if (duplicates.size > 0) footerLine = "Two cooks, one name. I’d never know who’s talking.";
  else if (recordingIndex >= 0) footerLine = `${nameOf(cooks[recordingIndex], recordingIndex)}’s reading. Everyone else, hush.`;
  else if (!allPicked) footerLine = "Every cook needs a chef before anyone reads.";
  else if (pending.length === 0) footerLine = "Both voices on file. Onward.";
  else if (pending.length === cooks.length) footerLine = "Nobody’s read yet. I’m waiting.";
  else footerLine = `${nameOf(pending[0], cooks.indexOf(pending[0]))} still owes me a line.`;

  // Voice. Everything a button here does, a command does — the commands
  // read the latest state through a ref so the layer is registered once
  // rather than torn down on every keystroke of a rename.
  const voiceRef = useRef();
  voiceRef.current = {
    cooks, ready, canAdd, locked, navigate, drawer,
    renameCook, addCook, removeCook, openDrawer, closeDrawer, pickBird, rollBird,
    startRecording, completeRecording, stopRecording,
  };

  // Layer 0: the page itself. Under the recording and drawer layers,
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
          v().openDrawer(cook);
        },
      },
      {
        // The dice, without opening the drawer first — the card's own
        // avatar shuffles in place.
        phrases: [/\b(?:surprise me|surprise)\b/, /\broll (?:the )?dice\b/, /\brandom(?: chef| bird)?\b/],
        run: ({ 1: who }) => {
          const cook = who ? ref(who) : v().cooks.find((c) => !c.avatar) ?? v().cooks[0];
          if (!cook) return which;
          v().rollBird(cook);
          return null;
        },
      },
      {
        phrases: [/\bstart (?:reading|recording)(?: (?:for|of))?(?: (.+))?$/, /\brecord again(?: (?:for|of))?(?: (.+))?$/],
        run: ({ 1: who }) => {
          const isReady = (c) => c.name.trim() && c.avatar;
          const cook = who ? ref(who) : v().cooks.find((c) => isReady(c) && !c.bound) ?? v().cooks.find(isReady);
          if (!cook) return who ? which : "Give a cook a name and a chef first.";
          if (!isReady(cook)) return `${label(cook)} needs a name and a chef first.`;
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

  // Layer 10 while a chef drawer is unfolded. A bird is named by its own
  // name or by its colour ("Whisk", "the orange one"); nothing else on
  // the page is listening until the drawer folds away.
  const openDrawerCookId = drawer?.phase === "open" ? drawer.cookId : null;
  useEffect(() => {
    if (!openDrawerCookId) return undefined;
    const v = () => voiceRef.current;
    const cookNow = () => v().cooks.find((c) => c.id === openDrawerCookId);
    const words = CHEF_AVATARS.flatMap((a) => [a.name, a.hue]).filter(Boolean).map((w) => w.toLowerCase());
    const byWord = (word) => CHEF_AVATARS.find((a) => a.name.toLowerCase() === word || a.hue?.toLowerCase() === word);
    return registerVoiceCommands(
      [
        {
          phrases: [/\bthat'?s me\b/, /\bconfirm\b/, /\bthis one\b/, /\blooks good\b/, /\bsave\b/, /\bdone\b/, /\bclose\b/],
          run: () => {
            v().closeDrawer();
            return null;
          },
        },
        {
          phrases: [/\brandom\b/, /\bsurprise(?: me)?\b/, /\broll (?:the )?dice\b/],
          run: () => {
            const cook = cookNow();
            if (!cook) return null;
            v().rollBird(cook);
            return "Rolling — say “that’s me” to keep it.";
          },
        },
        {
          phrases: [/\bcancel\b/, /\bnever ?mind\b/, /\bgo back\b/],
          run: () => {
            v().closeDrawer();
            return null;
          },
        },
        {
          phrases: [new RegExp(`\\b(${words.join("|")})\\b`)],
          run: ({ 1: word }) => {
            const cook = cookNow();
            if (!cook) return null;
            const bird = byWord(word);
            const taken = v().cooks.some((c) => c.id !== cook.id && c.avatar === bird.id);
            if (taken) return `${bird.name} is taken — pick another.`;
            v().pickBird(cook, bird.id);
            return `Chef ${bird.name}.`;
          },
        },
      ],
      { priority: 10, exclusive: true },
    );
  }, [openDrawerCookId]);

  useEffect(() => {
    if (!openDrawerCookId) return undefined;
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say a bird’s name or colour — “Whisk”, “the orange one” — or “surprise me”.",
          sub: "Then “that’s me”, or “cancel”.",
        },
      },
    });
    // The page's own hint effect puts its line back when this unwinds.
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [openDrawerCookId, dispatch]);

  let note = "Every cook needs a chef, a name and a voice to carry on.";
  let noteClass = "is-accent";
  if (locked) [note, noteClass] = ["The line-up is locked until this cook finishes.", ""];
  else if (duplicates.size > 0) [note, noteClass] = ["Give each cook a different name to carry on.", "is-crit"];
  else if (service && !service.up) [note, noteClass] = ["Speaker service is off. Run npm run speaker so I can learn voices.", "is-accent"];
  else [note, noteClass] = [footerLine, ready ? "is-done" : ""];

  return (
    <section className="page voice-binding-page">
      <header className="vb-title-row">
        <span className="vb-eyebrow mono">Tonight&rsquo;s run</span>
        <div className="vb-title-line">
          <span className="vb-title-mark">
            <h1>Who&rsquo;s in the kitchen?</h1>
            <svg className="vb-underline vb-underline-title" viewBox="0 0 430 10" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path d="M2 7c68-4 144 1 220-2 58-2.5 134 3 206 .5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <BoundStamp bound={boundCount} total={cooks.length} nonce={stampNonce} />
        </div>
        <p className="vb-sub">Two cooks max · different names · voices stay on this device</p>
        <span className="vb-aside">
          <GoosePrint />
          <span className="mono">A bird, a name, one line read out loud. That&rsquo;s how I know who&rsquo;s shouting &ldquo;done&rdquo;.</span>
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
            <span className="vb-title-mark vb-panel-title">
              The line-up
              <svg className="vb-underline vb-underline-section" viewBox="0 0 120 8" preserveAspectRatio="none" fill="none" aria-hidden="true">
                <path d="M2 5c22-2.4 44 1.4 66-.8 16-1.6 36 1.8 50 .4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
              </svg>
            </span>
            <span className="vb-panel-note">Your bird&rsquo;s colour is your lane on the schedule.</span>
          </div>

          <div className="cooks-grid">
            {cooks.map((cook, index) => {
              const isRecording = recordingCookId === cook.id;
              const name = cook.name.trim();
              const isBound = Boolean(name) && cook.bound;
              const avatar = chefAvatar(cook.avatar);
              const canStart = Boolean(name) && Boolean(cook.avatar);
              const phrase = voicePhraseFor(index, name);
              const cookFx = fxOf(cook.id);
              const isDrawerOpen = drawer?.cookId === cook.id;
              const lockBird = !canChangeBird(cook);

              let status = `${name}. Whole line, normal voice.`;
              let statusClass = "is-accent";
              if (isRecording) [status, statusClass] = [`Listening. ${Math.min(99, Math.round(recordingProgress))}%.`, "is-accent"];
              else if (!cook.avatar) [status, statusClass] = ["Tap the bird to pick your chef", "is-accent"];
              else if (!name) [status, statusClass] = ["No name, no line.", ""];
              else if (isBound && service?.up && !service.enrolled[cook.id]) [status, statusClass] = ["Line recorded, but I haven't learned your voice. Record again", "is-accent"];
              else if (isBound) [status, statusClass] = [`Got it. That’s ${name}.`, "is-done"];
              if (enrollNote?.cookId === cook.id && !isRecording) [status, statusClass] = [enrollNote.text, enrollNote.tone];

              return (
                <div className={`cook-slot${isRecording ? " is-recording" : ""}`} key={cook.id}>
                  {isDrawerOpen ? (
                    <div className={`cook-drawer${drawer.phase === "closing" ? " is-closing" : ""}`}>
                      <div className="cook-drawer-head">
                        <span className="cook-drawer-art" style={avatarStyle(avatar)} aria-hidden="true" />
                        <div className="cook-drawer-who">
                          <span className="cook-drawer-name">Chef {avatar.name}</span>
                          <span className="vb-lane mono" style={{ color: avatar.ink }}>
                            {avatar.hue ? `${avatar.hue} lane` : "No lane yet"}
                          </span>
                        </div>
                        <button type="button" className="btn cook-dice-btn" onClick={() => rollBird(cook)} disabled={lockBird}>
                          <DiceGlyph spinning={cookFx.rolling} />
                          Surprise me
                        </button>
                        <button type="button" className="cook-drawer-done" onClick={closeDrawer} aria-label="Done">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 12.5l4 4 8-9" />
                          </svg>
                        </button>
                      </div>

                      <div className="chef-grid">
                        {CHEF_AVATARS.map((a, k) => {
                          const other = cooks.find((c) => c.id !== cook.id && c.avatar === a.id);
                          const isSelected = cook.avatar === a.id;
                          return (
                            <button
                              type="button"
                              key={a.id}
                              className={`chef-tile${isSelected ? " is-selected" : ""}${cookFx.landId === a.id ? " is-landing" : ""}`}
                              style={{ animationDelay: `${40 + k * 25}ms` }}
                              aria-pressed={isSelected}
                              aria-label={`Chef ${a.name}${other ? " (taken)" : ""}`}
                              disabled={Boolean(other)}
                              onClick={() => pickBird(cook, a.id)}
                            >
                              {other && (
                                <span className="chef-tile-taken mono">
                                  {(other.name.trim() || `Cook ${cooks.indexOf(other) + 1}`)}&rsquo;s
                                </span>
                              )}
                              <span className="chef-tile-art" style={{ backgroundColor: a.bg, backgroundImage: `url(${a.src})` }} />
                              <span className="chef-tile-name">{a.name}</span>
                            </button>
                          );
                        })}
                      </div>

                      <span className="vb-aside cook-drawer-aside">
                        <GoosePrint />
                        <span className="mono">Tap one, or let the dice pick :)</span>
                      </span>
                    </div>
                  ) : (
                    <div className="cook-face">
                      {cooks.length > 1 && (
                        <button type="button" className="cook-slot-remove" onClick={() => removeCook(cook.id)} aria-label="Remove cook">
                          &times;
                        </button>
                      )}

                      <div className="cook-chooser">
                        <div className="cook-carousel">
                          <button
                            type="button"
                            className="cook-step"
                            onClick={() => stepBird(cook, -1)}
                            disabled={lockBird}
                            aria-label="Previous bird"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M15 6l-6 6 6 6" />
                            </svg>
                          </button>

                          <div className="cook-avatar-wrap">
                            <CookAvatar cook={cook} fx={cookFx} onClick={() => openDrawer(cook)} />
                            {isRecording && <span className="cook-on-air mono">ON AIR</span>}
                            {isBound && (
                              <span className="cook-avatar-badge">
                                <Icon glyph="checkmark-burst" size={14} />
                              </span>
                            )}
                            <span className="cook-avatar-caret" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </span>
                          </div>

                          <button
                            type="button"
                            className="cook-step"
                            onClick={() => stepBird(cook, 1)}
                            disabled={lockBird}
                            aria-label="Next bird"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        </div>

                        <div className="cook-lane-row">
                          <button type="button" className="cook-lane-chip mono" style={{ color: avatar.ink }} onClick={() => openDrawer(cook)}>
                            {cook.avatar ? `Chef ${avatar.name} · ${avatar.hue.toLowerCase()} lane` : "Pick your chef"}
                          </button>
                          <button type="button" className="cook-dice" onClick={() => rollBird(cook)} disabled={lockBird} aria-label="Surprise me">
                            <DiceGlyph spinning={cookFx.rolling} />
                          </button>
                        </div>
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
                          <div className="cook-phrase is-empty">Name first. Then I&rsquo;ll write you a line.</div>
                        ) : (
                          <div className={`cook-phrase ${isBound && !isRecording ? "is-quiet" : "is-active"}`}>
                            <span className="vb-eyebrow mono">{isBound && !isRecording ? "Your line" : "Read this aloud"}</span>
                            <p className="cook-phrase-text">&ldquo;{phrase}&rdquo;</p>
                          </div>
                        )}
                      </div>

                      <div className="cook-action-row">
                        {isRecording && (
                          <div className="cook-waveform" aria-hidden="true">
                            {[0, 1, 2, 3, 4].map((i) => (
                              <span className="cook-waveform-bar" key={i} style={{ animationDelay: `${i * 0.11}s` }} />
                            ))}
                          </div>
                        )}
                        <span className={`cook-status mono ${statusClass}`} aria-live="polite">
                          {status}
                        </span>
                        {isRecording ? (
                          <button type="button" className="btn btn-mic is-live" onClick={() => completeRecording(cook.id)}>
                            <span className="btn-mic-disc">
                              <span className="btn-mic-square" />
                            </span>
                            Stop and save
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`btn btn-mic${isBound ? " is-again" : ""}`}
                            disabled={!canStart}
                            onClick={() => startRecording(cook.id)}
                          >
                            <span className="btn-mic-disc">
                              <MicGlyph />
                            </span>
                            {isBound ? "Record again" : "Start reading"}
                          </button>
                        )}
                      </div>
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
        <span className={`vb-note mono ${noteClass}`}>{note}</span>
        <span className="vb-footer-go">
          <span className="vb-footer-tracks" aria-hidden="true">
            <GoosePrint depth="pale" size={16} rotate={78} style={{ position: "absolute", left: 4, bottom: 4 }} />
            <GoosePrint depth="deep" size={19} rotate={98} style={{ position: "absolute", left: 34, bottom: 16 }} />
          </span>
          <button className="btn btn-primary btn-lg" disabled={!ready && !locked} onClick={() => navigate("/session/schedule")}>
            Continue to scheduling
          </button>
        </span>
      </div>
    </section>
  );
}

// The bird itself. Stepping keeps both faces on screen for a moment —
// the outgoing one sliding away, the incoming one swinging in from the
// other side — so the carousel turns rather than cuts. Every face is
// keyed by the step's nonce, which is what restarts the keyframes.
function CookAvatar({ cook, fx, onClick }) {
  const avatar = chefAvatar(cook.avatar);
  const outgoing = fx.prev && (fx.anim === "next" || fx.anim === "prev") ? chefAvatar(fx.prev) : null;
  const wrapClass =
    fx.rolling ? "is-rolling" : fx.anim === "land" ? "is-landing" : fx.anim === "pop" ? "is-popping" : "";
  return (
    <button
      type="button"
      className="vb-avatar vb-avatar-lg"
      onClick={onClick}
      aria-label={cook.avatar ? `Chef ${avatar.name} — change chef` : "Pick your chef"}
    >
      <span key={`w${wrapClass ? fx.nonce : "s"}`} className={`cook-avatar-spin ${wrapClass}`}>
        <span className="cook-avatar-window">
          {outgoing && (
            <span
              key={`o${fx.nonce}`}
              className={`cook-avatar-face ${fx.anim === "next" ? "is-out-left" : "is-out-right"}`}
              style={avatarStyle(outgoing)}
            />
          )}
          <span
            key={`i${fx.nonce}`}
            className={`cook-avatar-face ${fx.anim === "next" ? "is-in-right" : fx.anim === "prev" ? "is-in-left" : ""}`}
            style={avatarStyle(avatar)}
          />
        </span>
      </span>
    </button>
  );
}

// The tally, stamped on at a slant. It slams once per change, and the
// digit rolls up into place behind the frame — the number is the part
// that moved, so it is the part that animates.
function BoundStamp({ bound, total, nonce }) {
  return (
    <span key={`st${nonce}`} className={`vb-stamp mono${bound === total ? " is-done" : ""}${nonce > 0 ? " anim" : ""}`}>
      <span className="vb-stamp-window">
        <span key={`n${bound}`} className="vb-stamp-digit">
          {bound}
        </span>
      </span>
      <span>OF {total} BOUND</span>
    </span>
  );
}

function DiceGlyph({ spinning }) {
  return (
    <svg
      className={`cook-dice-glyph${spinning ? " is-spinning" : ""}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2.4" width="6" height="10.4" rx="3" />
      <path d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0" />
      <path d="M12 18v3.4M8.6 21.4h6.8" />
    </svg>
  );
}
