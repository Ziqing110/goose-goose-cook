// "Add a task" — the board panel in add mode. A new step can't close a
// loop — nothing depends on it yet — so every existing step is a legal
// "runs after". The cycle rule only bites when editing an existing
// step's dependencies, which NodeEditorPanel handles.
//
// A step belongs to exactly one dish, so with more than one dish in the
// run the target is picked explicitly rather than guessed.
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { PHASE_OPTIONS, EQUIPMENT_OPTIONS, equipmentLabel } from "../data/dishes.js";
import BoardPanel, { ChoiceChip, LinkPicker, LinkRow, MaterialsField, PanelField, Segmented } from "./BoardPanel.jsx";
import { DIFFICULTY_SEGMENTS } from "./NodeEditorPanel.jsx";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { useVoicePageState } from "../hooks/useVoicePageState.js";
import { useVoiceConfirm } from "../hooks/useVoiceConfirm.js";
import { spokenNumber, spokenMinutes, NUMBER_TOKEN } from "../utils/understanding.js";
import { matchStepName, guessIfNone, stepByNumber, stepRetryRef, STEP_RETRY_PATTERNS } from "../utils/stepNameMatch.js";
import { ADD_STEP_VOICE } from "../utils/pageVoiceGrammar.js";
import "./AddStepPanel.css";

const EQUIPMENT_ARTICLE = { cutting_board: "a", stove_burner: "a", wok: "a", pot: "a", oven: "an" };

