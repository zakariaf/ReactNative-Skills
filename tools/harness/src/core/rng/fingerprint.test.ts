// src/core/rng/fingerprint.test.ts
// Pinned fingerprints were computed by an independent oracle (Python: its own canonical JSON writer
// and FNV-1a over UTF-16 code units). A diff here invalidates every vectors file in the app.
import fc from 'fast-check';

import { FINGERPRINT_ALGORITHM, canonicalJson, fingerprint } from './fingerprint';

describe('canonicalJson', () => {
  it('sorts keys by code unit and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2, 3], Z: { y: false } })).toBe(
      '{"Z":{"y":false},"a":[2,3],"b":1}',
    );
    expect(canonicalJson([1, 'a', null])).toBe('[1,"a",null]');
  });

  it('escapes strings exactly as JSON.stringify does', () => {
    expect(canonicalJson('é ✓ "q" \\ \n')).toBe('"é ✓ \\"q\\" \\\\ \\n"');
  });

  it('rejects floats, -0, NaN, undefined and non-plain objects', () => {
    expect(() => canonicalJson(0.5)).toThrow('not a safe integer');
    expect(() => canonicalJson(-0)).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(2 ** 53)).toThrow(TypeError);
    expect(() => canonicalJson({ a: undefined })).toThrow('"a" is undefined');
    expect(() => canonicalJson(new Map())).toThrow('unsupported object');
    expect(() => canonicalJson(undefined)).toThrow('unsupported undefined');
  });

  it('ignores key insertion order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(record));
      }),
      { seed: 31, numRuns: 200 },
    );
  });
});

describe('fingerprint', () => {
  it('pins the oracle fingerprints', () => {
    expect(fingerprint(null)).toBe('77074ba4');
    expect(fingerprint(true)).toBe('4db211e5');
    expect(fingerprint(-12)).toBe('d7c6e55b');
    expect(fingerprint([])).toBe('741638a5');
    expect(fingerprint({ b: 1, a: [2, 3], Z: { y: false } })).toBe('d8d5639e');
    expect(fingerprint({ key: '2026-09-26', version: 1, itemIds: ['item-01', 'item-02'] })).toBe(
      'cfb59da0',
    );
    expect(fingerprint('é ✓ "q" \\ \n')).toBe('c4c853e2');
  });

  it('names its algorithm', () => {
    expect(FINGERPRINT_ALGORITHM).toBe('fnv1a32/canonical-json-v1');
  });
});
