// Generic scrim + centered panel + click-outside-to-close — the one
// modal primitive in the app. Panel content is entirely up to the
// caller; pass panelClassName for sizing overrides.
//
// Portaled to document.body — `.page`'s rise-in animation leaves a
// `transform: translateY(0)` applied after it finishes, which makes it
// the containing block for `position: fixed` descendants, so without
// the portal this would center on `.page`'s box instead of the real
// viewport.
import { createPortal } from "react-dom";
import "./Modal.css";

export default function Modal({ label, onClose, children, panelClassName = "" }) {
  return createPortal(
    <div className="modal-scrim" role="dialog" aria-label={label} onClick={onClose}>
      <div className={`modal-panel card ${panelClassName}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
