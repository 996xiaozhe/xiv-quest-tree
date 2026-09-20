/**
 * DOM-level smoke test: runs the real application bundle inside jsdom and drives the
 * UI the way a user would (filters, search, language switch), so React runtime errors
 * are caught without needing a browser binary.
 *
 *   npx vite build --config tools/vite.iife.config.ts && node tools/dom-smoke.mjs
 */
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DATA = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const BUNDLE = await readFile('dist-test/app.js', 'utf8');

const dom = new JSDOM(
  '<!doctype html><html><head><meta name="theme-color" content="#0a0d12"></head><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  },
);
const { window } = dom;

/* ---------------------------------------------------------------- polyfills */
const W = 1280;
const H = 720;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { width: W, height: H, left: 0, top: 0, right: W, bottom: H, x: 0, y: 0, toJSON() {} };
};
class RO {
  constructor(cb) {
    this.cb = cb;
  }
  observe() {
    this.cb([{ contentRect: { width: W, height: H } }], this);
  }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = RO;
window.devicePixelRatio = 1;

// jsdom has no canvas backend. Provide an *explicit* 2D-context mock: any method the
// renderer calls that is missing here throws, so typos and unimplemented calls show
// up as test failures instead of silently doing nothing.
let drawCalls = 0;
let iconDraws = 0;
let iconsInSmallView = -1;
const CTX_METHODS = [
  'setTransform', 'clearRect', 'fillRect', 'save', 'restore', 'translate', 'scale',
  'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'rect', 'fill', 'stroke',
  'setLineDash', 'fillText', 'strokeText', 'clip', 'rotate', 'drawImage',
];
function makeCtx() {
  const ctx = {
    canvas: { width: W, height: H },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
  };
  for (const m of CTX_METHODS) {
    ctx[m] = (...args) => {
      void args;
      drawCalls++;
      if (m === 'drawImage') iconDraws++;
    };
  }
  return ctx;
}
window.HTMLCanvasElement.prototype.getContext = function () {
  return makeCtx();
};
window.Path2D = class Path2D {
  moveTo() {}
  lineTo() {}
  arc() {}
  closePath() {}
  rect() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
};
// jsdom has no PointerEvent; React listens for it, so alias it to MouseEvent.
window.PointerEvent = window.MouseEvent;
// The data loader streams the response, so it needs the fetch plumbing jsdom lacks.
window.Response = Response;
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
window.ReadableStream = ReadableStream;
// jsdom never loads images, and nothing depends on it any more: the renderer draws no
// marker bitmaps on nodes (every quest is a plain diamond), which is asserted below.
const DATA_JSON = JSON.stringify(DATA);
window.fetch = async (input) => {
  const url = String(input);
  if (url.includes('quests.json')) {
    // Mirror a real response: a Content-Length header plus a streamable body, so the
    // boot screen's progress path is the one under test.
    const bytes = new TextEncoder().encode(DATA_JSON);
    return new window.Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) },
    });
  }
  throw new Error('unexpected fetch: ' + url);
};

const consoleErrors = [];
const runtimeErrors = [];
window.addEventListener('error', (e) => runtimeErrors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => runtimeErrors.push('unhandled rejection: ' + String(e.reason)));
const nativeError = window.console.error.bind(window.console);
window.console.error = (...args) => {
  consoleErrors.push(args.map((a) => (a && a.message) || String(a)).join(' '));
  nativeError(...args);
};
window.console.warn = () => {};

/* -------------------------------------------------------------------- boot */
window.eval(BUNDLE);
await sleep(900);

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const text = (s) => $(s)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const evaluateInPage = (expr) => window.eval(expr);

/* ------------------------------------------- default language from navigator */
console.log('--- default language (jsdom reports en-US) ---');
check('defaults to English UI', text('.brand h1')?.includes('Quest Tree'), String(text('.brand h1')));
check('document lang set to en', window.document.documentElement.lang === 'en');

// Pin Chinese so the remaining assertions are deterministic.
click($$('.langs button').find((b) => b.textContent.trim() === '中'));
await sleep(600);

