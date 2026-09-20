/**
 * Verification of the pure logic the site relies on (filters, search, taxonomy, layout).
 * Runs in plain Node — the browser bundle uses the same modules.
 */
import { readFile } from 'node:fs/promises';
import { PALETTES, rgbToHex } from '../src/graph/theme.ts';
import { buildNameIndex, dependencyPath, homePath, parseLocation, resolveRoute } from '../src/route.ts';
import { mapUrl } from '../src/map.ts';
import { chooseLang, firstSupportedLang } from '../src/i18n.ts';
import { applyFilters, buildTaxonomy, datasetSources, dependencyClosure, fetchFirstAvailable, prerequisiteSet, relatedSet, searchQuests } from '../src/data.ts';
import { cdnUrlFor } from '../src/cdn.ts';
import { markerIconLocalUrl, markerIconUrl } from '../src/graph/icons.ts';
import { layoutGraph, DEFAULT_X_STEP, DEFAULT_Y_STEP } from '../src/graph/layout.ts';
import {
  COLUMN_STEP,
  DEP_ANCHOR,
  DEP_COLUMNS,
  MAX_SCALE,
  MIN_SCALE,
  focusViewport,
  scaleForColumns,
} from '../src/graph/camera.ts';
import { emptyFilters, isMainScenario } from '../src/types.ts';

const raw = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const data = { ...raw, quests: raw.quests };
const index = new Map(data.quests.map((q) => [q.id, q]));

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

console.log('=== dataset ===');
check('5377 quests', data.quests.length === 5377, String(data.quests.length));
check('every quest has a CN name', data.quests.every((q) => q.cn));
check('every quest has an EN name', data.quests.every((q) => q.en));
check('every quest has a JA name', data.quests.every((q) => q.ja));
check(
  'no FFXIV private-use glyphs left in names',
  !data.quests.some((q) => /[\uE000-\uF8FF\u200B-\u200F]/.test(q.cn + q.en + q.ja)),
);
check(
  'no leading/trailing whitespace in names',
  data.quests.every((q) => q.cn === q.cn.trim() && q.en === q.en.trim() && q.ja === q.ja.trim()),
);
check('every prerequisite id resolves', data.quests.every((q) => q.prev.every((p) => index.has(p))));
check('every follow-up is reciprocal', data.quests.every((q) => q.next.every((n) => index.get(n).prev.includes(q.id))));

console.log('\n=== the wiki reference quest (69477 苍鹰归巢作战 / Where Eagles Nest) ===');
const eagle = index.get(69477);
check('exists', !!eagle);
check('CN name', eagle.cn === '苍鹰归巢作战', eagle.cn);
check('EN name', eagle.en === 'Where Eagles Nest', eagle.en);
check('JA name', eagle.ja === '荒鷲の巣作戦', eagle.ja);
check('level 71', eagle.lv === 71, String(eagle.lv));
check('patch 5.35', eagle.patch === '5.35', eagle.patch);
check('region = Gangos 甘戈斯', data.dicts.place[eagle.place][0] === '甘戈斯', data.dicts.place[eagle.place][0]);
check('category = 武器强化支线任务', data.dicts.jcat[eagle.jcat][0] === '武器强化支线任务', data.dicts.jcat[eagle.jcat][0]);
check('subcategory = 天佑女王', data.dicts.jgen[eagle.jgen][0] === '天佑女王', data.dicts.jgen[eagle.jgen][0]);
check('starting NPC = 马尔夏克', data.dicts.npc[eagle.start][0] === '马尔夏克', data.dicts.npc[eagle.start][0]);
check('ending NPC = 水琴', data.dicts.npc[eagle.end][0] === '水琴', data.dicts.npc[eagle.end][0]);
check('lodestone coords 6.4/5.7', eagle.lode.x === 6.4 && eagle.lode.y === 5.7, `${eagle.lode.x}/${eagle.lode.y}`);
const prevCn = eagle.prev.map((p) => index.get(p).cn);
const nextCn = eagle.next.map((n) => index.get(n).cn);
check(
  'prerequisites match the wiki',
  ['博兹雅堡垒蒸发事件', '重现“女王之刃”', '纯白誓约、漆黑密约'].every((n) => prevCn.includes(n)),
  prevCn.join(' | '),
);
check(
  'follow-ups match the wiki',
  ['记录“战果记录”', '工作时禁止喝酒'].every((n) => nextCn.includes(n)),
  nextCn.join(' | '),
);

