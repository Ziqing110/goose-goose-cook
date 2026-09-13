// Controlled kitchen-profile fields (name + equipment). Parent owns
// the draft object and the submit handler — used both inline in the
// first-time session setup page and inside the add/edit modal.
import NumberStepper from "./NumberStepper.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";
import "./KitchenProfileForm.css";

export default function KitchenProfileForm({ value, onChange, nameError }) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="kitchen-profile-form">
      <div className="field">
        <label htmlFor="kp-name">Kitchen name</label>
        <input
          id="kp-name"
          type="text"
          placeholder="e.g. Home kitchen"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          className={nameError ? "field-error" : ""}
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "kp-name-error" : undefined}
        />
        {nameError && (
          <p id="kp-name-error" className="field-error-text">
            Give this kitchen a name before continuing.
          </p>
        )}
      </div>

      <div className="setup-grid">
        <NumberStepper id="kp-burners" label="Stove burners" value={value.burners} min={1} max={8} onChange={(v) => set({ burners: v })} />
        <NumberStepper
          id="kp-cuttingBoards"
          label="Cutting boards"
          value={value.cuttingBoards}
          min={1}
          max={6}
          onChange={(v) => set({ cuttingBoards: v })}
        />
        <NumberStepper id="kp-pots" label="Pots" value={value.pots} min={0} max={6} onChange={(v) => set({ pots: v })} />
      </div>

      <div className="setup-toggles">
        <ToggleSwitch id="kp-hasWok" label="Wok / wok ring" checked={value.hasWok} onChange={(v) => set({ hasWok: v })} />
        <ToggleSwitch id="kp-hasOven" label="Oven" checked={value.hasOven} onChange={(v) => set({ hasOven: v })} />
      </div>
    </div>
  );
}

export function emptyKitchenProfileDraft() {
  return { name: "", burners: 2, hasWok: true, hasOven: false, cuttingBoards: 1, pots: 2 };
}
