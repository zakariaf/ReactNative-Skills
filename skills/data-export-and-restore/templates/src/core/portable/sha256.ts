// src/core/portable/sha256.ts: SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex characters (FIPS 180-4).
import { utf8Bytes } from './utf8';

/**
 * The backup envelope's payload checksum. Pure TypeScript on purpose: it runs the same in Hermes,
 * Jest and Node, synchronously, and Node's `createHash('sha256').update(text, 'utf8')` gives the
 * same value, so a support script can verify a user's file without the app. It detects a damaged,
 * truncated or hand-edited file; it is not a signature (anyone can recompute it).
 */
const K_WORDS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const K = Uint32Array.from(K_WORDS);

/** The message padded to a multiple of 64 bytes: 0x80, zeros, then the bit length (big-endian). */
function padded(message: Uint8Array): DataView {
  const total = Math.ceil((message.length + 9) / 64) * 64;
  const buffer = new Uint8Array(total);
  buffer.set(message);
  buffer[message.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bits = message.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  return view;
}

const rotr = (value: number, by: number): number => (value >>> by) | (value << (32 - by));

/** Fills `w` (64 words) with the message schedule of the block at `offset`. */
function schedule(view: DataView, offset: number, w: Uint32Array): void {
  for (let t = 0; t < 16; t += 1) w.set([view.getUint32(offset + t * 4)], t);
  for (let t = 16; t < 64; t += 1) {
    const a = w[t - 15] ?? 0;
    const b = w[t - 2] ?? 0;
    const sigma0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
    const sigma1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
    w.set([(w[t - 16] ?? 0) + sigma0 + (w[t - 7] ?? 0) + sigma1], t);
  }
}

type Words8 = [number, number, number, number, number, number, number, number];

/** The eight state words (DataView reads are plain numbers, no undefined to check). */
function read8(view: DataView): Words8 {
  return [
    view.getUint32(0),
    view.getUint32(4),
    view.getUint32(8),
    view.getUint32(12),
    view.getUint32(16),
    view.getUint32(20),
    view.getUint32(24),
    view.getUint32(28),
  ];
}

/** The 64 rounds of one block over `state` (eight words, added to in place). */
function compress(state: DataView, w: Uint32Array): void {
  let [a, b, c, d, e, f, g, h] = read8(state);
  for (let t = 0; t < 64; t += 1) {
    const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + sigma1 + choice + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
    const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + sigma0 + majority) >>> 0;
  }
  [a, b, c, d, e, f, g, h].forEach((value, index) => {
    state.setUint32(index * 4, (state.getUint32(index * 4) + value) >>> 0);
  });
}

/** SHA-256 of `text` encoded as UTF-8, as lowercase hex. */
export function sha256Hex(text: string): string {
  const view = padded(utf8Bytes(text));
  const state = new DataView(new ArrayBuffer(32));
  INITIAL.forEach((word, index) => {
    state.setUint32(index * 4, word);
  });
  const w = new Uint32Array(64);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    schedule(view, offset, w);
    compress(state, w);
  }
  return read8(state)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}
