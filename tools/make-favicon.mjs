/**
 * Renders the site mark (public/favicon.svg) to the PNG sizes browsers ask for.
 *
 *   node tools/make-favicon.mjs
 *
 * No dependencies on purpose: a PNG is just a container around a zlib stream (which Node
 * has built in), and the mark is three flat diamonds, so it can be rasterised directly
 * with a point-in-shape test. Everything is drawn at 4x and box-filtered down, which is
 * where the anti-aliased edges come from.
 *
 *   public/favicon-32.png         rounded tile — the browser tab
 *   public/apple-touch-icon.png   full-bleed square — iOS masks it with its own squircle,
 *                                 so pre-rounding it would leave dark corners
 */
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

/* ------------------------------------------------------------------- geometry -- */
// Same three shapes as the SVG, in a 64-unit square.
const TILE = '#070a0f';
const RING = '#d9b877';
const CORE = '#f4e0ac';
const CORNER_RADIUS = 15;
const DIAMONDS = [
  { half: 24, color: RING }, // 32,8 → 56,32 → 32,56 → 8,32
  { half: 12, color: TILE }, // punches the ring out of the middle
  { half: 6, color: CORE }, //  the bright core
];

const hex = (h) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

/** |dx| + |dy| <= r is exactly a diamond centred on (32, 32). */
const inDiamond = (x, y, half) => Math.abs(x - 32) + Math.abs(y - 32) <= half;

function inRoundedTile(x, y, radius) {
  if (x < 0 || y < 0 || x > 64 || y > 64) return false;
  if (!radius) return true;
  // only the four corner quadrants need the circle test
  const cx = x < radius ? radius : x > 64 - radius ? 64 - radius : x;
  const cy = y < radius ? radius : y > 64 - radius ? 64 - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** Colour of the mark at a point, or null outside the tile. */
function sample(x, y, rounded) {
  if (!inRoundedTile(x, y, rounded ? CORNER_RADIUS : 0)) return null;
  let color = TILE;
  for (const d of DIAMONDS) if (inDiamond(x, y, d.half)) color = d.color;
  return hex(color);
}

/* --------------------------------------------------------------- rasterising -- */
const SS = 4; // supersampling factor per axis

function render(size, rounded) {
  const px = Buffer.alloc(size * size * 4);
  const unit = 64 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) * unit, (y + (sy + 0.5) / SS) * unit, rounded);
          if (c) {
            r += c.r;
            g += c.g;
            b += c.b;
            n++;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (!n) continue; // fully outside the tile: stays transparent
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round((n / (SS * SS)) * 255);
    }
  }
  return px;
}

/* ------------------------------------------------------------------- encoding -- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression, filter, interlace: all zero

  // one filter byte (0 = none) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------------- main -- */
const targets = [
  { file: 'public/favicon-32.png', size: 32, rounded: true },
  { file: 'public/apple-touch-icon.png', size: 180, rounded: false },
];

for (const t of targets) {
  const png = encodePng(t.size, render(t.size, t.rounded));
  await writeFile(t.file, png);
  console.log(`${t.file.padEnd(32)} ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} kB`);
}
console.log('\nwrote both PNGs from the geometry in public/favicon.svg');