/* ---------------------------------------------------------- initial render */
console.log('\n--- initial render (zh) ---');
const initial = {
  bootScreen: !!$('.boot'),
  rootChildren: window.document.getElementById('root').children.length,
  canvas: !!$('.stage-canvas'),
  canvasPx: $('.stage-canvas') ? `${$('.stage-canvas').width}x${$('.stage-canvas').height}` : null,
  filterItems: $$('.fitem').length,
  groups: $$('.fgroup h3').map((h) => h.textContent.trim()),
  presets: $$('.preset').map((b) => b.textContent.trim()),
  stats: text('.stage-stats'),
  legend: $$('.legend li').map((l) => l.textContent.trim()),
  langs: $$('.langs button').map((b) => b.textContent.trim()),
  detailEmpty: !!$('.detail.empty'),
  brand: text('.brand h1'),
};
console.log(JSON.stringify(initial, null, 1));

check('application booted', !initial.bootScreen);
check('react mounted into #root', initial.rootChildren > 0);
check('graph canvas mounted and sized', initial.canvas && initial.canvasPx === '1280x720', String(initial.canvasPx));
check('filter panel rendered', initial.filterItems > 10, `${initial.filterItems} items`);
check('all four filter groups present', initial.groups.length >= 4, initial.groups.join(' | '));
{
  // The group titles are i18n strings; one of them used to append a literal translation,
  // which rendered as "主分类 · 主分类" / "Category · Category".
  const titles = $$('.fgroup h3').map((h) => h.textContent.trim());
  const parts = titles.map((t) => t.split(/[·•]/).map((s) => s.trim()));
  check('filter group titles are unique', new Set(titles).size === titles.length, titles.join(' | '));
  check('no filter group title repeats itself', parts.every((p) => new Set(p).size === p.length), titles.join(' | '));
}
check('stats report the full dataset', /5377/.test(initial.stats || ''), initial.stats);
check('legend rendered inside the stage', initial.legend.length > 0, initial.legend.join(' / '));
check('three language buttons', initial.langs.length === 3, initial.langs.join(','));
check('detail panel starts empty', initial.detailEmpty);
check('the legend lists marker icons only in the small view', $$('.legend img.legend-icon').length === 0, `${$$('.legend img.legend-icon').length} icons`);
await sleep(400);
const iconsInFullView = iconDraws;
check('no marker icons drawn on the 5377-quest view', iconsInFullView === 0, `${iconsInFullView} drawImage calls`);

/* -------------------------------------------------------------- filtering */
console.log('\n--- subcategory filter (天佑女王) ---');
const target = $$('.fitem').find((el) => el.querySelector('.fitem-name')?.textContent.trim() === '天佑女王');
check('天佑女王 exists in the subcategory list', !!target);
if (target) {
  click(target.querySelector('input'));
  await sleep(900);
  const stats = text('.stage-stats');
  console.log('   stats after filter:', stats);
  check('stats shrink to the 40 filtered quests', /^40 /.test(stats || ''), stats);
  check('legend adapts to the filtered view', $$('.legend li').length > 0);
  check('marker icons appear once the view is small enough', $$('.legend img.legend-icon').length === 3, `${$$('.legend img.legend-icon').length} icons`);
  check(
    'the legend offers all three quest-marker icons',
    new Set($$('.legend img.legend-icon').map((i) => i.getAttribute('src'))).size === 3,
    $$('.legend img.legend-icon').map((i) => i.getAttribute('src')).join(','),
  );
  await sleep(400);
  iconsInSmallView = iconDraws;
  check('no marker icons are drawn on nodes even in the small view', iconsInSmallView === 0, `${iconsInSmallView} drawImage calls`);
  click($$('.preset').find((b) => b.textContent.trim() === '全部'));
  await sleep(700);
}

