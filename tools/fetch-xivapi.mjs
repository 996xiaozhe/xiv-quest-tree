/**
 * Downloads game-sheet data from XIVAPI.
 *
 * IMPORTANT: xivapi.com v1 is running an OLD game version (its Quest/JournalGenre rows
 * are shifted relative to the live sheets and it stops at quest id 70723). v2
 * (v2.xivapi.com) tracks the current game build and matches the Chinese datamining dump,
 * so v2 is the source of truth here for everything except the "game patch" column, which
 * the v2 schema no longer exposes — those numbers are salvaged from v1 (a quest's release
 * patch never changes, so the stale snapshot is still correct for the rows it has).
 *
 * Chinese names always come from ffxiv-datamining-cn (XIVAPI has no CN data at all).
 *
 * Everything is cached under data-src/ so the build is re-runnable offline. FORCE=1 refetches.
 */
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fetchWithRetry, sleep, pool } from './lib/http.mjs';

const V2 = 'https://v2.xivapi.com/api/sheet';
const V1 = 'https://xivapi.com';
const D2 = path.resolve('data-src/xivapi-v2');
const D1 = path.resolve('data-src/xivapi-v1');
const FORCE = process.env.FORCE === '1';

await mkdir(D2, { recursive: true });
await mkdir(D1, { recursive: true });

async function cached(dir, name, producer) {
  const file = path.join(dir, name + '.json');
  if (!FORCE) {
    const s = await stat(file).catch(() => null);
    if (s && s.size > 2) {
      console.log(`  cached ${name}.json (${(s.size / 1e3).toFixed(0)} kB)`);
      return JSON.parse(await readFile(file, 'utf8'));
    }
  }
  const data = await producer();
  await writeFile(file, JSON.stringify(data));
  console.log(`  saved  ${name}.json (${(await stat(file)).size / 1e3 | 0} kB, ${Array.isArray(data) ? data.length : Object.keys(data).length} records)`);
  return data;
}

const enc = encodeURIComponent;

/** Reads every row of a v2 sheet (paginated with `after`). */
async function readSheet(sheet, fields) {
  const out = [];
  let after = null;
  for (let page = 0; page < 400; page++) {
    const url = `${V2}/${sheet}?limit=500&fields=${enc(fields)}${after != null ? '&after=' + after : ''}`;
    const json = await fetchWithRetry(url, { json: true, label: `${sheet} after=${after}` });
    const rows = json.rows || [];
    for (const r of rows) out.push({ id: r.row_id, ...r.fields });
    process.stdout.write(`  ${sheet}: ${out.length} rows (page ${page + 1})\r`);
    if (rows.length < 500) break;
    after = rows[rows.length - 1].row_id;
    await sleep(40);
  }
  process.stdout.write('\n');
  return out;
}

const L = (f) => `${f}@lang(en),${f}@lang(ja),${f}@lang(de),${f}@lang(fr)`;
const L2 = (f) => `${f}@lang(en),${f}@lang(ja)`;

console.log('== XIVAPI v2 ==');

// ---------------------------------------------------------------- quests ----
const questFields = [
  L('Name'),
  'PreviousQuest@as(raw)', 'PreviousQuestJoin',
  'QuestLock[].value', 'QuestLockJoin',
  'JournalGenre@as(raw)', 'PlaceName@as(raw)', 'Expansion@as(raw)',
  'ClassJobCategory0@as(raw)', 'ClassJobCategory1@as(raw)',
  'ClassJobLevel[]', 'ClassJobRequired@as(raw)', 'ClassJobUnlock@as(raw)',
  'IssuerStart@as(raw)', 'IssuerLocation@as(raw)', 'TargetEnd@as(raw)',
  'Icon', 'EventIconType@as(raw)', 'Type', 'IsRepeatable', 'SortKey', 'LevelMax',
  'ExpFactor', 'GilReward', 'CurrencyReward@as(raw)', 'CurrencyRewardCount',
].join(',');
const quests = await cached(D2, 'quests', () => readSheet('Quest', questFields));
console.log('  quest rows:', quests.length);

// ---------------------------------------------------------------- lookups ---
const genre = await cached(D2, 'journalgenre', () => readSheet('JournalGenre', [L2('Name'), 'JournalCategory@as(raw)'].join(',')));
const category = await cached(D2, 'journalcategory', () => readSheet('JournalCategory', [L2('Name'), 'JournalSection@as(raw)', 'DataType', 'SeparateType'].join(',')));
const section = await cached(D2, 'journalsection', () => readSheet('JournalSection', L2('Name')));
const cjc = await cached(D2, 'classjobcategory', () => readSheet('ClassJobCategory', L2('Name')));
const classJob = await cached(D2, 'classjob', () => readSheet('ClassJob', [L2('Name'), L2('Abbreviation'), 'ClassJobCategory@as(raw)'].join(',')));
const exVersion = await cached(D2, 'exversion', () => readSheet('ExVersion', L2('Name')));
const place = await cached(D2, 'placename', () => readSheet('PlaceName', L2('Name')));
const npc = await cached(D2, 'enpcresident', () => readSheet('ENpcResident', L2('Singular')));

// ------------------------------------------------------- game patch (v1) ----
console.log('\n== XIVAPI v1 (game patch numbers only) ==');
const patches = await cached(D1, 'patches', async () => {
  const map = {};
  for (let page = 1; page <= 60; page++) {
    const json = await fetchWithRetry(
      `${V1}/Quest?limit=500&page=${page}&columns=ID,GamePatch.Name`,
      { json: true, label: 'v1 patches p' + page },
    );
    const rows = json.Results || [];
    if (!rows.length) break;
    for (const r of rows) {
      const name = r.GamePatch && r.GamePatch.Name;
      if (name) map[r.ID] = name.replace(/^Patch\s*/, '');
    }
    process.stdout.write(`  v1 patches: page ${page} (${Object.keys(map).length} entries)\r`);
    if (!json.Pagination || page >= json.Pagination.PageTotal) break;
    await sleep(50);
  }
  process.stdout.write('\n');
  return map;
});

console.log('\nsummary');
console.log('  quests', quests.length, '| genre', genre.length, '| category', category.length, '| section', section.length);
console.log('  classJobCategory', cjc.length, '| classJob', classJob.length, '| exVersion', exVersion.length);
console.log('  placeName', place.length, '| enpcResident', npc.length, '| patches', Object.keys(patches).length);
