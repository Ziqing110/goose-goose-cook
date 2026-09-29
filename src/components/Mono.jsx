/** Numbers and clocks, set in the monospace face. */
export default function Mono({ children, className = "" }) {
  return <span className={className ? `mono ${className}` : "mono"}>{children}</span>;
}
