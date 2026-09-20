/**
 * Merges everything into the dataset the website ships.
 *
 *   ffxiv-datamining-cn  -> Chinese names (XIVAPI has no CN data)
 *   XIVAPI v2            -> current EN/JA/DE/FR names + the journal taxonomy + rewards
 *   XIVAPI v1            -> release patch numbers (column dropped from the new schema)
 *   Lodestone            -> official deep link + starting-NPC coordinates + verification
 *
 * Output: public/data/quests.json
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadDataminingCsv } from './lib/csv.mjs';

const SRC = path.resolve('data-src');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/**
 * Game strings often carry FFXIV's private-use icon glyphs and zero-width padding
 * (e.g. the Bozja quest "重现“女王之刃”" arrives as "\uE0BF 重现“女王之刃”").
 * Strip those so display and search behave.
 */
const clean = (s) =>
  (s || '')
    .replace(/[\uE000-\uF8FF]/g, '') // FFXIV private-use glyphs
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // zero-width / bidi marks
    .replace(/\s+/g, ' ')
    .trim();

const trio = (cn, en, ja) => [clean(cn), clean(en), clean(ja)];

/* ------------------------------------------------------- Chinese CSV names --- */
console.log('reading Chinese game data ...');
const cnQuestName = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/Quest.csv'))) {
  const n = r.get('Name');
  if (n) cnQuestName.set(r.key, n);
}
const cnNpc = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/ENpcResident.csv'))) {
  const n = r.get('Singular');
  if (n) cnNpc.set(r.key, n);
}
const cnPlace = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/PlaceName.csv'))) {
  const n = r.get('Name');
  if (n) cnPlace.set(r.key, n);
}
const cnGenre = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/JournalGenre.csv'))) {
  const n = r.get('Name');
  if (n) cnGenre.set(r.key, n);
}
const cnCategory = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/JournalCategory.csv'))) {
  const n = r.get('Name');
  if (n) cnCategory.set(r.key, n);
}
const cnSection = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/JournalSection.csv'))) {
  const n = r.get('Name');
  if (n) cnSection.set(r.key, n);
}
const cnCjc = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/ClassJobCategory.csv'))) {
  const n = r.get('Name');
  if (n) cnCjc.set(r.key, n);
}
const cnEx = new Map();
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/ExVersion.csv'))) {
  const n = r.get('Name');
  if (n) cnEx.set(r.key, n);
}

/**
 * Where each quest's starting NPC actually stands.
 *
 * The interactive map (map.wakingsands.com) is addressed by **Map** id — not Territory —
 * and its x/y are the same displayed coordinates the detail panel prints. A quest's
 * PlaceName is too coarse for that: an ARR city quest is filed under 乌尔达哈 as a whole,
 * which owns three district maps. The Level table resolves the NPC itself, and its Map
 * column is exactly the map the player sees (it also covers the ~1 100 city quests).
 */
const mapByNpc = new Map(); // ENpcResident id -> Map id
const mapsByPlace = new Map(); // PlaceName id -> [Map id] (fallback, ascending)
const mapById = new Map(); // Map id -> the row, for anything that needs sizeFactor/offsets
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/Map.csv'))) {
  mapById.set(r.key, r);
  const place = r.num('PlaceName');
  if (!place) continue;
  if (!mapsByPlace.has(place)) mapsByPlace.set(place, []);
  mapsByPlace.get(place).push(r.key);
}
for (const ids of mapsByPlace.values()) ids.sort((a, b) => a - b);
for (const r of await loadDataminingCsv(path.join(SRC, 'cn/Level.csv'))) {
  const obj = r.num('Object');
  const map = r.num('Map');
  if (obj && map && !mapByNpc.has(obj)) mapByNpc.set(obj, map);
}
console.log(
  '  CN names: quests',
  cnQuestName.size,
  'npcs',
  cnNpc.size,
  'places',
  cnPlace.size,
  '| maps',
  mapById.size,
  '| NPC spawns',
  mapByNpc.size,
);

