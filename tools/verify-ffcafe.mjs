/**
 * Independent verification of the trilingual quest names against 沙之家攻略站's
 * FFXIV full-text string database (https://strings.ffcafe.cn) — the service the
 * brief pointed at. It exposes GET /api/search?...&sheet=Quest and returns the
 * chs/en/ja strings for a Quest sheet row id, which we compare against our dataset.
 */
import { readFile } from 'node:fs/promises';

const API = 'https://strings.ffcafe.cn/api/search';
const UA = 'XIVQuestTree/1.0 (data verification)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const data = JSON.parse(await readFile('public/data/quests.json', 'utf8'));
const quests = data.quests;

// The upstream strings carry FFXIV's private-use icon glyphs and zero-width padding,
// which our build strips; normalise both sides before comparing.
const norm = (s) =>
  (s || '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// deterministic spread across the whole id range, plus the brief's example
const STEP = Math.max(1, Math.floor(quests.length / 70));
const sample = [];
for (let i = 0; i < quests.length; i += STEP) sample.push(quests[i]);
const eagle = quests.find((q) => q.id === 69477);
if (eagle && !sample.includes(eagle)) sample.push(eagle);

console.log(`cross-checking ${sample.length} quests against strings.ffcafe.cn …\n`);

let checked = 0;
let missing = 0;
const mismatches = [];

for (const q of sample) {
  const query = q.en || q.cn;
  const url = `${API}?q=${encodeURIComponent(query)}&lang=en&fields=chs,en,ja&limit=10`;
  let json = null;
  for (let attempt = 1; attempt <= 3 && !json; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      json = await r.json();
    } catch (e) {
      if (attempt === 3) console.log(`  ! ${q.id} request failed: ${e.message}`);
      else await sleep(500 * attempt);
    }
  }
  if (!json) continue;

  const rows = json.data || [];
  const hit = rows.find((row) => String(row.rowId) === String(q.id));
  if (!hit) {
    missing++;
    await sleep(60);
    continue;
  }
  checked++;
  const v = hit.values || {};
  // Some upstream rows are multi-line dumps (name + script actors); the quest name
  // is always the first line.
  const line = (s) => norm(String(s ?? '').split(/\r?\n/)[0]);
  const bad = [];
  if (line(v.chs) !== norm(q.cn)) bad.push(`cn "${q.cn}" != "${v.chs}"`);
  if (line(v.en) !== norm(q.en)) bad.push(`en "${q.en}" != "${v.en}"`);
  if (line(v.ja) !== norm(q.ja)) bad.push(`ja "${q.ja}" != "${v.ja}"`);
  if (bad.length) mismatches.push({ id: q.id, bad });
  await sleep(60);
}

console.log(`resolved by row id : ${checked} / ${sample.length}`);
console.log(`not found upstream : ${missing}`);
console.log(`name mismatches    : ${mismatches.length}`);
for (const m of mismatches.slice(0, 15)) console.log(`  ${m.id}: ${m.bad.join(' | ')}`);

const rate = checked ? (checked - mismatches.length) / checked : 0;
console.log(`\nagreement: ${(rate * 100).toFixed(1)}%`);
if (rate < 0.95 || checked < sample.length * 0.6) {
  console.log('VERIFICATION INCONCLUSIVE — investigate');
  process.exit(1);
}
console.log('VERIFIED against an independent trilingual source');
