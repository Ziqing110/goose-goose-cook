// Schedule — session step 6 of 7, the game plan before going live
// (design/claude-design-schedule-prompt.md, "Kitchen Path - Schedule").
// The player's job, in order: pick a mode, read the plan the agent made
// for it, go live. Nothing here is authored by hand — the plan is
// computed by utils/scheduleLayout.js from the approved main line, the
// two players and the kitchen; this page only renders it. Mode is
// session state (persisted through the debounced sync); the run is
// written straight through saveRunNow.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { createRun, runProgress } from "../utils/liveCook.js";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import { computeSchedule, computeOpeningAssignment, missingEquipment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import { formatClock } from "../utils/inventory.js";
import KpIcon from "../components/KpIcon.jsx";
import Modal from "../components/Modal.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import "./SchedulePage.css";

// Player colors come from the index in cooks[] — player 1 is "a",
// player 2 is "b" — never stored, never chosen (design-v4.css tokens).
const PLAYER_KEYS = ["a", "b"];
const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

// Zoom is a three-stop slider (Fit · 1× · 2×), no pixel readout. "Fit"
// is the real thing — measured from the track's width so the whole plan
// is on screen — while 1× and 2× are the design's fixed densities.
const ZOOM_STOPS = ["Fit", "1×", "2×"];
const ZOOM_PX_PER_MIN = { "1×": 78, "2×": 108 };
const FIT_FALLBACK_PX_PER_MIN = 56;
// On a phone a true fit is ~7px/min — every block a bare sliver — so
// "Fit" bottoms out here and scrolls a little instead.
const FIT_MIN_PX_PER_MIN = 16;
const TRACK_END_PADDING = 24;

// Whole-minute ruler ticks, stepped up until the labels can't collide.
const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30];
const TICK_MIN_PX = 56;

// A block shows as much as it can without clipping a word into
// nonsense ("Cut tof…"): name + meta → name → duration → bare bar.
const RUNG_FULL_PX = 130;
const RUNG_NAME_PX = 76;
const RUNG_DURATION_PX = 48;
const RUNG_WAIT_PX = 88;
// Rough glyph width at the 13px block font, used to cut labels at a
// word boundary instead of letting CSS leave "Dice oni…".
const LABEL_PX_PER_CHAR = 6.6;
const BLOCK_TEXT_INSET_PX = 18;

// The longest run of whole words that fits `widthPx`; the first word
// (ellipsized by CSS) if none do.
function fitLabel(label, widthPx) {
  const words = (label || "").split(" ");
  const fits = (text) => text.length * LABEL_PX_PER_CHAR <= widthPx - BLOCK_TEXT_INSET_PX;
  let out = words[0] || "";
  for (let i = 1; i < words.length; i++) {
    const next = `${out} ${words[i]}`;
    if (!fits(next + "…") && !(i === words.length - 1 && fits(next))) break;
    out = next;
  }
  return out === label ? label : `${out}…`;
}

