import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { createRun, runProgress } from "../utils/liveCook.js";
import { mergeRecipesForDisplay, formatDuration } from "../utils/graphLayout.js";
import { computeSchedule, computeOpeningAssignment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import { cookColorKey } from "../utils/cooks.js";
import "./SchedulePage.css";

const ZOOM_LEVELS = [6, 10, 16, 24, 36, 54, 80];
const DEFAULT_ZOOM_INDEX = 3;

// A block shows as much as it can without clipping words into nonsense
// ("Cut tof…"): name plus equipment when there's room, then name alone,
// then just the duration — which still says something useful — and only
// a bare bar when even that won't fit. The name is always in the
// tooltip and the detail card.
const META_MIN_PX = 176;
const LABEL_MIN_PX = 116;
const DURATION_MIN_PX = 48;

function formatMinutes(sec) {
  return Math.round(sec / 60);
}

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Keep tick labels from colliding: step up until they're far enough apart.
function pickTickStepMinutes(pxPerMin) {
  const steps = [1, 2, 5, 10, 15, 20, 30, 60];
  return steps.find((s) => s * pxPerMin >= 56) || steps[steps.length - 1];
}

export default function SchedulePage() {
  const { state, dispatch, saveRunNow } = useAppState();
  const navigate = useNavigate();
  const { recipes, sharedSteps, cooks, mode, run } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [selectedStepId, setSelectedStepId] = useState(null);

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const nodes = useMemo(() => approved?.nodes || [], [approved]);
  const schedule = useMemo(() => computeSchedule(nodes, cooks, kitchenProfile), [nodes, cooks, kitchenProfile]);
  const opening = useMemo(
    () => computeOpeningAssignment(nodes, cooks, kitchenProfile),
    [nodes, cooks, kitchenProfile]
  );

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const stepById = Object.fromEntries(schedule.steps.map((s) => [s.id, s]));
  const cookById = Object.fromEntries(cooks.map((c) => [c.id, c]));
  const cookIndexById = Object.fromEntries(cooks.map((c, i) => [c.id, i]));
  const dishOf = (nodeId) =>
    byId[nodeId]?._shared ? "Shared" : recipes.find((r) => r.id === byId[nodeId]?._recipeId)?.working.title || null;

  const pxPerMin = ZOOM_LEVELS[zoomIndex];
  const pxFor = (sec) => (sec / 60) * pxPerMin;
  const trackWidth = Math.max(pxFor(schedule.makespanSec), 240);
  const tickStep = pickTickStepMinutes(pxPerMin);
  const ticks = [];
  for (let m = 0; m * 60 <= schedule.makespanSec; m += tickStep) ticks.push(m);

  // Mode is snapshotted into the run, so changing it mid-cook would
  // desync what's already happened — the cards lock once a run exists.
  const setMode = (nextMode) => {
    if (run) return;
    dispatch({ type: "session/update", payload: { mode: nextMode } });
  };

  const canStart = Boolean(mode) && schedule.unscheduledIds.length === 0;
  const startCooking = () => {
    // schedule/opening are already memoized above — no extra solver run.
    saveRunNow(createRun({ nodes, mode, schedule, opening, now: new Date() }));
    navigate("/session/live-cook");
  };
  // Throwing away a run in progress is the most destructive thing on
  // this page and it used to ask with one vague line. Name the cost:
  // what's already been cooked is what's actually being lost.
  const discardRun = () => {
    const progress = runProgress(run, nodes, Date.now());
    const done = `${progress.done} completed step${progress.done === 1 ? "" : "s"}`;
    const elapsed = formatDuration(progress.elapsedSec);
    if (!window.confirm(`Throw away this cook? You lose ${done} and ${elapsed} on the clock, and it can't be undone.`)) return;
    saveRunNow(null);
  };

  // Any gap between a cook's previous block and their next one is idle
  // time — labeled from the next step's startCause (what actually
  // constrained it), not just equipment-caused waits, so a step that's
  // simply waiting on its own dependency chain shows an honest reason too.
  const waitLabelFor = (cause) => {
    if (cause.type === "equipment") {
      const holderStep = cause.refStepId ? stepById[cause.refStepId] : null;
      const holderCook = holderStep ? cookById[holderStep.cookId] : null;
      return `Waiting for ${EQUIPMENT_LABELS[cause.equipmentType]}` + (holderCook ? ` — ${holderCook.name} has it` : "");
    }
    if (cause.type === "dependency" && cause.refStepId) {
      return `Waiting on "${byId[cause.refStepId]?.label || cause.refStepId}"`;
    }
    return "Waiting";
  };

  const lanes = cooks.map((cook) => {
    const steps = schedule.steps.filter((s) => s.cookId === cook.id).sort((a, b) => a.startSec - b.startSec);
    const blocks = [];
    let prevEnd = 0;
    steps.forEach((s) => {
      if (s.startSec > prevEnd) {
        blocks.push({ kind: "wait", startSec: prevEnd, endSec: s.startSec, label: waitLabelFor(s.startCause) });
      }
      blocks.push({ kind: "task", step: s, node: byId[s.id] });
      prevEnd = s.endSec;
    });
    return { cook, steps, blocks, busySec: steps.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) };
  });

  if (!approved) {
    return (
      <section className="page schedule-page">
        <p className="hint">Loading your schedule&hellip;</p>
      </section>
    );
  }

  const selectedStep = selectedStepId ? stepById[selectedStepId] : null;
  const selectedNode = selectedStepId ? byId[selectedStepId] : null;
  const isCompetition = mode === "competition";

  return (
    <section className="page schedule-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>{approved.title} &middot; approved</h1>
          </div>
        </div>
        {/* The makespan and per-cook counts describe the cooperative
            assignment, which competition mode deliberately doesn't use —
            showing them there would promise an order that won't happen. */}
        <div className="band-header-right">
          {isCompetition ? (
            <span className="tag mono">{nodes.length} steps to claim</span>
          ) : (
            <>
              <span
                className="tag mono"
                title={
                  schedule.optimal
                    ? "No arrangement of these steps finishes sooner."
                    : `Best found. Nothing can beat ${formatMinutes(schedule.lowerBoundSec)} min, so this is within ${formatMinutes(schedule.makespanSec - schedule.lowerBoundSec)} min of the best possible.`
                }
              >
                Estimated {formatMinutes(schedule.makespanSec)} min
                {schedule.optimal ? " · optimal" : ` · best of ≥${formatMinutes(schedule.lowerBoundSec)}`}
              </span>
              {schedule.savedSec > 0 && (
                <span className="tag mono tag-difficulty-low">{formatMinutes(schedule.savedSec)} min faster than solo</span>
              )}
              {lanes.map(({ cook, steps }) => (
                <span className={`tag mono cook-color-${cookColorKey(cookIndexById[cook.id])}`} key={cook.id}>
                  {cook.name} &middot; {steps.length} steps
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {schedule.unscheduledIds.length > 0 && (
        <div className="card schedule-warning">
          <span className="mini-title">{schedule.unscheduledIds.length} steps couldn&rsquo;t be scheduled</span>
          <p className="hint">
            These steps depend on each other in a loop, so there&rsquo;s no order that satisfies them. Go back to the
            recipe graph and break the cycle:{" "}
            {schedule.unscheduledIds.map((id) => byId[id]?.label || id).join(", ")}.
          </p>
        </div>
      )}

      {isCompetition ? (
        <CompetitionPanel
          opening={opening}
          cooks={cooks}
          byId={byId}
          cookIndexById={cookIndexById}
          dishOf={dishOf}
        />
      ) : (
        <div className="card schedule-card">
          <div className="schedule-card-head">
            <span className="mini-title">Who does what, when</span>
            <div className="schedule-head-right">
              <div className="schedule-legend">
                <span className="legend-item"><span className="legend-swatch legend-critical" /> Critical path</span>
                <span className="legend-item"><span className="legend-swatch legend-wait" /> Waiting</span>
              </div>
              <div className="zoom-controls">
                <span className="mini-title">Zoom</span>
                <input
                  type="range"
                  className="zoom-slider"
                  min={0}
                  max={ZOOM_LEVELS.length - 1}
                  step={1}
                  value={zoomIndex}
                  onChange={(e) => setZoomIndex(Number(e.target.value))}
                  aria-label="Timeline zoom"
                />
                <span className="hint mono zoom-readout">{pxPerMin}px / min</span>
              </div>
            </div>
          </div>

          <div className="schedule-body">
            <div className="schedule-lane-labels">
              <div className="schedule-lane-label-spacer" />
              {lanes.map(({ cook, busySec }) => (
                <div className="schedule-lane-label" key={cook.id}>
                  <span className={`cook-avatar cook-avatar-sm cook-color-${cookColorKey(cookIndexById[cook.id])}`}>
                    {cook.name[0]?.toUpperCase()}
                  </span>
                  <div>
                    <div className="schedule-lane-name">{cook.name}</div>
                    <div className="hint mono">{formatMinutes(busySec)} min busy</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="schedule-scroll">
              <div className="schedule-inner" style={{ width: trackWidth }}>
                <div className="schedule-ruler-track">
                  {ticks.map((m, i) => (
                    // The first tick sits at x=0, where centring it would
                    // push half the label out of the scroll area.
                    <span className={`schedule-tick mono ${i === 0 ? "is-first" : ""}`} key={m} style={{ left: pxFor(m * 60) }}>
                      {m}&prime;
                    </span>
                  ))}
                </div>

                {lanes.map(({ cook, blocks }) => (
                <div className="schedule-lane-track" key={cook.id}>
                  {blocks.map((b, i) => {
                    const startSec = b.kind === "wait" ? b.startSec : b.step.startSec;
                    const endSec = b.kind === "wait" ? b.endSec : b.step.endSec;
                    const widthPx = Math.max(pxFor(endSec - startSec), 3);
                    const showLabel = widthPx >= LABEL_MIN_PX;
                    const showMeta = widthPx >= META_MIN_PX;
                    if (b.kind === "wait") {
                      return (
                        <div
                          className="schedule-block schedule-block-wait"
                          key={`wait-${i}`}
                          style={{ left: pxFor(startSec), width: widthPx }}
                          title={b.label}
                        >
                          {showLabel && <span className="schedule-block-label">{b.label}</span>}
                        </div>
                      );
                    }
                    const isCritical = schedule.criticalStepIds.has(b.step.id);
                    return (
                      <button
                        type="button"
                        className={`schedule-block schedule-block-task cook-color-${cookColorKey(cookIndexById[cook.id])} ${
                          isCritical ? "is-critical" : ""
                        } ${selectedStepId === b.step.id ? "is-selected" : ""}`}
                        key={b.step.id}
                        style={{ left: pxFor(startSec), width: widthPx }}
                        title={`${b.node?.label} · ${formatDuration(endSec - startSec)}`}
                        onClick={() => setSelectedStepId(selectedStepId === b.step.id ? null : b.step.id)}
                      >
                        {showLabel && <span className="schedule-block-label">{b.node?.label}</span>}
                        {showMeta && (
                          <span className="schedule-block-meta mono">
                            {formatDuration(endSec - startSec)}
                            {b.step.requiredEquipment.length > 0 && ` · ${EQUIPMENT_LABELS[b.step.requiredEquipment[0]]}`}
                          </span>
                        )}
                        {!showLabel && widthPx >= DURATION_MIN_PX && (
                          <span className="schedule-block-meta mono">{formatDuration(endSec - startSec)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                ))}
              </div>
            </div>
          </div>

          {selectedStep && selectedNode ? (
            <StepDetail
              step={selectedStep}
              node={selectedNode}
              dish={dishOf(selectedStep.id)}
              cook={cookById[selectedStep.cookId]}
              isCritical={schedule.criticalStepIds.has(selectedStep.id)}
              waitLabel={selectedStep.startSec > selectedStep.dependsReadySec ? waitLabelFor(selectedStep.startCause) : null}
              onClose={() => setSelectedStepId(null)}
            />
          ) : (
            <p className="hint">Click any task for its exact timing.</p>
          )}

          <p className="hint schedule-gap-note">
            Every step needs a cook&rsquo;s full attention in this version — hands-off steps like a rice cooker
            aren&rsquo;t modeled yet.
          </p>
        </div>
      )}

      <div className="card mode-select-card">
        <div className="mode-cards">
          <button
            type="button"
            className={`mode-card ${mode === "cooperation" ? "is-selected" : ""}`}
            disabled={Boolean(run)}
            onClick={() => setMode("cooperation")}
          >
            <div className="mode-card-head">
              <span className="mini-title">Cooperation</span>
              {mode === "cooperation" && <span className="tag tag-difficulty-low">Selected</span>}
            </div>
            <p className="hint">Follow the optimal assignment. Every &ldquo;done&rdquo; re-schedules automatically. Goal: fastest dinner.</p>
          </button>
          <button
            type="button"
            className={`mode-card ${mode === "competition" ? "is-selected" : ""}`}
            disabled={Boolean(run) || cooks.length < 2}
            onClick={() => setMode("competition")}
          >
            <div className="mode-card-head">
              <span className="mini-title">Competition</span>
              {mode === "competition" && <span className="tag tag-difficulty-low">Selected</span>}
            </div>
            <p className="hint">
              {cooks.length < 2
                ? "Needs two cooks — a one-person contest has nobody to race."
                : "No assignments past the opening. Claim tasks by voice. Score on difficulty and performance."}
            </p>
          </button>
        </div>
      </div>

      <div className="band-footer">
        <div className="band-footer-left">
          <span className="hint">
            {run
              ? "A cook is already in progress — mode is locked until it's finished."
              : mode
              ? `Mode: ${mode}`
              : "Pick a mode to continue"}
          </span>
        </div>
        <div className="band-footer-right">
          {run && (
            <button className="btn btn-ghost btn-danger" onClick={discardRun}>
              Throw away this cook
            </button>
          )}
          <button
            className="btn btn-primary btn-lg"
            disabled={!run && !canStart}
            onClick={run ? () => navigate("/session/live-cook") : startCooking}
          >
            {run ? "Resume cooking" : "Start cooking"} &rarr;
          </button>
        </div>
      </div>
    </section>
  );
}

function StepDetail({ step, node, dish, cook, isCritical, waitLabel, onClose }) {
  return (
    <div className="step-detail">
      <div className="step-detail-head">
        <div>
          <span className="mini-title">{dish || "Step"}</span>
          <h3 className="step-detail-title">{node.label}</h3>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {node.description && <p className="hint">{node.description}</p>}
      <div className="step-detail-grid">
        <div><span className="mini-title">Starts</span><span className="mono">{formatClock(step.startSec)}</span></div>
        <div><span className="mini-title">Ends</span><span className="mono">{formatClock(step.endSec)}</span></div>
        <div><span className="mini-title">Takes</span><span className="mono">{formatDuration(step.endSec - step.startSec)}</span></div>
        <div><span className="mini-title">Cook</span><span>{cook?.name || "—"}</span></div>
        <div>
          <span className="mini-title">Equipment</span>
          <span>{step.requiredEquipment.length ? step.requiredEquipment.map((e) => EQUIPMENT_LABELS[e]).join(", ") : "none"}</span>
        </div>
        <div><span className="mini-title">Difficulty</span><span>{node.difficulty}</span></div>
      </div>
      {waitLabel && <p className="hint step-detail-wait">&#9888; {waitLabel}</p>}
      {isCritical && <p className="hint step-detail-critical">On the critical path — if this runs late, dinner runs late.</p>}
    </div>
  );
}

function CompetitionPanel({ opening, cooks, byId, cookIndexById, dishOf }) {
  const { bundles, poolIds, lockedIds, contested, skewSec } = opening;

  return (
    <div className="card schedule-card">
      <div className="schedule-card-head">
        <span className="mini-title">Opening tasks</span>
        {!contested && skewSec > 0 && (
          <span className="hint mono">{formatDuration(skewSec)} apart at the start</span>
        )}
      </div>

      {contested ? (
        <p className="hint">
          Only {poolIds.length} task{poolIds.length === 1 ? "" : "s"} can start right now — not enough to give everyone
          their own. It&rsquo;s open: first to claim it by voice gets it.
        </p>
      ) : (
        <p className="hint">
          Everyone starts with a roughly equal chunk of work, and no two opening tasks fight over the same equipment.
          After that, nothing is assigned — claim what you want by voice.
        </p>
      )}

      {!contested && (
        <div className="opening-bundles">
          {bundles.map((bundle) => {
            const cook = cooks.find((c) => c.id === bundle.cookId);
            return (
              <div className={`opening-bundle cook-color-${cookColorKey(cookIndexById[bundle.cookId])}`} key={bundle.cookId}>
                <div className="opening-bundle-head">
                  <span className="cook-avatar cook-avatar-sm">{cook?.name[0]?.toUpperCase()}</span>
                  <div>
                    <div className="schedule-lane-name">{cook?.name}</div>
                    <div className="hint mono">{formatDuration(bundle.totalSec)} to open</div>
                  </div>
                </div>
                <ul className="opening-bundle-list">
                  {bundle.stepIds.map((id) => (
                    <li key={id}>
                      <span className="opening-step-label">{byId[id]?.label}</span>
                      <span className="hint mono">
                        {formatDuration(byId[id]?.estimated_duration_sec || 0)}
                        {dishOf(id) ? ` · ${dishOf(id)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="task-pool">
        <span className="mini-title">
          Unclaimed &middot; {poolIds.length + lockedIds.length} steps
        </span>
        <p className="hint">
          {poolIds.length} ready to claim now, {lockedIds.length} still blocked by other steps.
        </p>
        <div className="task-pool-chips">
          {poolIds.map((id) => (
            <span className="tag" key={id}>
              {byId[id]?.label} &middot; {formatDuration(byId[id]?.estimated_duration_sec || 0)}
            </span>
          ))}
          {lockedIds.map((id) => (
            <span className="tag task-chip-locked" key={id}>
              {byId[id]?.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