export default function AddStepPanel({
  recipes,
  nodes,
  numberOf,
  materialsInfo,
  onRegisterMaterial,
  onAdd,
  onClose,
  initialLabel = "",
  initialDependsOn = [],
  initialRunsBefore = [],
}) {
  const { dispatch } = useAppState();
  const [label, setLabel] = useState(initialLabel);
  const [recipeId, setRecipeId] = useState(recipes[0]?.id || "");
  const [phase, setPhase] = useState("prep");
  // The scheduler reads duration and equipment as fact, so both are
  // asked for here rather than invented and quietly scheduled.
  const [minutes, setMinutes] = useState(2);
  const [difficulty, setDifficulty] = useState("low");
  useVoicePageState(
    [`Adding a task: ${label.trim() ? `"${label.trim()}"` : "no name yet"}, ${minutes} min, ${difficulty} difficulty, ${phase} phase.`],
    { priority: 10 },
  );
  const [equipment, setEquipment] = useState([]);
  // Ingredients are asked for here rather than after the fact: a step
  // saved without them reads as craftable on the board and in the
  // coverage line, which is a claim nobody made.
  const [materials, setMaterials] = useState([]);
  const [materialUsage, setMaterialUsage] = useState({});
  const [dependsOn, setDependsOn] = useState(initialDependsOn);
  // A step can't be both what this waits on and what waits on it — that's
  // a cycle through the very node being created — so picking one side
  // clears the other rather than letting the two lists disagree.
  const [runsBefore, setRunsBefore] = useState(initialRunsBefore);

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const sortedNodes = [...nodes].sort((a, b) => (numberOf?.(a.id) || "").localeCompare(numberOf?.(b.id) || ""));

  const pickDependsOn = (id) => {
    setDependsOn((cur) => toggleIn(cur, id));
    setRunsBefore((cur) => cur.filter((x) => x !== id));
  };
  const pickRunsBefore = (id) => {
    setRunsBefore((cur) => toggleIn(cur, id));
    setDependsOn((cur) => cur.filter((x) => x !== id));
  };
  const pickMaterial = (id) => setMaterials((cur) => (cur.includes(id) ? cur : [...cur, id]));

  // "Runs after boil the noodles" and "add material soy sauce" both
  // resolve a spoken name against a list of candidates that can read a
  // lot alike, same as the live cook claiming a step by voice. A close
  // but not exact guess asks rather than either firing on a guess or
  // flatly giving up on anything short of the step's full name read
  // back verbatim.
  const askConfirm = useVoiceConfirm();
  // Which field ("after" or "before") a step reference just failed to
  // resolve for, so the very next turn can answer with just the number
  // ("the second step") instead of the whole sentence again. Cleared the
  // moment anything resolves it (or fails to a second time) -- one
  // retry, not a standing memory of the last question asked.
  const lastFailedFieldRef = useRef(null);

  const submit = (e) => {
    e?.preventDefault();
    const name = label.trim();
    if (!name || !recipeId) return false;
    onAdd(recipeId, {
      label: name,
      phase,
      dependsOn,
      runsBefore,
      difficulty,
      equipment,
      materials,
      materialUsage,
      durationSec: Math.max(15, Math.round(Number(minutes) * 60) || 0),
    });
    return true;
  };

  // This form only exists because voice or a click opened it, so it has
  // to be finishable by voice too — otherwise a voice-prefilled form
  // still dead-ends at a mouse click. The values read through a ref so
  // the commands don't have to re-register on every keystroke.
  const stateRef = useRef();
  stateRef.current = { label, recipeId, phase, minutes, difficulty, equipment, materials, materialUsage, dependsOn, runsBefore, materialsInfo };
  // Registered once per `nodes` change, so the command closures below must
  // not read `label`/`onAdd`/`onClose` directly — those go stale the
  // moment the effect doesn't re-run. Everything reads through these.
  const actionsRef = useRef();
  actionsRef.current = { onAdd, onClose, onRegisterMaterial };

  useEffect(() => {
    const stepIds = nodes.map((n) => n.id);
    const labelOf = (id) => nodes.find((n) => n.id === id)?.label;

    const commands = [
      {
        phrases: ADD_STEP_VOICE.name,
        run: (m, spoken) => {
          // A name keeps the spelling it was said with: the matcher
          // hands over the capture from the raw transcript, and only
          // falls back to the normalized one if it could not re-match.
          const name = (spoken?.[1] ?? m[1]).trim();
          if (!name) return null;
          setLabel(name);
          return `Called it “${name}.”`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.duration(NUMBER_TOKEN),
        run: (m) => {
          const mins = spokenMinutes(m[1], m[2]);
          if (mins === null) return null;
          setMinutes(mins);
          const said = spokenNumber(m[1]);
          const isSeconds = /^s/i.test(m[2] || "");
          return isSeconds ? `${said} second${said === 1 ? "" : "s"}.` : `${said} minute${said === 1 ? "" : "s"}.`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.difficulty,
        run: (m) => {
          setDifficulty(m[1]);
          return `${m[1]} difficulty.`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.phase,
        run: (m) => {
          setPhase(m[1]);
          return `Phase: ${m[1]}.`;
        },
      },
      ...EQUIPMENT_OPTIONS.flatMap((eq) => {
        const word = equipmentLabel(eq).toLowerCase();
        const a = EQUIPMENT_ARTICLE[eq];
        return [
          {
            phrases: ADD_STEP_VOICE.equipment(word, a).off,
            allowSubject: true, // "I don't need a wok" always names the equipment
            label: `${equipmentLabel(eq)} — not needed.`,
            run: () => setEquipment((cur) => cur.filter((x) => x !== eq)),
          },
          {
            phrases: ADD_STEP_VOICE.equipment(word, a).on,
            allowSubject: true, // "I need a wok" always names the equipment
            label: `${equipmentLabel(eq)} needed.`,
            run: () => setEquipment((cur) => (cur.includes(eq) ? cur : [...cur, eq])),
          },
        ];
      }),
      {
        phrases: ADD_STEP_VOICE.after,
        run: (m) => {
          const said = m[1];
          const match = stepByNumber(said, stepIds, labelOf, numberOf) ?? guessIfNone(matchStepName(said, stepIds, labelOf), labelOf);
          if (match.confidence === "none") {
            lastFailedFieldRef.current = "after";
            return "I couldn't tell which step you meant.";
          }
          lastFailedFieldRef.current = null;
          if (match.confidence === "exact") {
            pickDependsOn(match.stepId);
            return `Runs after “${match.label}.”`;
          }
          askConfirm(() => pickDependsOn(match.stepId));
          return `Runs after “${match.label}”? Say yes or no.`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.before,
        run: (m) => {
          const said = m[1];
          const match = stepByNumber(said, stepIds, labelOf, numberOf) ?? guessIfNone(matchStepName(said, stepIds, labelOf), labelOf);
          if (match.confidence === "none") {
            lastFailedFieldRef.current = "before";
            return "I couldn't tell which step you meant.";
          }
          lastFailedFieldRef.current = null;
          if (match.confidence === "exact") {
            pickRunsBefore(match.stepId);
            return `Unlocks “${match.label}” next.`;
          }
          askConfirm(() => pickRunsBefore(match.stepId));
          return `Unlock “${match.label}” next? Say yes or no.`;
        },
      },
      {
        // Answers a step reference that just failed to resolve, with
        // nothing but the number: "the second step" fails once above,
        // and the very next turn -- even just "2" or "second" alone --
        // finishes it, instead of making someone repeat the whole
        // sentence. Silent (no match at all) unless that just happened,
        // so a bare "second" heard out of nowhere means nothing.
        phrases: STEP_RETRY_PATTERNS,
        run: (m) => {
          const field = lastFailedFieldRef.current;
          if (!field) return null;
          lastFailedFieldRef.current = null;
          const match = stepRetryRef(m[0], stepIds, labelOf, numberOf);
          if (!match || match.confidence !== "exact") return "I still couldn't tell which step you meant.";
          if (field === "after") {
            pickDependsOn(match.stepId);
            return `Runs after “${match.label}.”`;
          }
          pickRunsBefore(match.stepId);
          return `Unlocks “${match.label}” next.`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.material,
        run: (m) => {
          const said = m[1].trim();
          const info = stateRef.current.materialsInfo;
          const materialIds = Object.keys(info || {});
          const materialLabelOf = (id) => info?.[id]?.label;
          const match = matchStepName(said, materialIds, materialLabelOf);
          if (match.confidence === "exact") {
            pickMaterial(match.stepId);
            return `Added “${match.label}.”`;
          }
          // Unlike a step name, a material has no confirm-and-guess tier:
          // real catalogs are full of short names sharing one generic
          // word ("soy sauce" / "fish sauce", "green onion" / "red
          // onion"), so a partial match is as likely to be a different
          // ingredient as the one meant, and a "yes" said without really
          // checking would put the wrong one on the step. Anything short
          // of the full name registers as new instead — harmless even if
          // it was really a near-miss on an existing one, since
          // onRegisterMaterial dedupes by the same slug either way.
          if (!actionsRef.current.onRegisterMaterial) return "I couldn't tell which material you meant.";
          const id = actionsRef.current.onRegisterMaterial({ label: said, unit: "" }, stateRef.current.recipeId);
          if (!id) return "I couldn't tell which material you meant.";
          pickMaterial(id);
          return `Added “${said}” as a new material.`;
        },
      },
      {
        phrases: ADD_STEP_VOICE.submit,
        run: () => {
          const s = stateRef.current;
          const name = s.label.trim();
          if (!name || !s.recipeId) return "This task needs a name first — say “call it” and then the name.";
          actionsRef.current.onAdd(s.recipeId, {
            label: name,
            phase: s.phase,
            dependsOn: s.dependsOn,
            runsBefore: s.runsBefore,
            difficulty: s.difficulty,
            equipment: s.equipment,
            materials: s.materials,
            materialUsage: s.materialUsage,
            durationSec: Math.max(15, Math.round(Number(s.minutes) * 60) || 0),
          });
          return null; // the panel is closing; the page will speak next
        },
      },
      {
        phrases: ADD_STEP_VOICE.cancel,
        run: () => {
          actionsRef.current.onClose();
          return null;
        },
      },
    ];

    return registerVoiceCommands(commands, { priority: 10, exclusive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say “call it toast the sesame seeds”, “two minutes”, “add a wok”, “runs after mince garlic”, “unlock plate the bowls next”, “add material soy sauce”.",
          sub: "Then “add it to the board”, or “cancel”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  return (
    <form className="add-step-form" onSubmit={submit}>
      <BoardPanel
        label="Add a task"
        title="Add a task"
        onClose={onClose}
        footer={
          <div className="add-step-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!label.trim()}>
              Add to the board
            </button>
          </div>
        }
      >
        <PanelField as="label" label="Task">
          <input
            className="panel-input"
            type="text"
            value={label}
            autoFocus
            placeholder="e.g. Toast the sesame seeds"
            onChange={(e) => setLabel(e.target.value)}
          />
        </PanelField>

        {recipes.length > 1 && (
          <PanelField as="label" label="Dish">
            <select className="panel-select" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.working.title}
                </option>
              ))}
            </select>
          </PanelField>
        )}

        <PanelField label="Phase">
          <Segmented label="Phase" options={PHASE_OPTIONS} value={phase} onChange={setPhase} />
        </PanelField>

        <div className="panel-field-row">
          <PanelField as="label" label="Takes">
            <span className="panel-minutes">
              <input
                className="panel-input"
                type="number"
                min="0.25"
                step="0.25"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <span className="panel-minutes-unit">min</span>
            </span>
          </PanelField>
          <PanelField label="Difficulty">
            <Segmented label="Difficulty" options={DIFFICULTY_SEGMENTS} value={difficulty} onChange={setDifficulty} />
          </PanelField>
        </div>

        <PanelField label="Needs">
          <div className="panel-chips">
            {EQUIPMENT_OPTIONS.map((eq) => (
              <ChoiceChip key={eq} on={equipment.includes(eq)} onToggle={() => setEquipment((cur) => toggleIn(cur, eq))}>
                {equipmentLabel(eq)}
              </ChoiceChip>
            ))}
          </div>
        </PanelField>

        <MaterialsField
          materialsInfo={materialsInfo}
          selected={materials}
          amountFor={(m) => materialUsage[m] || { amount: materialsInfo?.[m]?.amount ?? null, unit: materialsInfo?.[m]?.unit || "" }}
          onSetAmount={(m, next) =>
            setMaterialUsage((cur) => ({
              ...cur,
              [m]: { ...(cur[m] || { amount: materialsInfo?.[m]?.amount ?? null, unit: materialsInfo?.[m]?.unit || "" }), ...next },
            }))
          }
          onRemove={(m) => setMaterials((cur) => cur.filter((x) => x !== m))}
          onPick={(m) => setMaterials((cur) => (cur.includes(m) ? cur : [...cur, m]))}
          onRegisterMaterial={onRegisterMaterial && ((draft) => onRegisterMaterial(draft, recipeId))}
        />

        {/* Same pattern as the step editor: what is picked, as chips,
            and a menu for the rest. A new step has no links yet, so the
            only ineligible options are the ones already picked on the
            other side. */}
        <PanelField label="Runs after">
          <LinkRow
            ids={dependsOn}
            allNodes={sortedNodes}
            numberOf={numberOf}
            empty="Nothing, can start right away"
            removeHint="no longer comes before this step"
            onRemove={(id) => pickDependsOn(id)}
          />
          <LinkPicker
            label="+ Add a step that comes before"
            options={sortedNodes.filter((n) => !dependsOn.includes(n.id) && !runsBefore.includes(n.id))}
            numberOf={numberOf}
            onPick={(id) => pickDependsOn(id)}
          />
        </PanelField>

        {/* Picking something here that already runs after one of THIS
            step's own "Runs after" picks is exactly "insert between":
            the redundant direct edge is dropped in favour of routing
            through the new step — addNode (useStepEditing.js) does that
            rewiring, not this form. */}
        <PanelField label="Unlocks next">
          <LinkRow
            ids={runsBefore}
            allNodes={sortedNodes}
            numberOf={numberOf}
            empty="Nothing waits on this yet"
            removeHint="no longer waits on this step"
            onRemove={(id) => pickRunsBefore(id)}
          />
          <LinkPicker
            label="+ Add a step that comes after"
            options={sortedNodes.filter((n) => !dependsOn.includes(n.id) && !runsBefore.includes(n.id))}
            numberOf={numberOf}
            onPick={(id) => pickRunsBefore(id)}
          />
        </PanelField>
      </BoardPanel>
    </form>
  );
}
