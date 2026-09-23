import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import KitchenProfileForm, { emptyKitchenProfileDraft } from "./KitchenProfileForm.jsx";
import { useAppState } from "../state/AppStateContext.jsx";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { spokenNumber, NUMBER_TOKEN } from "../utils/understanding.js";
import { KITCHEN_PROFILE_VOICE } from "../utils/pageVoiceGrammar.js";
import "./KitchenProfileFormModal.css";

// The bounds the steppers enforce, restated here because voice has no
// stepper to stop at the end. Saying "twelve burners" should land on
// eight and say so, not fail silently or write a number the form could
// never have produced by clicking.
const LIMITS = {
  burners: { min: 1, max: 8, label: "burners", one: "burner" },
  cuttingBoards: { min: 1, max: 6, label: "cutting boards", one: "cutting board" },
  pots: { min: 0, max: 6, label: "pots", one: "pot" },
};

// Imperative phrasings only, deliberately. The "is this conversation?"
// guard stands a command down the moment it finds a subject, so "we have
// a wok" would be heard as two people chatting and ignored — which is
// correct behaviour in a kitchen, and the reason to say "add a wok".
// Every way someone actually flips a switch out loud. The first pass here
// listed two phrasings per toggle and missed the shortest one there is —
// "oven on" — which is exactly what a person says when their hands are
// full. A toggle is a small closed idea; enumerate it properly once.
//
// The singular forms, for stepping one at a time. Plural stays out of
// these on purpose: "\bpot\b" will not match "pots", which is what keeps
// "one more pot" and "three pots" from fighting over the same words.
// Add/edit a kitchen profile. `profile` is null for "add", or an
// existing profile object for "edit" — which adds a Delete action when
// `onDelete` is given (Home passes it; a mid-session edit doesn't, since
// deleting the kitchen the run is planned on isn't a fix for anything).
export default function KitchenProfileFormModal({ profile, notice, error, onSave, onDelete, onClose }) {
  const { dispatch } = useAppState();
  const [draft, setDraft] = useState(profile ? { ...profile } : emptyKitchenProfileDraft());
  const [nameError, setNameError] = useState(false);
  const isEdit = Boolean(profile);

  const handleChange = (next) => {
    setDraft(next);
    if (nameError && next.name.trim()) setNameError(false);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!draft.name.trim()) {
      setNameError(true);
      return;
    }
    onSave({ ...draft, name: draft.name.trim() });
  };

  // The commands read and write the live draft, but they are registered
  // once — re-registering on every keystroke would churn the registry for
  // nothing. A ref keeps them current without that.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const actions = useRef({});
  actions.current = { onClose, onSave, onDelete };

  // While this dialog is open it owns the microphone: a higher layer than
  // the page underneath, and exclusive, so "resume the run" and page
  // navigation both stand down until it closes. You can only say things
  // this form can actually do.
  useEffect(() => {
    const setField = (field, raw) => {
      const { min, max, label } = LIMITS[field];
      const n = spokenNumber(raw);
      if (n === null) return null;
      const clamped = Math.max(min, Math.min(max, Math.round(n)));
      setDraft((d) => ({ ...d, [field]: clamped }));
      if (clamped !== n) return `${clamped} ${label} — that's the ${clamped === max ? "most" : "fewest"} this allows.`;
      return `${clamped} ${label}.`;
    };

    const nudge = (field, by) => {
      const { min, max, label } = LIMITS[field];
      const next = Math.max(min, Math.min(max, (draftRef.current[field] ?? min) + by));
      setDraft((d) => ({ ...d, [field]: next }));
      return `${next} ${label}.`;
    };

    const toggle = (field, on, label) => {
      setDraft((d) => ({ ...d, [field]: on }));
      return on ? `${label} on.` : `${label} off.`;
    };

    const commands = [
      {
        // Free text, so it has to be last-resort specific: an explicit
        // naming verb and everything after it. Without the verb this
        // would swallow every other command in the list.
        phrases: KITCHEN_PROFILE_VOICE.name,
        run: (m) => {
          const name = m[1].trim();
          if (!name) return null;
          setDraft((d) => ({ ...d, name }));
          setNameError(false);
          return `Called it “${name}”.`;
        },
      },
      ...Object.keys(LIMITS).map((field) => ({
        phrases: KITCHEN_PROFILE_VOICE.count(LIMITS[field].label, NUMBER_TOKEN),
        run: (m) => setField(field, m[1]),
      })),
      // Stepping one at a time, for every count — not just burners, which
      // was the only one the first pass covered.
      ...Object.keys(LIMITS).flatMap((field) => [
        { phrases: KITCHEN_PROFILE_VOICE.decrease(LIMITS[field].one), run: () => nudge(field, -1) },
        { phrases: KITCHEN_PROFILE_VOICE.increase(LIMITS[field].one), run: () => nudge(field, 1) },
      ]),
      // Off before on, so anything that reads both ways reads as off.
      { phrases: KITCHEN_PROFILE_VOICE.toggleOff("wok", "a"), run: () => toggle("hasWok", false, "Wok") },
      { phrases: KITCHEN_PROFILE_VOICE.toggleOn("wok", "a"), run: () => toggle("hasWok", true, "Wok") },
      { phrases: KITCHEN_PROFILE_VOICE.toggleOff("oven", "an"), run: () => toggle("hasOven", false, "Oven") },
      { phrases: KITCHEN_PROFILE_VOICE.toggleOn("oven", "an"), run: () => toggle("hasOven", true, "Oven") },
      {
        phrases: KITCHEN_PROFILE_VOICE.save,
        run: () => {
          const d = draftRef.current;
          if (!d.name.trim()) {
            setNameError(true);
            return "This kitchen needs a name first — say “call it” and then the name.";
          }
          actions.current.onSave({ ...d, name: d.name.trim() });
          return null; // the modal is closing; the page will speak next
        },
      },
      {
        phrases: KITCHEN_PROFILE_VOICE.cancel,
        run: () => {
          actions.current.onClose();
          return null;
        },
      },
    ];

    return registerVoiceCommands(commands, { priority: 10, exclusive: true });
  }, []);

  // Say what this dialog takes, since it has taken the microphone off the
  // page underneath. A bar still advertising "resume the run" while the
  // only working commands are these would be worse than saying nothing.
  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say “call it Flat 3 galley”, “four burners”, “add an oven”.",
          sub: "Then “save the kitchen”, or “cancel”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  return (
    <Modal label={isEdit ? "Edit kitchen" : "Add a kitchen"} onClose={onClose} panelClassName="kp-modal">
      <form onSubmit={submit} className="kitchen-profile-modal-form">
        <span className="kitchen-profile-modal-title">{isEdit ? "Edit kitchen" : "Add a kitchen"}</span>

        {notice && <p className="kitchen-profile-modal-notice">{notice}</p>}
        {error && <p className="kitchen-profile-modal-notice kitchen-profile-modal-error">{error}</p>}

        <KitchenProfileForm value={draft} onChange={handleChange} nameError={nameError} />

        <div className="kitchen-profile-modal-actions">
          {isEdit && onDelete ? (
            <button type="button" className="btn btn-ghost btn-danger" onClick={onDelete}>
              Delete kitchen
            </button>
          ) : (
            <span />
          )}
          <div className="kitchen-profile-modal-actions-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save kitchen
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
