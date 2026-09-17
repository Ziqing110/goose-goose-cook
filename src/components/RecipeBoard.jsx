// The recipe graph as a board you can rearrange. Cards are a fixed size
// and absolutely positioned, which is what lets the board guarantee two
// things the old flow layout couldn't: no card ever sits on top of
// another, and an edge that would run under a card detours around it.
//
// Geometry lives in utils/boardLayout.js, and the boxes are computed
// from the position map rather than measured from the DOM — so edges
// are right on first paint instead of after a layout pass.
//
// Positions live on the session (session.nodePositions), not on the
// nodes: the graph is what an LLM will generate, and where someone
// dragged a card isn't part of the recipe. Anything never dragged falls
// back to its dependency-depth slot, so a fresh session opens tidy.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatMinutes } from "../utils/inventory.js";
import { autoPositions, boxOf, edgePath, resolvePositions, settle, CARD_W, CARD_H, PAD } from "../utils/boardLayout.js";
import "./RecipeBoard.css";

const STATUS_WORD = { atRisk: "at risk", blocked: "blocked" };
// Spacing between arrowheads converging on one card.
const LANDING_GAP = 16;
const MARGIN = 16;

// State lives in fill, border and ink — never opacity. Over the board's
// warm ground a faded card dropped red ink under 3:1, so a card away
// from the selection flattens its fill instead, and a blocked card
// never recedes at all.
export default function RecipeBoard({
  nodes,
  positions,
  selectedNodeId,
  dishLabelFor,
  statusOf,
  numberOf,
  onSelect,
  onMove,
  // Pixels on the right covered by an overlay (the board panel). The
  // board pans the selection clear of it and grows so it can.
  reserveRight = 0,
  onOffscreen,
  readOnly = false,
}) {
  const boardRef = useRef(null);
  const scrollRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [panning, setPanning] = useState(false);
  const ghostRef = useRef(null);
  ghostRef.current = ghost;

  const auto = useMemo(() => autoPositions(nodes), [nodes]);
  // What gets drawn: stored where it's usable, nudged where it isn't.
  const resolved = useMemo(() => resolvePositions(nodes, positions, auto), [nodes, positions, auto]);
  const posOf = (id) => (drag?.id === id && ghost) || resolved[id] || { x: PAD, y: PAD };

  const boxes = useMemo(() => {
    const out = {};
    nodes.forEach((n) => {
      out[n.id] = { id: n.id, ...boxOf(posOf(n.id)) };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, positions, auto, ghost, drag]);

  // With a card selected, its immediate neighbourhood is what matters —
  // everything else dims so the connections can be followed.
  const related = useMemo(() => {
    if (!selectedNodeId) return null;
    const set = new Set([selectedNodeId]);
    nodes.forEach((n) => {
      if (n.id === selectedNodeId) (n.depends_on || []).forEach((d) => set.add(d));
      if ((n.depends_on || []).includes(selectedNodeId)) set.add(n.id);
    });
    return set;
  }, [nodes, selectedNodeId]);

  const edges = useMemo(() => {
    const out = [];
    nodes.forEach((n) => {
      // Incoming edges land top to bottom in the order of their sources,
      // spread around the midline so each keeps its own arrowhead.
      const deps = (n.depends_on || []).filter((d) => boxes[d] && boxes[n.id]).sort((a, b) => boxes[a].y - boxes[b].y);
      const spread = Math.min(LANDING_GAP, (CARD_H - 24) / Math.max(1, deps.length - 1));
      deps.forEach((depId, i) => {
        // Anything that isn't one of the two ends is something to avoid.
        const obstacles = Object.values(boxes).filter((b) => b.id !== n.id && b.id !== depId);
        out.push({
          key: `${depId}->${n.id}`,
          d: edgePath(boxes[depId], boxes[n.id], obstacles, (i - (deps.length - 1) / 2) * spread),
          active: selectedNodeId === n.id || selectedNodeId === depId,
        });
      });
    });
    return out;
  }, [nodes, boxes, selectedNodeId]);

  // Move/up go on the window: once the cursor outruns the card the
  // events stop targeting it, and setPointerCapture isn't reliable here.
  const startDrag = (e, id) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    const board = boardRef.current.getBoundingClientRect();
    const p = posOf(id);
    setDrag({ id, dx: e.clientX - board.left - p.x, dy: e.clientY - board.top - p.y, from: p, moved: false });
    setGhost(p);
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
      if (drag.moved && ghostRef.current) {
        // Land on the nearest spot that touches nothing.
        const others = nodes.filter((n) => n.id !== drag.id).map((n) => boxOf(posOf(n.id)));
        onMove(drag.id, settle(ghostRef.current, others));
      } else {
        onSelect(drag.id);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, onMove, onSelect, nodes, positions]);

  // Grabbing the background scrolls the viewport under the board. Done
  // by moving the scroll container, not transforming the board, so the
  // edge geometry stays in one coordinate space.
  const startPan = (e) => {
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

  const content = nodes.reduce(
    (acc, n) => {
      const p = posOf(n.id);
      return { w: Math.max(acc.w, p.x + CARD_W + PAD), h: Math.max(acc.h, p.y + CARD_H + PAD) };
    },
    { w: 640, h: 320 }
  );
  // Room to pan the rightmost cards out from under the overlay.
  const extent = { w: content.w + reserveRight, h: content.h };

  // Opening the panel pans rather than reflows: bring the selected card
  // and its lit neighbours into the part of the viewport the panel
  // doesn't cover.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedNodeId || !boxes[selectedNodeId]) return;
    const group = [...(related || [selectedNodeId])].map((id) => boxes[id]).filter(Boolean);
    const sel = boxes[selectedNodeId];
    const box = {
      x1: Math.min(...group.map((b) => b.x)),
      x2: Math.max(...group.map((b) => b.x + b.w)),
      y1: Math.min(...group.map((b) => b.y)),
      y2: Math.max(...group.map((b) => b.y + b.h)),
    };
    const fit = (lo, hi, from, span, selLo, selHi) => {
      if (hi - lo + 2 * MARGIN > span) return selLo - (span - (selHi - selLo)) / 2; // too wide: centre the card
      if (lo - MARGIN < from) return lo - MARGIN;
      if (hi + MARGIN > from + span) return hi + MARGIN - span;
      return from;
    };
    const width = el.clientWidth - reserveRight;
    const left = fit(box.x1, box.x2, el.scrollLeft, width, sel.x, sel.x + sel.w);
    const top = fit(box.y1, box.y2, el.scrollTop, el.clientHeight, sel.y, sel.y + sel.h);
    if (Math.abs(left - el.scrollLeft) < 1 && Math.abs(top - el.scrollTop) < 1) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    // Only when the selection or the overlay changes — not on every drag frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, reserveRight]);

  // Which cards are scrolled out of view, for the caption under the board.
  const offscreenKey = useRef("");
  const reportOffscreen = () => {
    const el = scrollRef.current;
    if (!el || !onOffscreen) return;
    const view = { x1: el.scrollLeft, x2: el.scrollLeft + el.clientWidth, y1: el.scrollTop, y2: el.scrollTop + el.clientHeight };
    const out = { left: [], right: [], other: [] };
    nodes.forEach((n) => {
      const b = boxes[n.id];
      if (!b) return;
      if (b.x + b.w <= view.x1) out.left.push(n.id);
      else if (b.x >= view.x2) out.right.push(n.id);
      else if (b.y + b.h <= view.y1 || b.y >= view.y2) out.other.push(n.id);
    });
    const key = JSON.stringify(out);
    if (key === offscreenKey.current) return;
    offscreenKey.current = key;
    onOffscreen(out);
  };
  useEffect(() => {
    reportOffscreen();
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(reportOffscreen);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <div className={`board-scroll${panning ? " is-panning" : ""}`} ref={scrollRef} onScroll={reportOffscreen}>
      <div
        className="board"
        ref={boardRef}
        style={{ width: extent.w, height: extent.h }}
        onPointerDown={startPan}
      >
        <svg className="board-edges" width={extent.w} height={extent.h} aria-hidden="true">
          <defs>
            {/* Two markers rather than context-stroke, which Safari
                still doesn't support. */}
            <marker id="board-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" className="board-arrow-head" />
            </marker>
            <marker id="board-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" className="board-arrow-head is-active" />
            </marker>
          </defs>
          {edges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              className={`board-edge${e.active ? " is-active" : ""}`}
              markerEnd={`url(#board-arrow${e.active ? "-active" : ""})`}
            />
          ))}
        </svg>

        {nodes.map((n) => {
          const p = posOf(n.id);
          const status = statusOf?.(n.id) || "craftable";
          const tail = STATUS_WORD[status] || dishLabelFor?.(n);
          const number = numberOf?.(n.id);
          return (
            <button
              type="button"
              key={n.id}
              title={n.label}
              aria-label={`${number ? `Step ${number}: ` : ""}${n.label}${STATUS_WORD[status] ? `, ${STATUS_WORD[status]}` : ""}`}
              aria-pressed={selectedNodeId === n.id}
              className={`board-card phase-${n.phase || "prep"} is-${status}${selectedNodeId === n.id ? " is-selected" : ""}${
                drag?.id === n.id ? " is-dragging" : ""
              }${related && !related.has(n.id) && status !== "blocked" ? " is-dimmed" : ""}`}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              onPointerDown={(e) => startDrag(e, n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            >
              {number && <span className="board-card-num">{number}</span>}
              <span className="board-card-label">{n.label}</span>
              <span className="board-card-meta">
                {formatMinutes(n.estimated_duration_sec)}
                {tail ? ` · ${tail}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
