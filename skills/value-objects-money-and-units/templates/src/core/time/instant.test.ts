// src/core/time/instant.test.ts
import fc from 'fast-check';

import { instantFromEpochSeconds, parseIsoInstant, toIsoInstant } from './instant';

const AT = 1_791_621_000_000; // 2026-10-10T08:30:00.000Z

describe('instants', () => {
  it.each([
    ['2026-10-10T08:30:00Z', AT],
    ['2026-10-10T08:30Z', AT],
    ['2026-10-10T10:30:00+02:00', AT],
    ['2026-10-10T03:00:00-0530', AT],
    ['2026-10-10T08:30:00.250Z', AT + 250],
    ['2026-10-10T08:30:00.5Z', AT + 500],
    ['2026-10-10T08:30:00.123456789Z', AT + 123],
    ['2024-02-29T00:00:00Z', 1_709_164_800_000],
    ['2026-10-10t08:30:00z', AT],
  ])('reads %s as %i', (text, atMs) => {
    expect(parseIsoInstant(text)).toStrictEqual({ ok: true, value: atMs });
  });

  it('refuses a date alone, a time without an offset and impossible fields', () => {
    expect(parseIsoInstant('2026-10-10')).toStrictEqual({
      ok: false,
      error: { kind: 'date-only', text: '2026-10-10' },
    });
    expect(parseIsoInstant('2026-10-10T08:30:00')).toStrictEqual({
      ok: false,
      error: { kind: 'missing-offset', text: '2026-10-10T08:30:00' },
    });
    for (const text of [
      '2026-02-29T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-10-10T24:00:00Z',
      '2026-10-10T08:60:00Z',
      '2026-10-10T08:30:60Z',
      '2026-10-10T08:30:00+24:00',
      '0000-01-01T00:00:00+01:00',
      '9999-12-31T23:59:59-01:00',
      'Sat Oct 10 2026',
      '1791621000000',
    ]) {
      expect(parseIsoInstant(text)).toStrictEqual({
        ok: false,
        error: { kind: 'not-an-instant', text },
      });
    }
  });

  it('writes UTC ISO text with milliseconds, and round-trips', () => {
    expect(toIsoInstant(AT)).toBe('2026-10-10T08:30:00.000Z');
    fc.assert(
      fc.property(fc.integer({ min: -62_167_219_200_000, max: 253_402_300_799_999 }), (atMs) => {
        expect(parseIsoInstant(toIsoInstant(atMs))).toStrictEqual({
          ok: true,
          value: atMs,
        });
      }),
    );
    expect(() => toIsoInstant(1.5)).toThrow(RangeError);
    expect(toIsoInstant(-1)).toBe('1969-12-31T23:59:59.999Z');
    expect(toIsoInstant(-62_167_219_200_000)).toBe('0000-01-01T00:00:00.000Z');
    expect(parseIsoInstant('0050-03-01T00:00:00Z')).toStrictEqual({
      ok: true,
      value: -60_584_198_400_000,
    });
    expect(() => toIsoInstant(253_402_300_800_000)).toThrow(RangeError);
  });

  it('converts epoch seconds once, at the boundary', () => {
    expect(instantFromEpochSeconds(1_791_621_000)).toBe(AT);
    expect(() => instantFromEpochSeconds(1.5)).toThrow(RangeError);
    expect(() => instantFromEpochSeconds(9e12)).toThrow(RangeError);
  });
});
