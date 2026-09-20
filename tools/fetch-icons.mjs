/**
 * Downloads the official FFXIV quest-type marker icons and reports the alpha bounding
 * box of each, so the renderer can place them tightly inside a node without guessing.
 *
 * The marker for a quest type lives beside that type's text sprite in the game's icon
 * atlas: EventIconType.NpcIconAvailable gives 71200 / 71220 / 71340 (the "AVAILABLE
 * QUEST" lettering), and the matching pictorial marker is the next icon up.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';

const UA = 'XIVQuestTree/1.0 (icon fetch)';
const ICONS = [
  { id: 71201, note: 'main scenario (EventIconType 3)' },
  { id: 71221, note: 'sidequest (EventIconType 1)' },
  { id: 71341, note: 'class & job (EventIconType 8 / 10)' },
];

function decodePng(buf) {
  let p = 8, width = 0, height = 0, colorType = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) cur[i] = (cur[i] + a) & 0xff;
      else if (f === 2) cur[i] = (cur[i] + b) & 0xff;
      else if (f === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, ch, data: out };
}

await mkdir(path.resolve('public/icons'), { recursive: true });
const report = [];
for (const { id, note } of ICONS) {
  const folder = String(Math.floor(id / 1000) * 1000).padStart(6, '0');
  const res = await fetch(`https://xivapi.com/i/${folder}/${String(id).padStart(6, '0')}.png`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`icon ${id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path.resolve('public/icons', `${id}.png`), buf);

  const img = decodePng(buf);
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const A = img.ch === 4 ? img.data[(y * img.width + x) * img.ch + 3] : 255;
      if (A < 32) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const box = { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  report.push({ id, note, size: `${img.width}x${img.height}`, ...box, bytes: buf.length });
  console.log(`${id}  ${note}\n    ${img.width}x${img.height}  content ${box.w}x${box.h} at (${minX},${minY})  ${(buf.length / 1024).toFixed(1)} kB`);
}
await writeFile(path.resolve('public/icons/manifest.json'), JSON.stringify(report, null, 2));
console.log('\nwrote public/icons/manifest.json');
