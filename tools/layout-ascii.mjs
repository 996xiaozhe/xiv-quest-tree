/**
 * ASCII density preview of the quest layout — lets the graph shape be inspected in a terminal.
 * Usage: node tools/layout-ascii.mjs [sectionId|all] [cols] [rows] [--vertical]
 */
import { readFile } from 'node:fs/promises';
import { layoutGraph, DEFAULT_X_STEP, DEFAULT_Y_STEP } from '../src/graph/layout.ts';

const arg = process.argv[2] || 'all';
const COLS = Number(process.argv[3] || 200);
const ROWS = Number(process.argv[4] || 70);
const vertical = process.argv.includes('--vertical');

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const all = data.quests;
const index = new Map(all.map((q) => [q.id, q]));
const quests = arg === 'all' ? all : all.filter((q) => q.js === Number(arg));
const visible = new Set(quests.map((q) => q.id));

const t0 = Date.now();
const lay = layoutGraph(quests, index, {
  xStep: DEFAULT_X_STEP,
  yStep: DEFAULT_Y_STEP,
  vertical,
  isMain: (q) => q.js === 0 || q.js === 1,
});
console.log(
  `${quests.length} nodes | ${Date.now() - t0} ms | maxRank=${lay.maxRank} | lanes ${lay.minLane}..${lay.maxLane} | cycles=${lay.cycles}`,
);

// overlap check
const cell = new Map();
let overlaps = 0;
for (const q of quests) {
  const p = lay.pos.get(q.id);
  if (!p) continue;
  const k = p.x + ',' + p.y;
  if (cell.has(k)) overlaps++;
  cell.set(k, q.id);
}
console.log('exact position collisions:', overlaps);

const minX = lay.minX;
const maxX = lay.maxX;
const minY = lay.minY;
const maxY = lay.maxY;
const sx = (COLS - 1) / Math.max(1, maxX - minX);
const sy = (ROWS - 1) / Math.max(1, maxY - minY);
const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
const mainGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
for (const q of quests) {
  const p = lay.pos.get(q.id);
  if (!p) continue;
  const cx = Math.round((p.x - minX) * sx);
  const cy = Math.round((p.y - minY) * sy);
  if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) {
    grid[cy][cx]++;
    if (q.js === 0 || q.js === 1) mainGrid[cy][cx]++;
  }
}
const chars = ' .:-=+*#%@';
let maxCell = 0;
for (const row of grid) for (const v of row) if (v > maxCell) maxCell = v;
console.log(`max nodes per cell: ${maxCell}\n`);
for (let y = 0; y < ROWS; y++) {
  let line = '';
  for (let x = 0; x < COLS; x++) {
    const v = grid[y][x];
    if (mainGrid[y][x] > 0) line += v === 1 ? 'O' : 'M';
    else line += v === 0 ? ' ' : chars[Math.min(chars.length - 1, 1 + Math.floor((v / maxCell) * (chars.length - 2)))];
  }
  console.log(line.replace(/\s+$/, ''));
}
console.log('\n(O/M = main scenario)');

