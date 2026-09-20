import type { NodeModel, EdgeModel } from './model.ts';
import { paletteFor, rgba, type Palette, type Theme } from './theme.ts';

export interface Viewport {
  /** world coordinate shown at the centre of the canvas */
  x: number;
  y: number;
  scale: number;
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels — the canvas backing store is dpr times larger */
  width: number;
  height: number;
  /**
   * Device pixel ratio of the backing store. The renderer owns this transform: it
   * must NOT reset to identity, or the scene would be drawn at a different scale
   * than the hit test assumes and clicks would land beside the marker (only visible
   * on displays with OS scaling != 100%).
   */
  dpr: number;
  viewport: Viewport;
  model: NodeModel;
  edges: EdgeModel;
  hovered: number | null;
  selected: number | null;
  /** prerequisites of the selection — the chain that is emphasised */
  highlight: Set<number> | null;
  /** quests matching the current search */
  matches: Set<number>;
  /** 0 = cn, 1 = en, 2 = ja */
  langIndex: 0 | 1 | 2;
  /** selects the day or night canvas palette */
  theme: Theme;
}

/**
 * Every quest is drawn as a flat diamond, batched into one path per colour group — at
 * every zoom level and whatever the size of the visible set. Marker artwork is never
 * layered onto a node; the official quest-marker icons only appear in the legend and in
 * the hover card.
 *
 * A view this small is cheap enough for extra fidelity elsewhere: the canvas runs at the
 * full device pixel ratio and the hover card shows the quest's marker icon.
 */
export const DETAIL_MAX_QUESTS = 50;

const LABEL_FONT = '"Segoe UI", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans", Meiryo, sans-serif';

function diamond(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x, y - r);
  p.lineTo(x + r, y);
  p.lineTo(x, y + r);
  p.lineTo(x - r, y);
}

const nodeName = (q: { cn: string; en: string; ja: string }, langIndex: 0 | 1 | 2) =>
  (langIndex === 0 ? q.cn : langIndex === 1 ? q.en : q.ja) || q.en || q.cn || q.ja;

