// Goose's Notes: the record of the conversation, on every page.
//
// Built for the live cook, where two records existed and one was shown
// behind a closed drawer. It turned out to be the thing missing
// everywhere else too: off a run, a spoken command is matched, acted on
// and forgotten, so "say the kitchen's name" either works or appears to
// do nothing and there is nothing to look at afterwards to tell which.
//
// Mounted once in AppShell, beside VoiceBar, for the same reason: there
// is one microphone and one conversation, so there is one record of it.
// What fills it differs by page — a run supplies its own transcript and
// events, everything else uses voice/voiceLog.js — and merging them is
// utils/conversationFeed.js's job, not this component's.
//
// It is also where Toque's drawer went. The live cook used to have its
// own panel for the same record plus the speaker toggle; both now live
// here, so there is one place to look on every page. What did NOT come
// across, on purpose: the typed box and the tap-to-answer buttons. Every
// question the goose asks is answered by voice, and a cook whose voice is
// not getting through has the cards' own buttons.
//
// The look is design 4e, "Handle → pull-out sheet" (claude.ai/design,
// "Live cook - Goose panel"): tucked, a slim handle on the right edge
// that can be dragged up or down and pings when a note lands; opened, a
// sheet that slides over the page from that edge. History only -- the
// voice controls stay on the goose.
//
// Unlike the design, nothing dims or covers the rest of the page while
// the sheet is out: a scrim reads as "everything else is off", and the
// cards have to stay tappable while somebody reads back what happened.
// The grip on the sheet's edge and Escape tuck it away.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildConversationFeed, feedKey } from "../utils/conversationFeed.js";
import { useLocation } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ROUTES } from "../utils/routeGuards.js";
import { voiceLog } from "../voice/voiceLog.js";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import { AGENT_NAME } from "../voice/agentVoice.js";
import { speakerSelection, resolveSpeaker } from "../voice/speakerSelection.js";
import { playerKey } from "../utils/serviceResults.js";
import { PlayerAvatar } from "./ServiceResults.jsx";
import { clampHandleTop, DEFAULT_HANDLE_TOP, parseHandleTop } from "../utils/railPlacement.js";
import { notesPanel } from "../voice/notesPanel.js";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { NOTES_VOICE } from "../utils/pageVoiceGrammar.js";
import "./ConversationRail.css";

const TOP_KEY = "goosesNotes.handleTop";

/** Where this viewer last left the handle, or the default spot. */
function readHandleTop() {
  try {
    return parseHandleTop(localStorage.getItem(TOP_KEY)) ?? DEFAULT_HANDLE_TOP;
  } catch {
    return DEFAULT_HANDLE_TOP; // private window, or storage is off
  }
}

