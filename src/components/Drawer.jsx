// Side-anchored scrim + panel, for content too tall/frequent to sit
// inline in page flow (e.g. the step editor) — sibling to Modal.jsx's
// centered variant. Same click-outside-to-close contract.
//
// Portaled straight to document.body: `.page`'s rise-in animation
// leaves a `transform: translateY(0)` applied after it finishes, and
// any ancestor with a non-none transform becomes the containing block
// for `position: fixed` descendants — without the portal this drawer
// would anchor to `.page`'s (content-width-capped) box instead of the
// real viewport edge, leaving a gap on wide screens.
import { createPortal } from "react-dom";
import "./Drawer.css";

export default function Drawer({ label, onClose, children }) {
  return createPortal(
    <div className="drawer-scrim" role="dialog" aria-label={label} onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-ghost drawer-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
