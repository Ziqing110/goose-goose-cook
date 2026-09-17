// The recipe graph's one overlay panel. It floats over the board's
// right edge (no scrim — the board stays live behind it) and holds one
// of three things: the impact list, a step's fields, or the add-a-task
// form. The page decides which; this is the shell plus the few form
// controls the editor and the add form share.
import "./BoardPanel.css";

export default function BoardPanel({ label, title, tone, mark, onClose, closeLabel = "Close panel", footer, children }) {
  return (
    <section className="board-panel" role="dialog" aria-label={label}>
      <header className={`board-panel-head${tone ? ` is-${tone}` : ""}`}>
        {mark}
        <span className="board-panel-title">{title}</span>
        <button type="button" className="board-panel-close" onClick={onClose} aria-label={closeLabel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="board-panel-body">{children}</div>
      {footer && <footer className="board-panel-foot">{footer}</footer>}
    </section>
  );
}

/** Mono uppercase label over a control. `as="label"` wraps a single input. */
export function PanelField({ label, as: Tag = "div", className = "", children }) {
  return (
    <Tag className={`panel-field ${className}`}>
      <span className="panel-field-label">{label}</span>
      {children}
    </Tag>
  );
}

/** Single choice from a short list — the tab bar's control at field size. */
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="panel-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`panel-seg-btn${value === o.value ? " is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A toggle pill for multi-select lists (equipment, materials, runs-after). */
export function ChoiceChip({ on, disabled, title, onToggle, children }) {
  return (
    <button
      type="button"
      className={`panel-chip${on ? " is-on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
