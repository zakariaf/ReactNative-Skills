// src/features/daily-focus/daily-focus-generator.ts (example: the template after a version 2 cutover)
// The Tasks app's "daily focus": every user sees the same suggested tasks for a civil date. Version 1
// shipped first; version 2 (a larger catalog, four picks) serves keys from 2027-03-01 on. Version 1
// is untouched and stays callable, so an outcome stored with generatorVersion 1 still reproduces.
// The salt and the item-NN ids are the template's, kept only so that this example's version 1
// rows are the template's rows and the diff shows nothing but the cutover. A real app replaced
// both before its first release (Workflow step 6); the checker notes "template values still in
// use" until then.
import { dailySeed } from '@/core/dates/daily-seed';
import { versionFor } from '@/core/dates/generator-versions';
import { drawSample } from '@/core/rng/seeded-draws';
import { seedRng } from '@/core/rng/sfc32';

import type { DateKey } from '@/core/dates/date-key';
import type { GeneratorVersion } from '@/core/dates/generator-versions';

/**
 * Frozen on first ship (here still the template's value, see above). Both versions use it; a new
 * salt would itself be a cutover.
 */
export const DAILY_FOCUS_SALT = 0x2f6b4c1d;

/** Appended, never edited: version 2's cutover was chosen weeks in the future when it shipped. */
export const DAILY_FOCUS_VERSIONS: readonly GeneratorVersion[] = [
  { version: 1, from: null },
  { version: 2, from: '2027-03-01' },
];

const CATALOG_V1: readonly string[] = [
  'item-01',
  'item-02',
  'item-03',
  'item-04',
  'item-05',
  'item-06',
  'item-07',
  'item-08',
  'item-09',
  'item-10',
  'item-11',
  'item-12',
];
const PICKS_V1 = 3;

/** Version 2: the version 1 list plus four new ids at the end (a new list, not an edit of v1's). */
const CATALOG_V2: readonly string[] = [...CATALOG_V1, 'item-13', 'item-14', 'item-15', 'item-16'];
const PICKS_V2 = 4;

export type DailyFocus = {
  readonly key: DateKey;
  readonly version: number;
  readonly itemIds: readonly string[];
};

function generateV1(key: DateKey): DailyFocus {
  const state = seedRng(dailySeed(key, DAILY_FOCUS_SALT));
  return { key, version: 1, itemIds: drawSample(CATALOG_V1, PICKS_V1, state).value };
}

function generateV2(key: DateKey): DailyFocus {
  const state = seedRng(dailySeed(key, DAILY_FOCUS_SALT));
  return { key, version: 2, itemIds: drawSample(CATALOG_V2, PICKS_V2, state).value };
}

export function generateDailyFocus(
  key: DateKey,
  version: number = versionFor(DAILY_FOCUS_VERSIONS, key),
): DailyFocus {
  switch (version) {
    case 1:
      return generateV1(key);
    case 2:
      return generateV2(key);
    default:
      throw new RangeError(`no daily-focus generator version ${String(version)}`);
  }
}

export function summarizeDailyFocus(output: DailyFocus): string {
  return output.itemIds.join(' ');
}
