// src/features/__FEATURE__/__FEATURE__-generator.test.ts
import fc from 'fast-check';

import { addDays, fromDayNumber } from '@/core/dates/date-key';
import { assertVersionTable } from '@/core/dates/generator-versions';

import {
  __FEATURE_CONST___VERSIONS,
  generate__FEATURE_PASCAL__,
  summarize__FEATURE_PASCAL__,
} from './__FEATURE__-generator';

const dayArb = fc.integer({ min: 0, max: 60_000 }).map((days) => fromDayNumber(days));

describe('__FEATURE__ generator', () => {
  it('returns identical output for the same key, even after other keys ran', () => {
    const first = generate__FEATURE_PASCAL__('2026-09-26');
    generate__FEATURE_PASCAL__('2026-09-27');
    expect(generate__FEATURE_PASCAL__('2026-09-26')).toStrictEqual(first);
  });

  it('returns distinct catalog ids for any day, three of them at version 1', () => {
    fc.assert(
      fc.property(dayArb, (key) => {
        const { itemIds } = generate__FEATURE_PASCAL__(key);
        expect(new Set(itemIds).size).toBe(itemIds.length);
        // The template catalog's id rule: replace it with your catalog's.
        expect(itemIds.every((id) => /^item-\d{2}$/.test(id))).toBe(true);
        expect(generate__FEATURE_PASCAL__(key, 1).itemIds).toHaveLength(3);
      }),
      { seed: 41, numRuns: 300 },
    );
  });

  it('decorrelates consecutive days (the seed is mixed before drawing)', () => {
    const summaries = Array.from({ length: 60 }, (_, index) =>
      summarize__FEATURE_PASCAL__(generate__FEATURE_PASCAL__(addDays('2026-01-01', index))),
    );
    const repeatsNextDay = summaries.filter((summary, index) => summary === summaries[index + 1]);
    expect(new Set(summaries).size).toBeGreaterThan(50);
    expect(repeatsNextDay.length).toBeLessThanOrEqual(1);
  });

  it('keeps a valid cutover table and stamps the version it used', () => {
    expect(() => {
      assertVersionTable(__FEATURE_CONST___VERSIONS);
    }).not.toThrow();
    const routed = generate__FEATURE_PASCAL__('2026-09-26');
    expect(routed.version).toBe(1);
    expect(generate__FEATURE_PASCAL__('2026-09-26', 1)).toStrictEqual(routed);
  });

  it('throws for a version the app never shipped', () => {
    expect(() => generate__FEATURE_PASCAL__('2026-09-26', 99)).toThrow('version 99');
  });
});