/* ------------------------------------------------------------------ v2 --- */
console.log('reading XIVAPI v2 ...');
const D2 = path.join(SRC, 'xivapi-v2');
const quests0 = await readJson(path.join(D2, 'quests.json'));
const genreRows = await readJson(path.join(D2, 'journalgenre.json'));
const categoryRows = await readJson(path.join(D2, 'journalcategory.json'));
const sectionRows = await readJson(path.join(D2, 'journalsection.json'));
const cjcRows = await readJson(path.join(D2, 'classjobcategory.json'));
const exRows = await readJson(path.join(D2, 'exversion.json'));
const placeRows = await readJson(path.join(D2, 'placename.json'));
const npcRows = await readJson(path.join(D2, 'enpcresident.json'));
const patches = await readJson(path.join(SRC, 'xivapi-v1/patches.json')).catch(() => ({}));
console.log('  quests', quests0.length, 'genre', genreRows.length, 'category', categoryRows.length, 'section', sectionRows.length);

const idx = (rows) => new Map(rows.map((r) => [r.id, r]));
const genreById = idx(genreRows);
const categoryById = idx(categoryRows);
const sectionById = idx(sectionRows);
const cjcById = idx(cjcRows);
const exById = idx(exRows);
const placeById = idx(placeRows);
const npcById = idx(npcRows);

/* ----------------------------------------------------------- Lodestone --- */
let lodeEntries = [];
let lodeDetails = {};
try {
  lodeEntries = (await readJson(path.join(SRC, 'lodestone/list.json'))).entries;
  lodeDetails = await readJson(path.join(SRC, 'lodestone/details.json'));
  console.log('  lodestone entries', lodeEntries.length, '| details', Object.keys(lodeDetails).length);
} catch {
  console.log('  lodestone data not ready - skipping enrichment');
}

/* --------------------------------------------------------------- merge --- */
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lodeByName = new Map();
for (const e of lodeEntries) {
  const k = norm(e.name);
  if (!lodeByName.has(k)) lodeByName.set(k, []);
  lodeByName.get(k).push(e);
}

const npcDict = new Map();
const placeDict = new Map();
const genreDict = new Map();
const categoryDict = new Map();
const sectionDict = new Map();
const cjcDict = new Map();
const exDict = new Map();

const quests = [];
let lodeMatched = 0;
let noCn = 0;
let noEn = 0;

