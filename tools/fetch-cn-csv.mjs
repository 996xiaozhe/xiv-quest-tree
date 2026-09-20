/**
 * Downloads the Chinese game-data CSVs (ffxiv-datamining-cn) into data-src/cn/.
 * raw.githubusercontent.com is unreachable from some networks, so we use the
 * GitHub contents API with `Accept: application/vnd.github.raw`, which works.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const REPO = 'thewakingsands/ffxiv-datamining-cn';
const OUT = path.resolve('data-src/cn');
const UA = 'XIVQuestTree/1.0 (+data build script)';

const FILES = [
  'Quest.csv',
  'ENpcResident.csv',
  'PlaceName.csv',
  'JournalGenre.csv',
  'JournalCategory.csv',
  'JournalSection.csv',
  'ClassJobCategory.csv',
  'ClassJob.csv',
  'ExVersion.csv',
  'TerritoryType.csv',
];

await mkdir(OUT, { recursive: true });

for (const file of FILES) {
  const dest = path.join(OUT, file);
  const existing = await stat(dest).catch(() => null);
  if (existing && existing.size > 0) {
    console.log(`skip  ${file} (${(existing.size / 1e6).toFixed(2)} MB already present)`);
    continue;
  }
  const url = `https://api.github.com/repos/${REPO}/contents/${file}`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github.raw' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const s = await stat(dest);
      console.log(`ok    ${file} ${(s.size / 1e6).toFixed(2)} MB`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.log(`retry ${file} attempt ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) throw new Error(`failed to download ${file}: ${lastErr.message}`);
}
console.log('done');
