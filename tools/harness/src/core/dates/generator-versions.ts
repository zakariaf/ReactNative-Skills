// src/core/dates/generator-versions.ts
// The cutover table of a seeded generator. A shipped version is frozen; an improvement is a new
// version, and every older version stays callable so stored outcomes can be replayed with the
// version they were made with. A date-keyed generator serves each later version from a future
// cutover key on. A text-keyed generator (a share code, a typed seed) has no date to route on: the
// version travels with the key, every entry has `from: null`, and callers always pass the version.
import { isDateKey } from './date-key';

import type { DateKey } from './date-key';

/** One shipped version: it serves every key from `from` (inclusive) until the next entry's `from`. */
export type GeneratorVersion = { readonly version: number; readonly from: DateKey | null };

/** How a generator's keys pick a version: by cutover date, or carried by the key itself. */
export type KeyKind = 'date' | 'text';

export type VersionTableOptions = { readonly keyKind?: KeyKind };

type EntryContext = {
  readonly entry: GeneratorVersion;
  readonly index: number;
  readonly previous: DateKey | null;
  readonly keyKind: KeyKind;
};

/** What is wrong with one entry of the table, or '' when nothing is. */
function entryProblem({ entry, index, previous, keyKind }: EntryContext): string {
  if (entry.version !== index + 1)
    return `entry ${String(index)} is version ${String(entry.version)}`;
  if (index === 0) return entry.from === null ? '' : 'version 1 must have from: null';
  if (keyKind === 'text') {
    return entry.from === null
      ? ''
      : `version ${String(entry.version)} of a text-keyed table must have from: null`;
  }
  if (entry.from === null || !isDateKey(entry.from))
    return `version ${String(entry.version)} needs a date key`;
  if (previous !== null && entry.from <= previous) {
    return `version ${String(entry.version)} starts ${entry.from}, not after ${previous}`;
  }
  return '';
}

/**
 * Throws unless versions are 1..n in order and version 1 has from: null. A date table (the default)
 * needs strictly increasing civil-date cutovers; a text table (`{ keyKind: 'text' }`) needs
 * from: null on every entry.
 */
export function assertVersionTable(
  versions: readonly GeneratorVersion[],
  options: VersionTableOptions = {},
): void {
  const keyKind = options.keyKind ?? 'date';
  if (versions.length === 0) throw new RangeError('a generator needs at least version 1');
  versions.forEach((entry, index) => {
    const previous = versions[index - 1]?.from ?? null;
    const problem = entryProblem({ entry, index, previous, keyKind });
    if (problem !== '') throw new RangeError(`generator versions: ${problem}`);
  });
}

/**
 * The version that serves a date `key`: the last entry whose cutover is on or before it. Throws for
 * a text-keyed table (a later version with from: null): callers pass the version the key carries.
 */
export function versionFor(versions: readonly GeneratorVersion[], key: DateKey): number {
  if (versions.slice(1).some((entry) => entry.from === null)) {
    throw new RangeError(`a text-keyed table has no cutover for ${key}: pass the version`);
  }
  let served = 0;
  for (const entry of versions) {
    if (entry.from === null || entry.from <= key) served = entry.version;
  }
  if (served === 0) throw new RangeError(`no generator version serves ${key}`);
  return served;
}

/** The newest version: what keys after the last cutover get, and what a new share code carries. */
export function latestVersion(versions: readonly GeneratorVersion[]): number {
  const last = versions.at(-1);
  if (last === undefined) throw new RangeError('a generator needs at least version 1');
  return last.version;
}
