import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type T = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  /** deep link to the interactive map, marker included */
  url: string;
  /** the quest, shown as a subtitle */
  quest: string;
  /** "甘戈斯 X:6.4 Y:5.7" — what the user actually asked for */
  where: string;
  t: T;
  onClose: () => void;
}

const DEFAULT_SIDE = 760;
const MIN_W = 320;
const MIN_H = 260;
/** How much of the panel has to stay on screen while dragging. */
const KEEP_VISIBLE = 120;
/** Gap kept between the panel and the viewport edges. */
const EDGE_GAP = 32;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const maxW = () => Math.max(MIN_W, (typeof window === 'undefined' ? 1280 : window.innerWidth) - EDGE_GAP);
const maxH = () => Math.max(MIN_H, (typeof window === 'undefined' ? 800 : window.innerHeight) - EDGE_GAP);

/** Opens as a square that fits the viewport — after that both sides are the user's. */
function defaultSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: DEFAULT_SIDE, h: DEFAULT_SIDE };
  const fit = Math.max(MIN_W, Math.min(window.innerWidth, window.innerHeight) - 48);
  const side = Math.max(MIN_W, Math.min(DEFAULT_SIDE, fit));
  return { w: side, h: Math.max(MIN_H, side) };
}

interface DragState {
  px: number;
  py: number;
  x: number;
  y: number;
}

interface ResizeState {
  px: number;
  py: number;
  w: number;
  h: number;
  /** offset and size when the drag started, so every move is absolute, not cumulative */
  ox: number;
  oy: number;
  /** which edges this grip moves: -1 = west/north, 0 = untouched, +1 = east/south */
  sx: number;
  sy: number;
}

/** Corners resize both axes, edge grips only one — like any window. */
const GRIPS: readonly [string, number, number][] = [
  ['nw', -1, -1],
  ['n', 0, -1],
  ['ne', 1, -1],
  ['w', -1, 0],
  ['e', 1, 0],
  ['sw', -1, 1],
  ['s', 0, 1],
  ['se', 1, 1],
];

/**
 * The interactive map in a floating window over the app (the site documents itself as an
 * embeddable map, and answers without X-Frame-Options / frame-ancestors, so an iframe in
 * a portal is enough — no jQuery/leaflet bundle of our own, and panning/zooming inside
 * the map keeps working exactly as it does on their site).
 *
 * The window opens square, is dragged by its title bar and resized from any of its eight
 * grips — width and height move independently, the opposite edge stays pinned, and the
 * geometry lives in CSS custom properties so the narrow-screen rule can simply override
 * width/height instead of fighting inline styles.
 *
 * Portalled to <body> so that no ancestor's containment or backdrop-filter can turn
 * `position: fixed` into "fixed inside that panel".
 */
export function MapPanel({ url, quest, where, t, onClose }: Props) {
  const [size, setSize] = useState(defaultSize);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind the panel keeps its scroll position but must not scroll along.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Keep the window reachable after the viewport changes.
  useEffect(() => {
    const onResize = () => {
      setSize((s) => ({ w: clamp(s.w, MIN_W, maxW()), h: clamp(s.h, MIN_H, maxH()) }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** How far the panel may be pushed from the centre before it leaves the screen. */
  const limit = (w = size.w, h = size.h) => {
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
    return { x: (vw + w) / 2 - KEEP_VISIBLE, y: (vh + h) / 2 - KEEP_VISIBLE };
  };

  /* ------------------------------------------------------------------ drag -- */
  const onHeadDown = (e: React.PointerEvent) => {
    // The controls in the title bar are not a drag handle.
    if ((e.target as HTMLElement).closest('button, a')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: offset.x, y: offset.y };
    setDragging(true);
  };
  const onHeadMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const lim = limit();
    setOffset({
      x: clamp(d.x + (e.clientX - d.px), -lim.x, lim.x),
      y: clamp(d.y + (e.clientY - d.py), -lim.y, lim.y),
    });
  };
  const onHeadUp = () => {
    drag.current = null;
    setDragging(false);
  };

  /* ---------------------------------------------------------------- resize -- */
  const onResizeDown = (sx: number, sy: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    resize.current = { px: e.clientX, py: e.clientY, w: size.w, h: size.h, ox: offset.x, oy: offset.y, sx, sy };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resize.current;
    if (!r) return;
    const w = clamp(r.w + (r.sx === 0 ? 0 : r.sx * (e.clientX - r.px)), MIN_W, maxW());
    const h = clamp(r.h + (r.sy === 0 ? 0 : r.sy * (e.clientY - r.py)), MIN_H, maxH());
    // Keep the opposite edge pinned: the centre moves by half of the growth, measured
    // from where the drag started (accumulating it would overshoot on every move).
    const lim = limit(w, h);
    setSize({ w, h });
    setOffset({
      x: clamp(r.ox + (r.sx * (w - r.w)) / 2, -lim.x, lim.x),
      y: clamp(r.oy + (r.sy * (h - r.h)) / 2, -lim.y, lim.y),
    });
  };
  const onResizeUp = () => {
    resize.current = null;
  };

  return createPortal(
    <div
      className="map-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('map.title')}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="map-panel"
        style={
          {
            '--map-w': `${size.w}px`,
            '--map-h': `${size.h}px`,
            '--map-x': `${Math.round(offset.x)}px`,
            '--map-y': `${Math.round(offset.y)}px`,
          } as React.CSSProperties
        }
      >
        <header
          className={'map-head' + (dragging ? ' dragging' : '')}
          onPointerDown={onHeadDown}
          onPointerMove={onHeadMove}
          onPointerUp={onHeadUp}
          onPointerCancel={onHeadUp}
        >
          <div className="map-titles">
            <strong>{where}</strong>
            <span>{quest}</span>
          </div>
          <a className="map-ext" href={url} target="_blank" rel="noreferrer noopener">
            {t('map.openSite')}
          </a>
          <button type="button" className="map-close" onClick={onClose} aria-label={t('map.close')} title={t('map.close')}>
            ×
          </button>
        </header>
        <iframe className="map-frame" src={url} title={`${where} · ${t('map.title')}`} referrerPolicy="no-referrer" />
        {GRIPS.map(([name, sx, sy]) => (
          <span
            key={name}
            className={`map-resize ${name}`}
            aria-hidden
            onPointerDown={onResizeDown(sx, sy)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