for (const q of quests0) {
  const enRaw = clean(q['Name@lang(en)']);
  const jaRaw = clean(q['Name@lang(ja)']);
  const de = clean(q['Name@lang(de)']);
  const fr = clean(q['Name@lang(fr)']);
  const cn = clean(cnQuestName.get(q.id) || '');
  if (!enRaw && !jaRaw && !cn) continue; // spacer rows
  // A handful of quests exist in the Chinese client only; fall back so the UI
  // always has something to show in every language.
  const en = enRaw || cn;
  const ja = jaRaw || cn;
  if (!enRaw) noEn++;
  if (!cn) noCn++;

  const genreId = q['JournalGenre@as(raw)'] || 0;
  const genre = genreId ? genreById.get(genreId) : undefined;
  const categoryId = genre ? genre['JournalCategory@as(raw)'] || 0 : 0;
  const category = categoryId ? categoryById.get(categoryId) : undefined;
  let sectionId = category ? category['JournalSection@as(raw)'] ?? -1 : -1;
  if (sectionId === 255 || sectionId == null || sectionId < 0) sectionId = -1;
  const catId = categoryId || -1;
  const genId = genreId || -1;

  const cjcId = q['ClassJobCategory0@as(raw)'] || 0;
  const placeId = q['PlaceName@as(raw)'] || 0;
  const exId = q['Expansion@as(raw)'] || 0;
  const startNpc = q['IssuerStart@as(raw)'] || 0;
  const endNpc = q['TargetEnd@as(raw)'] || 0;

  if (genId > 0) genreDict.set(genId, trio(cnGenre.get(genId), genre?.['Name@lang(en)'], genre?.['Name@lang(ja)']));
  if (catId > 0) categoryDict.set(catId, trio(cnCategory.get(catId), category?.['Name@lang(en)'], category?.['Name@lang(ja)']));
  if (sectionId >= 0) sectionDict.set(sectionId, trio(cnSection.get(sectionId), sectionById.get(sectionId)?.['Name@lang(en)'], sectionById.get(sectionId)?.['Name@lang(ja)']));
  if (cjcId) cjcDict.set(cjcId, trio(cnCjc.get(cjcId), cjcById.get(cjcId)?.['Name@lang(en)'], cjcById.get(cjcId)?.['Name@lang(ja)']));
  // ExVersion 0 is a real expansion ("A Realm Reborn"), so no truthiness guard here.
  exDict.set(exId, trio(cnEx.get(exId), exById.get(exId)?.['Name@lang(en)'], exById.get(exId)?.['Name@lang(ja)']));
  if (placeId) placeDict.set(placeId, trio(cnPlace.get(placeId), placeById.get(placeId)?.['Name@lang(en)'], placeById.get(placeId)?.['Name@lang(ja)']));
  if (startNpc) npcDict.set(startNpc, trio(cnNpc.get(startNpc), npcById.get(startNpc)?.['Singular@lang(en)'], npcById.get(startNpc)?.['Singular@lang(ja)']));
  if (endNpc) npcDict.set(endNpc, trio(cnNpc.get(endNpc), npcById.get(endNpc)?.['Singular@lang(en)'], npcById.get(endNpc)?.['Singular@lang(ja)']));

  // Lodestone match: exact (english name, level); fall back to a unique name match
  const level0 = q['ClassJobLevel'] && q['ClassJobLevel'][0] && q['ClassJobLevel'][0] !== 65535 ? q['ClassJobLevel'][0] : 0;
  const candidates = lodeByName.get(norm(en)) || [];
  let lode = null;
  if (candidates.length === 1) lode = candidates[0];
  else if (candidates.length > 1) lode = candidates.find((c) => c.level === level0) || null;
  let lodeInfo = null;
  if (lode) {
    const d = lodeDetails[lode.hash];
    lodeMatched++;
    lodeInfo = {
      h: lode.hash,
      x: d?.giver?.x ?? null,
      y: d?.giver?.y ?? null,
    };
  }

  const prev = (q['PreviousQuest@as(raw)'] || []).filter(Boolean);
  const lock = (q['QuestLock'] || []).map((l) => (l && typeof l === 'object' ? l.value : l)).filter(Boolean);
  const levels = q['ClassJobLevel'] || [];
  const lvl = (n) => (levels[n] && levels[n] !== 65535 ? levels[n] : 0);

  // Which map the coordinate belongs to: the starting NPC's own map when the Level table
  // knows them, otherwise the first map filed under the quest's area name.
  const mapId = mapByNpc.get(startNpc) || mapsByPlace.get(placeId)?.[0] || 0;

  quests.push({
    id: q.id,
    cn, en, ja,
    ex: exId,
    patch: patches[q.id] || '',
    lv: lvl(0),
    lv2: lvl(1),
    cjc: cjcId,
    jobUnlock: q['ClassJobUnlock@as(raw)'] || 0,
    js: sectionId,
    jcat: catId,
    jgen: genId,
    place: placeId,
    mp: mapId,
    start: startNpc,
    end: endNpc,
    prev,
    prevJoin: q.PreviousQuestJoin ?? 1,
    lock,
    lockJoin: q.QuestLockJoin ?? 0,
    next: [],
    rep: q.IsRepeatable ? 1 : 0,
    type: q.Type ?? 0,
    eit: q['EventIconType@as(raw)'] ?? -1,
    sortKey: q.SortKey || 0,
    rw: { exp: q.ExpFactor || 0, gil: q.GilReward || 0 },
    lode: lodeInfo,
  });
}

const byId = new Map(quests.map((q) => [q.id, q]));
for (const q of quests) {
  q.prev = q.prev.filter((p) => byId.has(p));
  q.lock = q.lock.filter((p) => byId.has(p));
}
for (const q of quests) for (const p of q.prev) byId.get(p).next.push(q.id);
for (const q of quests) q.next.sort((a, b) => a - b);

/* ---------------------------------------------------------------- dicts --- */
const sortedObj = (m) =>
  Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));

// Sentinel for quests the journal does not file anywhere (mostly ARR class/job
// quests, which carry JournalGenre 0). Keeping this out of "0" matters: section 0
// is the real "Main Scenario (ARR-EW)" section.
const UNCLASSIFIED = ['无分类', 'Unclassified', '分類なし'];
for (const dict of [sectionDict, categoryDict, genreDict]) if (!dict.has(-1)) dict.set(-1, UNCLASSIFIED);

