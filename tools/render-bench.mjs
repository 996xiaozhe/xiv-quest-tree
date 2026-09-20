/**
 * Measures the per-frame cost of the canvas renderer.
 *
 * The mock 2D context counts every path operation, which is the part of the work that
 * dominates a frame at the global view (rasterisation itself needs a real browser).
 *
 *   node tools/render-bench.mjs
 */
import { readFile } from 'node:fs/promises';
import { layoutGraph, DEFAULT_X_STEP, DEFAULT_Y_STEP } from '../src/graph/layout.ts';
import { buildEdgeModel, buildNodeModel } from '../src/graph/model.ts';
import { drawGraph } from '../src/graph/render.ts';
import { isMainScenario } from '../src/types.ts';

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const all = data.quests;
const index = new Map(all.map((q) => [q.id, q]));

class CountingPath2D {
  constructor(counter) {
    this.c = counter;
  }
  moveTo() { this.c.pathOps++; }
  lineTo() { this.c.pathOps++; }
  arc() { this.c.pathOps++; }
  closePath() { this.c.pathOps++; }
  rect() { this.c.pathOps++; }
  quadraticCurveTo() { this.c.pathOps++; }
  bezierCurveTo() { this.c.pathOps++; }
}

function makeCtx(counter) {
  const noop = () => { counter.calls++; };
  return {
    canvas: { width: 1280, height: 720 },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    setTransform: noop, clearRect: noop, fillRect: noop, save: noop, restore: noop,
    translate: noop, scale: noop, beginPath: noop, fill: noop, stroke: noop,
    setLineDash: noop, fillText: () => { counter.calls++; counter.texts++; }, drawImage: () => { counter.calls++; counter.drawImage++; },
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 0 }),
  };
}

