import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';

const UA = 'XIVQuestTree/1.0';
function decodePng(buf) {
  let p = 8;
  let width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 0xff;
      else if (filter === 2) cur[i] = (cur[i] + b) & 0xff;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

function stats(png) {
  const { width, height, channels, data } = png;
  let R = 0, G = 0, B = 0, n = 0, opaque = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const A = channels === 4 ? data[o + 3] : 255;
    if (A < 32) continue;
    opaque++;
    if (A > 160) { R += data[o]; G += data[o + 1]; B += data[o + 2]; n++; }
  }
  const avg = n ? `rgb(${Math.round(R / n)},${Math.round(G / n)},${Math.round(B / n)})` : 'n/a';
  const sat = n ? Math.round((Math.max(R / n, G / n, B / n) - Math.min(R / n, G / n, B / n))) : 0;
  return `${width}x${height} opaque=${((opaque / (width * height)) * 100).toFixed(0)}% lightAvg=${avg} chroma=${sat}`;
}

function ascii(png, cols = 64) {
  const { width, height, channels, data } = png;
  const rows = Math.max(1, Math.round(((cols * height) / width) / 2.1));
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = Math.min(width - 1, Math.floor((c * width) / cols));
      const y = Math.min(height - 1, Math.floor((r * height) / rows));
      const i = (y * width + x) * channels;
      const A = channels === 4 ? data[i + 3] : 255;
      if (A < 40) { line += ' '; continue; }
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * (A / 255);
      line += lum > 190 ? '@' : lum > 140 ? '#' : lum > 90 ? '*' : lum > 45 ? '+' : lum > 18 ? '.' : ' ';
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

const ids = process.argv.slice(2).map(Number);
for (const id of ids) {
  const folder = String(Math.floor(id / 1000) * 1000).padStart(6, '0');
  const url = `https://xivapi.com/i/${folder}/${String(id).padStart(6, '0')}.png`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.log(`\n### ${id}: HTTP ${res.status}`); continue; }
    const png = decodePng(Buffer.from(await res.arrayBuffer()));
    console.log(`\n### ${id}  ${stats(png)}`);
    console.log(ascii(png, Number(process.env.COLS || 64)));
  } catch (e) { console.log(`\n### ${id}: ERROR ${e.message}`); }
}
