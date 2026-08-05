'use strict';
// Generates the app icon from code — no binary asset checked in, no image
// library, no design tool. Node's zlib is enough for PNG; the .ico is written
// with classic BMP entries so it works with NSIS and every Windows shell.
//
//   node scripts/make-icon.js
//     -> build/icon.ico    (installer + exe, sizes 16..256)
//     -> assets/icon.png   (window icon, 256)
//     -> assets/tray.png   (tray, 32)
//
// The artwork is the same gauge the overlay draws: a dark rounded tile with a
// red->amber->green arc and a needle sitting in the "runs fine" band.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// ---- geometry / palette --------------------------------------------------
const BG_TOP = [23, 28, 37];
const BG_BOTTOM = [13, 16, 21];
const BORDER = [255, 255, 255];
const BORDER_ALPHA = 0.16;
const TRACK = [42, 49, 60];
const NEEDLE = [230, 237, 243];
const RED = [242, 85, 90];
const AMBER = [242, 177, 60];
const GREEN = [53, 208, 127];

const SS = 4; // supersampling factor per axis

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rampColor(t) {
  return t < 0.5 ? mix(RED, AMBER, t / 0.5) : mix(AMBER, GREEN, (t - 0.5) / 0.5);
}

// Signed distance to a rounded rectangle centred in the unit square.
function roundedRectInside(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  const outside = Math.sqrt(ax * ax + ay * ay);
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius; // <0 == inside
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}

// Layer one source colour over the accumulating destination.
function over(dst, src, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[0] = dst[0] * (1 - a) + src[0] * a;
  dst[1] = dst[1] * (1 - a) + src[1] * a;
  dst[2] = dst[2] * (1 - a) + src[2] * a;
  dst[3] = dst[3] + (1 - dst[3]) * a;
}

// Sample the icon at one point in normalized [0,1] space.
const GAUGE_CX = 0.5;
const GAUGE_CY = 0.635;
const R_OUT = 0.335;
const R_IN = 0.235;
const NEEDLE_T = 0.78; // where the needle points on the 0..1 arc

function sample(u, v) {
  const px = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const dst = [0, 0, 0, 0];
  void px;

  // tile
  const d = roundedRectInside(u - 0.5, v - 0.5, 0.5, 0.235);
  if (d > 0.004) return dst; // outside the tile, fully transparent
  const tileAlpha = d < -0.002 ? 1 : 1 - (d + 0.002) / 0.006;
  over(dst, mix(BG_TOP, BG_BOTTOM, v), tileAlpha);

  // hairline border just inside the edge
  const borderBand = Math.abs(d + 0.012);
  if (borderBand < 0.008) {
    over(dst, BORDER, BORDER_ALPHA * (1 - borderBand / 0.008) * tileAlpha);
  }

  // gauge arc
  const dx = u - GAUGE_CX;
  const dy = v - GAUGE_CY;
  const r = Math.hypot(dx, dy);
  if (r <= R_OUT + 0.01 && r >= R_IN - 0.01 && dy <= 0.02) {
    const ang = Math.atan2(-dy, dx); // 0 at right, PI at left
    if (ang >= -0.05 && ang <= Math.PI + 0.05) {
      const t = 1 - Math.min(1, Math.max(0, ang / Math.PI));
      const edge = Math.min(R_OUT - r, r - R_IN) / 0.012;
      const aa = Math.min(1, Math.max(0, edge + 0.5));
      // the arc is "filled" up to the needle, dim track beyond it
      over(dst, t <= NEEDLE_T ? rampColor(t) : TRACK, aa);
    }
  }

  // needle + hub
  const ang = (1 - NEEDLE_T) * Math.PI;
  const nx = GAUGE_CX + Math.cos(ang) * (R_OUT - 0.02);
  const ny = GAUGE_CY - Math.sin(ang) * (R_OUT - 0.02);
  const dn = distToSegment(u, v, GAUGE_CX, GAUGE_CY, nx, ny);
  if (dn < 0.022) over(dst, NEEDLE, Math.min(1, (0.018 - dn) / 0.006 + 0.5));
  const dh = Math.hypot(dx, dy);
  if (dh < 0.055) over(dst, NEEDLE, Math.min(1, (0.048 - dh) / 0.008 + 0.5));

  return dst;
}

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  const inv = 1 / (size * SS);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x * SS + sx + 0.5) * inv;
          const v = (y * SS + sy + 0.5) * inv;
          const c = sample(u, v);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const alpha = a / n;
      out[o] = alpha > 0 ? Math.round(Math.min(255, r / a)) : 0;
      out[o + 1] = alpha > 0 ? Math.round(Math.min(255, g / a)) : 0;
      out[o + 2] = alpha > 0 ? Math.round(Math.min(255, b / a)) : 0;
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

// ---- PNG -----------------------------------------------------------------
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO (BMP entries) ---------------------------------------------------
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND masks stacked
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const maskRow = ((size + 31) >> 5) * 4;
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // BMP rows are bottom-up
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2]; // B
      pixels[d + 1] = rgba[s + 1]; // G
      pixels[d + 2] = rgba[s]; // R
      pixels[d + 3] = rgba[s + 3]; // A
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([dir, ...entries, ...blobs]);
}

// ---- main ----------------------------------------------------------------
function writeFile(rel, buf) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  process.stdout.write(`${rel}  ${(buf.length / 1024).toFixed(1)} KB\n`);
}

function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const rendered = new Map();
  for (const s of new Set([...icoSizes, 512])) rendered.set(s, render(s));

  writeFile(
    'build/icon.ico',
    encodeIco(icoSizes.map((size) => ({ size, data: bmpEntry(size, rendered.get(size)) })))
  );
  writeFile('assets/icon.png', encodePng(256, rendered.get(256)));
  writeFile('assets/tray.png', encodePng(32, rendered.get(32)));
}

main();