export function drawGraph(input: DrawInput): void {
  const { ctx, width, height, dpr, viewport: vp, model, edges, hovered, selected, highlight, matches, langIndex, theme } = input;
  const pal: Palette = paletteFor(theme);

  // Everything below is expressed in CSS pixels; the dpr transform scales it onto the
  // backing store. Keeping it here (instead of the caller) is what guarantees the
  // drawing and the pointer hit test share one coordinate system.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(vp.scale, vp.scale);
  ctx.translate(-vp.x, -vp.y);

  const pad = 140 / vp.scale;
  const minX = vp.x - width / 2 / vp.scale - pad;
  const maxX = vp.x + width / 2 / vp.scale + pad;
  const minY = vp.y - height / 2 / vp.scale - pad;
  const maxY = vp.y + height / 2 / vp.scale + pad;

  const { x, y, count, groups, main } = model;
  const hasSelection = selected != null || highlight != null;

  // One shape for every node: no icon is ever stacked on a diamond, so the size only
  // depends on whether the quest is main scenario.
  const radius = (i: number): number => (main[i] === 1 ? 6.6 : 4.6);

  /* -------------------------------------------------------------------- edges */
  if (edges.count) {
    const ax = edges.a;
    const bx = edges.b;
    const isLock = edges.lock;
    const normal = new Path2D();
    const lockPath = new Path2D();
    const hot = new Path2D();
    const hoveredIdx = hovered != null ? model.byId.get(hovered) ?? -1 : -1;

    // Only the prerequisite chain is emphasised. An edge lights up when BOTH of its
    // ends are highlighted, and the highlight set holds ancestors only — so links
    // running forward to a follow-up quest never light up.
    let hotMask: Uint8Array | null = null;
    let hasLocks = false;
    if (highlight && highlight.size) {
      hotMask = new Uint8Array(count);
      for (const id of highlight) {
        const hi = model.byId.get(id);
        if (hi !== undefined) hotMask[hi] = 1;
      }
    }

    for (let i = 0; i < edges.count; i++) {
      const ai = ax[i];
      const bi = bx[i];
      const x0 = x[ai];
      const y0 = y[ai];
      const x1 = x[bi];
      const y1 = y[bi];
      if (Math.max(x0, x1) < minX || Math.min(x0, x1) > maxX) continue;
      if (Math.max(y0, y1) < minY || Math.min(y0, y1) > maxY) continue;
      const lock = isLock[i] === 1;
      if (lock) hasLocks = true;
      const isHot = (hotMask !== null && hotMask[ai] === 1 && hotMask[bi] === 1) || bi === hoveredIdx;
      const target = isHot ? hot : lock ? lockPath : normal;
      target.moveTo(x0, y0);
      target.lineTo(x1, y1);
    }

    ctx.lineWidth = 1 / vp.scale;
    ctx.strokeStyle = rgba(pal.edge, hasSelection ? 0.3 : 0.46);
    ctx.stroke(normal);
    if (hasLocks) {
      ctx.strokeStyle = rgba(pal.edgeLock, hasSelection ? 0.28 : 0.4);
      ctx.setLineDash([5 / vp.scale, 4 / vp.scale]);
      ctx.stroke(lockPath);
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 2 / vp.scale;
    ctx.strokeStyle = rgba(pal.gold, 0.9);
    ctx.stroke(hot);
  }

  /* -------------------------------------------------------------------- nodes */
  // Counted while drawing: labels are gated on what is actually on screen, not on the
  // size of the filtered set, so zooming into the global graph still shows names.
  const onScreen: number[] = [];
  for (const g of groups) {
    const idx = g.indices;
    const path = new Path2D();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const px = x[i];
      if (px < minX || px > maxX) continue;
      const py = y[i];
      if (py < minY || py > maxY) continue;
      diamond(path, px, py, radius(i));
      onScreen.push(i);
    }
    ctx.fillStyle = rgba(g.color, hasSelection ? 0.45 : 0.95);
    ctx.fill(path);
  }

  /* ---------------------------------------------------------- search matches */
  if (matches.size) {
    const hit = new Path2D();
    for (const id of matches) {
      const i = model.byId.get(id);
      if (i === undefined) continue;
      const px = x[i];
      const py = y[i];
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      diamond(hit, px, py, radius(i) + 4);
    }
    ctx.strokeStyle = pal.matchRing;
    ctx.lineWidth = 2.2 / vp.scale;
    ctx.stroke(hit);
  }

  /* ------------------------------------------------------- related highlight */
  // Rings the prerequisites of the selection, never its follow-ups.
  if (highlight && highlight.size) {
    const ring = new Path2D();
    for (const id of highlight) {
      if (id === selected) continue; // already carries the stronger selection ring
      const i = model.byId.get(id);
      if (i === undefined) continue;
      const px = x[i];
      const py = y[i];
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      diamond(ring, px, py, radius(i) + 3.5);
    }
    ctx.strokeStyle = pal.highlightRing;
    ctx.lineWidth = 1.6 / vp.scale;
    ctx.stroke(ring);
  }

  /* --------------------------------------------------------- hover / selection */
  const markerRing = (i: number, outset: number) => {
    const path = new Path2D();
    diamond(path, x[i], y[i], radius(i) + outset);
    return path;
  };
  if (hovered != null) {
    const i = model.byId.get(hovered);
    if (i !== undefined) {
      ctx.strokeStyle = pal.hoverRing;
      ctx.lineWidth = 1.8 / vp.scale;
      ctx.stroke(markerRing(i, 3));
    }
  }
  if (selected != null) {
    const i = model.byId.get(selected);
    if (i !== undefined) {
      // A double ring — a wide translucent halo under a crisp line — so the selection
      // stays obvious against both the dark and the parchment background.
      ctx.strokeStyle = pal.selectHalo;
      ctx.lineWidth = 6 / vp.scale;
      ctx.stroke(markerRing(i, 6));
      ctx.strokeStyle = pal.selectRing;
      ctx.lineWidth = 2.6 / vp.scale;
      ctx.stroke(markerRing(i, 5));
    }
  }

  /* ------------------------------------------------------------------- labels */
  // No toggle: names appear on their own once the zoom makes them readable. The halo
  // behind the glyphs is what keeps them legible over a dense cluster of markers.
  if (vp.scale > 0.5 && onScreen.length <= 900) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = pal.labelHalo;
    ctx.shadowBlur = 3;
    const searching = matches.size > 0;
    const selIdx = selected != null ? model.byId.get(selected) : undefined;
    const hovIdx = hovered != null ? model.byId.get(hovered) : undefined;
    // A label sits to the RIGHT of its diamond, so it has to clear whatever ring is
    // drawn around it. The rings are defined in world units (their stroke is divided by
    // the zoom to keep a constant pixel width), which is why a fixed pixel offset got
    // eaten by the selection halo: at scale 1 the halo already reaches 9 world units out
    // while the name started at 4. Ask each ring how far it actually goes instead, then
    // add a 6px breathing gap.
    const px = 1 / vp.scale; // one CSS pixel, in world units
    const ringOuter = (i: number, id: number): number => {
      if (i === selIdx) return 6 + 3 * px; // halo: radius + 6, 6px stroke
      if (i === hovIdx) return 3 + 0.9 * px; // hover ring: radius + 3, 1.8px stroke
      if (matches.has(id)) return 4 + 1.1 * px; // search ring: radius + 4, 2.2px stroke
      if (highlight?.has(id)) return 3.5 + 0.8 * px; // prerequisite ring
      return 0;
    };
    let drawn = 0;
    for (let k = 0; k < onScreen.length && drawn <= 700; k++) {
      const i = onScreen[k];
      const isMain = main[i] === 1;
      const important = searching || i === selIdx || i === hovIdx;
      if (!important && vp.scale < 0.6) continue;
      if (!important && !isMain && vp.scale < 0.8) continue;
      const size = (important ? 18 : isMain ? 17 : 16) / vp.scale;
      ctx.font = `${important || isMain ? 600 : 500} ${size}px ${LABEL_FONT}`;
      ctx.fillStyle = important ? pal.labelHot : isMain ? pal.labelMain : pal.labelOther;
      const q = model.quests[i];
      ctx.fillText(nodeName(q, langIndex), x[i] + radius(i) + ringOuter(i, q.id) + 6 * px, y[i]);
      drawn++;
    }
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
