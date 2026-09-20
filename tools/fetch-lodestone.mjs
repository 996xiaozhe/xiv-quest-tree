/**
 * Scrapes the official Lodestone Eorzea Database quest pages (English).
 *
 *  - list pages:  https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/?page=N
 *  - detail page: https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/<hash>/
 *
 * The Lodestone does NOT publish quest prerequisites (that data only exists in the
 * game sheets), but it does give the official English name, level, content type,
 * Quest Giver NPC + area + X/Y coordinates, requirements and rewards. We use it to
 * enrich & independently verify the game-data derived dataset.
 *
 * Resumable: every detail page is cached under data-src/lodestone/detail/<hash>.json
 */
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/';
const OUT = path.resolve('data-src/lodestone');
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

await mkdir(path.join(OUT, 'detail'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(600 * attempt * attempt);
    }
  }
  throw lastErr;
}

const decode = (s) =>
  s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, '\u2019');

const strip = (s) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ list --- */

async function scrapeList() {
  const cache = path.join(OUT, 'list.json');
  const existing = await readFile(cache, 'utf8').then(JSON.parse).catch(() => null);
  if (existing && existing.entries && existing.entries.length > 1000) {
    console.log(`[list] cached: ${existing.entries.length} entries / ${existing.total} total`);
    return existing;
  }

  const first = await fetchText(BASE);
  const total = Number((first.match(/of <span class="total">(\d+)<\/span>/) || [])[1] || 0);
  const pageSize = 50;
  const pages = Math.ceil(total / pageSize);
  console.log(`[list] ${total} quests over ${pages} pages`);

  const entries = [];
  const parsePage = (html) => {
    const rows = html.split('<tr>').slice(1);
    for (const row of rows) {
      const hash = (row.match(/db\/quest\/([a-z0-9]+)\/"/) || [])[1];
      if (!hash) continue;
      const name = strip((row.match(/class="db_popup db-table__txt--detail_link">([^<]*)</) || [])[1] || '');
      const cats = [...row.matchAll(/<a href="\/lodestone\/playguide\/db\/quest\/\?category2=\d+(?:&amp;category3=\d+)?">([^<]*)<\/a>/g)].map((m) => decode(m[1]));
      const area = strip((row.match(/db-table__quest__area">([^<]*)</) || [])[1] || '');
      const level = Number((row.match(/db-table__body--center">(\d+)</) || [])[1] || 0);
      entries.push({ hash, name, area, level, categories: cats });
    }
  };

  parsePage(first);
  for (let p = 2; p <= pages; p++) {
    const html = await fetchText(BASE + '?page=' + p);
    if (!html) {
      console.log(`[list] page ${p} unavailable`);
      continue;
    }
    parsePage(html);
    if (p % 10 === 0 || p === pages) console.log(`[list] page ${p}/${pages} (${entries.length} entries)`);
  }

  const unique = [...new Map(entries.map((e) => [e.hash, e])).values()];
  const out = { scrapedAt: new Date().toISOString(), total, entries: unique };
  await writeFile(cache, JSON.stringify(out));
  console.log(`[list] saved ${unique.length} unique entries`);
  return out;
}

/* ---------------------------------------------------------------- detail --- */

function parseDetail(html, hash) {
  const name = strip((html.match(/db-view__detail__lname_name[^>]*>\s*([\s\S]*?)<\/h2>/) || [])[1] || '');
  const level = Number(((html.match(/db-view__detail__level">Lv\.\s*(\d+)/) || [])[1]) || 0);
  const contentType = strip((html.match(/db-view__detail__content_type">([^<]*)</) || [])[1] || '');

  // Quest giver block
  let giver = null;
  const gi = html.indexOf('db-view__npc__header_text');
  if (gi >= 0) {
    const seg = html.slice(gi, html.indexOf('db-view__data', gi));
    const npc = strip((seg.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || '');
    const npcHash = (seg.match(/db\/npc\/npc\/([a-z0-9]+)\//) || [])[1] || null;
    const area = strip((seg.match(/<li>\s*([^<]+?)\s*<ul>/) || [])[1] || '');
    const xy = seg.match(/X:\s*([\d.]+)\s*Y:\s*([\d.]+)/);
    giver = { npc, npcHash, area, x: xy ? Number(xy[1]) : null, y: xy ? Number(xy[2]) : null };
  }

  // Requirements
  const requirements = {};
  for (const m of html.matchAll(/db-view__data__detail_list__header">([^<]*)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) {
    requirements[strip(m[1])] = strip(m[2]);
  }

  // Rewards
  const rewards = [];
  for (const m of html.matchAll(/db-view__quest__reward__name">([^<]*)<\/div>\s*<div class="db-view__quest__reward__value">([\s\S]*?)<\/div>/g)) {
    rewards.push({ name: strip(m[1]), value: strip(m[2]) });
  }

  return { hash, name, level, contentType, giver, requirements, rewards, url: BASE + hash + '/' };
}

async function scrapeDetails(entries) {
  const dir = path.join(OUT, 'detail');
  const done = new Set((await readdir(dir)).map((f) => f.replace(/\.json$/, '')));
  const todo = entries.filter((e) => !done.has(e.hash));
  console.log(`[detail] ${done.size} cached, ${todo.length} to fetch`);

  let i = 0;
  let ok = 0;
  let fail = 0;
  const started = Date.now();

  async function worker(id) {
    while (true) {
      const idx = i++;
      if (idx >= todo.length) return;
      const entry = todo[idx];
      try {
        const html = await fetchText(entry.url || BASE + entry.hash + '/');
        if (!html) {
          fail++;
          continue;
        }
        const rec = parseDetail(html, entry.hash);
        await writeFile(path.join(dir, entry.hash + '.json'), JSON.stringify(rec));
        ok++;
      } catch (e) {
        fail++;
        if (fail < 20) console.log(`[detail] ${entry.hash} failed: ${e.message}`);
      }
      const n = ok + fail;
      if (n % 250 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        console.log(`[detail] ${n}/${todo.length} ok=${ok} fail=${fail} (${rate.toFixed(1)}/s)`);
      }
      if (id === 0 && n % 97 === 0) await sleep(120);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)));
  console.log(`[detail] finished ok=${ok} fail=${fail}`);
}

/* ------------------------------------------------------------------ main --- */

const list = await scrapeList();
await scrapeDetails(list.entries);

// compact merged file for the next build step
const dir = path.join(OUT, 'detail');
const files = await readdir(dir);
const details = {};
for (const f of files) {
  try {
    const rec = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    details[rec.hash] = rec;
  } catch {}
}
await writeFile(path.join(OUT, 'details.json'), JSON.stringify(details));
console.log(`saved ${Object.keys(details).length} detail records -> data-src/lodestone/details.json`);
const sz = await stat(path.join(OUT, 'details.json'));
console.log('size', (sz.size / 1e6).toFixed(2), 'MB');