const dicts = {
  npc: sortedObj(npcDict),
  place: sortedObj(placeDict),
  jgen: sortedObj(genreDict),
  jcat: sortedObj(categoryDict),
  js: sortedObj(sectionDict),
  cjc: sortedObj(cjcDict),
  ex: sortedObj(exDict),
};

/* --------------------------------------------------------------- report --- */
console.log('\n--- build report ---');
console.log('quests                    ', quests.length);
console.log('  with CN / EN / JA name  ', quests.filter((q) => q.cn).length, '/', quests.filter((q) => q.en).length, '/', quests.filter((q) => q.ja).length);
console.log('  missing CN              ', noCn, '| missing EN', noEn);
console.log('  with release patch      ', quests.filter((q) => q.patch).length);
console.log('  with lodestone match    ', lodeMatched);
console.log('  edges (prev links)      ', quests.reduce((a, q) => a + q.prev.length, 0));
console.log('  roots / leaves          ', quests.filter((q) => !q.prev.length).length, '/', quests.filter((q) => !q.next.length).length);

const joinCounts = {};
for (const q of quests) if (q.prev.length > 1) joinCounts[q.prevJoin] = (joinCounts[q.prevJoin] || 0) + 1;
console.log('  PreviousQuestJoin (>1 prereq):', joinCounts);
const lockCounts = {};
for (const q of quests) if (q.lock.length) lockCounts[q.lockJoin] = (lockCounts[q.lockJoin] || 0) + 1;
console.log('  QuestLockJoin (with locks):', lockCounts);

console.log('\n  section distribution:');
for (const [id, names] of Object.entries(dicts.js)) {
  console.log(`    ${id} ${names[0]} / ${names[1]}  -> ${quests.filter((q) => String(q.js) === id).length} quests`);
}
console.log('\n  top categories:');
for (const [id, names] of Object.entries(dicts.jcat)) {
  const n = quests.filter((q) => String(q.jcat) === id).length;
  if (n >= 25) console.log(`    ${n.toString().padStart(4)}  ${names[0]} | ${names[1]}`);
}

console.log('\n  spot checks:');
for (const id of [69477, 69372, 69380, 69218, 65537]) {
  const q = byId.get(id);
  if (!q) { console.log('    MISSING', id); continue; }
  console.log(`    ${id} ${q.cn} | ${q.en} | ${q.ja}`);
  console.log(`        lv=${q.lv} patch=${q.patch} js=${JSON.stringify(dicts.js[q.js])} jcat=${JSON.stringify(dicts.jcat[q.jcat])} jgen=${JSON.stringify(dicts.jgen[q.jgen])}`);
  console.log(`        place=${JSON.stringify(dicts.place[q.place])} start=${JSON.stringify(dicts.npc[q.start])} end=${JSON.stringify(dicts.npc[q.end])} lode=${JSON.stringify(q.lode)}`);
  console.log(`        prev=${JSON.stringify(q.prev.map((p) => byId.get(p)?.cn))} (join ${q.prevJoin}) next=${JSON.stringify(q.next.slice(0, 5).map((p) => byId.get(p)?.cn))}`);
}

// examples of "any of" prerequisites
console.log('\n  sample quests with >1 prerequisite and join=2 (any-of):');
for (const q of quests.filter((q) => q.prev.length > 1 && q.prevJoin === 2).slice(0, 5)) {
  console.log(`    ${q.cn} <= ${q.prev.map((p) => byId.get(p)?.cn).join(' | ')}`);
}
console.log('  sample quests with >1 prerequisite and join=1 (all-of):');
for (const q of quests.filter((q) => q.prev.length > 1 && q.prevJoin === 1).slice(0, 5)) {
  console.log(`    ${q.cn} <= ${q.prev.map((p) => byId.get(p)?.cn).join(' | ')}`);
}

/* ----------------------------------------------------------------- save --- */
const out = { generatedAt: new Date().toISOString(), counts: { quests: quests.length }, dicts, quests };
await mkdir(path.resolve('public/data'), { recursive: true });
await writeFile(path.resolve('public/data/quests.json'), JSON.stringify(out));
console.log('\nsaved public/data/quests.json', ((await stat('public/data/quests.json')).size / 1e6).toFixed(2), 'MB');