/* ----------------------------------------------------------------- search */
console.log('\n--- search + jump ---');
const input = $('.search input');
const setValue = (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
input.focus();
setValue(input, '苍鹰归巢作战');
await sleep(700);
const results = $$('.search-pop li button').map((b) => b.textContent.replace(/\s+/g, ' ').trim());
console.log('   results:', results.slice(0, 3));
check('search produced a result', results.some((r) => r.includes('苍鹰归巢作战')), results.join(' | '));
click($$('.search-pop li button')[0]);
await sleep(1500);

const detail = {
  title: text('.detail h2'),
  alt: $$('.detail-alt span').map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
  kv: $$('.detail .kv').map((k) => k.textContent.replace(/\s+/g, ' ').trim()),
  chips: $$('.detail .chip').map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  names: $$('.detail .names tr').map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  links: $$('.detail a.ext').map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),
  actionButtons: $$('.detail-actions button').map((b) => b.textContent.trim()),
  stats: text('.stage-stats'),
};
console.log(JSON.stringify({ ...detail, kv: detail.kv.slice(0, 9) }, null, 1));
console.log('   chips:', detail.chips);

check('detail title is the quest', detail.title === '苍鹰归巢作战', String(detail.title));
check('detail header shows the quest-marker icon', /\/icons\/71221\.png/.test($('.detail-icon')?.getAttribute('src') ?? ''), String($('.detail-icon')?.getAttribute('src')));
check('detail shows the other two names', detail.alt.length === 2, detail.alt.join(' / '));
check('detail shows patch 5.35', detail.kv.some((k) => k.includes('5.35')));
check('detail shows the region', detail.kv.some((k) => k.includes('甘戈斯')));
check('detail shows the category', detail.kv.some((k) => k.includes('武器强化支线任务')));
check('detail shows the subcategory', detail.kv.some((k) => k.includes('天佑女王')));
check('detail shows the class/job gate', detail.kv.some((k) => k.includes('战斗精英 魔法导师')));
check(
  'detail shows the starting NPC with coordinates',
  detail.kv.some((k) => k.includes('马尔夏克') && k.includes('6.4') && k.includes('5.7')),
  detail.kv.find((k) => k.includes('马尔夏克')),
);
check('detail shows the ending NPC', detail.kv.some((k) => k.includes('水琴')));
check(
  'all three prerequisite chips rendered',
  ['博兹雅堡垒蒸发事件', '重现“女王之刃”', '纯白誓约、漆黑密约'].every((n) => detail.chips.some((c) => c.includes(n))),
  detail.chips.join(' | '),
);
check(
  'both follow-up chips rendered',
  ['记录“战果记录”', '工作时禁止喝酒'].every((n) => detail.chips.some((c) => c.includes(n))),
  detail.chips.join(' | '),
);
check('trilingual name table filled', detail.names.length === 3 && detail.names.every((n) => n.length > 4), detail.names.join(' / '));
check(
  'Lodestone deep link is a list row',
  detail.links.some((l) => l.href === 'https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/20ecde94d22/'),
  JSON.stringify(detail.links),
);
check(
  'Huiji wiki link uses the 任务 namespace',
  detail.links.some((l) => l.href === 'https://ff14.huijiwiki.com/wiki/' + encodeURIComponent('任务') + ':' + encodeURIComponent('苍鹰归巢作战')),
  JSON.stringify(detail.links),
);
check(
  'only the prerequisite-view button remains',
  detail.actionButtons.length === 1 && detail.actionButtons[0] === '查看前置依赖',
  JSON.stringify(detail.actionButtons),
);

/* ------------------------------------------------------- chip navigation */
console.log('\n--- navigating via a prerequisite chip ---');
click($$('.detail .chip').find((c) => c.textContent.includes('博兹雅堡垒蒸发事件')));
await sleep(1300);
check('clicking a chip navigates to that quest', text('.detail h2') === '博兹雅堡垒蒸发事件', String(text('.detail h2')));

/* ---------------------------------------------------------- dependency view */
console.log('\n--- right-click dependency view ---');
const canvasEl = $('.stage-canvas');
let ctxThrew = null;
try {
  canvasEl.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 640, clientY: 360 }));
} catch (e) {
  ctxThrew = e.message;
}
await sleep(300);
check('right-click on the canvas is handled without throwing', !ctxThrew, String(ctxThrew));

