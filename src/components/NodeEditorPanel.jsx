import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { EQUIPMENT_OPTIONS, DIFFICULTY_OPTIONS, PHASE_OPTIONS, equipmentLabel } from "../data/dishes.js";
import BoardPanel, { ChoiceChip, LinkPicker, LinkRow, MaterialsField, PanelField, Segmented } from "./BoardPanel.jsx";
import { childrenOf, eligibleParents, eligibleChildren } from "../utils/boardLinks.js";
import { stepMaterialAmount } from "../utils/materialAmounts.js";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { spokenNumber, NUMBER_TOKEN } from "../utils/understanding.js";
import { matchStepName } from "../utils/stepNameMatch.js";
import { EDIT_STEP_VOICE } from "../utils/pageVoiceGrammar.js";
import "./NodeEditorPanel.css";

export const DIFFICULTY_SEGMENTS = DIFFICULTY_OPTIONS.map((d) => ({
  value: d,
  label: { low: "Low", medium: "Med", high: "High" }[d] || d,
}));

const EQUIPMENT_ARTICLE = { cutting_board: "a", stove_burner: "a", wok: "a", pot: "a", oven: "an" };

// Edits are staged locally and only committed to the graph when Save
// is clicked — closing the panel just discards the draft. Adding a
// brand-new material is the one exception: it registers immediately on
// the recipe (via onRegisterMaterial) so it's available to every other
// step too, but still only turns on for *this* step once Saved.
export default function NodeEditorPanel({
  node,
  allNodes,
  numberOf,
  onSave,
  onDelete,
  onClose,
  materialsInfo,
  onRegisterMaterial,
  blockedDependencyIds,
}) {
  const { dispatch } = useAppState();
  const [draft, setDraft] = useState(node);
  // The steps that wait on this one. Held apart from the draft because
  // it is not a property of this step — saving it rewrites THEIR
  // depends_on. Seeded from the graph when the panel opens.
  const [before, setBefore] = useState(() => childrenOf(allNodes, node.id));
  // Which materials were already on the step when it opened: those rows
  // read as part of the step, the ones added since as pending.
  const [originalMaterials] = useState(() => new Set(node.required_materials || []));

  // Keyed on node.id deliberately, NOT on node. Re-seeding the draft
  // whenever the node object changes identity would discard whatever the
  // person has typed the moment anything upstream re-renders. Switching
  // to a different step is the only time the draft should be replaced.
  useEffect(() => {
    setDraft(node);
    setBefore(childrenOf(allNodes, node.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // An arrow drawn on the board while this panel is open is about this
  // step too: without this the panel would save the links as they stood
  // when it opened and quietly undo the drag.
  const graphDeps = (node.depends_on || []).join("|");
  const graphChildren = childrenOf(allNodes, node.id).join("|");
  useEffect(() => {
    setDraft((d) => (d.depends_on.join("|") === graphDeps ? d : { ...d, depends_on: node.depends_on || [] }));
    setBefore((b) => (b.join("|") === graphChildren ? b : childrenOf(allNodes, node.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphDeps, graphChildren]);

  const others = allNodes
    .filter((n) => n.id !== node.id)
    .sort((a, b) => (numberOf?.(a.id) || "").localeCompare(numberOf?.(b.id) || ""));

  const patch = (patchFn) => {
    setDraft((d) => {
      const next = { ...d };
      patchFn(next);
      return next;
    });
  };

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  // Amounts are per step. A step that has never had one falls back to an
  // even share of the material's total (utils/materialAmounts.js), so
  // the Ingredients tab adds up to what it always did until someone
  // actually changes a number.
  const amountFor = (materialId) => {
    const recorded = draft.material_usage?.[materialId];
    if (recorded) return recorded;
    return stepMaterialAmount(allNodes, node, materialId, materialsInfo || {});
  };
  const setAmount = (materialId, next) => {
    const current = amountFor(materialId);
    patch((n) => {
      n.material_usage = { ...(n.material_usage || {}), [materialId]: { ...current, ...next } };
    });
  };

  const number = numberOf?.(node.id);

  // Every field here was mouse-only, including for a step voice itself
  // just created — the editor auto-opens after "add a task" and used to
  // hand control straight back to the mouse. Registered once per node
  // (not per keystroke), so values are read through a ref.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const beforeRef = useRef(before);
  beforeRef.current = before;
  const actionsRef = useRef();
  actionsRef.current = { onSave, onDelete, onClose };

  useEffect(() => {
    const otherIds = others.map((o) => o.id);
    const labelOf = (id) => others.find((o) => o.id === id)?.label;

    const commands = [
      {
        phrases: EDIT_STEP_VOICE.name,
        run: (m, spoken) => {
          // A name keeps the spelling it was said with: the matcher
          // hands over the capture from the raw transcript, and only
          // falls back to the normalized one if it could not re-match.
          const name = (spoken?.[1] ?? m[1]).trim();
          if (!name) return null;
          patch((n) => (n.label = name));
          return `Called it “${name}.”`;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.duration(NUMBER_TOKEN),
        run: (m) => {
          const mins = spokenNumber(m[1]);
          if (mins === null) return null;
          patch((n) => (n.estimated_duration_sec = Math.round(Math.max(0.25, mins) * 60)));
          return `${mins} minute${mins === 1 ? "" : "s"}.`;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.difficulty,
        run: (m) => {
          patch((n) => (n.difficulty = m[1]));
          return `${m[1]} difficulty.`;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.phase,
        run: (m) => {
          patch((n) => (n.phase = m[1]));
          return `Phase: ${m[1]}.`;
        },
      },
      ...EQUIPMENT_OPTIONS.flatMap((eq) => {
        const word = equipmentLabel(eq).toLowerCase();
        const a = EQUIPMENT_ARTICLE[eq];
        return [
          {
            phrases: EDIT_STEP_VOICE.equipment(word, a).off,
            label: `${equipmentLabel(eq)} — not needed.`,
            run: () => patch((n) => (n.required_equipment = n.required_equipment.filter((x) => x !== eq))),
          },
          {
            phrases: EDIT_STEP_VOICE.equipment(word, a).on,
            label: `${equipmentLabel(eq)} needed.`,
            run: () => patch((n) => (n.required_equipment = n.required_equipment.includes(eq) ? n.required_equipment : [...n.required_equipment, eq])),
          },
        ];
      }),
      {
        phrases: EDIT_STEP_VOICE.stopWaiting,
        run: (m) => {
          const match = matchStepName(m[1], otherIds, labelOf);
          if (match.confidence !== "exact") return "I couldn't tell which step you meant.";
          patch((n) => (n.depends_on = n.depends_on.filter((x) => x !== match.stepId)));
          return `No longer waits on “${match.label}.”`;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.after,
        run: (m) => {
          const match = matchStepName(m[1], otherIds, labelOf);
          if (match.confidence !== "exact") return "I couldn't tell which step you meant.";
          if (blockedDependencyIds?.has(match.stepId)) return `That would create a loop — “${match.label}” already comes after this step.`;
          patch((n) => (n.depends_on = n.depends_on.includes(match.stepId) ? n.depends_on : [...n.depends_on, match.stepId]));
          return `Runs after “${match.label}.”`;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.delete,
        confirm: "Delete this step? Say yes or no.",
        run: () => {
          actionsRef.current.onDelete(node.id);
          return null;
        },
      },
      {
        phrases: EDIT_STEP_VOICE.save,
        run: () => {
          actionsRef.current.onSave(node.id, draftRef.current, beforeRef.current);
          return null; // the panel is closing; the page will speak next
        },
      },
      {
        phrases: EDIT_STEP_VOICE.cancel,
        run: () => {
          actionsRef.current.onClose();
          return null;
        },
      },
    ];

    return registerVoiceCommands(commands, { priority: 10, exclusive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, allNodes]);

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say “call it sear the tofu”, “five minutes”, “add a wok”, “runs after mince garlic”.",
          sub: "Then “save the step”, “delete it”, or “cancel”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  return (
    <BoardPanel
      label="Edit step"
      title={number ? `Editing step ${number}` : "Editing step"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn panel-btn-danger" onClick={() => onDelete(node.id)}>
            Delete
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(node.id, draft, before)}>
            Save
          </button>
        </>
      }
    >
      <PanelField as="label" label="Label">
        <input className="panel-input" type="text" value={draft.label} onChange={(e) => patch((n) => (n.label = e.target.value))} />
      </PanelField>

      <PanelField as="label" label="Description">
        <textarea
          className="panel-textarea"
          rows={2}
          value={draft.description}
          onChange={(e) => patch((n) => (n.description = e.target.value))}
        />
      </PanelField>

      <PanelField label="Phase">
        <Segmented label="Phase" options={PHASE_OPTIONS} value={draft.phase || "prep"} onChange={(v) => patch((n) => (n.phase = v))} />
      </PanelField>

      <div className="panel-field-row">
        <PanelField as="label" label="Takes">
          <span className="panel-minutes">
            <input
              className="panel-input"
              type="number"
              min="0.25"
              step="0.25"
              value={Number((draft.estimated_duration_sec / 60).toFixed(2))}
              onChange={(e) => {
                const minutes = Math.max(0.25, Number(e.target.value) || 0);
                patch((n) => (n.estimated_duration_sec = Math.round(minutes * 60)));
              }}
            />
            <span className="panel-minutes-unit">min</span>
          </span>
        </PanelField>
        <PanelField label="Difficulty">
          <Segmented
            label="Difficulty"
            options={DIFFICULTY_SEGMENTS}
            value={draft.difficulty}
            onChange={(v) => patch((n) => (n.difficulty = v))}
          />
        </PanelField>
      </div>

      <PanelField label="Needs">
        <div className="panel-chips">
          {EQUIPMENT_OPTIONS.map((eq) => (
            <ChoiceChip
              key={eq}
              on={draft.required_equipment.includes(eq)}
              onToggle={() => patch((n) => (n.required_equipment = toggleIn(n.required_equipment, eq)))}
            >
              {equipmentLabel(eq)}
            </ChoiceChip>
          ))}
        </div>
      </PanelField>

      <MaterialsField
        materialsInfo={materialsInfo}
        selected={draft.required_materials}
        amountFor={amountFor}
        onSetAmount={setAmount}
        onRemove={(m) => patch((n) => (n.required_materials = n.required_materials.filter((x) => x !== m)))}
        onPick={(m) => patch((n) => (n.required_materials = [...new Set([...n.required_materials, m])]))}
        onRegisterMaterial={onRegisterMaterial}
        onStepIds={originalMaterials}
      />

      <PanelField label="Runs after">
        <LinkRow
          ids={draft.depends_on}
          allNodes={allNodes}
          numberOf={numberOf}
          empty="Nothing, can start right away"
          removeHint="no longer waits on"
          onRemove={(id) => patch((n) => (n.depends_on = n.depends_on.filter((x) => x !== id)))}
        />
        <LinkPicker
          label="+ Add a step that comes before"
          options={eligibleParents(allNodes, node.id, { deps: draft.depends_on, children: before })}
          numberOf={numberOf}
          onPick={(id) => patch((n) => (n.depends_on = [...n.depends_on, id]))}
        />
      </PanelField>

      {/* The other direction. It is the same fact as "runs after" read
          from the other end, but only one end of an arrow was ever
          editable here, so re-pointing a step meant opening whichever
          step happened to own the link. */}
      <PanelField label="Unlocks next">
        <LinkRow
          ids={before}
          allNodes={allNodes}
          numberOf={numberOf}
          empty="Nothing waits on this yet"
          removeHint="no longer waits on this step"
          onRemove={(id) => setBefore((b) => b.filter((x) => x !== id))}
        />
        <LinkPicker
          label="+ Add a step that comes after"
          options={eligibleChildren(allNodes, node.id, { deps: draft.depends_on, children: before })}
          numberOf={numberOf}
          onPick={(id) => setBefore((b) => [...b, id])}
        />
      </PanelField>
    </BoardPanel>
  );
}
