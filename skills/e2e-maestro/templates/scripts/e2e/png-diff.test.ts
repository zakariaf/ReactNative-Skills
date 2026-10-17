// scripts/e2e/png-diff.test.ts
import { crc32, deflateSync } from 'node:zlib';

import { decodePng, diffImages, encodePng, yiqDelta, type Image } from './png-diff.ts';

function solid(width: number, height: number, rgba: readonly number[]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(rgba, at);
  return { width, height, data };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A 2x2 RGB PNG whose rows use the Sub and the Paeth filter, as a screenshot tool may write it. */
function filteredRgbPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  // Pixels: row 0 = (10,20,30) (15,25,35); row 1 = (12,22,32) (20,30,40).
  const rows = Buffer.from([1, 10, 20, 30, 5, 5, 5, 4, 2, 2, 2, 5, 5, 5]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('encodePng and decodePng', () => {
  it('encodes and decodes RGBA pixels unchanged', () => {
    const image = solid(3, 2, [12, 34, 56, 255]);
    expect(decodePng(encodePng(image))).toStrictEqual(image);
  });

  it('undoes the Sub and Paeth row filters of an RGB file', () => {
    const { data } = decodePng(filteredRgbPng());
    expect([...data]).toStrictEqual([
      10, 20, 30, 255, 15, 25, 35, 255, 12, 22, 32, 255, 20, 30, 40, 255,
    ]);
  });

  it('refuses a file that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('GIF89a'.padEnd(40, ' ')))).toThrow('not a PNG file');
  });
});

describe('yiqDelta', () => {
  it('is zero for equal pixels and large for black against white', () => {
    const white = new Uint8Array([255, 255, 255, 255]);
    const black = new Uint8Array([0, 0, 0, 255]);
    expect(yiqDelta(white, white, 0)).toBe(0);
    expect(yiqDelta(white, black, 0)).toBeGreaterThan(30_000);
  });
});

describe('diffImages', () => {
  it('counts only pixels past the threshold and paints them red', () => {
    const expected = solid(10, 10, [200, 200, 200, 255]);
    const actual = solid(10, 10, [201, 200, 200, 255]);
    actual.data.set([0, 0, 0, 255], 0);
    const { ratio, diff } = diffImages(expected, actual, 0.1);
    expect(ratio).toBe(0.01);
    expect([...diff.data.subarray(0, 4)]).toStrictEqual([255, 0, 0, 255]);
  });
});
