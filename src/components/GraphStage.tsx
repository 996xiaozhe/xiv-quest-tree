import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Quest } from '../types.ts';
import { layoutGraph, DEFAULT_X_STEP, DEFAULT_Y_STEP } from '../graph/layout.ts';
import { clampScale, focusViewport, scaleForColumns } from '../graph/camera.ts';
import { drawGraph, DETAIL_MAX_QUESTS, type Viewport } from '../graph/render.ts';
import { buildEdgeModel, buildNodeModel } from '../graph/model.ts';
import { markerIconForQuest } from '../graph/icons.ts';
import { MarkerIcon } from './MarkerIcon.tsx';
import { isMainScenario } from '../types.ts';
import type { Theme } from '../graph/theme.ts';

export interface GraphHandle {
  fit: (animate?: boolean) => void;
  zoomBy: (factor: number) => void;
  focus: (id: number, scale?: number, anchorX?: number, columns?: number) => void;
  centerMain: () => void;
}

interface Props {
  nodes: Quest[];
  index: Map<number, Quest>;
  selected: number | null;
  /** right-click on a node; x/y are relative to the stage element */
  onNodeContextMenu?: (id: number, x: number, y: number) => void;
  onSelect: (id: number | null) => void;
  highlight: Set<number> | null;
  matches: Set<number>;
  langIndex: 0 | 1 | 2;
  showLocks: boolean;
  /** quests that count as finished — drawn fainter */
  done: Set<number>;
  /** day or night canvas palette */
  theme: Theme;
  /** UI translator, used only for the hover tooltip */
  t: (key: string) => string;
  /** changing `nonce` asks the stage to fly to `id` */
  focusRequest?: {
    id: number;
    nonce: number;
    scale?: number;
    /** horizontal screen fraction the node should land on (0.5 = centred) */
    anchorX?: number;
    /** when set, pick the zoom that fits this many quest columns across the stage */
    columns?: number;
  } | null;
}

interface CamState {
  vp: Viewport;
  target: Viewport | null;
  anim: number;
}

