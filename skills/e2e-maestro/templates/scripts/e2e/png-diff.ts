// scripts/e2e/png-diff.ts
// Compares a screenshot with its baseline without any package: a small PNG reader (8-bit grey, RGB,
// grey + alpha and RGBA, not interlaced: what simctl io screenshot and adb screencap write), the
// YIQ colour distance pixelmatch uses (per-pixel threshold 0.1), and a diff PNG with the changed
// pixels in red that a reviewer (or an agent's image reader) opens next to the two screenshots.
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

export type Image = { readonly width: number; readonly height: number; readonly data: Uint8Array };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** pixelmatch's largest YIQ distance (35215), so a threshold of 0.1 means 1 % of it squared. */
const MAX_YIQ_DELTA = 35_215;

type Header = { width: number; height: number; channels: number };

function readHeader(png: Buffer): Header {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  const bitDepth = png.readUInt8(24);
  const colorType = png.readUInt8(25);
  const channels = CHANNELS[colorType];
  if (bitDepth !== 8 || channels === undefined || png.readUInt8(28) !== 0) {
    throw new Error(
      `unsupported PNG (bit depth ${String(bitDepth)}, colour type ${String(colorType)}, or interlaced)`,
    );
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), channels };
}

function idatOf(png: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT')
      parts.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  return inflateSync(Buffer.concat(parts));
}

function paeth(left: number, up: number, upLeft: number): number {
  const base = left + up - upLeft;
  const [dLeft, dUp, dUpLeft] = [
    Math.abs(base - left),
    Math.abs(base - up),
    Math.abs(base - upLeft),
  ];
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

type Neighbours = { readonly left: number; readonly up: number; readonly upLeft: number };

/** The value a row filter predicts from the left, upper and upper-left neighbours. */
function predict(filter: number, { left, up, upLeft }: Neighbours): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paeth(left, up, upLeft);
    default:
      return 0;
  }
}

/** Undoes the per-row filters into raw pixel bytes. */
function unfilter(raw: Buffer, header: Header): Uint8Array {
  const stride = header.width * header.channels;
  const out = new Uint8Array(stride * header.height);
  const at = (row: number, x: number): number =>
    row >= 0 && x >= 0 ? (out[row * stride + x] ?? 0) : 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const back = x - header.channels;
      const guess = predict(filter, {
        left: at(y, back),
        up: at(y - 1, x),
        upLeft: at(y - 1, back),
      });
      out[y * stride + x] = ((raw[y * (stride + 1) + 1 + x] ?? 0) + guess) & 0xff;
    }
  }
  return out;
}

/** Decodes a PNG into RGBA bytes, rows top to bottom. */
export function decodePng(png: Buffer): Image {
  const header = readHeader(png);
  const pixels = unfilter(idatOf(png), header);
  const data = new Uint8Array(header.width * header.height * 4);
  for (let i = 0; i < header.width * header.height; i += 1) {
    const at = i * header.channels;
    const isGrey = header.channels < 3;
    data[i * 4] = pixels[at] ?? 0;
    data[i * 4 + 1] = pixels[isGrey ? at : at + 1] ?? 0;
    data[i * 4 + 2] = pixels[isGrey ? at : at + 2] ?? 0;
    data[i * 4 + 3] = header.channels % 2 === 0 ? (pixels[at + header.channels - 1] ?? 255) : 255;
  }
  return { width: header.width, height: header.height, data };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA bytes as an 8-bit RGBA PNG (filter 0 on every row). */
export function encodePng(image: Image): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    rows.set(
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      y * (image.width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One channel blended over white by its alpha (pixelmatch's rule for transparent pixels). */
const blend = (value: number, alpha: number): number => 255 + ((value - 255) * alpha) / 255;

/** pixelmatch's squared YIQ distance between the RGBA pixels at byte offset `at` of a and b. */
export function yiqDelta(a: Uint8Array, b: Uint8Array, at: number): number {
  const [r1, g1, b1] = [0, 1, 2].map((c) => blend(a[at + c] ?? 0, a[at + 3] ?? 255));
  const [r2, g2, b2] = [0, 1, 2].map((c) => blend(b[at + c] ?? 0, b[at + 3] ?? 255));
  const [dr, dg, db] = [(r1 ?? 0) - (r2 ?? 0), (g1 ?? 0) - (g2 ?? 0), (b1 ?? 0) - (b2 ?? 0)];
  const y = dr * 0.298_895_31 + dg * 0.586_622_47 + db * 0.114_482_23;
  const i = dr * 0.595_977_99 - dg * 0.274_176_47 - db * 0.321_801_52;
  const q = dr * 0.211_470_19 - dg * 0.522_617_24 + db * 0.311_147_05;
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

/** The share of pixels whose distance exceeds `threshold`, and a diff image (changed pixels red). */
export function diffImages(
  expected: Image,
  actual: Image,
  threshold: number,
): { ratio: number; diff: Image } {
  const limit = MAX_YIQ_DELTA * threshold * threshold;
  const diff = new Uint8Array(expected.data.length);
  let changed = 0;
  for (let at = 0; at < expected.data.length; at += 4) {
    const isChanged = yiqDelta(expected.data, actual.data, at) > limit;
    const grey = Math.round(255 - (255 - (expected.data[at + 1] ?? 0)) * 0.1);
    diff.set(isChanged ? [255, 0, 0, 255] : [grey, grey, grey, 255], at);
    if (isChanged) changed += 1;
  }
  return { ratio: changed / (expected.width * expected.height), diff: { ...expected, data: diff } };
}
