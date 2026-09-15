// The screen people actually cook from. Read at ~1.5m with wet hands,
// so: big type, 64px targets, and no affordance that depends on hover.
// Every voice command has a button sitting next to the thing it acts on,
// and both paths call the same handlers â€” parity is structural, not a
// discipline.
//
// Sub-components live in this file rather than their own (same pattern as
// RecipeGraphPage's ApprovedPanel) since none of them is used elsewhere.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { mergeRecipesForDisplay, formatDuration } from "../utils/graphLayout.js";
import { EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import { cookColorKey } from "../utils/cooks.js";
import {
  reconcileRun, isReady, readyStepIds, blockedStepIds, activeStepFor, stepVariance,
  runProgress, isRunComplete, scoreboard, runOutcome, resolveAssignments, replan,
  arbitrateClaim, claimSuggestions, applyStart, applyDone, applySkip, applyDrop,
  applyUndo, endRun, appendTranscript, scoreStep, DIFFICULTY_POINTS,
} from "../utils/liveCook.js";
import { parseCommand, HELP_TEXT } from "../utils/voiceCommands.js";
import { buildSummary } from "../utils/summaryCard.js";
import "./LiveCookPage.css";

/** One clock for the page â€” not one per card. */
function useNow(paused) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);
  return now;
}

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function LiveCookPage() {
  const { state, saveRunNow, finishSession } = useAppState();
  const navigate = useNavigate();
  const { recipes, sharedSteps, cooks } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const nodes = useMemo(() => approved?.nodes || [], [approved]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const storedRun = state.session.run;
  const run = useMemo(() => (storedRun ? reconcileRun(storedRun, nodes) : null), [storedRun, nodes]);

  const finished = Boolean(run?.endedAt);
  const now = useNow(finished);
  const [speakerId, setSpeakerId] = useState(cooks[0]?.id);
  // Seeded once, so it can end up pointing at nobody if the line-up
  // changed since. Fall back rather than attributing speech to a ghost.
  const speaker = cooks.some((c) => c.id === speakerId) ? speakerId : cooks[0]?.id;
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // inline disambiguation buttons
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const transcriptRef = useRef(null);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [run?.transcript?.length]);

  if (!run) {
    return (
      <section className="page live-cook-page">
        <p className="hint">No cook in progress.</p>
        <button className="btn btn-primary" onClick={() => navigate("/session/schedule")}>
          Back to the plan
        </button>
      </section>
    );
  }

  const isCompetition = run.mode === "competition";
  const progress = runProgress(run, nodes, now);
  const board = scoreboard(run, nodes, cooks);
  const ready = readyStepIds(nodes, run);
  const blocked = blockedStepIds(nodes, run);
  const complete = isRunComplete(run, nodes);
  const assignments = isCompetition ? null : resolveAssignments({ nodes, run, cooks, now });

  const say = (nextRun, text, actions) =>
    appendTranscript(nextRun, { at: new Date().toISOString(), speaker: "agent", text, actions });

  const commit = (nextRun) => saveRunNow(nextRun);

  // --- the handlers every button AND every utterance routes through ---

  const doStart = (stepId, cookId, source = "tap") => {
    if (!stepId || !isReady(stepId, nodes, run)) return;
    if (activeStepFor(cookId, run)) return;
    const at = new Date().toISOString();
    let next = applyStart({ run, stepId, cookId, at, source });
    next = say(next, `Timer running on ${byId[stepId].label}. Est ${formatDuration(byId[stepId].estimated_duration_sec)}.`);
    commit(next);
  };

  const doDone = (stepId, cookId, source = "tap") => {
    if (!stepId || run.steps[stepId]?.status !== "active") return;
    const at = new Date().toISOString();
    const v = stepVariance(byId[stepId], { ...run.steps[stepId], endedAt: at });
    let next = applyDone({ run, stepId, cookId, at, source });
    // Recompile the rest of the plan on every completion â€” real times
    // diverge from estimates, so what's left genuinely changes shape.
    if (!isCompetition) next = replan({ nodes, run: next, cooks, kitchenProfile });
    const pts = scoreStep(byId[stepId], { record: next.steps[stepId], run: next, nodes, cooks }).points;
    const overNote = v.over ? `, ${clock(v.deltaSec)} over` : "";
    next = say(
      next,
      isCompetition
        ? `+${pts} for ${cooks.find((c) => c.id === cookId)?.name}. ${byId[stepId].label}, ${clock(v.actualSec)}${overNote}.`
        : `${byId[stepId].label} done in ${clock(v.actualSec)}${overNote}.`
    );
    if (isRunComplete(next, nodes)) next = say(next, "That's everything. Dinner's up.");
    commit(next);
  };

  const doSkip = (stepId, cookId, source = "tap") => {
    if (!stepId) return;
    const dependents = nodes.filter((n) => (n.depends_on || []).includes(stepId));
    if (dependents.length && !window.confirm(`${dependents.map((d) => d.label).join(", ")} was counting on this. Skip anyway?`)) return;
    const at = new Date().toISOString();
    let next = applySkip({ run, stepId, cookId, at, source });
    if (!isCompetition) next = replan({ nodes, run: next, cooks, kitchenProfile });
    next = say(next, `Skipped ${byId[stepId].label}. No points for that one.`);
    commit(next);
  };

  const doDrop = (stepId, cookId, source = "tap") => {
    if (!stepId) return;
    const at = new Date().toISOString();
    let next = applyDrop({ run, stepId, cookId, at, source });
    if (!isCompetition) next = replan({ nodes, run: next, cooks, kitchenProfile });
    commit(say(next, `Back in the pool. ${byId[stepId].label} is open again.`));
  };

  const doClaim = (stepId, cookId, source = "tap") => {
    const at = new Date().toISOString();
    const verdict = arbitrateClaim({ run, nodes, cooks, stepId, cookId, at });
    const name = (id) => cooks.find((c) => c.id === id)?.name ?? "someone";
    if (!verdict.ok) {
      const text = {
        busy: `You're still on ${byId[verdict.holdingStepId]?.label}. Finish it first.`,
        already_claimed: verdict.tie
          ? `Dead heat. ${name(verdict.holderCookId)} is behind, so ${name(verdict.holderCookId)} takes it.`
          : `${name(verdict.holderCookId)} called it first.`,
        not_ready: `Not yet â€” that needs ${(verdict.blockedBy || []).map((d) => byId[d]?.label).join(", ")} first.`,
        already_done: "That one's already finished.",
        noop: "You've already got that one.",
        unknown_step: "I don't know that step.",
      }[verdict.code];
      commit(say(run, text));
      return;
    }
    let next = run;
    if (verdict.stealFrom) next = applyDrop({ run: next, stepId, cookId: verdict.stealFrom, at, source });
    next = applyStart({ run: next, stepId, cookId, at, source });
    commit(say(next, `${name(cookId)} has ${byId[stepId].label}. Go.`));
  };

  const doUndo = (cookId) => {
    const result = applyUndo({ run, nodes, cookId, at: new Date().toISOString() });
    if (result.rejected) {
      const text = {
        too_late: "Too late to undo that one.",
        downstream_started: "Can't undo â€” something downstream already started.",
        nothing: "Nothing of yours to undo.",
      }[result.rejected];
      commit(say(run, text));
      return;
    }
    commit(say(result.run, `Rolled back â€” ${result.label} is active again.`));
  };

  const doFinish = () => {
    if (!complete && !window.confirm(`${progress.pending + progress.active} steps aren't done. Finish anyway?`)) return;
    commit(endRun({ run, nodes, at: new Date().toISOString() }));
  };

  // Freeze the card, persist it with the session, then hand over to it.
  // The wait matters: the card page fetches this session back by id, so
  // navigating before the write lands shows "no card for this cook" for
  // a cook that saved perfectly well. If the write fails, stay put and
  // say so rather than handing over to a page that has nothing to show.
  const saveAndSeeCard = async () => {
    const sessionId = state.session.id;
    const summary = buildSummary({
      outcome: runOutcome(run, nodes, cooks),
      cooks,
      dish: approved?.title || "Untitled cook",
      mode: run.mode,
    });
    setSaveError(null);
    setSaving(true);
    try {
      await finishSession(summary);
      navigate(`/cook/${sessionId}`);
    } catch (err) {
      setSaving(false);
      setSaveError(err.message || "Couldn't save the card.");
    }
  };

  // --- voice: parse, then call the exact same handlers ---

  const submitUtterance = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setPending(null);
    const cookId = speaker;
    const activeStepId = activeStepFor(cookId, run);
    const ownQueue = isCompetition
      ? claimSuggestions({ nodes, run, cookId })
      : [assignments?.byCook[cookId]?.stepId].filter(Boolean);
    const result = parseCommand(text, { byId, activeStepId, claimable: ready, ownQueue });

    let heard = appendTranscript(run, { at: new Date().toISOString(), speaker: cookId, text });

    const needTarget = (message) => {
      const options = (result.candidates.length ? result.candidates : claimSuggestions({ nodes, run, cookId })).slice(0, 3);
      setPending({ intent: result.intent, options, cookId });
      commit(say(heard, message));
    };

    switch (result.intent) {
      case "done":
        if (!result.stepId) return needTarget("Which one did you finish?");
        return doDone(result.stepId, cookId, "voice");
      case "start":
        if (!result.stepId) return needTarget("Which one are you starting?");
        return doStart(result.stepId, cookId, "voice");
      case "claim":
        if (!result.stepId) return needTarget("Which one? Tap it or say the name.");
        return doClaim(result.stepId, cookId, "voice");
      case "skip":
        if (!result.stepId) return needTarget("Which one should I skip?");
        return doSkip(result.stepId, cookId, "voice");
      case "drop":
        if (!result.stepId) return needTarget("Which one are you putting back?");
        return doDrop(result.stepId, cookId, "voice");
      case "undo":
        return doUndo(cookId);
      case "finish_run":
        return doFinish();
      case "score":
        return commit(say(heard, board.map((b) => `${b.name} ${b.points}`).join(", ") + `. ${progress.pending} left.`));
      case "status": {
        const lines = cooks.map((c) => {
          const active = activeStepFor(c.id, run);
          if (active) return `${c.name}: ${byId[active].label}, ${clock(stepVariance(byId[active], run.steps[active], now).actualSec)} in`;
          return `${c.name}: free`;
        });
        return commit(say(heard, `${lines.join(". ")}. ${progress.done} of ${progress.total} done.`));
      }
      case "help":
        return commit(say(heard, HELP_TEXT));
      default:
        return commit(say(heard, `I didn't catch that. ${HELP_TEXT}`));
    }
  };

  const runPending = (stepId) => {
    const { intent, cookId } = pending;
    setPending(null);
    if (intent === "claim") return doClaim(stepId, cookId, "voice");
    if (intent === "done") return doDone(stepId, cookId, "voice");
    if (intent === "start") return doStart(stepId, cookId, "voice");
    if (intent === "skip") return doSkip(stepId, cookId, "voice");
    if (intent === "drop") return doDrop(stepId, cookId, "voice");
  };

  return (
    <section className={`page live-cook-page ${isCompetition ? "is-competition" : ""}`}>
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">{isCompetition ? "Competition" : "Cooperation"}</p>
            <h1>{approved?.title}</h1>
          </div>
        </div>
        <div className="band-header-right">
          <span className="tag mono live-clock">{clock(progress.elapsedSec)}</span>
          <span className="tag mono">
            {progress.done}/{progress.total} done
          </span>
          {!isCompetition && progress.driftSec > 30 && (
            <span className="tag mono live-drift">{clock(progress.driftSec)} behind plan</span>
          )}
          {/* The plan was previously only reachable by browser-Back,
              which nobody finds. Leaving doesn't end the run. */}
          {!finished && (
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/session/schedule")}>
              See the plan
            </button>
          )}
        </div>
      </div>

      {finished ? (
        <RunSummary
          outcome={runOutcome(run, nodes, cooks)}
          cooks={cooks}
          isCompetition={isCompetition}
          onExit={saveAndSeeCard}
          saving={saving}
          saveError={saveError}
        />
      ) : (
        <>
          {isCompetition && <Leaderboard board={board} cooks={cooks} />}

          <div className="focus-row">
            {cooks.map((cook, i) => (
              <CookFocusCard
                key={cook.id}
                cook={cook}
                colorKey={cookColorKey(i)}
                run={run}
                byId={byId}
                now={now}
                isCompetition={isCompetition}
                points={board.find((b) => b.cookId === cook.id)?.points ?? 0}
                assignment={assignments?.byCook[cook.id]}
                onStart={(stepId) => doStart(stepId, cook.id)}
                onDone={(stepId) => doDone(stepId, cook.id)}
                onSkip={(stepId) => doSkip(stepId, cook.id)}
                onDrop={(stepId) => doDrop(stepId, cook.id)}
              />
            ))}
          </div>

          {isCompetition && (
            <TaskPoolBoard
              ready={ready}
              blocked={blocked}
              run={run}
              byId={byId}
              cooks={cooks}
              now={now}
              onClaim={(stepId, cookId) => doClaim(stepId, cookId)}
            />
          )}

          <div className="progress-track live-progress">
            <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
          </div>
        </>
      )}

      {!finished && (
        <div className="card voice-console">
          <div className="voice-console-head">
            <span className="mini-title">Talk to the agent</span>
            <div className="speaker-select">
              {cooks.map((cook, i) => (
                <button
                  key={cook.id}
                  type="button"
                  className={`btn speaker-pill cook-color-${cookColorKey(i)} ${speaker === cook.id ? "is-active" : ""}`}
                  onClick={() => setSpeakerId(cook.id)}
                >
                  {cook.name}
                </button>
              ))}
            </div>
          </div>

          <div className="live-transcript" ref={transcriptRef} role="log" aria-live="polite">
            {run.transcript.map((entry) => (
              <div key={entry.id} className={`live-line ${entry.speaker === "agent" ? "is-agent" : "is-cook"}`}>
                <span className="live-who mono">
                  {entry.speaker === "agent" ? "Agent" : cooks.find((c) => c.id === entry.speaker)?.name || "Cook"}
                </span>
                <p className="live-bubble">{entry.text}</p>
              </div>
            ))}
          </div>

          {pending && (
            <div className="pending-options">
              {pending.options.map((id) => (
                <button key={id} type="button" className="btn" onClick={() => runPending(id)}>
                  {byId[id]?.label}
                </button>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}

          <form className="voice-input-row" onSubmit={submitUtterance}>
            <input
              type="text"
              className="voice-command-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Say something as ${cooks.find((c) => c.id === speaker)?.name || "a cook"} â€” "done", "take the garlic"â€¦`}
            />
            <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
              Send
            </button>
          </form>
          <p className="hint">{HELP_TEXT}</p>
        </div>
      )}

      {!finished && (
        <div className="band-footer live-footer">
          <div className="band-footer-left">
            <button className="btn btn-ghost" onClick={() => doUndo(speakerId)}>
              Undo
            </button>
          </div>
          <div className="band-footer-right">
            <button className="btn btn-primary btn-lg" onClick={doFinish}>
              {complete ? "Finish cooking" : "Finish early"} &rarr;
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CookFocusCard({ cook, colorKey, run, byId, now, isCompetition, points, assignment, onStart, onDone, onSkip, onDrop }) {
  const activeId = activeStepFor(cook.id, run);
  const node = activeId ? byId[activeId] : null;
  const variance = node ? stepVariance(node, run.steps[activeId], now) : null;
  const suggestedId = !activeId ? assignment?.stepId : null;
  const suggested = suggestedId ? byId[suggestedId] : null;

  return (
    <div className={`card focus-card cook-border-${colorKey}`}>
      <div className="focus-head">
        <span className={`cook-avatar cook-avatar-sm cook-color-${colorKey}`}>{cook.name[0]?.toUpperCase()}</span>
        <span className="focus-cook-name">{cook.name}</span>
        {isCompetition && <span className="tag mono focus-points">{points} pts</span>}
      </div>

      {/* Every branch renders the same skeleton â€” eyebrow, title, body,
          then an action block pinned to the bottom â€” so both cooks' cards
          line up instead of one looking half-empty. */}
      {node ? (
        <>
          <span className="mini-title">Cooking</span>
          <h2 className="focus-step-title">{node.label}</h2>
          {node.description && <p className="focus-step-desc">{node.description}</p>}
          <div className="focus-meta">
            <span className={`focus-timer mono ${variance.over ? "is-over" : ""}`}>{clock(variance.actualSec)}</span>
            <span className="hint mono">
              est {formatDuration(variance.estSec)}
              {variance.over ? ` Â· ${clock(variance.deltaSec)} over` : ""}
            </span>
          </div>
          <div className="focus-tags">
            <span className={`tag tag-difficulty-${node.difficulty}`}>{node.difficulty}</span>
            {(node.required_equipment || []).map((e) => (
              <span className="tag mono" key={e}>
                {EQUIPMENT_LABELS[e]}
              </span>
            ))}
            {isCompetition && <span className="tag mono">worth +{DIFFICULTY_POINTS[node.difficulty]}</span>}
          </div>
          <div className="focus-actions">
            <button className="btn btn-success btn-lg focus-primary" onClick={() => onDone(activeId)}>
              Done
            </button>
            <div className="focus-secondary">
              <button className="btn btn-ghost" onClick={() => onSkip(activeId)}>
                Skip step
              </button>
              {isCompetition && (
                <button className="btn btn-ghost" onClick={() => onDrop(activeId)}>
                  Put it back
                </button>
              )}
            </div>
          </div>
        </>
      ) : suggested ? (
        <>
          <span className="mini-title">{assignment?.reason === "idle_fill" ? "Blocked â€” pick this up?" : "Up next"}</span>
          <h2 className="focus-step-title">{suggested.label}</h2>
          {suggested.description && <p className="focus-step-desc">{suggested.description}</p>}
          <div className="focus-tags">
            <span className={`tag tag-difficulty-${suggested.difficulty}`}>{suggested.difficulty}</span>
            <span className="tag mono">{formatDuration(suggested.estimated_duration_sec)}</span>
          </div>
          <div className="focus-actions">
            <button className="btn btn-primary btn-lg focus-primary" onClick={() => onStart(suggestedId)}>
              {assignment?.reason === "idle_fill" ? "Take it" : "Start"}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="mini-title">{assignment?.reason === "finished" ? "All done" : "Waiting"}</span>
          <p className="focus-step-desc focus-waiting-text">
            {assignment?.waitingOnStepId
              ? `Waiting on "${byId[assignment.waitingOnStepId]?.label}"${
                  assignment.etaSec != null ? `, about ${clock(assignment.etaSec)} left` : ""
                }.`
              : isCompetition
              ? "Nothing to grab right now."
              : "Nothing left for you."}
          </p>
          <div className="focus-actions" />
        </>
      )}
    </div>
  );
}

function TaskPoolBoard({ ready, blocked, run, byId, cooks, now, onClaim }) {
  const taken = Object.entries(run.steps).filter(([, r]) => r.status === "active");
  return (
    <div className="card pool-board">
      <div className="pool-head">
        <span className="mini-title">Up for grabs</span>
        <span className="hint">
          {ready.length} ready &middot; {blocked.length} still blocked
        </span>
      </div>
      <div className="pool-grid">
        {/* One button per cook rather than a single "Claim" that scores
            for whoever the voice-console pill happened to be left on.
            On a screen two people share, a tap has to say who tapped. */}
        {ready.map((id) => (
          <div key={id} className="pool-tile is-claimable">
            <span className="pool-label">{byId[id].label}</span>
            <span className="pool-meta mono">
              {formatDuration(byId[id].estimated_duration_sec)} &middot; +{DIFFICULTY_POINTS[byId[id].difficulty]}
            </span>
            <span className="pool-claimers">
              {cooks.map((cook, i) => (
                <button
                  key={cook.id}
                  type="button"
                  className={`btn pool-claim-btn cook-color-${cookColorKey(i)}`}
                  onClick={() => onClaim(id, cook.id)}
                  disabled={Boolean(activeStepFor(cook.id, run))}
                  title={activeStepFor(cook.id, run) ? `${cook.name} is still on something` : `${cook.name} takes it`}
                >
                  {cook.name}
                </button>
              ))}
            </span>
          </div>
        ))}
        {taken.map(([id, record]) => {
          const cookIndex = cooks.findIndex((c) => c.id === record.cookId);
          return (
            <div key={id} className={`pool-tile is-taken cook-color-${cookColorKey(cookIndex)}`}>
              <span className="pool-label">{byId[id]?.label}</span>
              <span className="pool-meta mono">
                {cooks[cookIndex]?.name} &middot; {clock(stepVariance(byId[id], record, now).actualSec)}
              </span>
            </div>
          );
        })}
        {blocked.map((id) => {
          const waiting = (byId[id].depends_on || []).filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
          return (
            <div key={id} className="pool-tile is-blocked">
              <span className="pool-label">{byId[id].label}</span>
              <span className="pool-meta mono">needs {waiting.map((d) => byId[d]?.label).join(", ")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({ board, cooks }) {
  const top = Math.max(1, ...board.map((b) => b.points));
  return (
    <div className="card leaderboard">
      {board.map((entry) => {
        const i = cooks.findIndex((c) => c.id === entry.cookId);
        return (
          <div className={`leader-row cook-color-${cookColorKey(i)}`} key={entry.cookId}>
            <span className={`cook-avatar cook-avatar-sm cook-color-${cookColorKey(i)}`}>{entry.name[0]?.toUpperCase()}</span>
            <div className="leader-body">
              <div className="leader-name">{entry.name}</div>
              <div className="leader-bar">
                <div className="leader-fill" style={{ width: `${(entry.points / top) * 100}%` }} />
              </div>
            </div>
            <span className="leader-points mono">{entry.points}</span>
          </div>
        );
      })}
    </div>
  );
}

function RunSummary({ outcome, cooks, isCompetition, onExit, saving, saveError }) {
  const winners = outcome.winnerCookIds.map((id) => cooks.find((c) => c.id === id)?.name).filter(Boolean);
  return (
    <div className="card run-summary">
      <span className="mini-title">Service done</span>
      <h2 className="summary-headline">
        {clock(outcome.totalSec)} on the clock
        {outcome.estimatedSec != null && <span className="hint"> Â· planned {clock(outcome.estimatedSec)}</span>}
      </h2>

      {isCompetition && winners.length > 0 && (
        <p className="summary-winner">
          {winners.length > 1 ? `Tied â€” ${winners.join(" and ")}, ${outcome.scoreboard[0].points} each` : `${winners[0]} wins it`}
        </p>
      )}

      <div className="summary-scores">
        {outcome.scoreboard.map((entry) => {
          const i = cooks.findIndex((c) => c.id === entry.cookId);
          return (
            <div className={`summary-score cook-color-${cookColorKey(i)}`} key={entry.cookId}>
              <span className="leader-points mono">{entry.points}</span>
              <span>{entry.name}</span>
              <span className="hint">
                {entry.doneCount} done{entry.skippedCount ? ` Â· ${entry.skippedCount} skipped` : ""}
              </span>
            </div>
          );
        })}
      </div>

      <ul className="summary-steps">
        {outcome.perStep.map((s) => (
          <li key={s.id} className={s.status === "skipped" ? "is-skipped" : ""}>
            <span className="summary-step-label">{s.label}</span>
            <span className="hint mono">
              {s.status === "skipped"
                ? "skipped"
                : `est ${clock(s.estSec)} Â· actual ${clock(s.actualSec)}${s.deltaSec > 0 ? ` Â· ${clock(s.deltaSec)} over` : ""}`}
            </span>
          </li>
        ))}
      </ul>

      {saveError && (
        <p className="hint summary-save-error" role="alert">
          {saveError} Nothing is lost — try again.
        </p>
      )}
      <button className="btn btn-primary btn-lg" onClick={onExit} disabled={saving}>
        {saving ? "Saving…" : saveError ? "Try again" : "Save & see the card"}
      </button>
    </div>
  );
}
