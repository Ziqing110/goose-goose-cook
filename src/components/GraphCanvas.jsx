// Renders the recipe DAG: one column per dependency depth, nodes as
// clickable cards, dependency edges drawn as an absolutely-positioned
// SVG overlay measured off the actual card positions after layout.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutLevels, formatDuration } from "../utils/graphLayout.js";
import { equipmentLabel } from "../data/dishes.js";
import "./GraphCanvas.css";

export default function GraphCanvas({ nodes, selectedNodeId, onSelect }) {
  const canvasRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [edges, setEdges] = useState({ width: 0, height: 0, paths: [] });

  const levels = layoutLevels(nodes);

  const measure = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();

    const rects = {};
    nodes.forEach((n) => {
      const el = nodeRefs.current.get(n.id);
      if (el) rects[n.id] = el.getBoundingClientRect();
    });

    const paths = [];
    nodes.forEach((n) => {
      const target = rects[n.id];
      if (!target) return;
      n.depends_on.forEach((depId) => {
        const source = rects[depId];
        if (!source) return;
        const x1 = source.right - canvasRect.left;
        const y1 = source.top + source.height / 2 - canvasRect.top;
        const x2 = target.left - canvasRect.left;
        const y2 = target.top + target.height / 2 - canvasRect.top;
        const midX = (x1 + x2) / 2;
        paths.push(`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      });
    });

    setEdges({ width: canvasRect.width, height: canvasRect.height, paths });
  };

  useLayoutEffect(measure, [nodes]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  return (
    <div className="graph-canvas" ref={canvasRef}>
      <svg className="graph-edges" width={edges.width} height={edges.height} viewBox={`0 0 ${edges.width} ${edges.height}`}>
        {edges.paths.map((d, i) => (
          <path key={i} d={d} className="edge-path" fill="none" />
        ))}
      </svg>

      <div className="graph-columns">
        {levels.map((col, i) => (
          <div className="graph-column" key={i}>
            {col.map((n) => (
              <button
                key={n.id}
                type="button"
                ref={(el) => {
                  if (el) nodeRefs.current.set(n.id, el);
                  else nodeRefs.current.delete(n.id);
                }}
                className={`node ${n.id === selectedNodeId ? "is-selected" : ""}`}
                onClick={() => onSelect(n.id)}
              >
                <span className="node-label">{n.label}</span>
                <span className="node-meta">
                  <span className="tag mono">{formatDuration(n.estimated_duration_sec)}</span>
                  <span className={`tag tag-difficulty-${n.difficulty}`}>{n.difficulty}</span>
                </span>
                {n.required_equipment.length > 0 && <span className="node-equip">{n.required_equipment.map(equipmentLabel).join(" · ")}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