export default function ConversationRail() {
  const { state } = useAppState();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(readHandleTop);
  const drag = useRef(null);
  // Ticks the thinking row's clock while a turn is in flight, and
  // nothing at all the rest of the time.
  const [tick, setTick] = useState(0);

  const rows = useSyncExternalStore(voiceLog.subscribe, voiceLog.all);
  const thinkingSince = useSyncExternalStore(voiceLog.subscribe, voiceLog.thinking);

  useEffect(() => {
    if (!thinkingSince) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [thinkingSince]);

  // Re-clamped on resize so a spot from a taller window never strands
  // the handle off screen. What is stored is left alone, so growing the
  // window back puts it where it was.
  const [viewH, setViewH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const handleTop = clampHandleTop(top, viewH);

  // A run keeps its own record and it outlives the page, so it is read
  // only where it is the subject. On Home it would be last night’s cook
  // presented as what is happening now.
  const inLiveCook = pathname === ROUTES.liveCook;
  const run = inLiveCook ? state.session?.run : null;

  // Who was heard, and whether a step was tapped or spoken, only
  // matter where several people are talking and the answer decides
  // who gets credited. Everywhere else there is one person at one
  // screen: the question is only whether the goose heard, and what it
  // said, so the badges would be noise around the answer.
  const showAttribution = inLiveCook;
  const cooks = state.session?.cooks || [];
  const cookIndex = (id) => (showAttribution ? cooks.findIndex((c) => c.id === id) : -1);

  // Who the goose is crediting: everything said that no voice match
  // claims is theirs. It moves by itself when a voice is recognised, a
  // diarization label is bound, or somebody says who they are; a tap
  // hands the goose to someone. Only a run with more than one cook has
  // anyone to choose between, and a finished one has nothing left to
  // credit.
  const selected = useSyncExternalStore(speakerSelection.subscribe, speakerSelection.get);
  const speaker = resolveSpeaker(selected, cooks);
  const speakerIndex = cooks.findIndex((c) => c.id === speaker);
  const showSpeaker = inLiveCook && Boolean(run) && !run.endedAt && cooks.length > 1;

  // Step labels, for naming what an action was done to. Only a session
  // in progress has any; on Home there is no recipe at all, and
  // mergeRecipesForDisplay maps its arguments unguarded.
  const recipes = state.session?.recipes;
  const sharedSteps = state.session?.sharedSteps;
  const byId = useMemo(() => {
    if (!recipes?.length) return {};
    const approved = mergeRecipesForDisplay(recipes, sharedSteps || []).approved;
    return Object.fromEntries((approved?.nodes || []).map((n) => [n.id, n]));
  }, [recipes, sharedSteps]);

  // A run supplies its own record; everywhere else it comes from the
  // log. Merging is the feed builder's job, so this only has to hand
  // over both.
  const feed = useMemo(
    () => buildConversationFeed({
      transcript: run?.transcript,
      events: run?.events,
      byId,
      cooks,
      extraRows: rows,
      thinkingSince,
      now: Date.now(),
    }),
    // `tick` is the clock, not data: it is what re-reads Date.now().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.transcript, run?.events, byId, cooks, rows, thinkingSince, tick],
  );

  // Notes, not the thinking row: a turn in flight is not something new
  // to read, and it would ping the handle on every question.
  const notes = feed.filter((r) => r.kind !== "thinking").length;
  // How many notes this viewer has seen. Tucked, anything past it pings
  // the handle; opened, it catches up.
  //
  // Caught up whenever the record itself changes -- the live cook's run
  // arriving after the page mounts, a different run, or leaving the live
  // cook for the log. A run's history is not news, and counting it as
  // unread would ping the handle on every page load.
  const source = run ? `run:${run.startedAt}` : "log";
  const [seen, setSeen] = useState({ source, count: notes });
  const caughtUp = seen.source !== source || notes < seen.count;
  useEffect(() => {
    if (open || caughtUp) setSeen({ source, count: notes });
  }, [open, caughtUp, source, notes]);
  const unread = open || caughtUp ? 0 : Math.max(0, notes - seen.count);

  // Rows that land while the sheet is open flash in. Measured against
  // what was on screen last render, so opening the sheet does not flash
  // the whole history.
  const shownRef = useRef(feed.length);
  const flashFrom = open ? shownRef.current : feed.length;
  useEffect(() => {
    shownRef.current = feed.length;
  });

  const endRef = useRef(null);
  // Follow the newest row. A log that has to be scrolled to be current
  // is one more thing to do with your hands full.
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [feed.length, open]);

  // "Open the notes" / "close the notes", on every page. Heard ahead of
  // pages that take every word (the conversation's questions, the live
  // cook), which is what `everywhere` is for; see voiceTurn.js.
  useEffect(() => notesPanel.onRequest(setOpen), []);
  useEffect(
    () =>
      registerVoiceCommands([
        {
          phrases: NOTES_VOICE.open,
          everywhere: true,
          whileDictating: true,
          label: "Here's everything so far.",
          run: () => notesPanel.request(true),
        },
        {
          phrases: NOTES_VOICE.close,
          everywhere: true,
          whileDictating: true,
          run: () => notesPanel.request(false),
        },
      ]),
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The handle: tap to open, drag to move it up or down the edge. A
  // press that never travelled is a tap.
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { sy: event.clientY, oy: handleTop, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const dy = event.clientY - d.sy;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    setTop(clampHandleTop(d.oy + dy, window.innerHeight));
  };
  const onPointerUp = (event) => {
    const d = drag.current;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!d) return;
    if (!d.moved) {
      setOpen(true);
      return;
    }
    try {
      localStorage.setItem(TOP_KEY, String(clampHandleTop(d.oy + (event.clientY - d.sy), window.innerHeight)));
    } catch {
      /* private window, or storage is full -- it just forgets */
    }
  };
  // Keyboard: Enter and Space arrive as a click with no pointer behind
  // them. A pointer tap is handled on pointerup above.
  const onHandleClick = (event) => {
    if (event.detail === 0) setOpen(true);
  };

  const close = () => setOpen(false);

  return (
    <div className={`gn ${open ? "is-open" : "is-tucked"}`}>
      <aside className="gn-sheet" aria-label="Goose's Notes" aria-hidden={!open} inert={open ? undefined : ""}>
        <button type="button" className="gn-grip" onClick={close} title="Tap to tuck away" aria-label="Tuck Goose's Notes away">
          <span className="gn-grip-line" />
        </button>
        <div className="gn-body">
          <header className="gn-head">
            <h2>Goose&rsquo;s Notes</h2>
            {showSpeaker && speakerIndex >= 0 && (
              <span className="gn-listening" id="gn-listening">listening to {cooks[speakerIndex].name}</span>
            )}
          </header>

          {showSpeaker && (
            <div
              className="gn-switch"
              role="radiogroup"
              aria-labelledby="gn-listening"
              style={{ "--gn-count": cooks.length, "--gn-at": Math.max(0, speakerIndex) }}
            >
              <span className="gn-switch-pill" aria-hidden="true" />
              {cooks.map((cook, i) => (
                <button
                  key={cook.id}
                  type="button"
                  role="radio"
                  aria-checked={speaker === cook.id}
                  className={`gn-switch-seg is-${playerKey(i)} ${speaker === cook.id ? "is-selected" : ""}`}
                  onClick={() => speakerSelection.set(cook.id)}
                >
                  <PlayerAvatar cook={cook} index={i} size={20} />
                  {cook.name}
                </button>
              ))}
            </div>
          )}

          <ol className="gn-list" role="log" aria-live="polite" aria-label="What was said and done">
            {feed.length === 0 && (
              <li className="gn-row is-empty">
                <span className="gn-text">
                  Nothing heard yet. Whatever you say, and whatever {AGENT_NAME} does about it, shows up here.
                </span>
              </li>
            )}
            {feed.map((row, i) => {
              const ci = row.kind === "said" || row.kind === "action" ? cookIndex(row.cookId) : -1;
              const who = ci >= 0 ? `is-cook is-${playerKey(ci)}` : row.kind === "agent" ? "is-goose" : "";
              return (
                <li key={feedKey(row, i)} className={`gn-row is-${row.kind} ${who} ${i >= flashFrom ? "is-new" : ""}`}>
                  <span className="gn-bar" aria-hidden="true" />
                  <span className="gn-text">
                    {row.kind === "said" && (
                      <>
                        <strong className="gn-who">{row.name}</strong> “{row.text}”
                        {/* Only ever shown when the app knows how it
                            decided. The toggle is the one worth seeing:
                            it is a guess nobody made deliberately. */}
                        {showAttribution && row.via && <span className="gn-via"> · heard {row.via}</span>}
                      </>
                    )}
                    {row.kind === "agent" && (
                      <>
                        <strong className="gn-who">{AGENT_NAME}</strong> {row.text}
                      </>
                    )}
                    {row.kind === "action" && (
                      <>
                        <strong className="gn-who">{row.name}</strong> {row.verb} {row.label || "a step since removed"}
                        {showAttribution && row.source && (
                          <span className="gn-via"> · {row.source === "tap" ? "tapped" : "by voice"}</span>
                        )}
                      </>
                    )}
                    {row.kind === "run" && row.text}
                    {row.kind === "thinking" && (
                      <span role="status">
                        {AGENT_NAME} is thinking… {row.seconds}s
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            <li ref={endRef} aria-hidden="true" />
          </ol>
        </div>
      </aside>

      <button
        type="button"
        className="gn-handle"
        style={{ top: `${handleTop}px` }}
        title="Goose's Notes — tap to open, drag to move"
        aria-label={unread ? `Goose's Notes, ${unread} new` : "Goose's Notes"}
        aria-expanded={open}
        tabIndex={open ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClick={onHandleClick}
      >
        {/* A straight apostrophe: turned sideways, a curly one reads as a dash. */}
        <span className="gn-handle-label">Goose&apos;s Notes</span>
        <span className="gn-handle-grip" aria-hidden="true">
          <span className="gn-grip-line" />
        </span>
      </button>
      {unread > 0 && <span className="gn-dot" style={{ top: `${handleTop - 4}px` }} aria-hidden="true" />}
    </div>
  );
}
