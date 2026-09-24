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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatMinutes } from "../utils/inventory.js";
import { autoPositions, boxOf, cardSize, edgePath, laneRouting, resolvePositions, settle, CARD_W, CARD_H, PAD } from "../utils/boardLayout.js";
import { linkRejection } from "../utils/boardLinks.js";
import "./RecipeBoard.css";

const STATUS_WORD = { atRisk: "at risk", blocked: "blocked" };

// The selected card is ringed by hand rather than outlined: an accent
// outline read as the same red the board uses for a step that can't be
// done. Two loose strokes that don't close, multiplied into the wood.
function SelectionMark() {
  return (
    <svg className="board-card-mark" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M150 14 C 110 2, 40 4, 16 30 C -4 54, 10 96, 60 110 C 110 122, 176 112, 192 78 C 206 46, 180 16, 120 10 C 96 8, 70 12, 52 18"
        fill="none"
        stroke="#f5d33a"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.78"
      />
      <path
        d="M40 24 C 20 36, 8 62, 24 86 C 44 112, 130 118, 172 98 C 196 84, 200 50, 176 28"
        fill="none"
        stroke="#f2c81f"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
// Must match .board-card-label in RecipeBoard.css — a card's size is
// worked out from its text before anything is rendered.
const LABEL_FONT = '600 14px "Inter", ui-sans-serif, system-ui, sans-serif';
// The board scales to fit its frame, so the whole graph is visible
// without panning — that fitted scale is also the zoom slider's floor
// (see InventoryPage), which is why it varies with how many steps a
// dish has. This is only a sanity stop for an enormous graph.
const MIN_SCALE = 0.35;
const MARGIN = 16;

// Every card is a slip of paper pinned to the board, and no two are
// pinned straight. The angles are a fixed cycle rather than random:
// re-rolling them on each render would make the whole board twitch
// whenever anything changed.
const CARD_TILTS = [-0.7, 0.5, -0.3, 0.8, -0.5, 0.3];
const TAPE_TILTS = [-3, 2, -1.5, 3, -2.5, 1];

// State lives in fill, border and ink — never opacity. Over the board's
// warm ground a faded card dropped red ink under 3:1, so a card away
// from the selection flattens its fill instead, and a blocked card
// never recedes at all.
const RecipeBoard = forwardRef(function RecipeBoard({
  nodes,
  positions,
  selectedNodeId,
  dishLabelFor,
  // The paper a step is written on — its dish's stock, or the dashed
  // white sheet for a step both dishes share.
  paperOf,
  statusOf,
  numberOf,
  onSelect,
  onMove,
  // Pixels on the right covered by an overlay (the board panel). The
  // board pans the selection clear of it and grows so it can.
  reserveRight = 0,
  onOffscreen,
  // Drawing and cutting arrows by hand. Both are given the pair in
  // graph order — the first step runs before the second.
  onLink,
  onUnlink,
  // How much room the legends floating over the top corners need. Two
  // dishes fit on one line; six wrap to three, and the cards underneath
  // have to move rather than be covered.
  legendKeepOut,
  // null = fit the frame; a number is the cook's own zoom.
  zoom = null,
  onFitScale,
  readOnly = false,
}, ref) {
  const boardRef = useRef(null);
  const scrollRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [panning, setPanning] = useState(false);
  // Drawing a link: { from, dir, x0, y0, x, y } in board coordinates.
  const [link, setLink] = useState(null);
  // Which card the pointer is over — tracked rather than read from :hover
  // because the ports sit in an overlay above the cards, not inside them.
  const [hoverId, setHoverId] = useState(null);
  // A picked arrow: { from, to, x, y }, where x/y is where it was clicked.
  const [edgeSel, setEdgeSel] = useState(null);
  const [linkMessage, setLinkMessage] = useState(null);
  const messageTimer = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const scale = zoom ?? fitScale;
  const ghostRef = useRef(null);
  ghostRef.current = ghost;

  // Every card is sized around its own label, so no step's name is cut
  // off. Measured with a canvas rather than the DOM: the layout has to
  // know the boxes before it can place them.
  const sizes = useMemo(() => {
    const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    const measure = (text) => {
      if (!ctx) return text.length * 6.9; // rough fallback; never hit in a browser
      ctx.font = LABEL_FONT;
      return ctx.measureText(text).width;
    };
    return Object.fromEntries(nodes.map((n) => [n.id, cardSize(n.label, measure)]));
  }, [nodes]);
  // Memoised so the layout below can depend on the function itself
  // rather than on `sizes` and a promise that the two stay in step.
  const sizeOf = useCallback((node) => sizes[node.id] || { w: CARD_W, h: CARD_H }, [sizes]);

  // The board's own frame, so the auto-layout can use the room a tall
  // screen gives it instead of packing everything into the top.
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setFrame((f) => (f.w === el.clientWidth && f.h === el.clientHeight ? f : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const auto = useMemo(() => {
    // Laid out twice, because the board is drawn scaled to fit and the
    // layout works in unscaled units: the frame's height means nothing
    // until we know that scale. The first pass, at the default
    // spacing, settles the board's width — row spacing cannot change
    // it — and the width is what the scale comes from here, so the
    // second pass can be told how much room it really has. Taking the
    // scale from the finished layout instead would feed a taller board
    // back into a smaller scale into a taller board.
    const packed = autoPositions(nodes, sizeOf, legendKeepOut);
    if (!frame.w || !frame.h) return packed;
    const width = nodes.reduce((max, n) => Math.max(max, (packed[n.id]?.x || 0) + sizeOf(n).w + PAD), 640);
    const k = Math.max(MIN_SCALE, Math.min(1, (frame.w - reserveRight) / width));
    return autoPositions(nodes, sizeOf, legendKeepOut, frame.h / k);
  }, [nodes, sizeOf, legendKeepOut, frame, reserveRight]);
  // What gets drawn: stored where it's usable, nudged where it isn't.
  const resolved = useMemo(() => resolvePositions(nodes, positions, auto, sizeOf), [nodes, positions, auto, sizeOf]);
  const posOf = (id) => (drag?.id === id && ghost) || resolved[id] || { x: PAD, y: PAD };

  const boxes = useMemo(() => {
    const out = {};
    nodes.forEach((n) => {
      out[n.id] = { id: n.id, ...boxOf(posOf(n.id), sizes[n.id]) };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, positions, auto, ghost, drag, sizes]);

  // With a card pointed at or open, its immediate neighbourhood is what
  // matters — everything else steps back so the connections can be
  // followed. Hover wins over the open card: it is the question being
  // asked right now.
  const related = useMemo(() => {
    const focus = hoverId || selectedNodeId;
    if (!focus) return null;
    const set = new Set([focus]);
    nodes.forEach((n) => {
      if (n.id === focus) (n.depends_on || []).forEach((d) => set.add(d));
      if ((n.depends_on || []).includes(focus)) set.add(n.id);
    });
    return set;
  }, [nodes, selectedNodeId, hoverId]);

  // The steps in trouble. An arrow leaving one of these is the path a
  // missing ingredient takes through the plan, so it is drawn in ink:
  // the point of the board with something out of stock is to follow
  // what it costs, and a grey line asks you to trace it yourself.
  const problems = useMemo(
    () => new Set(nodes.filter((n) => (statusOf?.(n.id) || "craftable") !== "craftable").map((n) => n.id)),
    [nodes, statusOf]
  );

  const edges = useMemo(() => {
    // A lane, an exit and a landing of its own for every arrow — see
    // laneRouting. Sharing them is what turned eighteen arrows into one
    // thicket: you could see that something fed a step, not what.
    const lanes = laneRouting(nodes, boxes);
    // Pointing at a card answers "what does THIS touch" and takes over
    // from the trouble paths while it lasts.
    const focus = hoverId || selectedNodeId;
    const out = [];
    nodes.forEach((n) => {
      const deps = (n.depends_on || []).filter((d) => boxes[d] && boxes[n.id]);
      deps.forEach((depId) => {
        // Anything that isn't one of the two ends is something to avoid.
        const obstacles = Object.values(boxes).filter((b) => b.id !== n.id && b.id !== depId);
        out.push({
          key: `${depId}->${n.id}`,
          from: depId,
          to: n.id,
          d: edgePath(boxes[depId], boxes[n.id], obstacles, lanes.get(`${depId}>${n.id}`)),
          active: focus ? focus === n.id || focus === depId : problems.has(depId),
          // With something to follow, everything else steps back so the
          // path reads as a path rather than as more of the mesh.
          quiet: Boolean(focus) || problems.size > 0,
        });
      });
    });
    // The lit ones last, so a live arrow is drawn over the rest.
    return out.sort((a, b) => Number(a.active) - Number(b.active));
  }, [nodes, boxes, selectedNodeId, hoverId, problems]);

  // Move/up go on the window: once the cursor outruns the card the
  // events stop targeting it, and setPointerCapture isn't reliable here.
  const startDrag = (e, id) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    const board = boardRef.current.getBoundingClientRect();
    const p = posOf(id);
    // The rect is scaled; the positions aren't.
    setDrag({ id, dx: (e.clientX - board.left) / scale - p.x, dy: (e.clientY - board.top) / scale - p.y, from: p, moved: false });
    setGhost(p);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const board = boardRef.current?.getBoundingClientRect();
      if (!board) return;
      const at = {
        x: Math.max(0, (e.clientX - board.left) / scale - drag.dx),
        y: Math.max(0, (e.clientY - board.top) / scale - drag.dy),
      };
      if (Math.abs(at.x - drag.from.x) > 3 || Math.abs(at.y - drag.from.y) > 3) drag.moved = true;
      setGhost(at);
    };
    const up = () => {
      if (drag.moved && ghostRef.current) {
        // Land on the nearest spot that touches nothing.
        const others = nodes.filter((n) => n.id !== drag.id).map((n) => boxOf(posOf(n.id), sizes[n.id]));
        onMove(drag.id, settle(ghostRef.current, others, sizes[drag.id]));
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
  }, [drag, onMove, onSelect, nodes, positions, scale, sizes]);

  // Pointer position in board coordinates: the board is scaled, the
  // geometry isn't.
  const toBoard = useCallback(
    (e) => {
      const r = boardRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    },
    [scale]
  );

  const flash = useCallback((message) => {
    clearTimeout(messageTimer.current);
    setLinkMessage(message);
    messageTimer.current = setTimeout(() => setLinkMessage(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  // A port drag starts a link, never a card move and never the editor.
  const startLink = (e, id, dir) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const b = boxes[id];
    if (!b) return;
    const at = { x: dir === "out" ? b.x + b.w : b.x, y: b.y + b.h / 2 };
    setEdgeSel(null);
    setLink({ from: id, dir, x0: at.x, y0: at.y, ...at });
  };

  useEffect(() => {
    if (!link) return undefined;
    const move = (e) => {
      setLink((current) => (current ? { ...current, ...toBoard(e) } : current));
      // preventDefault on the port's pointerdown stops the compatibility
      // mouse events, so mouseenter/leave go quiet for the whole drag.
      // The card under the pointer has to be found by hand.
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-node-id]");
      setHoverId(over?.getAttribute("data-node-id") || null);
    };
    const up = (e) => {
      setLink(null);
      setHoverId(null);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el?.closest?.("[data-node-id]");
      const target = card?.getAttribute("data-node-id");
      if (!target || target === link.from) return;
      // The right port says "this one comes first"; the left port says
      // "this one comes after".
      const [parent, child] = link.dir === "out" ? [link.from, target] : [target, link.from];
      const rejection = linkRejection(nodes, parent, child);
      if (rejection) {
        flash(rejection);
        return;
      }
      onLink?.(parent, child);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [link, nodes, onLink, toBoard, flash]);

  // A picked arrow answers to the keyboard as well as to its pill.
  useEffect(() => {
    if (!edgeSel) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setEdgeSel(null);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || "")) return;
      e.preventDefault();
      onUnlink?.(edgeSel.from, edgeSel.to);
      setEdgeSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edgeSel, onUnlink]);

  // Grabbing the background scrolls the viewport under the board. Done
  // by moving the scroll container, not transforming the board, so the
  // edge geometry stays in one coordinate space.
  const startPan = (e) => {
    if (e.button !== 0 || e.target.closest(".board-card")) return;
    setEdgeSel(null);
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
      const size = sizeOf(n);
      return { w: Math.max(acc.w, p.x + size.w + PAD), h: Math.max(acc.h, p.y + size.h + PAD) };
    },
    { w: 640, h: 320 }
  );
  // Fit the whole graph into the frame, so nothing needs panning to be
  // found. The panel's strip is deliberately not subtracted: rescaling
  // every time it opens would shrink the cards past readable. It gets
  // scroll room instead (below), and the selection pans clear of it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const fit = () => {
      if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
      const k = Math.min(1, el.clientWidth / content.w, el.clientHeight / content.h);
      setFitScale(Math.max(MIN_SCALE, Math.round(k * 1000) / 1000));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content.w, content.h]);

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
    const width = (el.clientWidth - reserveRight) / scale;
    const left = fit(box.x1, box.x2, el.scrollLeft / scale, width, sel.x, sel.x + sel.w) * scale;
    const top = fit(box.y1, box.y2, el.scrollTop / scale, el.clientHeight / scale, sel.y, sel.y + sel.h) * scale;
    if (Math.abs(left - el.scrollLeft) < 1 && Math.abs(top - el.scrollTop) < 1) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    // Only when the selection or the overlay changes — not on every drag frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, reserveRight, scale]);

  useEffect(() => onFitScale?.(fitScale), [fitScale, onFitScale]);

  // Voice's "scroll right"/"scroll to step X" have no card or slider to
  // click, so the scroll container needs an imperative door in. Kept
  // narrow — two methods, not a general escape hatch — everything else
  // about the board stays driven by props.
  useImperativeHandle(
    ref,
    () => ({
      scrollBy: (dx, dy) => {
        const el = scrollRef.current;
        if (!el) return;
        const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollBy({ left: dx, top: dy, behavior: smooth ? "smooth" : "auto" });
      },
      scrollToNode: (id) => {
        const el = scrollRef.current;
        const b = boxes[id];
        if (!el || !b) return false;
        const left = Math.max(0, (b.x + b.w / 2) * scale - el.clientWidth / 2);
        const top = Math.max(0, (b.y + b.h / 2) * scale - el.clientHeight / 2);
        const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollTo({ left, top, behavior: smooth ? "smooth" : "auto" });
        return true;
      },
    }),
    [boxes, scale]
  );

  // Which cards are scrolled out of view, for the caption under the board.
  const offscreenKey = useRef("");
  const reportOffscreen = () => {
    const el = scrollRef.current;
    if (!el || !onOffscreen) return;
    const view = {
      x1: el.scrollLeft / scale,
      x2: (el.scrollLeft + el.clientWidth) / scale,
      y1: el.scrollTop / scale,
      y2: (el.scrollTop + el.clientHeight) / scale,
    };
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
      <div className="board-zoom" style={{ width: content.w * scale + reserveRight, height: content.h * scale }}>
      <div
        className="board"
        ref={boardRef}
        style={{ width: content.w, height: content.h, transform: `scale(${scale})` }}
        onPointerDown={startPan}
      >
        <svg className="board-edges" width={content.w} height={content.h} aria-hidden="true">
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
          {edges.map((e) => {
            const picked = edgeSel?.from === e.from && edgeSel?.to === e.to;
            return (
              <g key={e.key}>
                <path
                  d={e.d}
                  className={`board-edge${e.active ? " is-active" : ""}${e.quiet && !e.active ? " is-quiet" : ""}${
                    picked ? " is-picked" : ""
                  }`}
                  markerEnd={`url(#board-arrow${e.active || picked ? "-active" : ""})`}
                />
                {/* The line itself is 1.5px — far too thin to hit. This
                    invisible one takes the click for it. */}
                {!readOnly && (
                  <path
                    d={e.d}
                    className="board-edge-hit"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEdgeSel({ from: e.from, to: e.to, ...toBoard(ev) });
                    }}
                  />
                )}
              </g>
            );
          })}
          {link && (
            <path
              className="board-link-preview"
              d={`M ${link.x0} ${link.y0} C ${link.x0 + (link.dir === "out" ? 60 : -60)} ${link.y0}, ${
                link.x + (link.dir === "out" ? -60 : 60)
              } ${link.y}, ${link.x} ${link.y}`}
              markerEnd="url(#board-arrow-active)"
            />
          )}
        </svg>

        {nodes.map((n, i) => {
          const p = posOf(n.id);
          const status = statusOf?.(n.id) || "craftable";
          const tail = STATUS_WORD[status] || dishLabelFor?.(n);
          const number = numberOf?.(n.id);
          const size = sizeOf(n);
          // A step in trouble is written on the same paper as any other
          // — the dish it belongs to does not change because an
          // ingredient ran out. The state is said in the border and the
          // ink instead.
          const paper = paperOf?.(n);
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
              style={{
                left: p.x,
                top: p.y,
                width: size.w,
                height: size.h,
                transform: `rotate(${CARD_TILTS[i % CARD_TILTS.length]}deg)`,
                // The paper's own edge goes in through a variable, not
                // as an inline border: an inline rule would outrank the
                // heavier border a blocked or at-risk step needs.
                ...(paper ? { background: paper.bg, "--card-edge": paper.border } : null),
              }}
              data-node-id={n.id}
              onPointerDown={(e) => startDrag(e, n.id)}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId((id) => (id === n.id ? null : id))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            >
              <span className="board-card-top">
                {number && <span className="board-card-num mono">{number}</span>}
                <span className="board-card-meta mono">{formatMinutes(n.estimated_duration_sec)}</span>
              </span>
              <span className="board-card-label">{n.label}</span>
              {tail && <span className="sr-only">{tail}</span>}
            </button>
          );
        })}
        {/* Above the cards, because a card clips its own overflow and
            both the ring and the ports live outside their card's box. */}
        <div className="board-overlay">
          {/* A strip of tape in the phase's colour, straddling the top
              edge of the slip: which part of the cook a step belongs to,
              read before the words are. Up here because a card clips its
              own overflow, and half the tape hangs over the edge. */}
          {nodes.map((n, i) => {
            const b = boxes[n.id];
            if (!b) return null;
            return (
              <span
                key={n.id}
                className={`board-tape phase-${n.phase || "prep"}`}
                aria-hidden="true"
                style={{
                  left: b.x + b.w / 2,
                  top: b.y,
                  transform: `translate(-50%, -50%) rotate(${TAPE_TILTS[i % TAPE_TILTS.length]}deg)`,
                }}
              />
            );
          })}
          {selectedNodeId && boxes[selectedNodeId] && (
            <span
              className="board-mark-slot"
              style={{
                left: boxes[selectedNodeId].x,
                top: boxes[selectedNodeId].y,
                width: boxes[selectedNodeId].w,
                height: boxes[selectedNodeId].h,
              }}
            >
              <SelectionMark />
            </span>
          )}
          {!readOnly &&
            nodes.map((n) => {
              const b = boxes[n.id];
              if (!b) return null;
              // Quiet until the card is wanted; while a link is being
              // drawn every card shows where it can be dropped.
              const shown = link ? (link.from === n.id ? 1 : 0.35) : hoverId === n.id || selectedNodeId === n.id ? 1 : 0;
              const isTarget = link && link.from !== n.id && hoverId === n.id;
              return (
                <span key={n.id} className={`board-ports${isTarget ? " is-target" : ""}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                  {[
                    ["in", "Drag to a step that comes before"],
                    ["out", "Drag to a step that comes next"],
                  ].map(([dir, title]) => (
                    <span
                      key={dir}
                      className={`board-port is-${dir}`}
                      style={{ opacity: shown }}
                      title={title}
                      data-node-id={n.id}
                      onPointerDown={(e) => startLink(e, n.id, dir)}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId((id) => (id === n.id ? null : id))}
                    />
                  ))}
                </span>
              );
            })}
          {edgeSel && (
            <button
              type="button"
              className="board-unlink"
              style={{ left: edgeSel.x, top: edgeSel.y }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onUnlink?.(edgeSel.from, edgeSel.to);
                setEdgeSel(null);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Unlink
            </button>
          )}
        </div>
      </div>
      </div>
      {linkMessage && (
        <span className="board-toast" role="status">
          {linkMessage}
        </span>
      )}
    </div>
  );
});

export default RecipeBoard;