const DIFFICULTY_FLAMES = { low: 1, medium: 2, high: 3 };

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const equipmentLabel = (type) => capitalize(EQUIPMENT_LABELS[type] || type);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Mono({ children, className = "" }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

function PlayerAvatar({ cook, index, size = 32 }) {
  return (
    <span className={`sch-avatar is-${playerKey(index)} sch-avatar-${size}`} aria-hidden="true">
      {cook?.name?.[0]?.toUpperCase() || "?"}
    </span>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default function SchedulePage() {
  const { state, dispatch, saveRunNow, editKitchenProfile } = useAppState();
  const navigate = useNavigate();
  const { recipes, sharedSteps, cooks, mode, run } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;

  // 1× by default: "Fit" squeezes a 40-minute plan into bare slivers.
  const [zoom, setZoom] = useState("1×");
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [editingKitchen, setEditingKitchen] = useState(false);
  const [kitchenError, setKitchenError] = useState(null);

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const nodes = useMemo(() => approved?.nodes || [], [approved]);
  const schedule = useMemo(() => computeSchedule(nodes, cooks, kitchenProfile), [nodes, cooks, kitchenProfile]);
  const opening = useMemo(() => computeOpeningAssignment(nodes, cooks, kitchenProfile), [nodes, cooks, kitchenProfile]);
  const lacking = useMemo(() => missingEquipment(nodes, kitchenProfile), [nodes, kitchenProfile]);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const stepById = useMemo(() => Object.fromEntries(schedule.steps.map((s) => [s.id, s])), [schedule]);
  const cookById = Object.fromEntries(cooks.map((c) => [c.id, c]));
  const cookIndexById = Object.fromEntries(cooks.map((c, i) => [c.id, i]));
  const dishOf = (nodeId) => {
    const node = byId[nodeId];
    if (!node) return null;
    if (node._shared) return "Shared";
    return recipes.find((r) => r.id === node._recipeId)?.working.title || null;
  };

  const finish = formatClock(schedule.makespanSec);
  const isCoop = mode === "cooperation";
  const isVersus = mode === "competition";
  const hasLoop = schedule.unscheduledIds.length > 0;
  const canStart = Boolean(mode) && !hasLoop;

  const grabsCount = opening.poolIds.length + opening.lockedIds.length;
  useEffect(() => {
    if (!approved) return undefined;
    const sub = isCoop
      ? `Plan's ready — ${finish} with ${cooks.length} players.`
      : isVersus
        ? `${grabsCount} steps up for grabs — first to claim wins.`
        : "Pick a mode and I'll deal the plan.";
    dispatch({
      type: "voice/setHint",
      payload: { hint: { line: "Say “co-op” or “versus”, then “go live”.", sub } },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, approved, finish, cooks.length, isCoop, isVersus, grabsCount]);

  // Mode is snapshotted into the run, so changing it mid-cook would
  // desync what's already happened — the cards lock once a run exists.
  const setMode = (nextMode) => {
    if (run) return;
    dispatch({ type: "session/update", payload: { mode: nextMode } });
  };

  const goLive = () => {
    // schedule/opening are already memoized above — no extra solver run.
    saveRunNow(createRun({ nodes, mode, schedule, opening, now: new Date() }));
    navigate("/session/live-cook");
  };
  const abandonRun = () => {
    saveRunNow(null);
    setConfirmAbandon(false);
  };
  const saveKitchen = async (draft) => {
    setKitchenError(null);
    try {
      await editKitchenProfile(kitchenProfile.id, draft);
      setEditingKitchen(false);
    } catch (err) {
      setKitchenError(err.message);
    }
  };

  // Any gap between a player's previous block and their next one is a
  // wait — labeled from the next step's startCause (what actually held
  // it), so a step waiting on its own dependency chain says so too.
  const waitLabelFor = (cause) => {
    if (cause.type === "equipment") {
      const holderStep = cause.refStepId ? stepById[cause.refStepId] : null;
      const holderCook = holderStep ? cookById[holderStep.cookId] : null;
      return `Waiting · ${EQUIPMENT_LABELS[cause.equipmentType] || cause.equipmentType}` + (holderCook ? ` — ${holderCook.name} has it` : "");
    }
    if (cause.type === "dependency" && cause.refStepId) {
      return `Waiting on “${byId[cause.refStepId]?.label || cause.refStepId}”`;
    }
    return "Waiting";
  };

  const lanes = cooks.map((cook, index) => {
    const steps = schedule.steps.filter((s) => s.cookId === cook.id).sort((a, b) => a.startSec - b.startSec);
    const blocks = [];
    let prevEnd = 0;
    steps.forEach((s) => {
      if (s.startSec > prevEnd) {
        blocks.push({ kind: "wait", id: `wait-${s.id}`, startSec: prevEnd, endSec: s.startSec, label: waitLabelFor(s.startCause) });
      }
      blocks.push({ kind: "task", id: s.id, startSec: s.startSec, endSec: s.endSec, step: s, node: byId[s.id] });
      prevEnd = s.endSec;
    });
    return { cook, index, steps, blocks, busySec: steps.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) };
  });

  const progress = run ? runProgress(run, nodes, Date.now()) : null;

  if (!approved) {
    return (
      <section className="page schedule-page">
        <header className="sch-title-row">
          <h1>Schedule</h1>
          <span className="sch-meta is-tertiary">
            Building your plan<Mono className="sch-dots">…</Mono>
          </span>
        </header>
      </section>
    );
  }

  const selectedStep = selectedStepId ? stepById[selectedStepId] : null;
  const selectedNode = selectedStepId ? byId[selectedStepId] : null;
  const selected =
    selectedStep && selectedNode
      ? {
          step: selectedStep,
          node: selectedNode,
          dish: dishOf(selectedStep.id),
          cook: cookById[selectedStep.cookId],
          cookIndex: cookIndexById[selectedStep.cookId],
          isCritical: schedule.criticalStepIds.has(selectedStep.id),
          waitLabel: selectedStep.startSec > selectedStep.dependsReadySec ? waitLabelFor(selectedStep.startCause) : null,
        }
      : null;

  const metaBits = [approved.title];
  if (approved.servings != null) metaBits.push(<><Mono>{approved.servings}</Mono> servings</>);
  metaBits.push(<><Mono>{nodes.length}</Mono> steps</>);
  if (kitchenProfile?.name) metaBits.push(kitchenProfile.name);

  return (
    <section className="page schedule-page">
      <header className="sch-title-row">
        <h1>Schedule</h1>
        <span className="sch-meta">
          {metaBits.map((bit, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {bit}
            </span>
          ))}
        </span>
      </header>

      {/* ---- Mode picker — first, because everything below changes with it ---- */}
      <div className="sch-modes-wrap">
        <div className="sch-modes" role="radiogroup" aria-label="Mode">
          <ModeCard
            glyph="fork-branch"
            title="Co-op"
            body="Follow the agent's assignment. Every “done” re-plans the rest. Goal: fastest dinner."
            selected={isCoop}
            locked={Boolean(run)}
            onSelect={() => setMode("cooperation")}
          />
          <ModeCard
            glyph="trophy"
            title="Versus"
            body="Only the opening hand is dealt. Claim the rest by voice. Score on difficulty."
            selected={isVersus}
            locked={Boolean(run)}
            onSelect={() => setMode("competition")}
          />
        </div>
        {run && <span className="sch-meta">Mode is locked while a cook is in progress.</span>}
      </div>

      {mode && (
        <>
          {/* ---- Plan HUD ---- */}
          <div className="sch-hud">
            <div className="sch-tiles">
              {isCoop ? (
                <>
                  <div className="sch-tile sch-roll">
                    <span className="sch-tile-value-row">
                      <KpIcon glyph="timer" size={20} />
                      <Mono className="sch-tile-value">{finish}</Mono>
                    </span>
                    <span className="sch-tile-label">finish in</span>
                  </div>
                  {schedule.savedSec > 0 && (
                    <div className="sch-tile sch-roll" style={{ animationDelay: "60ms" }}>
                      <Mono className="sch-tile-value">{formatClock(schedule.savedSec)}</Mono>
                      <span className="sch-tile-label">faster than solo</span>
                    </div>
                  )}
                  <div className="sch-tile sch-roll" style={{ animationDelay: "120ms" }}>
                    <Mono className="sch-tile-value">{schedule.steps.length}</Mono>
                    <span className="sch-tile-label">steps</span>
                  </div>
                </>
              ) : (
                <div className="sch-tile sch-roll">
                  <Mono className="sch-tile-value">{opening.poolIds.length + opening.lockedIds.length}</Mono>
                  <span className="sch-tile-label">steps up for grabs</span>
                </div>
              )}
            </div>
            <div className="sch-player-chips">
              {lanes.map(({ cook, index, steps, busySec }) => {
                const bundle = opening.bundles.find((b) => b.cookId === cook.id);
                return (
                  <span className="sch-player-chip" key={cook.id}>
                    <PlayerAvatar cook={cook} index={index} size={20} />
                    <span className="sch-player-chip-name">{cook.name}</span>
                    <Mono className="sch-player-chip-meta">
                      {isCoop ? (
                        <>
                          {steps.length}
                          <span className="sch-long"> steps</span> · {formatClock(busySec)}
                        </>
                      ) : (
                        <>{formatClock(bundle?.totalSec || 0)} to open</>
                      )}
                    </Mono>
                  </span>
                );
              })}
            </div>
          </div>

          {/* ---- Warnings ---- */}
          {lacking.length > 0 && (
            <div className="sch-notice is-warning" role="status">
              <span>
                Planned with {lacking.map((e) => `a ${EQUIPMENT_LABELS[e] || e}`).join(" and ")} {kitchenProfile?.name || "this kitchen"} doesn&rsquo;t
                have — timings assume you&rsquo;ll manage one. Real waits will be longer.
              </span>
              {kitchenProfile && (
                <button type="button" className="btn btn-ghost sch-notice-btn" onClick={() => setEditingKitchen(true)}>
                  Edit kitchen
                </button>
              )}
            </div>
          )}
          {hasLoop && (
            <div className="sch-notice is-error" role="alert">
              <span>
                <Mono>{schedule.unscheduledIds.length}</Mono> steps depend on each other in a loop — there&rsquo;s no order that works. Break the
                loop on the recipe graph: {schedule.unscheduledIds.map((id) => byId[id]?.label || id).join(", ")}.
              </span>
              <button type="button" className="btn sch-notice-btn" onClick={() => navigate("/session/inventory")}>
                Back to the recipe graph
              </button>
            </div>
          )}

          {/* ---- The plan ---- */}
          {isCoop ? (
            <Timeline
              lanes={lanes}
              makespanSec={schedule.makespanSec}
              criticalStepIds={schedule.criticalStepIds}
              zoom={zoom}
              onZoom={setZoom}
              selectedStepId={selectedStepId}
              onSelect={(id) => setSelectedStepId((cur) => (cur === id ? null : id))}
              selected={selected}
              onClose={() => setSelectedStepId(null)}
            />
          ) : (
            <OpeningHand opening={opening} cooks={cooks} byId={byId} dishOf={dishOf} />
          )}
        </>
      )}

      {/* ---- Footer band ---- */}
      <div className="sch-footer">
        {mode ? (
          <Mono className="sch-footer-tag">
            {isCoop ? `Co-op · finish in ${finish}` : `Versus · ${opening.poolIds.length + opening.lockedIds.length} steps to claim`}
          </Mono>
        ) : (
          <span className="sch-footer-hint">Pick Co-op or Versus to go live.</span>
        )}
        <div className="sch-footer-actions">
          {run && (
            <button type="button" className="btn btn-ghost sch-btn-abandon" onClick={() => setConfirmAbandon(true)}>
              Abandon this cook
            </button>
          )}
          {run ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate("/session/live-cook")}>
              Back to the cook &rarr;
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" disabled={!canStart} onClick={goLive}>
              Go live &rarr;
            </button>
          )}
        </div>
      </div>

      {confirmAbandon && progress && (
        <Modal label="Abandon this cook?" onClose={() => setConfirmAbandon(false)} panelClassName="sch-modal">
          <span className="sch-modal-title">Abandon this cook?</span>
          <p className="sch-modal-body">
            You lose <Mono className="sch-modal-num">{progress.done}</Mono> completed {progress.done === 1 ? "step" : "steps"} and{" "}
            <Mono className="sch-modal-num">{formatClock(progress.elapsedSec)}</Mono> on the clock. This can&rsquo;t be undone.
          </p>
          <div className="sch-modal-actions">
            <button type="button" className="btn btn-ghost sch-btn-keep" onClick={() => setConfirmAbandon(false)}>
              Keep cooking
            </button>
            <button type="button" className="btn sch-btn-danger" onClick={abandonRun}>
              Abandon
            </button>
          </div>
        </Modal>
      )}

      {editingKitchen && kitchenProfile && (
        <KitchenProfileFormModal
          profile={kitchenProfile}
          error={kitchenError}
          onSave={saveKitchen}
          onClose={() => {
            setEditingKitchen(false);
            setKitchenError(null);
          }}
        />
      )}
    </section>
  );
}

function ModeCard({ glyph, title, body, selected, locked, onSelect }) {
  // The radio is named by its title alone; the body is its description
  // and the "Selected" chip is decorative (aria-checked already says so).
  const bodyId = `sch-mode-body-${title.toLowerCase().replace(/[^a-z]/g, "")}`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={title}
      aria-describedby={bodyId}
      className={`sch-mode ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
      disabled={locked}
      onClick={onSelect}
    >
      {selected && (
        <span className="sch-mode-chip" aria-hidden="true">
          <KpIcon glyph="checkmark-burst" size={16} />
          <span className="sch-mode-chip-text">Selected</span>
        </span>
      )}
      <KpIcon glyph={glyph} size={24} className="sch-mode-glyph" />
      <span className="sch-mode-title">{title}</span>
      <span className="sch-mode-body" id={bodyId}>
        {body}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------
// Co-op → timeline ("Who does what, when")
// ---------------------------------------------------------------

function pickTickStepMinutes(pxPerMin) {
  return TICK_STEPS_MIN.find((s) => s * pxPerMin >= TICK_MIN_PX) || TICK_STEPS_MIN[TICK_STEPS_MIN.length - 1];
}

function Timeline({ lanes, makespanSec, criticalStepIds, zoom, onZoom, selectedStepId, onSelect, selected, onClose }) {
  const scrollRef = useRef(null);
  const [fitPxPerMin, setFitPxPerMin] = useState(FIT_FALLBACK_PX_PER_MIN);
  const makespanMin = Math.max(makespanSec / 60, 1);

  // "Fit" means the whole plan is visible: measure the scroll container
  // and size the track to it (re-measured on resize).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.clientWidth - TRACK_END_PADDING;
      if (width > 0) setFitPxPerMin(Math.max(FIT_MIN_PX_PER_MIN, width / makespanMin));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [makespanMin]);

  const pxPerMin = zoom === "Fit" ? fitPxPerMin : ZOOM_PX_PER_MIN[zoom];
  const pxFor = (sec) => (sec / 60) * pxPerMin;
  const trackWidth = Math.round(pxFor(makespanSec)) + TRACK_END_PADDING;
  const tickStep = pickTickStepMinutes(pxPerMin);
  const ticks = [];
  // The last regular tick stays clear of the end label.
  for (let m = 0; m * 60 <= makespanSec - tickStep * 30; m += tickStep) ticks.push(m);

  const isMobile = useMediaQuery("(max-width: 720px)");

  return (
    <div className="sch-card">
      <div className="sch-card-head">
        <span className="sch-card-title">Who does what, when</span>
        <div className="sch-card-tools">
          <span className="sch-legend">
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-critical" /> Critical path
            </span>
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-wait" /> Waiting
            </span>
          </span>
          <span className="sch-zoom">
            <span className={`mono sch-zoom-stop ${zoom === "Fit" ? "is-on" : ""}`}>Fit</span>
            <input
              type="range"
              className="sch-zoom-slider"
              min={0}
              max={ZOOM_STOPS.length - 1}
              step={1}
              value={ZOOM_STOPS.indexOf(zoom)}
              onChange={(e) => onZoom(ZOOM_STOPS[Number(e.target.value)])}
              aria-label="Timeline zoom"
              aria-valuetext={zoom}
            />
            <span className={`mono sch-zoom-stop ${zoom === "1×" ? "is-on" : ""}`}>1×</span>
            <span className={`mono sch-zoom-stop ${zoom === "2×" ? "is-on" : ""}`}>2×</span>
          </span>
        </div>
      </div>

      <div className="sch-track-wrap">
        <div className="sch-lane-labels">
          <div className="sch-ruler-spacer" />
          {lanes.map(({ cook, index, busySec }) => (
            <div className={`sch-lane-label is-${playerKey(index)}`} key={cook.id}>
              <PlayerAvatar cook={cook} index={index} size={32} />
              <span className="sch-lane-label-text">
                <span className="sch-lane-name">{cook.name}</span>
                <Mono className="sch-lane-busy">
                  {formatClock(busySec)}
                  <span className="sch-long"> busy</span>
                </Mono>
              </span>
            </div>
          ))}
        </div>

        <div className="sch-scroll" ref={scrollRef}>
          <div className="sch-track" style={{ minWidth: trackWidth, "--sch-grid": `${Math.round(5 * pxPerMin)}px` }}>
            <div className="sch-ruler">
              {ticks.map((m) => (
                <span className="mono sch-tick" key={m} style={{ left: Math.round(pxFor(m * 60)) }}>
                  {formatClock(m * 60)}
                </span>
              ))}
              <span className="mono sch-tick is-end" style={{ left: Math.round(pxFor(makespanSec)) }}>
                {formatClock(makespanSec)}
              </span>
            </div>

            {lanes.map(({ cook, index, blocks }) => (
              <div className={`sch-lane is-${playerKey(index)}`} key={cook.id}>
                {blocks.map((b, i) => {
                  const left = Math.round(pxFor(b.startSec));
                  const width = Math.max(10, Math.round(pxFor(b.endSec - b.startSec)) - 3);
                  const durationSec = b.endSec - b.startSec;
                  const delay = `${i * 40}ms`;
                  const style = { left, width, animationDelay: delay };
                  if (b.kind === "wait") {
                    return (
                      <div
                        className={`sch-block is-wait ${width < 96 ? "is-narrow" : ""}`}
                        key={b.id}
                        style={style}
                        title={b.label}
                        role="img"
                        aria-label={`${b.label} · ${formatClock(durationSec)}`}
                      >
                        {width >= RUNG_WAIT_PX && <span className="sch-block-label">{b.label}</span>}
                      </div>
                    );
                  }
                  const rung = width >= RUNG_FULL_PX ? "full" : width >= RUNG_NAME_PX ? "name" : width >= RUNG_DURATION_PX ? "dur" : "bare";
                  const isCritical = criticalStepIds.has(b.id);
                  const equipment = b.step.requiredEquipment[0];
                  return (
                    <button
                      type="button"
                      className={`sch-block is-task is-${playerKey(index)} ${isCritical ? "is-critical" : ""} ${
                        selectedStepId === b.id ? "is-selected" : ""
                      } ${width < 96 ? "is-narrow" : ""} ${width < 64 ? "is-tight" : ""}`}
                      key={b.id}
                      style={style}
                      title={`${b.node?.label} · ${formatClock(durationSec)}`}
                      aria-label={`${b.node?.label} · ${formatClock(durationSec)}`}
                      aria-pressed={selectedStepId === b.id}
                      onClick={() => onSelect(b.id)}
                    >
                      {(rung === "full" || rung === "name") && <span className="sch-block-label">{fitLabel(b.node?.label, width)}</span>}
                      {rung === "full" && (
                        <Mono className="sch-block-meta">
                          {formatClock(durationSec)}
                          {equipment && ` · ${equipmentLabel(equipment)}`}
                        </Mono>
                      )}
                      {rung === "dur" && <Mono className="sch-block-meta">{formatClock(durationSec)}</Mono>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sch-card-foot">
        {selected && !isMobile ? (
          <TaskDetail {...selected} onClose={onClose} scrollIntoView />
        ) : (
          <span className="sch-meta">Tap any task for its exact timing.</span>
        )}
        {/* On a phone the panel is a bottom sheet, portaled past .page's
            transform so `position: fixed` is measured from the viewport. */}
        {selected && isMobile && createPortal(<TaskDetail {...selected} sheet onClose={onClose} />, document.body)}
      </div>
    </div>
  );
}

function TaskDetail({ step, node, dish, cook, cookIndex, isCritical, waitLabel, sheet = false, scrollIntoView = false, onClose }) {
  const flames = DIFFICULTY_FLAMES[node.difficulty] || 1;
  const durationSec = step.endSec - step.startSec;
  const rootRef = useRef(null);
  const closeRef = useRef(null);

  // Inline panel: it lives below the timeline, under the sticky footer
  // at most viewport heights, so bring it up when the selection changes
  // (scroll-margin-bottom in CSS clears the footer + VoiceBar).
  useEffect(() => {
    if (scrollIntoView) rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollIntoView, step.id]);

  // Sheet: behaves like a dialog — focus lands on Close, Esc dismisses.
  useEffect(() => {
    if (!sheet) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, onClose]);

  const panel = (
    <div ref={rootRef} className={`sch-detail ${sheet ? "is-sheet" : ""}`} role={sheet ? "dialog" : undefined} aria-modal={sheet || undefined} aria-label={node.label}>
      {sheet && <span className="sch-sheet-handle" aria-hidden="true" />}
      <button ref={closeRef} type="button" className="btn btn-ghost sch-detail-close" onClick={onClose}>
        Close
      </button>
      <div className="sch-detail-head">
        <span className="sch-eyebrow">{dish || "Step"}</span>
        <span className="sch-detail-title">{node.label}</span>
        {node.description && <span className="sch-detail-desc">{node.description}</span>}
      </div>
      <div className="sch-detail-grid">
        <div>
          <span className="sch-eyebrow">Starts</span>
          <Mono className="sch-detail-value">{formatClock(step.startSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Ends</span>
          <Mono className="sch-detail-value">{formatClock(step.endSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Takes</span>
          <Mono className="sch-detail-value">{formatClock(durationSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Player</span>
          <span className="sch-detail-player">
            <PlayerAvatar cook={cook} index={cookIndex} size={24} />
            <span>{cook?.name || "—"}</span>
          </span>
        </div>
        <div>
          <span className="sch-eyebrow">Equipment</span>
          <span className="sch-detail-text">
            {step.requiredEquipment.length ? step.requiredEquipment.map(equipmentLabel).join(", ") : "None"}
          </span>
        </div>
        <div>
          <span className="sch-eyebrow">Difficulty</span>
          <span className="sch-difficulty" aria-label={`${node.difficulty} difficulty`}>
            {Array.from({ length: flames }, (_, i) => (
              <KpIcon glyph="flame" size={16} key={i} />
            ))}
          </span>
        </div>
      </div>
      {waitLabel && <span className="sch-detail-note is-warning">&#9888; {waitLabel}</span>}
      {isCritical && <span className="sch-detail-note is-critical">On the critical path — if this runs late, dinner runs late.</span>}
    </div>
  );
  if (!sheet) return panel;
  return (
    <>
      <div className="sch-sheet-scrim" onClick={onClose} aria-hidden="true" />
      {panel}
    </>
  );
}

// ---------------------------------------------------------------
// Versus → opening hand
// ---------------------------------------------------------------

function OpeningHand({ opening, cooks, byId, dishOf }) {
  const { bundles, poolIds, lockedIds, contested, skewSec } = opening;
  const durationOf = (id) => byId[id]?.estimated_duration_sec || 0;
  const grabsTotalSec = [...poolIds, ...lockedIds].reduce((sum, id) => sum + durationOf(id), 0);

  return (
    <div className="sch-card sch-card-versus">
      <div className="sch-card-head">
        <span className="sch-card-title">Opening hand</span>
        {!contested && skewSec > 0 && <Mono className="sch-card-meta">{formatClock(skewSec)} apart at the start</Mono>}
      </div>

      {contested ? (
        <div className="sch-notice is-warning sch-notice-inset" role="status">
          <span>
            Only {plural(poolIds.length, "task")} can start right now — not enough to deal everyone their own. First to claim it by voice
            gets it.
          </span>
        </div>
      ) : (
        <>
          <span className="sch-meta sch-intro">
            Everyone opens with a roughly equal chunk of work, and no two opening tasks fight over the same tool. After that, nothing is
            assigned — claim by voice.
          </span>
          <div className="sch-bundles">
            {bundles.map((bundle) => {
              const index = cooks.findIndex((c) => c.id === bundle.cookId);
              const cook = cooks[index];
              return (
                <div className={`sch-bundle is-${playerKey(index)}`} key={bundle.cookId}>
                  <div className="sch-bundle-head">
                    <PlayerAvatar cook={cook} index={index} size={32} />
                    <span className="sch-bundle-name">{cook?.name}</span>
                    <Mono className="sch-bundle-total">{formatClock(bundle.totalSec)} to open</Mono>
                  </div>
                  {bundle.stepIds.map((id) => (
                    <div className="sch-bundle-row" key={id}>
                      <span className="sch-bundle-row-main">
                        <span className="sch-bundle-row-label">{byId[id]?.label}</span>
                        {dishOf(id) && <span className="sch-bundle-row-dish">{dishOf(id)}</span>}
                      </span>
                      <Mono className="sch-bundle-row-dur">{formatClock(durationOf(id))}</Mono>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="sch-grabs">
        <div className="sch-grabs-head">
          <span className="sch-card-title">
            Up for grabs · <Mono className="sch-grabs-total">{formatClock(grabsTotalSec)}</Mono>
          </span>
          <span className="sch-meta">
            {poolIds.length} ready now · {lockedIds.length} not yet · claim by voice
          </span>
        </div>
        <div className="sch-grabs-group">
          <span className="sch-eyebrow is-ready">
            <span className="sch-dot" /> Ready now · {poolIds.length}
          </span>
          <div className="sch-chips">
            {poolIds.map((id) => (
              <span className="sch-chip is-ready" key={id}>
                {byId[id]?.label}
                <Mono className="sch-chip-dur">{formatClock(durationOf(id))}</Mono>
              </span>
            ))}
          </div>
        </div>
        {lockedIds.length > 0 && (
          <div className="sch-grabs-group">
            <span className="sch-eyebrow is-locked">
              <span className="sch-dot" /> Not yet · {lockedIds.length}
            </span>
            <div className="sch-chips">
              {lockedIds.map((id) => (
                <span className="sch-chip is-locked" key={id}>
                  {byId[id]?.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
