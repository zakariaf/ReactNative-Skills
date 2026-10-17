// Small image helpers on plain { width, height, data } RGBA images (data: Uint8Array or Buffer).
// PNG decoding and encoding come from check-lib (zero dependencies); references and sheets are
// written by encodeCompactPng below, which is smaller for flat UI screens.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import { decodePng, fail } from '../check-lib.mjs';

/** Read a PNG as RGBA, or stop with exit 2 naming the file. */
export function readImage(path, what = 'PNG') {
  if (!existsSync(path)) fail(`${what} not found: ${path}`, 'Pass the right file, or create it first.');
  try {
    return decodePng(readFileSync(path));
  } catch (error) {
    return fail(`${what} ${path} is not a readable PNG: ${error.message}`, 'Recreate the file (lossless, non-interlaced PNG only).');
  }
}

/** Decode a PNG buffer, or null when it is not one (a screenshot written half-way). */
export function tryDecode(buffer) {
  try {
    return decodePng(buffer);
  } catch {
    return null;
  }
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Lossless PNG, as small as plain zlib makes it: opaque images as RGB, no row filter, deflate level 9.
 * Measured on browser-rendered UI frames: no filter beat adaptive filters by about 25 % (flat fills
 * repeat byte for byte), and a lossy or quantised reference would destroy the exact fill values the
 * fill gate reads.
 */
export function encodeCompactPng({ width, height, data }) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const out = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const o = out + x * channels;
      raw[o] = data[i];
      raw[o + 1] = data[i + 1];
      raw[o + 2] = data[i + 2];
      if (!opaque) raw[o + 3] = data[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function writeImage(path, img) {
  writeFileSync(path, encodeCompactPng(img));
}

/** JSON with one array item per line: small on disk, still readable in a diff. */
export function compactJson(value) {
  const lines = ['{'];
  const entries = Object.entries(value);
  entries.forEach(([key, v], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (Array.isArray(v) && v.length > 0) {
      lines.push(`${JSON.stringify(key)}:[`);
      v.forEach((item, j) => lines.push(`${JSON.stringify(item)}${j < v.length - 1 ? ',' : ''}`));
      lines.push(`]${comma}`);
    } else lines.push(`${JSON.stringify(key)}:${JSON.stringify(v)}${comma}`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function blank(width, height, rgba = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  if (rgba.some((v) => v !== 0)) for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

export function cloneImage(img) {
  return { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
}

/** Copy a rectangle (pixels); parts outside the source stay transparent black. */
export function crop(img, x, y, w, h) {
  const out = blank(Math.max(1, w), Math.max(1, h));
  for (let row = 0; row < h; row += 1) {
    const sy = y + row;
    if (sy < 0 || sy >= img.height) continue;
    const x0 = Math.max(0, x);
    const x1 = Math.min(img.width, x + w);
    if (x1 <= x0) continue;
    out.data.set(img.data.subarray((sy * img.width + x0) * 4, (sy * img.width + x1) * 4), (row * w + (x0 - x)) * 4);
  }
  return out;
}

/** Paste src into dst at (x, y), clipped. */
export function blit(src, dst, x, y) {
  for (let row = 0; row < src.height; row += 1) {
    const dy = y + row;
    if (dy < 0 || dy >= dst.height) continue;
    const sx0 = Math.max(0, -x);
    const sx1 = Math.min(src.width, dst.width - x);
    if (sx1 <= sx0) continue;
    dst.data.set(src.data.subarray((row * src.width + sx0) * 4, (row * src.width + sx1) * 4), (dy * dst.width + x + sx0) * 4);
  }
}

/** Box-filter downscale by an integer factor (the 1 px per pt overview sheet). */
export function downscale(img, factor) {
  if (factor === 1) return img;
  const w = Math.max(1, Math.floor(img.width / factor));
  const h = Math.max(1, Math.floor(img.height / factor));
  const out = blank(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * img.width + x * factor) * 4;
        for (let dx = 0; dx < factor; dx += 1, i += 4) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Nearest-neighbour resample to a target size (zoom bands at 2x of a 3x capture). */
export function resample(img, w, h) {
  const out = blank(Math.max(1, w), Math.max(1, h));
  for (let y = 0; y < out.height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / out.height));
    for (let x = 0; x < out.width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / out.width));
      out.data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Outline a rectangle (pixels) in a colour, t pixels thick, drawn outside the rectangle. */
export function outline(img, x, y, w, h, rgb, t = 4) {
  const put = (px, py) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
    const i = (py * img.width + px) * 4;
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
    img.data[i + 3] = 255;
  };
  for (let k = 1; k <= t; k += 1) {
    for (let px = x - k; px <= x + w - 1 + k; px += 1) {
      put(px, y - k);
      put(px, y + h - 1 + k);
    }
    for (let py = y - k; py <= y + h - 1 + k; py += 1) {
      put(x - k, py);
      put(x + w - 1 + k, py);
    }
  }
}

/** Fill a rectangle with a flat colour (clipped). */
export function fillRect(img, x, y, w, h, rgba) {
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px += 1) img.data.set(rgba, (py * img.width + px) * 4);
  }
}

/** Grey diagonal hatching over a rectangle (masked areas on the sheets). */
export function hatch(img, x, y, w, h) {
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px += 1) {
      if ((px + py) % 8 < 3) img.data.set([150, 150, 160, 255], (py * img.width + px) * 4);
    }
  }
}

export const hex = (rgb) => `#${rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Whether two screenshots show the same screen: equal within `tolerance` per channel outside the masks (pixel rects). */
export function sameScreen(a, b, masks = [], tolerance = 3) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) <= tolerance && Math.abs(a.data[i + 1] - b.data[i + 1]) <= tolerance && Math.abs(a.data[i + 2] - b.data[i + 2]) <= tolerance) continue;
      if (masks.some((m) => x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1)) continue;
      return false;
    }
  }
  return true;
}
