import { useState } from "react";
import Modal from "./Modal.jsx";
import KitchenProfileForm, { emptyKitchenProfileDraft } from "./KitchenProfileForm.jsx";

// Add/edit a kitchen profile from Home. `profile` is null for "add",
// or an existing profile object for "edit" (adds a Delete action).
export default function KitchenProfileFormModal({ profile, notice, error, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(profile ? { ...profile } : emptyKitchenProfileDraft());
  const isEdit = Boolean(profile);

  const submit = (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim() });
  };

  return (
    <Modal label={isEdit ? "Edit kitchen" : "Add kitchen"} onClose={onClose}>
      <form onSubmit={submit} className="kitchen-profile-modal-form">
        <span className="mini-title">{isEdit ? "Edit kitchen" : "Add a kitchen"}</span>

        {notice && <p className="kitchen-profile-modal-notice">{notice}</p>}
        {error && <p className="kitchen-profile-modal-notice kitchen-profile-modal-error">{error}</p>}

        <KitchenProfileForm value={draft} onChange={setDraft} />

        <div className="kitchen-profile-modal-actions">
          {isEdit ? (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="kitchen-profile-modal-actions-right">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? "Save changes" : "Add kitchen"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