console.log('\n=== taxonomy ===');
const zh = buildTaxonomy(data, 'cn');
const en = buildTaxonomy(data, 'en');
check('expansions', zh.ex.length === 6, zh.ex.map((e) => e.name).join(','));
check('sections', zh.js.length === 9, zh.js.map((s) => s.name).join(','));
check('categories', zh.jcat.length > 80, String(zh.jcat.length));
check('subcategories', zh.jgen.length > 200, String(zh.jgen.length));
check('EN taxonomy differs from CN', en.jcat[0].name !== zh.jcat[0].name, `${zh.jcat[0].name} / ${en.jcat[0].name}`);
const counts = zh.jcat.reduce((a, c) => a + c.count, 0);
check('category counts sum to the dataset size', counts === data.quests.length, `${counts} vs ${data.quests.length}`);

console.log('\n=== dictionary coverage (what the detail panel looks up) ===');
const missing = { js: new Set(), jcat: new Set(), jgen: new Set(), ex: new Set(), cjc: new Set(), place: new Set(), npc: new Set() };
for (const q of data.quests) {
  if (!data.dicts.js[q.js]) missing.js.add(q.js);
  if (!data.dicts.jcat[q.jcat]) missing.jcat.add(q.jcat);
  if (!data.dicts.jgen[q.jgen]) missing.jgen.add(q.jgen);
  if (!data.dicts.ex[q.ex]) missing.ex.add(q.ex);
  if (q.cjc && !data.dicts.cjc[q.cjc]) missing.cjc.add(q.cjc);
  if (q.place && !data.dicts.place[q.place]) missing.place.add(q.place);
  if (q.start && !data.dicts.npc[q.start]) missing.npc.add(q.start);
  if (q.end && !data.dicts.npc[q.end]) missing.npc.add(q.end);
}
for (const [k, v] of Object.entries(missing)) {
  check(`every ${k} reference resolves`, v.size === 0, [...v].slice(0, 8).join(','));
}
check(
  'every dictionary entry is a 3-language trio',
  Object.values(data.dicts).every((g) => Object.values(g).every((t) => Array.isArray(t) && t.length === 3)),
);

console.log('\n=== filters ===');
const f = emptyFilters();
const tianyou = zh.jgen.find((g) => g.name === '天佑女王');
check('天佑女王 subcategory found', !!tianyou, tianyou && String(tianyou.count));
f.jgen = new Set([tianyou.id]);
const visible = applyFilters(data.quests, f);
check('filter yields the expected count', visible.length === tianyou.count, `${visible.length} vs ${tianyou.count}`);
check('all results are 天佑女王', visible.every((q) => q.jgen === tianyou.id));

// the "主线任务" preset is a section filter over js 0 + 1
const f2 = emptyFilters();
f2.js = new Set([0, 1]);
const msq = applyFilters(data.quests, f2);
check('main-scenario preset filter', msq.length > 1000 && msq.every(isMainScenario), `${msq.length} quests`);
check(
  'main scenario excludes the unclassified class/job quests',
  data.quests.filter((q) => q.js === -1).length === 184 && msq.every((q) => q.jcat !== -1),
);

const f3 = emptyFilters();
const wx = zh.jcat.find((c) => c.name === '武器强化支线任务');
f3.jcat = new Set([wx.id]);
const weapons = applyFilters(data.quests, f3);
check('主分类 武器强化支线任务 filter', weapons.length === wx.count && weapons.length >= 80, `${weapons.length} quests`);

