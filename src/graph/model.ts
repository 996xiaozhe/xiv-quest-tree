import type { Quest } from '../types.ts';
import type { NodePos } from './layout.ts';
import { paletteFor, type Palette, type RGB, type Theme } from './theme.ts';

/**
 * Rendering model for the current visible set.
 *
 * The first version walked the quest objects, the position Map and a colour Map on
 * every animation frame — at the global view that meant ~190 000 Path2D operations,
 * ~16 000 throw-away objects and ~5 000 Map lookups per frame. Everything that does
 * not depend on the viewport is therefore precomputed here once per filter change,
 * into flat typed arrays indexed by node position.
 */

export interface ColorGroup {
  color: RGB;
  /** node indices carrying this colour, sorted */
  indices: Int32Array;
}

export interface NodeModel {
  quests: Quest[];
  count: number;
  /** world position, parallel arrays */
  x: Float32Array;
  y: Float32Array;
  /** 1 when the quest is main scenario */
  main: Uint8Array;
  /** index into `groups` */
  group: Uint8Array;
  groups: ColorGroup[];
  /** quest id -> node index */
  byId: Map<number, number>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface EdgeModel {
  /** node indices into NodeModel */
  a: Int32Array;
  b: Int32Array;
  lock: Uint8Array;
  count: number;
}

export function buildNodeModel(nodes: Quest[], pos: Map<number, NodePos>, theme: Theme): NodeModel {
  const palette: Palette = paletteFor(theme);
  const count = nodes.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const main = new Uint8Array(count);
  const group = new Uint8Array(count);
  const byId = new Map<number, number>();

  // stable palette: one bucket per distinct section colour present in the view
  const groups: RGB[] = [];
  const paletteKey = new Map<string, number>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i++) {
    const q = nodes[i];
    const p = pos.get(q.id);
    const px = p ? p.x : 0;
    const py = p ? p.y : 0;
    x[i] = px;
    y[i] = py;
    byId.set(q.id, i);

    const isMain = q.js === 0 || q.js === 1;
    main[i] = isMain ? 1 : 0;

    const c = palette.sections[q.js] ?? palette.fallback;
    const key = `${c.r},${c.g},${c.b}`;
    let gi = paletteKey.get(key);
    if (gi === undefined) {
      gi = groups.length;
      paletteKey.set(key, gi);
      groups.push(c);
    }
    group[i] = gi;

    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  // bucket the indices per colour once, so each frame only has to cull + emit
  const buckets: number[][] = groups.map(() => []);
  for (let i = 0; i < count; i++) buckets[group[i]].push(i);
  const colorGroups: ColorGroup[] = groups.map((color, gi) => ({ color, indices: Int32Array.from(buckets[gi]) }));

  if (!count) {
    minX = minY = maxX = maxY = 0;
  }

  return { quests: nodes, count, x, y, main, group, groups: colorGroups, byId, minX, minY, maxX, maxY };
}

export function buildEdgeModel(nodes: Quest[], byId: Map<number, number>, showLocks: boolean): EdgeModel {
  const a: number[] = [];
  const b: number[] = [];
  const lock: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const q = nodes[i];
    for (const p of q.prev) {
      const pi = byId.get(p);
      if (pi === undefined) continue;
      a.push(pi);
      b.push(i);
      lock.push(0);
    }
    if (showLocks) {
      for (const p of q.lock) {
        const pi = byId.get(p);
        if (pi === undefined) continue;
        a.push(pi);
        b.push(i);
        lock.push(1);
      }
    }
  }
  return {
    a: Int32Array.from(a),
    b: Int32Array.from(b),
    lock: Uint8Array.from(lock),
    count: a.length,
  };
}
