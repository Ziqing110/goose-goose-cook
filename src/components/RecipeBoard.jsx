// The recipe graph as a board you can rearrange. Cards are absolutely
// positioned so a cook can drag one out from under an edge; the edges
// are an SVG layer measured off the real card boxes, so they follow.
//
// Positions live on the session (session.nodePositions), not on the
// nodes — the graph is what an LLM will generate, and where someone
// dragged a card isn't part of the recipe. A node with no saved
// position falls back to its dependency-depth slot, which is where the
// old static graph put it, so a fresh session opens tidy.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutLevels, formatDuration } from "../utils/graphLayout.js";
import "./RecipeBoard.css";

const CARD_W = 190;
const COL_GAP = 96;
const ROW_GAP = 28;
const ROW_H = 118; // a three-line label ('Brown pork, then fry doubanjiang & aromatics') has to fit
const PAD = 20;

/** Dependency-depth layout, used for any card never dragged. */
export function autoPositions(nodes) {
  const out = {};
  layoutLevels(nodes).forEach((level, col) => {
    level.forEach((node, row) => {
      out[node.id] = { x: PAD + col * (CARD_W + COL_GAP), y: PAD + row * (ROW_H + ROW_GAP) };
    });
  });
  return out;
}

export default function RecipeBoard({
  nodes,
  positions,
  selectedNodeId,
  dishLabelFor,
  blockedIds,
  onSelect,
  onMove,
  readOnly = false,
}) {
  const boardRef = useRef(null);
  const cardRefs = useRef(new Map());
  const [edges, setEdges] = useState([]);
  const [drag, setDrag] = useState(null); // { id, dx, dy } while a card is held
  const [panning, setPanning] = useState(false);
  const scrollRef = useRef(null);
  const [ghost, setGhost] = useState(null); // live position during a drag
  const ghostRef = useRef(null);
  ghostRef.current = ghost;

  const auto = autoPositions(nodes);
  const posOf = (id) => (drag?.id === id && ghost ? ghost : positions[id] || auto[id] || { x: PAD, y: PAD });

  // Edges are measured rather than computed from the position map so
  // they attach to the real card edges whatever height a card renders.
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const box = {};
    nodes.forEach((n) => {
      const el = cardRefs.current.get(n.id);
      if (el) box[n.id] = el.getBoundingClientRect();
    });
    const next = [];
    nodes.forEach((n) => {
      const to = box[n.id];
      if (!to) return;
      (n.depends_on || []).forEach((depId) => {
        const from = box[depId];
        if (!from) return;
        const x1 = from.right - base.left;
        const y1 = from.top + from.height / 2 - base.top;
        const x2 = to.left - base.left;
        const y2 = to.top + to.height / 2 - base.top;
        const mid = (x1 + x2) / 2;
        next.push({
          key: `${depId}->${n.id}`,
          d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
          active: selectedNodeId === n.id || selectedNodeId === depId,
        });
      });
    });
    setEdges(next);
  }, [nodes, selectedNodeId]);

  useLayoutEffect(measure, [measure, positions, ghost]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // The move/up listeners go on the window, not the card: once the
  // cursor outruns the card the events stop targeting it, and
  // setPointerCapture isn't reliable enough to lean on here.
  const startDrag = (e, id) => {
    if (readOnly || e.button !== 0) return;
    const board = boardRef.current.getBoundingClientRect();
    const p = posOf(id);
    setDrag({ id, dx: e.clientX - board.left - p.x, dy: e.clientY - board.top - p.y, from: p, moved: false });
    setGhost(p);
  };

  const startPan = (e) => {
    // Only the background pans; a card handles its own pointerdown.
    if (e.button !== 0 || e.target.closest(".board-card")) return;
    const el = scrollRef.current;
    if (!el) return;
    setPanning(true);
    const from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    const move = (ev) => {
      el.scrollLeft = from.left - (ev.clientX - from.x);
      el.scrollTop = from.top - (ev.clientY - from.y);
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const board = boardRef.current?.getBoundingClientRect();
      if (!board) return;
      const at = {
        x: Math.max(0, e.clientX - board.left - drag.dx),
        y: Math.max(0, e.clientY - board.top - drag.dy),
      };
      if (Math.abs(at.x - drag.from.x) > 3 || Math.abs(at.y - drag.from.y) > 3) drag.moved = true;
      setGhost(at);
    };
    const up = () => {
      // A press that never moved is a click, not a drag — let it select.
      if (drag.moved && ghostRef.current) onMove(drag.id, ghostRef.current);
      else onSelect(drag.id);
      setDrag(null);
      setGhost(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, onMove, onSelect]);

  // The board is as big as the furthest card, plus room to drag into.
  const extent = nodes.reduce(
    (acc, n) => {
      const p = posOf(n.id);
      return { w: Math.max(acc.w, p.x + CARD_W + PAD), h: Math.max(acc.h, p.y + ROW_H + PAD) };
    },
    { w: 640, h: 320 }
  );

  return (
    <div className={`board-scroll${panning ? " is-panning" : ""}`} ref={scrollRef}>
      <div className="board" ref={boardRef} style={{ width: extent.w, height: extent.h }} onPointerDown={startPan}>
        <svg className="board-edges" width={extent.w} height={extent.h} aria-hidden="true">
          {edges.map((e) => (
            <path key={e.key} d={e.d} className={`board-edge ${e.active ? "is-active" : ""}`} />
          ))}
        </svg>

        {nodes.map((n) => {
          const p = posOf(n.id);
          const dish = dishLabelFor?.(n);
          return (
            <button
              type="button"
              key={n.id}
              ref={(el) => (el ? cardRefs.current.set(n.id, el) : cardRefs.current.delete(n.id))}
              className={`board-card${selectedNodeId === n.id ? " is-selected" : ""}${
                blockedIds?.has(n.id) ? " is-blocked" : ""
              }${drag?.id === n.id ? " is-dragging" : ""}`}
              style={{ left: p.x, top: p.y, width: CARD_W }}
              onPointerDown={(e) => startDrag(e, n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            >
              <span className="board-card-label">{n.label}</span>
              <span className="board-card-meta mono">
                {formatDuration(n.estimated_duration_sec)}
                {dish ? ` · ${dish}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
