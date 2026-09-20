/** Measures what the browser actually downloads today, and what a split would save. */
import { readFile, stat } from 'node:fs/promises';
import zlib from 'node:zlib';

const raw = await readFile('public/data/quests.json');
const data = JSON.parse(raw.toString('utf8'));

const gz = (buf) => zlib.gzipSync(typeof buf === 'string' ? Buffer.from(buf) : buf, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(0).padStart(5) + ' kB';

const fileStat = await stat('public/data/quests.json');
console.log('=== what ships today ===');
console.log(`  quests.json      raw ${kb(fileStat.size)}   gzip ${kb(gz(raw))}`);

console.log('\n=== composition ===');
const dictsJson = JSON.stringify(data.dicts);
const questsJson = JSON.stringify(data.quests);
console.log(`  dicts            raw ${kb(dictsJson.length)}   gzip ${kb(gz(dictsJson))}`);
console.log(`  quests           raw ${kb(questsJson.length)}   gzip ${kb(gz(questsJson))}`);
console.log('  per dictionary (raw / gzip):');
for (const [k, v] of Object.entries(data.dicts)) {
  const j = JSON.stringify(v);
  console.log(`    ${k.padEnd(6)} ${String(Object.keys(v).length).padStart(5)} entries   raw ${kb(j.length)}  gzip ${kb(gz(j))}`);
}

// Which quest fields are needed just to DRAW + LAY OUT + FILTER + SEARCH the graph?
const GRAPH_FIELDS = ['id', 'cn', 'en', 'ja', 'ex', 'lv', 'patch', 'js', 'jcat', 'jgen', 'prev', 'prevJoin', 'next', 'eit'];
const DETAIL_FIELDS = ['cjc', 'lv2', 'jobUnlock', 'place', 'start', 'end', 'lock', 'lockJoin', 'rep', 'type', 'sortKey', 'rw', 'lode'];

const pick = (q, keys) => Object.fromEntries(keys.filter((k) => k in q).map((k) => [k, q[k]]));
const graphQuests = data.quests.map((q) => pick(q, GRAPH_FIELDS));
const detailQuests = data.quests.map((q) => ({ id: q.id, ...pick(q, DETAIL_FIELDS) }));

const graphPayload = JSON.stringify({
  generatedAt: data.generatedAt,
  counts: data.counts,
  dicts: { js: data.dicts.js, ex: data.dicts.ex },
  quests: graphQuests,
});
const detailPayload = JSON.stringify({ dicts: data.dicts, quests: detailQuests });

console.log('\n=== a possible split ===');
console.log(`  graph  (needed immediately)  raw ${kb(graphPayload.length)}   gzip ${kb(gz(graphPayload))}`);
console.log(`  detail (needed on click)     raw ${kb(detailPayload.length)}   gzip ${kb(gz(detailPayload))}`);
console.log(`  first-load saving: ${(100 - (gz(graphPayload) / gz(raw)) * 100).toFixed(0)}% of the transferred bytes`);

console.log('\n=== which fields are the weight? ===');
for (const f of [...GRAPH_FIELDS, ...DETAIL_FIELDS]) {
  const j = JSON.stringify(data.quests.map((q) => q[f]));
  const g = gz(j);
  if (g > 3000) console.log(`  ${f.padEnd(12)} raw ${kb(j.length)}  gzip ${kb(g)}`);
}