export const GraphStage = forwardRef<GraphHandle, Props>(function GraphStage(props, ref) {
  const { nodes, index, selected, onSelect, highlight, matches, langIndex, showLocks, done, t, theme, focusRequest } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });
  // Hover lives here rather than in App on purpose: putting it in App re-rendered the
  // 364-row filter sidebar on every mouse move, which is what made panning feel slow.
  const [hovered, setHovered] = useState<number | null>(null);
  const camRef = useRef<CamState>({ vp: { x: 0, y: 0, scale: 1 }, target: null, anim: 0 });
  const dirtyRef = useRef(true);

  /* ------------------------------------------------------------------ layout */
  const layout = useMemo(
    () =>
      layoutGraph(nodes, index, {
        xStep: DEFAULT_X_STEP,
        yStep: DEFAULT_Y_STEP,
        isMain: isMainScenario,
      }),
    [nodes, index],
  );

  /** flat array of visible node positions — much faster than Map lookups while hit-testing */
  const flat = useMemo(
    () =>
      nodes.map((q) => {
        const p = layout.pos.get(q.id);
        return { id: q.id, x: p ? p.x : 0, y: p ? p.y : 0 };
      }),
    [nodes, layout],
  );

  // Everything that does not depend on the viewport is precomputed once per filter
  // change: typed arrays of positions plus per-colour index buckets and the edge list.
  const model = useMemo(() => buildNodeModel(nodes, layout.pos, theme, done), [nodes, layout, theme, done]);
  const edgeModel = useMemo(() => buildEdgeModel(nodes, model.byId, showLocks), [nodes, model, showLocks]);

  // No marker bitmaps are ever drawn on a node — every quest is a plain diamond — so
  // there is nothing to preload here; the legend and the hover card use <img> URLs.

  /* ------------------------------------------------------------------ sizing */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(120, r.width);
      const h = Math.max(120, r.height);
      setSize((prev) => (Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }));
      dirtyRef.current = true;
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  // Refs mirror the latest values so the imperative camera API never goes stale
  // without forcing the callbacks to change identity (which would restart the
  // animation loop on every render).
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /* --------------------------------------------------------------- fit logic */
  const computeFit = useCallback((): Viewport => {
    const lay = layoutRef.current;
    const { w: vw, h: vh } = sizeRef.current;
    const cx = (lay.minX + lay.maxX) / 2;
    const cy = (lay.minY + lay.maxY) / 2;
    const w = Math.max(1, lay.maxX - lay.minX);
    const h = Math.max(1, lay.maxY - lay.minY);
    const scale = Math.min((vw - 56) / w, (vh - 56) / h);
    return { x: cx, y: cy, scale: clampScale(scale) };
  }, []);

  const animateTo = useCallback((target: Viewport) => {
    camRef.current.target = target;
    camRef.current.anim = performance.now();
    dirtyRef.current = true;
  }, []);

  const fit = useCallback(
    (animate = true) => {
      const target = computeFit();
      if (animate) animateTo(target);
      else {
        camRef.current.vp = target;
        camRef.current.target = null;
        dirtyRef.current = true;
      }
    },
    [computeFit, animateTo],
  );

  const zoomBy = useCallback((factor: number) => {
    const v = camRef.current.vp;
    camRef.current.vp = { ...v, scale: clampScale(v.scale * factor) };
    camRef.current.target = null;
    dirtyRef.current = true;
  }, []);

  const focus = useCallback(
    (id: number, scale?: number, anchorX = 0.5, columns?: number) => {
      const p = layoutRef.current.pos.get(id);
      if (!p) return;
      const { w } = sizeRef.current;
      const s =
        columns != null && columns > 0
          ? scaleForColumns(w, columns, DEFAULT_X_STEP)
          : clampScale(scale ?? Math.max(camRef.current.vp.scale, 0.85));
      animateTo(focusViewport(p, w, s, anchorX));
    },
    [animateTo],
  );

  const centerMain = useCallback(() => {
    const lay = layoutRef.current;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const q of nodes) {
      if (!isMainScenario(q)) continue;
      const p = lay.pos.get(q.id);
      if (!p) continue;
      sx += p.x;
      sy += p.y;
      n++;
    }
    if (!n) return;
    animateTo({ x: sx / n, y: sy / n, scale: Math.max(camRef.current.vp.scale, 0.3) });
  }, [nodes, animateTo]);

  useImperativeHandle(ref, () => ({ fit, zoomBy, focus, centerMain }), [fit, zoomBy, focus, centerMain]);

  // Fit when the visible graph changes, and once more when the stage first learns
  // its real pixel size. Deliberately NOT on every resize: that would throw away
  // the user's zoom level.
  const lastFittedLayout = useRef<typeof layout | null>(null);
  const hadRealSize = useRef(false);
  useEffect(() => {
    if (size.w <= 220 || size.h <= 220) return;
    const layoutChanged = lastFittedLayout.current !== layout;
    const sizeJustBecameKnown = !hadRealSize.current;
    if (!layoutChanged && !sizeJustBecameKnown) return;
    lastFittedLayout.current = layout;
    hadRealSize.current = true;
    fit(false);
  }, [layout, size, fit]);

  // explicit "fly to" requests coming from search / the detail panel / a /pre|/post link.
  // Each request is honoured exactly once: the layout also changes when a filter changes,
  // and re-applying the last request there would yank the camera back to whatever quest
  // was searched minutes ago instead of framing the view the user just asked for.
  const appliedFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === appliedFocus.current) return;
    // the node may not be laid out yet (e.g. filters were just cleared for it) — keep the
    // request pending, the next layout will find it
    if (!layout.pos.has(focusRequest.id)) return;
    appliedFocus.current = focusRequest.nonce;
    focus(focusRequest.id, focusRequest.scale, focusRequest.anchorX, focusRequest.columns);
  }, [focusRequest, focus, layout]);

  /* ------------------------------------------------------------------ render */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0) return;
    // The full-graph view is a dense scatter of thousands of markers; rendering it at
    // the full device pixel ratio costs 2-4x the fill area for no visible gain (labels
    // are hidden at that zoom anyway), so cap the backing store there.
    const native = window.devicePixelRatio || 1;
    const dpr = nodes.length > DETAIL_MAX_QUESTS ? Math.min(1.25, native) : Math.min(2.5, native);
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = size.w + 'px';
      canvas.style.height = size.h + 'px';
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawGraph({
      ctx,
      width: size.w,
      height: size.h,
      dpr,
      viewport: camRef.current.vp,
      model,
      edges: edgeModel,
      hovered,
      selected,
      highlight,
      matches,
      langIndex,
      theme,
    });
  }, [size, nodes, model, edgeModel, hovered, selected, highlight, matches, langIndex, theme]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const cam = camRef.current;
      if (cam.target) {
        const t = Math.min(1, (performance.now() - cam.anim) / 340);
        const e = 1 - Math.pow(1 - t, 3);
        cam.vp = {
          x: cam.vp.x + (cam.target.x - cam.vp.x) * e,
          y: cam.vp.y + (cam.target.y - cam.vp.y) * e,
          scale: cam.vp.scale + (cam.target.scale - cam.vp.scale) * e,
        };
        dirtyRef.current = true;
        if (t >= 1) cam.target = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [nodes, model, edgeModel, hovered, selected, highlight, matches, langIndex, theme, size]);

  /* ------------------------------------------------------------- interaction */
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; panning: boolean } | null>(null);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const vp = camRef.current.vp;
    return {
      x: (clientX - r.left - r.width / 2) / vp.scale + vp.x,
      y: (clientY - r.top - r.height / 2) / vp.scale + vp.y,
    };
  }, []);

  const hitTest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const p = toWorld(clientX, clientY);
      const tol = 11 / camRef.current.vp.scale;
      let best: number | null = null;
      let bestD = tol * tol;
      for (let i = 0; i < flat.length; i++) {
        const n = flat[i];
        const dx = n.x - p.x;
        if (dx > tol || dx < -tol) continue;
        const dy = n.y - p.y;
        if (dy > tol || dy < -tol) continue;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = n.id;
        }
      }
      return best;
    },
    [flat, toWorld],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, panning: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      const id = hitTest(e.clientX, e.clientY);
      // functional update: React bails out when the value is unchanged
      setHovered((prev) => (prev === id ? prev : id));
      return;
    }
    // Decide pan-vs-click from the NET displacement from the press point, not from the
    // accumulated path: a hand that jitters a few pixels and comes back is still a
    // click, and must not be swallowed by an accidental micro-pan.
    if (!drag.panning) {
      const net = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (net > 5) {
        drag.panning = true;
        setHovered((prev) => (prev === null ? prev : null));
      }
    }
    if (drag.panning) {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      const vp = camRef.current.vp;
      camRef.current.vp = { ...vp, x: vp.x - dx / vp.scale, y: vp.y - dy / vp.scale };
      camRef.current.target = null;
      dirtyRef.current = true;
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.panning) return;
    const id = hitTest(e.clientX, e.clientY);
    onSelect(id === selected ? null : id);
  };

  // Native (non-passive) wheel listener: React registers `wheel` passively at the
  // root container, which turns preventDefault() into a no-op.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const vp = camRef.current.vp;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const scale = clampScale(vp.scale * factor);
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      const wx = cx / vp.scale + vp.x;
      const wy = cy / vp.scale + vp.y;
      camRef.current.vp = { x: wx - cx / scale, y: wy - cy / scale, scale };
      camRef.current.target = null;
      dirtyRef.current = true;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = hitTest(e.clientX, e.clientY);
    if (id != null) focus(id, Math.max(camRef.current.vp.scale, 1.1));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const id = hitTest(e.clientX, e.clientY);
    if (id == null) return;
    const el = wrapRef.current;
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
    props.onNodeContextMenu?.(id, e.clientX - r.left, e.clientY - r.top);
  };

  const hoveredQuest = hovered != null ? index.get(hovered) ?? null : null;

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => {
          setHovered(null);
          dragRef.current = null;
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      {hoveredQuest && nodes.length <= DETAIL_MAX_QUESTS ? (
        <div className="hover-tip">
          <MarkerIcon className="tip-icon" id={markerIconForQuest(hoveredQuest)} size={22} />
          <div>
            <b>{(langIndex === 0 ? hoveredQuest.cn : langIndex === 1 ? hoveredQuest.en : hoveredQuest.ja) || hoveredQuest.en}</b>
            <span>
              {hoveredQuest.lv ? `Lv.${hoveredQuest.lv}` : ''} {hoveredQuest.patch ? `v${hoveredQuest.patch}` : ''}
            </span>
            {isMainScenario(hoveredQuest) ? <em>{t('legend.main')}</em> : null}
          </div>
        </div>
      ) : hoveredQuest ? (
        <div className="hover-tip">
          <div>
            <b>{(langIndex === 0 ? hoveredQuest.cn : langIndex === 1 ? hoveredQuest.en : hoveredQuest.ja) || hoveredQuest.en}</b>
            <span>
              {hoveredQuest.lv ? `Lv.${hoveredQuest.lv}` : ''} {hoveredQuest.patch ? `v${hoveredQuest.patch}` : ''}
            </span>
            {isMainScenario(hoveredQuest) ? <em>{t('legend.main')}</em> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
