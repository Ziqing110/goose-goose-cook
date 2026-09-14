import { useMemo } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import { computeSchedule, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import { cookColorKey } from "../utils/cooks.js";
import "./SchedulePage.css";

function formatMinutes(sec) {
  return Math.round(sec / 60);
}

function pickTickStepMinutes(totalMinutes) {
  const target = totalMinutes / 6;
  const steps = [1, 2, 5, 10, 15, 20, 30];
  return steps.find((s) => s >= target) || steps[steps.length - 1];
}

export default function SchedulePage() {
  const { state, dispatch } = useAppState();
  const { recipes, sharedSteps, cooks, mode } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const schedule = useMemo(
    () => computeSchedule(approved?.nodes || [], cooks, kitchenProfile),
    [approved, cooks, kitchenProfile]
  );

  const byId = Object.fromEntries((approved?.nodes || []).map((n) => [n.id, n]));
  const stepById = Object.fromEntries(schedule.steps.map((s) => [s.id, s]));
  const cookById = Object.fromEntries(cooks.map((c) => [c.id, c]));
  const cookIndexById = Object.fromEntries(cooks.map((c, i) => [c.id, i]));

  const makespanMinutes = formatMinutes(schedule.makespanSec) || 1;
  const tickStep = pickTickStepMinutes(makespanMinutes);
  const ticks = [];
  for (let m = 0; m <= makespanMinutes; m += tickStep) ticks.push(m);

  const setMode = (nextMode) => dispatch({ type: "session/update", payload: { mode: nextMode } });

  // Any gap between a cook's previous block and their next one is idle
  // time — labeled from the next step's startCause (what actually
  // constrained it), not just equipment-caused waits, so a step that's
  // simply waiting on its own dependency chain shows an honest reason too.
  const lanes = cooks.map((cook) => {
    const steps = schedule.steps
      .filter((s) => s.cookId === cook.id)
      .sort((a, b) => a.startSec - b.startSec);
    const blocks = [];
    let prevEnd = 0;
    steps.forEach((s) => {
      if (s.startSec > prevEnd) {
        const cause = s.startCause;
        let label = "Waiting";
        if (cause.type === "equipment") {
          const holderStep = cause.refStepId ? stepById[cause.refStepId] : null;
          const holderCook = holderStep ? cookById[holderStep.cookId] : null;
          label = `Waiting for ${EQUIPMENT_LABELS[cause.equipmentType]}` + (holderCook ? ` — ${holderCook.name} has it` : "");
        } else if (cause.type === "dependency" && cause.refStepId) {
          label = `Waiting on "${byId[cause.refStepId]?.label || cause.refStepId}"`;
        }
        blocks.push({ kind: "wait", startSec: prevEnd, endSec: s.startSec, label });
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

  return (
    <section className="page schedule-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>{approved.title} &middot; approved</h1>
          </div>
        </div>
        <div className="band-header-right">
          <span className="tag mono">Estimated {formatMinutes(schedule.makespanSec)} min</span>
          {schedule.savedSec > 0 && (
            <span className="tag mono tag-difficulty-low">{formatMinutes(schedule.savedSec)} min faster than solo</span>
          )}
          {lanes.map(({ cook, steps }) => (
            <span className={`tag mono cook-color-${cookColorKey(cookIndexById[cook.id])}`} key={cook.id}>
              {cook.name} &middot; {steps.length} steps
            </span>
          ))}
        </div>
      </div>

      <div className="card schedule-card">
        <div className="schedule-card-head">
          <span className="mini-title">Who does what, when</span>
          <div className="schedule-legend">
            <span className="legend-item"><span className="legend-swatch legend-critical" /> Critical path</span>
            <span className="legend-item"><span className="legend-swatch legend-wait" /> Waiting</span>
          </div>
        </div>

        <div className="schedule-ruler">
          <div className="schedule-ruler-label-spacer" />
          <div className="schedule-ruler-track">
            {ticks.map((m) => (
              <span className="schedule-tick mono" key={m} style={{ left: `${(m / makespanMinutes) * 100}%` }}>
                {m}&prime;
              </span>
            ))}
          </div>
        </div>

        {lanes.map(({ cook, blocks, busySec }) => (
          <div className="schedule-lane" key={cook.id}>
            <div className="schedule-lane-label">
              <span className={`cook-avatar cook-avatar-sm cook-color-${cookColorKey(cookIndexById[cook.id])}`}>
                {cook.name[0]?.toUpperCase()}
              </span>
              <div>
                <div className="schedule-lane-name">{cook.name}</div>
                <div className="hint mono">{formatMinutes(busySec)} min busy</div>
              </div>
            </div>
            <div className="schedule-lane-track">
              {blocks.map((b, i) =>
                b.kind === "wait" ? (
                  <div
                    className="schedule-block schedule-block-wait"
                    key={`wait-${i}`}
                    style={{
                      left: `${(b.startSec / schedule.makespanSec) * 100}%`,
                      width: `${((b.endSec - b.startSec) / schedule.makespanSec) * 100}%`,
                    }}
                    title={b.label}
                  >
                    <span className="schedule-block-label">{b.label}</span>
                  </div>
                ) : (
                  <div
                    className={`schedule-block schedule-block-task cook-color-${cookColorKey(cookIndexById[cook.id])} ${
                      schedule.criticalStepIds.has(b.step.id) ? "is-critical" : ""
                    }`}
                    key={b.step.id}
                    style={{
                      left: `${(b.step.startSec / schedule.makespanSec) * 100}%`,
                      width: `${((b.step.endSec - b.step.startSec) / schedule.makespanSec) * 100}%`,
                    }}
                    title={b.node?.label}
                  >
                    <span className="schedule-block-label">{b.node?.label}</span>
                    <span className="schedule-block-meta mono">
                      {formatMinutes(b.step.endSec - b.step.startSec)}:00
                      {b.step.requiredEquipment.length > 0 && ` · ${EQUIPMENT_LABELS[b.step.requiredEquipment[0]]}`}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        ))}

        <p className="hint schedule-gap-note">
          Every step needs a cook&rsquo;s full attention in this version — hands-off steps like a rice cooker
          aren&rsquo;t modeled yet.
        </p>
      </div>

      <div className="card mode-select-card">
        <div className="mode-cards">
          <button
            type="button"
            className={`mode-card ${mode === "cooperation" ? "is-selected" : ""}`}
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
            onClick={() => setMode("competition")}
          >
            <div className="mode-card-head">
              <span className="mini-title">Competition</span>
              {mode === "competition" && <span className="tag tag-difficulty-low">Selected</span>}
            </div>
            <p className="hint">No assignments. Claim tasks by voice. Score on difficulty and performance. Leaderboard at the end.</p>
          </button>
        </div>
      </div>

      <div className="band-footer">
        <div className="band-footer-left">
          <span className="hint">{mode ? `Mode: ${mode}` : "Pick a mode to continue"}</span>
        </div>
        <div className="band-footer-right">
          <button className="btn btn-primary btn-lg" disabled title="Coming soon">
            Start cooking &rarr;
          </button>
        </div>
      </div>
    </section>
  );
}