function bench(label, quests, viewport) {
  const lay = layoutGraph(quests, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
  const model = buildNodeModel(quests, lay.pos);
  const edges = buildEdgeModel(quests, model.byId, false);

  const counter = { pathOps: 0, calls: 0, drawImage: 0, texts: 0 };
  const prevPath2D = globalThis.Path2D;
  globalThis.Path2D = class extends CountingPath2D {
    constructor() { super(counter); }
  };
  const ctx = makeCtx(counter);
  const input = {
    ctx, width: 1280, height: 720, viewport,
    model, edges, hovered: null, selected: null, highlight: null,
    matches: new Set(), langIndex: 0,
  };

  // warm up, then time 40 frames
  for (let i = 0; i < 3; i++) { counter.pathOps = 0; drawGraph(input); }
  counter.pathOps = 0;
  counter.texts = 0;
  const t0 = performance.now();
  const N = 40;
  for (let i = 0; i < N; i++) {
    input.viewport = { ...viewport, x: viewport.x + i }; // force the full path each frame
    drawGraph(input);
  }
  const ms = (performance.now() - t0) / N;
  globalThis.Path2D = prevPath2D;

  console.log(
    `${label.padEnd(34)} nodes=${String(quests.length).padStart(5)}  mode=diamond  ` +
      `pathOps/frame=${String(Math.round(counter.pathOps / N)).padStart(7)}  labels/frame=${String(Math.round(counter.texts / N)).padStart(4)}  js=${ms.toFixed(2)} ms/frame`,
  );
  return { ops: Math.round(counter.pathOps / N), ms, icons: Math.round(counter.drawImage / N), labels: Math.round(counter.texts / N) };
}

const fit = (quests) => {
  const lay = layoutGraph(quests, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
  const w = Math.max(1, lay.maxX - lay.minX);
  const h = Math.max(1, lay.maxY - lay.minY);
  const scale = Math.min(1232 / w, 664 / h);
  return { x: (lay.minX + lay.maxX) / 2, y: (lay.minY + lay.maxY) / 2, scale };
};

// small, focused views keep the rich rendering
const tianyou = (() => {
  const g = Object.entries(data.dicts.jgen).find(([, v]) => v[0] === '天佑女王');
  return all.filter((q) => q.jgen === Number(g[0]));
})();
const weapons = (() => {
  const c = Object.entries(data.dicts.jcat).find(([, v]) => v[0] === '武器强化支线任务');
  return all.filter((q) => q.jcat === Number(c[0]));
})();

console.log('per-frame path operations (lower is better)\n');
const small = bench('天佑女王 (40 quests)', tianyou, fit(tianyou));
const mid = bench('武器强化支线任务 (82 quests)', weapons, fit(weapons));
const big = bench('全局 5377 quests', all, fit(all));

console.log('\nsummary');
console.log(`  global view: ${big.ops} path ops/frame  (previous rounded-rect renderer: ~193,000)`);
console.log(`  reduction:   ${(193000 / big.ops).toFixed(1)}x`);
console.log(`  the small view is drawn exactly like the global one: ${small.ops} ops/frame, ${small.icons} drawImage/frame`);
if (small.icons !== 0 || mid.icons !== 0 || big.icons !== 0) {
  console.log('  FAIL: a marker bitmap was drawn onto the canvas — nodes must stay plain diamonds');
  process.exitCode = 1;
} else {
  console.log('  OK: no bitmap is ever stacked on a node, at any view size');
}

/* --- regression guard -------------------------------------------------------
 * The renderer must apply the device-pixel-ratio transform itself. If it resets to
 * identity (as it once did), the scene is drawn at a different scale than the pointer
 * hit test assumes: on displays with OS scaling != 100% every click lands beside the
 * marker. That bug is invisible at dpr = 1, so it is asserted explicitly here.
 */
function checkDprTransform() {
  const counter = { pathOps: 0, calls: 0, drawImage: 0, texts: 0 };
  const transforms = [];
  const base = makeCtx(counter);
  const ctx = { ...base, setTransform: (...a) => transforms.push(a) };

  const lay = layoutGraph(tianyou, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
  const model = buildNodeModel(tianyou, lay.pos);
  const edgeModel = buildEdgeModel(tianyou, model.byId, false);
  const prev = globalThis.Path2D;
  globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} quadraticCurveTo() {} bezierCurveTo() {} };
  drawGraph({
    ctx, width: 1280, height: 720, dpr: 2, viewport: { x: 0, y: 0, scale: 1 },
    model, edges: edgeModel, hovered: null, selected: null, highlight: null,
    matches: new Set(), langIndex: 0,
  });
  globalThis.Path2D = prev;

  const t = transforms[0] || [];
  const ok = t.length === 6 && t[0] === 2 && t[3] === 2 && t[1] === 0 && t[2] === 0 && t[4] === 0 && t[5] === 0;
  console.log(`\ndpr transform regression check`);
  console.log(`  first setTransform = [${t.join(', ')}]  expected [2, 0, 0, 2, 0, 0]`);
  if (!ok) {
    console.log('  FAIL: the renderer wiped the device pixel ratio — hit testing would be offset');
    process.exitCode = 1;
  } else {
    console.log('  OK: drawing and hit testing share one coordinate system');
  }
}
/* --- label clearance guard --------------------------------------------------
 * A name is drawn to the RIGHT of its diamond, and the selection halo reaches further
 * out than the plain node does (path at radius + 6, plus half of its 6px stroke). With
 * the original fixed 4px offset the halo swallowed the first glyph of the selected
 * quest's name, which is exactly the node the user is looking at. Asserted here because
 * it depends on the zoom (the ring is in world units, the offset was in pixels).
 */
function checkLabelClearance() {
  const lay = layoutGraph(tianyou, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
  const model = buildNodeModel(tianyou, lay.pos);
  const edges = buildEdgeModel(tianyou, model.byId, false);
  const target = tianyou[0];
  const pos = lay.pos.get(target.id);
  const radius = isMainScenario(target) ? 6.6 : 4.6;

  const texts = [];
  const counter = { pathOps: 0, calls: 0, drawImage: 0, texts: 0 };
  const ctx = makeCtx(counter);
  ctx.fillText = (t, x, y) => {
    counter.calls++;
    counter.texts++;
    texts.push({ t, x, y });
  };
  const prev = globalThis.Path2D;
  globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} quadraticCurveTo() {} bezierCurveTo() {} };
  drawGraph({
    ctx, width: 1280, height: 720, dpr: 1, viewport: { x: pos.x, y: pos.y, scale: 1 },
    model, edges, hovered: null, selected: target.id, highlight: null,
    matches: new Set(), langIndex: 0, theme: 'night',
  });
  globalThis.Path2D = prev;

  // positions live in a Float32Array, so match the lane with a tolerance
  const label = texts.find((t) => t.t === (target.cn || target.en) && Math.abs(t.y - pos.y) < 0.5);
  const ringEnd = radius + 6 + 3; // distance from the node centre: halo radius + half its stroke
  const offset = label ? label.x - pos.x : NaN;
  const ok = !!label && offset >= ringEnd + 2;
  console.log('\nlabel clearance');
  console.log(`  selected: radius ${radius}, halo ends at +${ringEnd}, name starts at +${Number.isFinite(offset) ? offset.toFixed(1) : 'n/a'}`);
  if (!ok) {
    console.log('  FAIL: the selection ring covers the first glyph of the name');
    process.exitCode = 1;
  } else {
    console.log('  OK: the selected name starts clear of its halo');
  }
}
const fitAll = fit(all);
checkDprTransform();
checkLabelClearance();
const zoomed = bench('全局 5377, zoomed in (scale 0.9)', all, { ...fitAll, scale: 0.9 });
const fitted = bench('全局 5377, fit to screen', all, fitAll);
console.log('\nlabels');
console.log(`  zoomed in : ${zoomed.labels} labels/frame`);
console.log(`  fit to screen: ${fitted.labels} labels/frame (none expected — they would be unreadable)`);
if (zoomed.labels === 0) {
  console.log('  FAIL: no labels at a readable zoom');
  process.exitCode = 1;
} else {
  console.log('  OK: names reappear when zoomed in');
}
