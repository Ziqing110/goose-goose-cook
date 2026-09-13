// Generic scrim + centered panel + click-outside-to-close — the one
// modal primitive in the app. Panel content is entirely up to the
// caller; pass panelClassName for sizing overrides.
import "./Modal.css";

export default function Modal({ label, onClose, children, panelClassName = "" }) {
  return (
    <div className="modal-scrim" role="dialog" aria-label={label} onClick={onClose}>
      <div className={`modal-panel card ${panelClassName}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