console.log('\n=== search ===');
for (const [q, expect] of [
  ['苍鹰归巢作战', 69477],
  ['Where Eagles Nest', 69477],
  ['荒鷲の巣作戦', 69477],
  ['where eagles', 69477],
  ['天佑女王', null],
]) {
  const r = searchQuests(data.quests, q, 'cn', 20);
  check(`search "${q}" -> ${r.length} hits`, r.length > 0 && (expect === null || r.some((x) => x.id === expect)), r.slice(0, 2).map((x) => `${x.cn}/${x.en}`).join(' ; '));
}

console.log('\n=== graph traversal ===');
const rel = relatedSet(69477, index, 3, 3);
check('related set is non-trivial', rel.size > 5, `${rel.size} quests`);
check('related set includes prerequisites', eagle.prev.every((p) => rel.has(p)));
check('related set includes follow-ups', eagle.next.every((n) => rel.has(n)));

console.log('\n=== selection highlight (prerequisites only) ===');
{
  const q = index.get(69477);
  const hi = prerequisiteSet(69477, index, 5);
  // an ancestor reaches the quest by walking DOWN (next), not up
  const canReachRoot = (id) => {
    if (id === 69477) return true;
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = index.get(stack.pop());
      for (const n of cur.next) {
        if (n === 69477) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return false;
  };
  check('highlight contains the quest itself', hi.has(69477));
  check('highlight contains its direct prerequisites', q.prev.every((p) => hi.has(p)), q.prev.join(','));
  check('highlight contains no follow-up of the quest', q.next.every((n) => !hi.has(n)), `${hi.size} nodes, next=${q.next.join(',')}`);
  check(
    'every highlighted node leads to the quest through prerequisites alone',
    [...hi].every(canReachRoot),
    `${hi.size} nodes`,
  );
  const both = relatedSet(69477, index, 5, 5);
  check('relatedSet still walks both directions', both.size > hi.size, `${both.size} vs ${hi.size}`);
}

console.log('\n=== theme palettes match the stylesheet ===');
{
  const css = await readFile('src/styles.css', 'utf8');
  const block = (re) => {
    const m = re.exec(css);
    return m ? m[1] : null;
  };
  const secs = (body) => {
    const out = new Map();
    for (const m of body.matchAll(/--sec-(\d+):\s*(#[0-9a-fA-F]{6})/g)) out.set(Number(m[1]), m[2].toLowerCase());
    return out;
  };
  const rootBody = block(/:root \{([\s\S]*?)\n\}/);
  const dayBody = block(/\[data-theme='day'\] \{([\s\S]*?)\n\}/);
  check('both theme blocks exist in the stylesheet', !!rootBody && !!dayBody);
  if (rootBody && dayBody) {
    const root = secs(rootBody);
    const day = secs(dayBody);
    for (const [name, palette, cssMap] of [
      ['night', PALETTES.night, root],
      ['day', PALETTES.day, day],
    ]) {
      const mismatched = Object.entries(palette.sections).filter(([id, rgb]) => cssMap.get(Number(id)) !== rgbToHex(rgb));
      check(
        `${name}: all ${Object.keys(palette.sections).length} --sec-N values match the canvas palette`,
        mismatched.length === 0,
        mismatched.map(([id, rgb]) => `sec-${id} css=${cssMap.get(Number(id))} ts=${rgbToHex(rgb)}`).join(' | '),
      );
    }
    // the night block must actually differ from the day block, or the toggle is a no-op
    check('the two themes differ', [...root].some(([k, v]) => day.get(k) !== v));
  }
}

console.log('\n=== canvas contrast (WCAG) ===');
{
  const parse = (s) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(s);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(s);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const chan = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  for (const name of ['night', 'day']) {
    const pal = PALETTES[name];
    const bg = parse(pal.bg);
    const on = (c) => ratio(over(parse(c), bg), bg);
    const rOther = on(pal.labelOther);
    const rMain = on(pal.labelMain);
    const rHot = on(pal.labelHot);
    const rSelect = on(pal.selectRing);
    const rHover = on(pal.hoverRing);
    const rMatch = on(pal.matchRing);
    const rHighlight = on(pal.highlightRing);
    console.log(
      `  ${name}: label ${rOther.toFixed(1)}/${rMain.toFixed(1)}/${rHot.toFixed(1)}:1  ` +
        `select ${rSelect.toFixed(1)}  hover ${rHover.toFixed(1)}  match ${rMatch.toFixed(1)}  chain ${rHighlight.toFixed(1)}`,
    );
    // WCAG AA for body text is 4.5:1; graphics need 3:1
    check(`${name}: quest names clear AA (>= 4.5:1)`, rOther >= 4.5 && rMain >= 4.5 && rHot >= 4.5, `${rOther.toFixed(1)} / ${rMain.toFixed(1)} / ${rHot.toFixed(1)}`);
    check(`${name}: selection ring clears 3:1`, rSelect >= 3, rSelect.toFixed(1));
    check(`${name}: hover / search / chain rings clear 3:1`, rHover >= 3 && rMatch >= 3 && rHighlight >= 3, `${rHover.toFixed(1)} / ${rMatch.toFixed(1)} / ${rHighlight.toFixed(1)}`);
  }
}

console.log('\n=== shareable deep links ===');
{
  const names = buildNameIndex(data.quests);
  const eagle = index.get(69477);

  check('/pre/<name> parses', JSON.stringify(parseLocation('/pre/苍鹰归巢作战', '')) === JSON.stringify({ view: 'dependency', dir: 'prev', name: '苍鹰归巢作战', id: null }));
  check('/post/<name> parses', parseLocation('/post/Where Eagles Nest', '').dir === 'next');
  check('percent-encoded names decode', parseLocation('/pre/' + encodeURIComponent('重现“女王之刃”'), '').name === '重现“女王之刃”');
  check('?id= is picked up', parseLocation('/pre/x', '?id=69477').id === 69477);
  check('a non-integer ?id= is ignored', parseLocation('/pre/x', '?id=abc').id === null);
  check('the root path is home', parseLocation('/', '').view === 'home');
  check('unrelated paths are home', parseLocation('/whatever/deep', '').view === 'home');
  check('malformed escapes fall back to home', parseLocation('/pre/%E0%A4%A', '').view === 'home');

  check('a name resolves to its quest', resolveRoute(parseLocation('/pre/苍鹰归巢作战', ''), names, index) === 69477);
  check('English names resolve too', resolveRoute(parseLocation('/post/Where Eagles Nest', ''), names, index) === 69477);
  check('case-insensitive lookup', resolveRoute(parseLocation('/pre/where eagles nest', ''), names, index) === 69477);
  check('an unknown name resolves to nothing', resolveRoute(parseLocation('/pre/这不存在的任务', ''), names, index) === null);
  check('an explicit id wins over the name', resolveRoute(parseLocation('/pre/乱写的名字', '?id=69477'), names, index) === 69477);
  check('a bare id resolves', resolveRoute(parseLocation('/pre/69477', ''), names, index) === 69477);
  check('an unknown id resolves to nothing', resolveRoute(parseLocation('/pre/99999999', ''), names, index) === null);
  check('an unknown ?id= resolves to nothing', resolveRoute(parseLocation('/pre/x', '?id=99999999'), names, index) === null);

  const unique = dependencyPath(eagle, 'prev');
  check('the copy button writes a short id link', unique === '/pre/69477', unique);
  check('paths round-trip through the parser', resolveRoute(parseLocation(unique, ''), names, index) === 69477);
  check('builders agree with the parser for both directions', (() => {
    const a = dependencyPath(eagle, 'prev');
    const b = dependencyPath(eagle, 'next');
    return parseLocation(a, '').dir === 'prev' && parseLocation(b, '').dir === 'next' && homePath() === '/';
  })());
  check('a shareable link contains no percent-escapes and no non-ASCII', /^\/pre\/\d+$/.test(unique), unique);

  // Names remain supported for links shared before the switch to ids, including the
  // 70 Chinese names that more than one quest carries (they used to need `?id=`).
  const dupName = [...names.entries()].find(([, ids]) => ids.length > 1)[0];
  const dupId = names.get(dupName)[0];
  check(
    'an ambiguous name still resolves (to the earliest namesake)',
    resolveRoute(parseLocation('/pre/' + encodeURIComponent(dupName), ''), names, index) === Math.min(...names.get(dupName)),
    `${dupName} -> ${dupId}`,
  );
  check(
    'the old ?id= disambiguated link still resolves',
    resolveRoute(parseLocation('/pre/' + encodeURIComponent(dupName), '?id=' + dupId), names, index) === dupId,
    `${dupName} -> ${dupId}`,
  );

  // Exhaustive: EVERY quest must be reachable through the link the copy button makes
  // for it — that is the guarantee behind "some names might break the URL".
  let broken = 0;
  const brokenSample = [];
  const badSegments = [];
  for (const q of data.quests) {
    for (const dir of ['prev', 'next']) {
      const path = dependencyPath(q, dir);
      const [p, query] = path.split('?');
      const seg = p.replace(/^\/(pre|post)\//, '');
      // a single segment must survive decode and contain no path delimiters
      if (seg.includes('/') || seg.includes('?') || seg.includes('#')) badSegments.push(path);
      const back = resolveRoute(parseLocation(p, query ? '?' + query : ''), names, index);
      if (back !== q.id) {
        broken++;
        if (brokenSample.length < 5) brokenSample.push(`${q.id} ${q.cn} -> ${path} -> ${back}`);
      }
    }
  }
  check('no generated link produces a multi-segment or otherwise unsafe path', badSegments.length === 0, badSegments.slice(0, 3).join(' | '));
  check(
    `all ${data.quests.length} quests round-trip through their own shared link`,
    broken === 0,
    brokenSample.join(' | '),
  );
}

console.log('\n=== entry language ===');
{
  check('a supported browser language is used', chooseLang({ browserLangs: ['ja-JP'] }) === 'ja');
  check('the first supported language in the list wins', chooseLang({ browserLangs: ['de-DE', 'fr-FR', 'zh-TW'] }) === 'cn');
  check('region and script subtags do not matter', firstSupportedLang(['zh-Hans-CN']) === 'cn' && firstSupportedLang(['en_GB']) === 'en');
  check('an unsupported browser language falls back to English', chooseLang({ browserLangs: ['ko-KR'] }) === 'en');
  check('an empty language list falls back to English', chooseLang({ browserLangs: [] }) === 'en');
  check('an unsupported saved value is ignored', chooseLang({ saved: 'de', browserLangs: ['de'] }) === 'en');
  check('the saved choice beats the browser', chooseLang({ saved: 'en', browserLangs: ['ja'] }) === 'en');
  check('the html lang is used when the browser says nothing', chooseLang({ htmlLang: 'zh-Hans' }) === 'cn');
  check('an unsupported html lang falls back to English', chooseLang({ htmlLang: 'ar' }) === 'en');

  // index.html resolves <html lang> before first paint; App reads that attribute back,
  // so the two must agree on the same sources of information.
  const html = await readFile('index.html', 'utf8');
  check(
    'index.html resolves the language before first paint',
    html.includes('navigator.languages') && html.includes('xiv-quest-tree:lang') && /document\.documentElement\.lang/.test(html),
  );
  check('index.html falls back to English, not to the Chinese default', /document\.documentElement\.lang = 'en'/.test(html));
}

console.log('\n=== site icon ===');
{
  const html = await readFile('index.html', 'utf8');
  const svg = await readFile('public/favicon.svg', 'utf8');
  const css = await readFile('src/styles.css', 'utf8');

  check('index.html links the SVG favicon', /rel="icon"[^>]*favicon\.svg/.test(html));
  check('index.html links a PNG fallback for Safari', /rel="icon"[^>]*favicon-32\.png/.test(html));
  check('index.html links an apple-touch-icon for iOS', /rel="apple-touch-icon"[^>]*apple-touch-icon\.png/.test(html));
  check('the favicon is a well-formed SVG with a viewBox', svg.trimStart().startsWith('<svg') && svg.includes('viewBox="0 0 64 64"') && svg.includes('</svg>'));

  // The mark is drawn with the UI's own colours, so it cannot drift away from the theme.
  const gold = /--gold:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
  const goldBright = /--gold-bright:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
  const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
  check('the favicon uses the UI gold', !!gold && svg.includes(gold), `${gold}`);
  check('the favicon core uses the UI bright gold', !!goldBright && svg.includes(goldBright), `${goldBright}`);
  check('the favicon sits on the app background', !!bg && svg.includes(bg), `${bg}`);
  check('the mark is three flat shapes (no gradients)', !/gradient/i.test(svg), '');

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const [file, size] of [['public/favicon-32.png', 32], ['public/apple-touch-icon.png', 180]]) {
    const buf = await readFile(file);
    const w = buf.length > 24 ? buf.readUInt32BE(16) : 0;
    const h = buf.length > 24 ? buf.readUInt32BE(20) : 0;
    check(`${file} is a ${size}x${size} PNG`, buf.subarray(0, 8).equals(PNG_SIG) && w === size && h === size, `${w}x${h}`);
  }
}

console.log('\n=== interactive map link ===');
{
  check(
    'a map link carries the Map id and the displayed coordinates',
    mapUrl(603, 6.4, 5.7) === 'https://map.wakingsands.com/#f=mark&id=603&x=6.4&y=5.7',
    String(mapUrl(603, 6.4, 5.7)),
  );
  check('an unknown map produces no link', mapUrl(0, 6.4, 5.7) === null);
  check('coordinates that were never resolved produce no link', mapUrl(603, NaN, 5.7) === null && mapUrl(603, 6.4, Infinity) === null);

  const withMap = data.quests.filter((q) => q.mp > 0);
  const withCoords = data.quests.filter((q) => q.lode && q.lode.x != null && q.lode.y != null);
  const coordsNoMap = withCoords.filter((q) => !(q.mp > 0));
  console.log(`   ${withMap.length}/${data.quests.length} quests know their map, ${withCoords.length} have coordinates, ${coordsNoMap.length} have coordinates but no map`);
  check('almost every quest knows which map it starts on', withMap.length / data.quests.length > 0.98, `${withMap.length}`);
  check('hardly any coordinate is left without a map', coordsNoMap.length < 20, `${coordsNoMap.length}`);

  // 乌尔达哈 / 利姆萨·罗敏萨 / 格里达尼亚 / 伊修加德 are whole cities in the Quest sheet,
  // each spread over several district maps — the Level table is what resolves those.
  const cities = data.quests.filter((q) => [39, 51, 27, 62].includes(q.place));
  check(
    'city quests resolve to a district map, not to nothing',
    cities.length > 500 && cities.filter((q) => q.mp > 0).length / cities.length > 0.95,
    `${cities.filter((q) => q.mp > 0).length}/${cities.length}`,
  );
  const maps = [...new Set(withMap.map((q) => q.mp))];
  check('the ids point at many different maps', maps.length > 100, `${maps.length} maps`);
  const eagle = data.quests.find((q) => q.id === 69477);
  check('a known quest points at the map its NPC stands on', eagle.mp === 603, `map ${eagle.mp} at ${eagle.lode.x},${eagle.lode.y}`);
}

console.log('\n=== CDN mirror ===');
{
  check(
    'a repository path becomes an immutable jsDelivr link',
    cdnUrlFor('abc1234', 'public/data/quests.json') === 'https://cdn.jsdelivr.net/gh/996xiaozhe/xiv-quest-tree@abc1234/public/data/quests.json',
    String(cdnUrlFor('abc1234', 'public/data/quests.json')),
  );
  check('leading slashes are tolerated', cdnUrlFor('abc1234', '/public/icons/71221.png')?.endsWith('/public/icons/71221.png') === true);
  check('without a build ref there is no CDN link', cdnUrlFor('', 'public/data/quests.json') === null && cdnUrlFor('abc', '') === null);

  // In plain Node there is no build ref, so the app must fall back to its own copy.
  const sources = datasetSources();
  check('with no build ref the dataset has one source: the local copy', sources.length === 1 && sources[0].endsWith('data/quests.json'), sources.join(' | '));
  check('icons fall back to the local path too', markerIconUrl(71221) === markerIconLocalUrl(71221), markerIconUrl(71221));

  // The fallback itself: a blocked CDN must not stop the app.
  {
    const tried = [];
    const blocked = async (url) => {
      tried.push(String(url));
      if (String(url).includes('jsdelivr')) throw new Error('blocked');
      return new Response('{"quests":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const res = await fetchFirstAvailable(['https://cdn.jsdelivr.net/gh/x/y@z/public/data/quests.json', '/data/quests.json'], blocked, 50);
    check('a blocked CDN falls back to the local copy', tried.length === 2 && res.status === 200, tried.map((u) => u.slice(0, 32)).join(' → '));
    check('the fallback response is usable', (await res.json()).quests.length === 0);
  }
  {
    const tried = [];
    const ok = async (url) => {
      tried.push(String(url));
      return new Response('{"quests":[]}', { status: 200 });
    };
    await fetchFirstAvailable(['https://cdn.jsdelivr.net/gh/x/y@z/public/data/quests.json', '/data/quests.json'], ok, 50);
    check('a healthy CDN is used first and only once', tried.length === 1 && tried[0].includes('jsdelivr'), tried.length + ' attempts');
  }
  {
    const tried = [];
    const failing = async (url) => {
      tried.push(String(url));
      throw new Error('offline');
    };
    let threw = false;
    try {
      await fetchFirstAvailable(['/a.json', '/b.json'], failing, 50);
    } catch {
      threw = true;
    }
    check('if every source fails the loader reports it', threw && tried.length === 2, tried.join(' → '));
  }
}

console.log('\n=== layout ===');
const t0 = Date.now();
const layAll = layoutGraph(data.quests, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
const ms = Date.now() - t0;
check('no cycles in the full graph', layAll.cycles === 0, String(layAll.cycles));
check('no two nodes share a position', new Set([...layAll.pos.values()].map((p) => p.x + ':' + p.y)).size === data.quests.length);
check(`layout of 5377 nodes is fast (${ms} ms)`, ms < 1500);
const mainLanes = [...layAll.pos.entries()].filter(([id]) => isMainScenario(index.get(id))).map(([, p]) => Math.abs(p.lane));
const otherLanes = [...layAll.pos.entries()].filter(([id]) => !isMainScenario(index.get(id))).map(([, p]) => Math.abs(p.lane));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
check('main scenario hugs the centre spine', avg(mainLanes) < avg(otherLanes) / 2, `main |lane| avg ${avg(mainLanes).toFixed(1)} vs others ${avg(otherLanes).toFixed(1)}`);

const laySmall = layoutGraph(visible, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
check('filtered layout has no collisions', new Set([...laySmall.pos.values()].map((p) => p.x + ':' + p.y)).size === visible.length);

// ASCII of the flagship filtered view
const sub = applyFilters(data.quests, f);
const subLay = layoutGraph(sub, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
const COLS = 110;
const ROWS = 34;
const gx = (x) => Math.round((x - subLay.minX) / Math.max(1, subLay.maxX - subLay.minX) * (COLS - 1));
const gy = (y) => Math.round((y - subLay.minY) / Math.max(1, subLay.maxY - subLay.minY) * (ROWS - 1));
const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
for (const q of sub) {
  const p = subLay.pos.get(q.id);
  grid[gy(p.y)][gx(p.x)]++;
}
console.log('\n--- 子分类「天佑女王」 subgraph (rank = x, lane = y) ---');
for (const row of grid) console.log(row.map((v) => (v === 0 ? ' ' : v === 1 ? 'o' : v < 4 ? 'O' : '#')).join('').replace(/\s+$/, ''));

console.log('\n=== dependency view framing ===');
{
  const STAGE = 1180;
  const colsAcross = (w) => w / (scaleForColumns(w, DEP_COLUMNS) * COLUMN_STEP);
  const widths = [640, 900, 1180, 1600];
  const drift = widths.map((w) => [w, colsAcross(w)]).filter(([, c]) => Math.abs(c - DEP_COLUMNS) > 0.02);
  check(
    `a ${DEP_COLUMNS}-column frame really shows ${DEP_COLUMNS} quest ranks at any stage width`,
    drift.length === 0,
    drift.map(([w, c]) => `${w}px -> ${c.toFixed(2)} cols`).join(' | '),
  );
  // On an ultra-wide stage the entry zoom is capped by the global MAX_SCALE, so the
  // frame loosens a little instead of zooming past a level where the diamonds are huge.
  // Either way it stays a local window — never a fitted overview of the whole ancestry.
  const sweep = [200, 400, 700, 1000, 1400, 1900, 2400, 3200].map((w) => [w, colsAcross(w)]);
  const unbounded = sweep.filter(([, c]) => c < DEP_COLUMNS - 0.02 || c > 14);
  check(
    'no stage width turns the entry view into an overview',
    unbounded.length === 0,
    unbounded.map(([w, c]) => `${w}px -> ${c.toFixed(2)} cols`).join(' | '),
  );
  check(
    'the dependency zoom is clamped to the global zoom limits',
    scaleForColumns(2, DEP_COLUMNS) === MIN_SCALE && scaleForColumns(100000, DEP_COLUMNS) === MAX_SCALE,
    `${scaleForColumns(2, DEP_COLUMNS)} / ${scaleForColumns(100000, DEP_COLUMNS)}`,
  );
  check(
    'prerequisite views park the root on the right, follow-up views on the left',
    DEP_ANCHOR.prev > 0.5 && DEP_ANCHOR.next < 0.5 && Math.abs(DEP_ANCHOR.prev + DEP_ANCHOR.next - 1) < 1e-9,
    `prev ${DEP_ANCHOR.prev} / next ${DEP_ANCHOR.next}`,
  );

  // the anchor really lands the quest at that fraction of the stage width
  const scale = scaleForColumns(STAGE, DEP_COLUMNS);
  const vp = focusViewport({ x: 3000, y: -120 }, STAGE, scale, DEP_ANCHOR.prev);
  const screenX = (3000 - vp.x) * vp.scale + STAGE / 2;
  check(
    'anchorX puts the focused quest at exactly that fraction of the stage',
    Math.abs(screenX - DEP_ANCHOR.prev * STAGE) < 0.5 && Math.abs(vp.y - -120) < 1e-9,
    `screenX ${screenX.toFixed(1)} of ${STAGE}`,
  );

  // and on real ancestry: the ranks leading INTO the quest must be the ones on screen
  let sampled = 0;
  const starved = [];
  for (const q of data.quests.slice(0, 900)) {
    const chain = dependencyClosure(index, q.id, 'prev', false);
    if (chain.length < 8) continue;
    const lay = layoutGraph(chain, index, { xStep: DEFAULT_X_STEP, yStep: DEFAULT_Y_STEP, isMain: isMainScenario });
    const root = lay.pos.get(q.id);
    if (!root) continue;
    const ancestors = chain.map((n) => lay.pos.get(n.id)).filter((p) => p && p.x < root.x - 1e-6);
    if (!ancestors.length) continue;
    // left edge of the stage, in world units, for the viewport the app would open with
    const leftEdge = root.x - (DEP_ANCHOR.prev * STAGE) / scale;
    const rankOf = (p) => Math.round(p.x / COLUMN_STEP);
    const totalRanks = new Set(ancestors.map(rankOf)).size;
    const ranksInFrame = new Set(ancestors.filter((p) => p.x >= leftEdge).map(rankOf)).size;
    sampled++;
    // the nearest ranks must be visible; deeper ancestry is what the user pans to
    if (ranksInFrame < Math.min(4, totalRanks)) starved.push(`${q.cn} (${ranksInFrame}/${totalRanks})`);
    if (sampled >= 60) break;
  }
  check(
    `opening a /pre view leaves the ranks leading into the quest on screen (${sampled} sampled)`,
    sampled > 0 && starved.length === 0,
    starved.slice(0, 3).join(' | '),
  );
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
