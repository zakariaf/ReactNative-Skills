// src/data/checksum.test.ts: the pinned FNV-1a vectors the app, check-persistence and inspect-database must all give.
import fc from 'fast-check';

import { fnv1a32 } from './checksum';

describe('fnv1a32', () => {
  // The same vectors pin the checker's textChecksum (the skill's self-test asserts them too), so a
  // frozen fixture's recorded checksum means the same thing in Jest and in check-persistence.
  it('gives the published FNV-1a 32 test vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
  });

  it('hashes UTF-16 code units, so Arabic text and an emoji give a pinned value', () => {
    // Recomputed by an independent implementation (Python, UTF-16 LE code units).
    expect(fnv1a32('شراء الحليب 📊')).toBe('7db38061');
  });

  it('changes when one character of a stored row changes', () => {
    expect(fnv1a32('{"schemaVersion":1}')).not.toBe(fnv1a32('{"schemaVersion":2}'));
  });

  it('gives 8 lowercase hex characters for any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(fnv1a32(text)).toMatch(/^[0-9a-f]{8}$/);
      }),
    );
  });
});