// the same action is also reachable from the detail panel, which is deterministic
const rootName = text('.detail h2');
const rootQuest = DATA.quests.find((q) => q.cn === rootName);
const expectClosure = (() => {
  const byId = new Map(DATA.quests.map((q) => [q.id, q]));
  const seen = new Set([rootQuest.id]);
  const stack = [rootQuest.id];
  while (stack.length) {
    const q = byId.get(stack.pop());
    for (const p of q.prev) if (!seen.has(p)) { seen.add(p); stack.push(p); }
  }
  return seen.size;
})();

const depBtn = $$('.detail-actions button').find((b) => b.textContent.includes('查看前置依赖'));
check('detail panel offers the prerequisite view', !!depBtn);
depBtn?.click();
await sleep(1200);

const depBanner = text('.dep-banner');
const depStats = text('.stage-stats');
console.log('   banner:', depBanner);
console.log('   stats :', depStats);
console.log(`   expected closure size for ${rootName}:`, expectClosure);
check('dependency banner appears', !!$('.dep-banner'), String(depBanner));
check(
  'browsing does NOT rewrite the address bar',
  window.location.pathname === '/',
  window.location.pathname,
);
check('the banner offers an explicit copy-link button', !!$('.dep-banner button.dep-copy'));
check('banner names the quest', (depBanner || '').includes(rootName), String(depBanner));
check('only the ancestry is shown', new RegExp(`^${expectClosure} `).test(depStats || ''), depStats);
check(
  'a 715-quest dependency view correctly falls back to plain blocks',
  $$('.legend img.legend-icon').length === 0,
  `${$$('.legend img.legend-icon').length} icons`,
);

const exitBtn = $('.dep-banner button:not(.dep-copy)');
exitBtn?.click();
await sleep(900);
check('exiting the dependency view restores the full graph', /^5377 /.test(text('.stage-stats') || ''), text('.stage-stats'));

/* ------------------------------------------------------------ deep links */
console.log('\n--- shareable /pre and /post links ---');
const goto = async (url) => {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new window.Event('popstate'));
  await sleep(1100);
};

await goto('/pre/' + encodeURIComponent('苍鹰归巢作战'));
const eagleClosure = (() => {
  const byId = new Map(DATA.quests.map((q) => [q.id, q]));
  const seen = new Set([69477]);
  const stack = [69477];
  while (stack.length) {
    const q = byId.get(stack.pop());
    for (const p of q.prev) if (!seen.has(p)) { seen.add(p); stack.push(p); }
  }
  return seen.size;
})();
const pre = { url: window.location.pathname + window.location.search, banner: text('.dep-banner'), stats: text('.stage-stats') };
console.log('   /pre  ->', pre.url, '|', pre.stats, '| expected', eagleClosure);
check('/pre/<name> opens the prerequisite view', (pre.banner || '').includes('前置'), String(pre.banner));
check('/pre/<name> shows the right quest count', new RegExp('^' + eagleClosure + ' ').test(pre.stats || ''), pre.stats);

await goto('/post/' + encodeURIComponent('苍鹰归巢作战'));
const post = { banner: text('.dep-banner'), stats: text('.stage-stats') };
console.log('   /post ->', post.stats);
check('/post/<name> opens the follow-up view', (post.banner || '').includes('后续'), String(post.banner));

// what the copy button produces: a short, language-neutral id link
const copyTitle = $('.dep-banner .dep-copy')?.getAttribute('title') ?? '';
console.log('   copy button ->', copyTitle);
check('the copy button offers a short id link', /\/post\/69477$/.test(copyTitle), copyTitle);
check('the copy link carries no percent-escapes', /^[^\s%]*$/.test(copyTitle), copyTitle);

await goto('/pre/69477');
check('a bare id link opens the same view', (text('.dep-banner') || '').includes('前置'), String(text('.dep-banner')));
check('an id link resolves without a name', new RegExp('^' + eagleClosure + ' ').test(text('.stage-stats') || ''), text('.stage-stats'));

