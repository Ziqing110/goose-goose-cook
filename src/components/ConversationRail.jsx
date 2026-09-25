// The record of the conversation, on every page.
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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildConversationFeed, feedKey } from "../utils/conversationFeed.js";
import { useLocation } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ROUTES } from "../utils/routeGuards.js";
import { voiceLog } from "../voice/voiceLog.js";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import { AGENT_NAME } from "../voice/agentVoice.js";
import "./ConversationRail.css";

/**
 * Everything said and everything done, in one list.
 *
 * A rail beside the board, not a drawer over it: the point is to be able
 * to glance at what just happened without covering the thing it happened
 * to. Collapsible because a kitchen screen is not big, and open by
 * default during a run because a record nobody can find is the state we
 * are fixing.
 *
 * Visually plain on purpose — the shape is what matters for now.
 */
export default function ConversationRail() {
  const { state } = useAppState();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(true);
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

  const onToggle = () => setOpen((v) => !v);

  const endRef = useRef(null);
  // Follow the newest row. A log that has to be scrolled to be current
  // is one more thing to do with your hands full.
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [feed.length, open]);

  // Deliberately not hidden when empty. Somewhere permanent that says
  // what the goose heard is the point: a panel that appears only once
  // something has worked cannot tell you that nothing has.

  return (
    <aside className={`lc-rail ${open ? "is-open" : "is-closed"}`} aria-label="Conversation record">
      <header className="lc-rail-head">
        <h2>What&rsquo;s happening</h2>
        <button type="button" className="btn btn-ghost lc-rail-toggle" onClick={onToggle}>
          {open ? "Hide" : `Show (${feed.length})`}
        </button>
      </header>

      {open && (
        <ol className="lc-rail-list">
          {feed.length === 0 && (
            <li className="lc-rail-row is-empty">
              <span className="lc-rail-text">
                Nothing heard yet. Whatever you say, and whatever {AGENT_NAME} does
                about it, shows up here.
              </span>
            </li>
          )}
          {feed.map((row, i) => (
            <li key={feedKey(row, i)} className={`lc-rail-row is-${row.kind}`}>
              {row.kind === "said" && (
                <>
                  <span className="lc-rail-who">{row.name}</span>
                  <span className="lc-rail-text">“{row.text}”</span>
                  {/* Only ever shown when the app knows how it decided.
                      The toggle is the one worth seeing: it is a guess
                      nobody made deliberately. */}
                  {showAttribution && row.via && (
                    <span className="lc-rail-via">heard {row.via}</span>
                  )}
                </>
              )}
              {row.kind === "agent" && (
                <>
                  <span className="lc-rail-who">{AGENT_NAME}</span>
                  <span className="lc-rail-text">{row.text}</span>
                </>
              )}
              {row.kind === "action" && (
                <span className="lc-rail-text">
                  <strong>{row.name}</strong> {row.verb}{" "}
                  {row.label || "a step since removed"}
                  {showAttribution && row.source && (
                    <span className="lc-rail-via">{row.source === "tap" ? "tapped" : "by voice"}</span>
                  )}
                </span>
              )}
              {row.kind === "run" && <span className="lc-rail-text">{row.text}</span>}
              {row.kind === "thinking" && (
                <span className="lc-rail-text" role="status">
                  {AGENT_NAME} is thinking… {row.seconds}s
                </span>
              )}
            </li>
          ))}
          <li ref={endRef} aria-hidden="true" />
        </ol>
      )}
    </aside>
  );
}
