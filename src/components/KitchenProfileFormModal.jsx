import { useState } from "react";
import Modal from "./Modal.jsx";
import KitchenProfileForm, { emptyKitchenProfileDraft } from "./KitchenProfileForm.jsx";
import "./KitchenProfileFormModal.css";

// Add/edit a kitchen profile. `profile` is null for "add", or an
// existing profile object for "edit" — which adds a Delete action when
// `onDelete` is given (Home passes it; a mid-session edit doesn't, since
// deleting the kitchen the run is planned on isn't a fix for anything).
export default function KitchenProfileFormModal({ profile, notice, error, onSave, onDelete, onClose }) {
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