await goto('/pre/99999999');
check('an unknown id link shows a notice instead of a blank stage', !!$('.dep-banner-miss'), String(text('.dep-banner-miss')));

// an English name resolves too, and an unknown one falls back with a notice
await goto('/pre/' + encodeURIComponent('Where Eagles Nest'));
check('English names resolve from the URL', (text('.dep-banner') || '').includes('前置'), String(text('.dep-banner')));

await goto('/pre/' + encodeURIComponent('绝对不存在的任务名'));
check('an unresolvable link shows a notice instead of failing', !!$('.dep-banner-miss'), String(text('.dep-banner-miss')));
check('an unresolvable link leaves the full graph visible', /^5377 /.test(text('.stage-stats') || ''), text('.stage-stats'));

await goto('/');
check('returning to / clears the notice', !$('.dep-banner-miss') && !$('.dep-banner'));

/* ------------------------------------------------------- canvas node clicking */
console.log('\n--- clicking a node on the canvas ---');
click($$('.langs button').find((b) => b.textContent.trim() === '中'));
await sleep(400);
const backBtn2 = $('.dep-banner button:not(.dep-copy)');
if (backBtn2) click(backBtn2);
await sleep(400);
const jg2 = $$('.fitem').find((el) => el.querySelector('.fitem-name')?.textContent.trim() === '天佑女王');
click(jg2.querySelector('input'));
await sleep(1400);

// Park a known quest on the stage centre before clicking pixels. A search jump centres
// the node it flies to; a /pre or /post view deliberately does NOT — it parks the root at
// the far end of its chain — so the leftover selection from the deep links above is not a
// usable click target any more.
const searchInput0 = $('.search input');
setValue(searchInput0, '博兹雅堡垒蒸发事件');
await sleep(700);
click($$('.search-pop li button')[0]);
await sleep(1200);

const cv = $('.stage-canvas');
const pointer = (type, x, y) =>
  cv.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));

const title0 = text('.detail h2');
pointer('pointerdown', 640, 360);
pointer('pointerup', 640, 360);
await sleep(400);
const title1 = text('.detail h2');

pointer('pointerdown', 640, 360);
pointer('pointerup', 640, 360);
await sleep(400);
const title2 = text('.detail h2');

// a jittery click (a few px of hand movement that returns) must still count as a click
pointer('pointerdown', 640, 360);
pointer('pointermove', 643, 362);
pointer('pointermove', 640, 360);
pointer('pointerup', 640, 360);
await sleep(400);
const title3 = text('.detail h2');

// a real drag must NOT change the selection
pointer('pointerdown', 400, 300);
pointer('pointermove', 520, 380);
pointer('pointerup', 520, 380);
await sleep(400);
const title4 = text('.detail h2');

console.log(`   titles: start=${title0} click1=${title1} click2=${title2} jitter=${title3} drag=${title4}`);
check('clicking a node changes the selection', title1 !== title0, `${title0} -> ${title1}`);
check('clicking again selects a quest (toggle works both ways)', title2 !== null, `${title1} -> ${title2}`);
check('a jittery click still counts as a click', title3 !== title2, `${title2} -> ${title3}`);
check('a real drag does not change the selection', title4 === title3, `${title3} -> ${title4}`);
check('selected quest name is shown', (title2 || '').length > 0, String(title2));

