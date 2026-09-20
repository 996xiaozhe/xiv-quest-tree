import type { Quest } from '../types.ts';

export interface NodePos {
  x: number;
  y: number;
  rank: number;
  lane: number;
}

export interface LayoutResult {
  pos: Map<number, NodePos>;
  maxRank: number;
  minLane: number;
  maxLane: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** number of nodes that could not be ordered (cycles) */
  cycles: number;
}

export interface LayoutOptions {
  xStep: number;
  yStep: number;
  /** vertical main spine (rank on Y) instead of horizontal */
  vertical?: boolean;
  isMain: (q: Quest) => boolean;
}

export const DEFAULT_X_STEP = 74;
export const DEFAULT_Y_STEP = 42;

/**
 * Layered dependency layout.
 *
 *  - `rank` = longest path from a prerequisite-free quest  -> the dependency axis
 *  - `lane` = vertical position; main-scenario quests are pinned to the centre spine
 *    and everything else fans out above/below it, ordered by the barycentre of its
 *    prerequisites so chains stay straight.
 *
 * The layout is computed on whatever subset is currently visible, which keeps
 * filtered views compact while preserving the left-to-right story order.
 */
export function layoutGraph(
  visibleQuests: Quest[],
  index: Map<number, Quest>,
  opts: LayoutOptions,
): LayoutResult {
  const { xStep, yStep, isMain, vertical = false } = opts;
  const visible = new Set(visibleQuests.map((q) => q.id));

  /* ---------------------------------------------------- 1. dependency rank --- */
  const indeg = new Map<number, number>();
  const rank = new Map<number, number>();
  for (const q of visibleQuests) {
    indeg.set(q.id, 0);
    rank.set(q.id, 0);
  }
  for (const q of visibleQuests) {
    for (const p of q.prev) if (visible.has(p)) indeg.set(q.id, (indeg.get(q.id) ?? 0) + 1);
  }

  const queue: number[] = [];
  for (const q of visibleQuests) if ((indeg.get(q.id) ?? 0) === 0) queue.push(q.id);

  const byRank = new Map<number, number[]>();
  let cursor = 0;
  const ordered: number[] = [];
  while (cursor < queue.length) {
    const id = queue[cursor++];
    ordered.push(id);
    const q = index.get(id)!;
    const r = rank.get(id) ?? 0;
    for (const n of q.next) {
      if (!visible.has(n)) continue;
      if ((rank.get(n) ?? 0) < r + 1) rank.set(n, r + 1);
      const d = (indeg.get(n) ?? 1) - 1;
      indeg.set(n, d);
      if (d === 0) queue.push(n);
    }
  }

  // Defensive: anything left over is part of a cycle (should not happen for FFXIV quests).
  const cycles = visibleQuests.length - ordered.length;
  if (cycles > 0) {
    for (const q of visibleQuests) if (!ordered.includes(q.id)) ordered.push(q.id);
  }

  for (const id of ordered) {
    const r = rank.get(id) ?? 0;
    const bucket = byRank.get(r);
    if (bucket) bucket.push(id);
    else byRank.set(r, [id]);
  }

  /* --------------------------------------------------------- 2. lane seeds --- */
  const lane = new Map<number, number>();
  const roots = (byRank.get(0) ?? []).slice();
  const q = (id: number) => index.get(id)!;

  // Height = length of the longest descendant chain. Roots with long chains are
  // seeded closest to the centre so they fill the middle band, while standalone
  // quests (no follow-ups at all) end up at the outer edges.
  const height = new Map<number, number>();
  for (let i = ordered.length - 1; i >= 0; i--) {
    const id = ordered[i];
    let h = 0;
    for (const n of index.get(id)!.next) {
      if (!visible.has(n)) continue;
      const nh = (height.get(n) ?? 0) + 1;
      if (nh > h) h = nh;
    }
    height.set(id, h);
  }

  roots.sort((a, b) => {
    const A = q(a);
    const B = q(b);
    const am = isMain(A) ? 0 : 1;
    const bm = isMain(B) ? 0 : 1;
    if (am !== bm) return am - bm;
    const ah = height.get(a) ?? 0;
    const bh = height.get(b) ?? 0;
    if (ah !== bh) return bh - ah;
    if (A.js !== B.js) return A.js - B.js;
    if (A.jcat !== B.jcat) return A.jcat - B.jcat;
    if (A.jgen !== B.jgen) return A.jgen - B.jgen;
    if (A.ex !== B.ex) return A.ex - B.ex;
    return A.id - B.id;
  });
  roots.forEach((id, i) => lane.set(id, altSeed(i)));

  /* ---------------------------------------------------- 3. lane assignment --- */
  const GAP = 1;
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);

  for (const r of sortedRanks) {
    const nodes = byRank.get(r)!;

    // Desired lane for every node: the barycentre of its visible prerequisites
    // (rank-0 nodes have none, so they keep their seed).
    const desired = new Map<number, number>();
    for (const id of nodes) {
      const node = q(id);
      let sum = 0;
      let n = 0;
      for (const p of node.prev) {
        if (!visible.has(p)) continue;
        const pl = lane.get(p);
        if (pl === undefined) continue;
        sum += pl;
        n++;
      }
      desired.set(id, n ? sum / n : (lane.get(id) ?? 0));
    }

    const mainIds = nodes.filter((id) => isMain(q(id)));
    const otherIds = nodes.filter((id) => !isMain(q(id)));

    if (!mainIds.length) {
      // No main-scenario node in this rank: keep every node at its barycentre,
      // only separating nodes that would overlap.
      const ids = nodes.slice().sort((a, b) => desired.get(a)! - desired.get(b)! || a - b);
      const values = ids.map((id) => desired.get(id)!);
      for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i - 1] + GAP) values[i] = values[i - 1] + GAP;
      }
      const meanDesired = ids.reduce((a, id) => a + desired.get(id)!, 0) / ids.length;
      const meanPlaced = values.reduce((a, v) => a + v, 0) / values.length;
      const shift = meanPlaced - meanDesired;
      ids.forEach((id, i) => lane.set(id, values[i] - shift));
      continue;
    }

    // --- main scenario is pinned to the centre -------------------------------
    const m = mainIds.length;
    const half = (m - 1) / 2;
    mainIds.sort((a, b) => desired.get(a)! - desired.get(b)! || a - b);
    mainIds.forEach((id, i) => lane.set(id, (i - half) * GAP));

    const limit = half + GAP;
    const neg: { id: number; want: number }[] = [];
    const pos: { id: number; want: number }[] = [];
    const mid: { id: number; want: number }[] = [];

    for (const id of otherIds) {
      const d = desired.get(id)!;
      if (d < -limit) neg.push({ id, want: d });
      else if (d > limit) pos.push({ id, want: d });
      else mid.push({ id, want: d });
    }

    // Nodes whose whole ancestry is the main line have no side preference:
    // fan them out alternately so the spine stays balanced.
    mid.sort((a, b) => a.want - b.want || a.id - b.id);
    mid.forEach((e, i) => {
      const k = Math.floor(i / 2) + 1;
      const sign = i % 2 === 0 ? -1 : 1;
      (sign < 0 ? neg : pos).push({ id: e.id, want: sign * (limit + GAP * k) });
    });

    // Pack each side outwards from the spine, preserving barycentre order so
    // dependency chains stay straight instead of zig-zagging.
    neg.sort((a, b) => b.want - a.want);
    let prev = -limit;
    for (const e of neg) {
      const v = Math.min(e.want, prev);
      lane.set(e.id, v);
      prev = v - GAP;
    }
    pos.sort((a, b) => a.want - b.want);
    prev = limit;
    for (const e of pos) {
      const v = Math.max(e.want, prev);
      lane.set(e.id, v);
      prev = v + GAP;
    }
  }

  /* --------------------------------------------------------- 4. to pixels --- */
  // Roughly 900 of FFXIV's quests have no prerequisite *and* no follow-up (seasonal
  // events, allied-society errands, …). They all land in lane 0's neighbourhood and
  // would otherwise stretch the canvas into a mostly empty column. Lanes that carry
  // no dependency edges at all are therefore packed tightly.
  const laneEdge = new Map<number, number>();
  for (const node of visibleQuests) {
    const l = lane.get(node.id);
    if (l === undefined) continue;
    let e = 0;
    for (const p of node.prev) if (visible.has(p)) e++;
    for (const n of node.next) if (visible.has(n)) e++;
    laneEdge.set(l, (laneEdge.get(l) ?? 0) + e);
  }
  const usedLanes = [...new Set(lane.values())].sort((a, b) => a - b);
  const spacing = (l: number) => {
    const e = laneEdge.get(l) ?? 0;
    return 0.3 + 0.7 * Math.min(1, e / 2);
  };
  const compact = new Map<number, number>();
  let acc = 0;
  for (const l of usedLanes) {
    if (l < 0) continue;
    compact.set(l, acc);
    acc += spacing(l);
  }
  acc = 0;
  for (let i = usedLanes.length - 1; i >= 0; i--) {
    const l = usedLanes[i];
    if (l >= 0) continue;
    acc -= spacing(l);
    compact.set(l, acc);
  }

  let maxRank = 0;
  let minLane = Infinity;
  let maxLane = -Infinity;
  const pos = new Map<number, NodePos>();
  for (const id of ordered) {
    const r = rank.get(id) ?? 0;
    const rawLane = lane.get(id) ?? 0;
    const l = compact.get(rawLane) ?? rawLane;
    if (r > maxRank) maxRank = r;
    if (l < minLane) minLane = l;
    if (l > maxLane) maxLane = l;
    const x = vertical ? l * yStep : r * xStep;
    const y = vertical ? r * xStep : l * yStep;
    pos.set(id, { x, y, rank: r, lane: l });
  }
  if (!Number.isFinite(minLane)) {
    minLane = 0;
    maxLane = 0;
  }

  return {
    pos,
    maxRank,
    minLane,
    maxLane,
    minX: vertical ? minLane * yStep : 0,
    maxX: vertical ? maxLane * yStep : maxRank * xStep,
    minY: vertical ? 0 : minLane * yStep,
    maxY: vertical ? maxRank * xStep : maxLane * yStep,
    cycles,
  };
}

/** 0, +1, -1, +2, -2, … keeps the highest priority roots closest to the centre. */
function altSeed(i: number): number {
  if (i === 0) return 0;
  const k = Math.ceil(i / 2);
  return i % 2 === 1 ? k : -k;
}
