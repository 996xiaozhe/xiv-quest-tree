/** Quick structural analysis of the built dataset, to inform the layout design. */
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const { quests, dicts } = data;
const byId = new Map(quests.map((q) => [q.id, q]));

// longest-path rank via topological order
const indeg = new Map(quests.map((q) => [q.id, 0]));
for (const q of quests) for (const n of q.next) indeg.set(n, (indeg.get(n) || 0) + 1);
const rank = new Map(quests.map((q) => [q.id, 0]));
const queue = quests.filter((q) => q.prev.length === 0).map((q) => q.id);
let processed = 0;
while (queue.length) {
  const id = queue.shift();
  processed++;
  const r = rank.get(id);
  for (const n of byId.get(id).next) {
    if (rank.get(n) < r + 1) rank.set(n, r + 1);
    indeg.set(n, indeg.get(n) - 1);
    if (indeg.get(n) === 0) queue.push(n);
  }
}
console.log('topologically processed', processed, '/', quests.length, '(cycle?', processed !== quests.length, ')');

const ranks = [...rank.values()];
const maxRank = Math.max(...ranks);
console.log('max rank', maxRank, '| mean', (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1));

const perRank = new Map();
for (const q of quests) perRank.set(rank.get(q.id), (perRank.get(rank.get(q.id)) || 0) + 1);
const widths = [...perRank.values()].sort((a, b) => b - a);
console.log('widest ranks', widths.slice(0, 10).join(','), '| ranks with >20 nodes:', widths.filter((w) => w > 20).length);

const msq = quests.filter((q) => q.js === 0 || q.js === 1);
console.log('main scenario quests', msq.length, '| max rank', Math.max(...msq.map((q) => rank.get(q.id))));
console.log('  MSQ rank range', Math.min(...msq.map((q) => rank.get(q.id))), '-', Math.max(...msq.map((q) => rank.get(q.id))));
const msqPerRank = new Map();
for (const q of msq) msqPerRank.set(rank.get(q.id), (msqPerRank.get(rank.get(q.id)) || 0) + 1);
console.log('  ranks with >1 MSQ quest:', [...msqPerRank.values()].filter((v) => v > 1).length);

console.log('\nby section:');
for (const [id, names] of Object.entries(dicts.js)) {
  const qs = quests.filter((q) => String(q.js) === id);
  if (!qs.length) continue;
  const rs = qs.map((q) => rank.get(q.id));
  console.log(`  ${names[0].padEnd(28)} n=${String(qs.length).padStart(4)} rank ${Math.min(...rs)}-${Math.max(...rs)}`);
}

console.log('\nby expansion (js==0 main scenario only):');
for (const [id, names] of Object.entries(dicts.ex)) {
  const qs = quests.filter((q) => String(q.ex) === id);
  console.log(`  ${names[0].padEnd(12)} ${names[1].padEnd(14)} n=${String(qs.length).padStart(4)}`);
}

console.log('\nsubcategory sizes (journal genre) — top 20:');
const byGenre = new Map();
for (const q of quests) byGenre.set(q.jgen, (byGenre.get(q.jgen) || 0) + 1);
for (const [gid, n] of [...byGenre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  const g = dicts.jgen[gid];
  console.log(`  ${String(n).padStart(4)}  ${g ? g[0] : '?'} | ${g ? g[1] : ''}`);
}
console.log('\nthe 天佑女王 subcategory:');
for (const q of quests.filter((q) => dicts.jgen[q.jgen] && dicts.jgen[q.jgen][0] === '天佑女王')) {
  console.log(`  ${q.id} lv${q.lv} ${q.cn} | prev=${q.prev.length} next=${q.next.length} rank=${rank.get(q.id)}`);
}
console.log('\nchain depth histogram (rank -> node count), first 40 ranks:');
console.log([...perRank.entries()].sort((a, b) => a[0] - b[0]).slice(0, 40).map(([r, n]) => `${r}:${n}`).join(' '));
