import { readFile } from 'node:fs/promises';
import { layoutGraph, DEFAULT_X_STEP, DEFAULT_Y_STEP } from '../src/graph/layout.ts';

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const all = data.quests;
const index = new Map(all.map((q) => [q.id, q]));
const lay = layoutGraph(all, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: (q) => q.js === 0 || q.js === 1 });

const lanes = [...lay.pos.values()].map((p) => p.lane);
const abs = lanes.map(Math.abs).sort((a, b) => a - b);
const q = (p) => abs[Math.floor(abs.length * p)];
console.log('|lane| percentiles: p50', q(0.5), 'p75', q(0.75), 'p90', q(0.9), 'p95', q(0.95), 'p99', q(0.99), 'max', abs[abs.length - 1]);
for (const t of [10, 25, 50, 100, 200, 300, 400]) {
  console.log(`  |lane| > ${String(t).padStart(3)}: ${abs.filter((v) => v > t).length}`);
}

// how many nodes per rank
const perRank = new Map();
for (const p of lay.pos.values()) perRank.set(p.rank, (perRank.get(p.rank) || 0) + 1);
const sizes = [...perRank.values()].sort((a, b) => b - a);
console.log('\nranks:', perRank.size, '| per-rank sizes top 15:', sizes.slice(0, 15).join(','));
console.log('ranks with >30 nodes:', sizes.filter((s) => s > 30).length);

// chain lengths from roots
const rootChains = [];
for (const r of all.filter((x) => x.prev.length === 0)) {
  let n = 0;
  const seen = new Set([r.id]);
  const st = [r.id];
  while (st.length) {
    const id = st.pop();
    n++;
    for (const c of index.get(id).next) if (!seen.has(c)) { seen.add(c); st.push(c); }
  }
  rootChains.push(n);
}
rootChains.sort((a, b) => b - a);
console.log('\nroot subtree sizes top 15:', rootChains.slice(0, 15).join(','));
console.log('roots with subtree > 20:', rootChains.filter((v) => v > 20).length, 'of', rootChains.length);

// which sections dominate rank 0
const rank0 = all.filter((x) => lay.pos.get(x.id).rank === 0);
const bySec = new Map();
for (const x of rank0) bySec.set(x.js, (bySec.get(x.js) || 0) + 1);
console.log('\nrank-0 by section:', [...bySec.entries()].map(([s, n]) => `${data.dicts.js[s]?.[0]}=${n}`).join(' '));