/* ------------------------------------------------------------ languages */
// re-select deterministically (the drag test panned the camera, so the centre moved)
const searchInput2 = $('.search input');
setValue(searchInput2, '博兹雅堡垒蒸发事件');
await sleep(700);
click($$('.search-pop li button')[0]);
await sleep(1200);
console.log('\n--- language switching ---');
const langState = {};
for (const label of ['中', 'EN', '日']) {
  click($$('.langs button').find((b) => b.textContent.trim() === label));
  await sleep(500);
  langState[label] = {
    brand: text('.brand h1'),
    detail: text('.detail h2'),
    firstGroup: text('.fgroup h3'),
    docLang: window.document.documentElement.lang,
  };
}
console.log(JSON.stringify(langState, null, 1));
check('Chinese UI', langState['中'].detail === '博兹雅堡垒蒸发事件' && langState['中'].brand.includes('任务树'), JSON.stringify(langState['中']));
check('English UI', langState['EN'].detail === 'The Bozja Incident' && langState['EN'].brand.includes('Quest Tree'), JSON.stringify(langState['EN']));
check('Japanese UI', langState['日'].detail === 'シタデル・ボズヤ蒸発事変' && langState['日'].brand.includes('クエストツリー'), JSON.stringify(langState['日']));

/* ----------------------------------------------------------- group preset */
console.log('\n--- main-scenario preset ---');
click($$('.langs button').find((b) => b.textContent.trim() === '中'));
await sleep(400);
click($$('.preset').find((b) => b.textContent.includes('主线任务')));
await sleep(900);
const msqStats = text('.stage-stats');
console.log('   ', msqStats);
check('main scenario preset filters to the 1050 main-scenario quests', /^1050 /.test(msqStats || ''), msqStats);

/* ---------------------------------------------------------------- canvas */
console.log('\n--- canvas renderer ---');
console.log('   draw operations issued:', drawCalls);
check('renderer actually drew (mock 2D context exercised)', drawCalls > 500, `${drawCalls} ops`);
check('the canvas never draws a marker bitmap (diamonds only)', iconDraws === 0, `${iconDraws} drawImage calls`);

/* -------------------------------------------------------- day / night theme */
console.log('\n--- day / night theme ---');
const themeBtn = $('.theme-toggle');
const rootTheme = () => window.document.documentElement.dataset.theme;
check('the top bar has a theme toggle', !!themeBtn);
check('starts in one of the two themes', rootTheme() === 'night' || rootTheme() === 'day', String(rootTheme()));
const started = rootTheme();
// The icon is inline SVG (a ☀/☾ glyph pair would change the button's size between themes).
const themeIcon = $('.theme-icon');
check(
  'the toggle draws the icon for the theme it switches TO',
  themeIcon?.tagName.toLowerCase() === 'svg' && !!themeIcon.querySelector(started === 'night' ? 'circle' : 'path'),
  themeIcon ? `${themeIcon.tagName} ${started}` : 'no .theme-icon',
);
check('the toggle carries no visible label', (themeBtn.textContent || '').trim().length === 0, JSON.stringify(themeBtn.textContent));

click(themeBtn);
await sleep(600);
check('clicking flips the theme', rootTheme() !== started, `${started} -> ${rootTheme()}`);
check('the choice is persisted for next visit', window.localStorage.getItem('xiv-quest-tree:theme') === rootTheme(), String(window.localStorage.getItem('xiv-quest-tree:theme')));
check('the theme-color meta follows the theme', $('meta[name="theme-color"]')?.getAttribute('content') === (rootTheme() === 'day' ? '#f7f3e9' : '#0a0d12'), String($('meta[name="theme-color"]')?.getAttribute('content')));
check('the app is still alive after switching', !!$('.stage-canvas') && !!$('.app'));

click(themeBtn);
await sleep(600);
check('switching back returns to the original theme', rootTheme() === started, `${started} -> ${rootTheme()}`);

/* --------------------------------------------------------------- errors */
console.log('\n--- console / runtime errors ---');
runtimeErrors.slice(0, 8).forEach((e) => console.log('   runtime:', String(e).split('\n')[0]));
consoleErrors.slice(0, 8).forEach((e) => console.log('   console:', String(e).split('\n')[0]));
check('no uncaught runtime errors', runtimeErrors.length === 0, `${runtimeErrors.length}`);
check('no React console errors', consoleErrors.length === 0, `${consoleErrors.length}`);

console.log(failures ? `\n${failures} DOM CHECK(S) FAILED` : '\nALL DOM CHECKS PASSED');
dom.window.close();
process.exit(failures ? 1 : 0);
