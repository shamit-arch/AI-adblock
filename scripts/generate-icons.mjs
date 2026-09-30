/**
 * Generates the extension icons (PNG) procedurally — no image dependencies.
 * Design: rounded square, white four-point "AI sparkle", crossed by a slash.
 * Writes icons/icon-{16,32,48,128}.png and grey "off" variants.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Colour + coverage of one sample point in unit coordinates [0,1]. */
function sample(x, y, palette) {
  // Rounded square background.
  const r = 0.22;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  if (dx * dx + dy * dy > r * r) return null;

  let color = mix(palette.bgA, palette.bgB, (x + y) / 2);

  // Four-point sparkle: |u|^p + |v|^p <= R^p with p < 1.
  const cx = 0.5;
  const cy = 0.5;
  const u = Math.abs(x - cx);
  const v = Math.abs(y - cy);
  const p = 0.55;
  const R = 0.33;
  const star = Math.pow(u, p) + Math.pow(v, p) <= Math.pow(R, p);
  if (star) color = palette.star;

  // Diagonal slash from top-left to bottom-right, with a gap outline.
  const dist = Math.abs(x - y) / Math.SQRT2;
  const within = x > 0.16 && x < 0.84 && y > 0.16 && y < 0.84;
  if (within && dist < 0.085) color = palette.bgEdge;
  if (within && dist < 0.052) color = palette.slash;
  return color;
}

function render(size, palette) {
  const ss = 4; // supersampling
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let cover = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, palette);
          if (!c) continue;
          rr += c[0];
          gg += c[1];
          bb += c[2];
          cover++;
        }
      }
      const i = (py * size + px) * 4;
      if (cover) {
        buf[i] = Math.round(rr / cover);
        buf[i + 1] = Math.round(gg / cover);
        buf[i + 2] = Math.round(bb / cover);
        buf[i + 3] = Math.round((cover / (ss * ss)) * 255);
      }
    }
  }
  return encodePNG(size, buf);
}

const ON = { bgA: hex('#6d5dfc'), bgB: hex('#4a36c9'), bgEdge: hex('#4a36c9'), star: hex('#ffffff'), slash: hex('#ff5a7a') };
const OFF = { bgA: hex('#a3a5b5'), bgB: hex('#7d8093'), bgEdge: hex('#7d8093'), star: hex('#f2f2f6'), slash: hex('#d9dae3') };

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size, ON));
  writeFileSync(join(outDir, `icon-off-${size}.png`), render(size, OFF));
}
console.log(`Icons written to ${outDir}`);
