// src/features/__FEATURE__/__FEATURE__-generator.ts
// A seeded generator: a pure function of (key, version). Every device computes the same output for
// the same key. Frozen once shipped: change it only by adding a version with a future cutover key
// (and a row in contracts/seeded-generators.json), never by editing a shipped version.
import { dailySeed } from '@/core/dates/daily-seed';
import { versionFor } from '@/core/dates/generator-versions';
import { drawSample } from '@/core/rng/seeded-draws';
import { seedRng } from '@/core/rng/sfc32';

import type { DateKey } from '@/core/dates/date-key';
import type { GeneratorVersion } from '@/core/dates/generator-versions';

/**
 * This feature's salt: frozen on first ship, unique in the app (the contract records it in decimal).
 * The template value: replace it with a new random salt before the first release, together with the
 * oracle's copy and the contract, then refill the vectors rows (Workflow step 6).
 */
export const __FEATURE_CONST___SALT = 0x2f6b4c1d;

/** The shipped versions and their cutover keys. Append only. */
export const __FEATURE_CONST___VERSIONS: readonly GeneratorVersion[] = [{ version: 1, from: null }];

/**
 * Version 1 draws 3 of these ids. The list, its order and the count are part of version 1. The
 * template catalog: replace it with the feature's own ids before the first release (and the oracle's
 * copy).
 */
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

/** What one key produces. Only plain data, integers and strings, so it fingerprints canonically. */
export type __FEATURE_PASCAL__ = {
  readonly key: DateKey;
  readonly version: number;
  readonly itemIds: readonly string[];
};

function generateV1(key: DateKey): __FEATURE_PASCAL__ {
  // Draw order (a contract): one drawSample of PICKS_V1 from CATALOG_V1, nothing else.
  const state = seedRng(dailySeed(key, __FEATURE_CONST___SALT));
  const { value } = drawSample(CATALOG_V1, PICKS_V1, state);
  return { key, version: 1, itemIds: value };
}

/**
 * The content for `key`. Pass the stored version to reproduce exactly what a user saw; leave it out
 * for the version the cutover table assigns to the key.
 */
export function generate__FEATURE_PASCAL__(
  key: DateKey,
  version: number = versionFor(__FEATURE_CONST___VERSIONS, key),
): __FEATURE_PASCAL__ {
  switch (version) {
    case 1:
      return generateV1(key);
    default:
      throw new RangeError(`no __FEATURE__ generator version ${String(version)}`);
  }
}

/** The line a reviewer reads in the vectors file: what the user sees, in order. */
export function summarize__FEATURE_PASCAL__(output: __FEATURE_PASCAL__): string {
  return output.itemIds.join(' ');
}
