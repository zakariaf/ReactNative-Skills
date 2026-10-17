// src/features/starter-pack/starter-pack-generator.ts (example: a text-keyed generator with two versions)
// The Tasks app's "starter pack": a user shares a short code and the receiver's app suggests the same
// starter tasks. The key is text, so there is no cutover date to route on: the share code carries the
// version ('v2:7KQ2'), every entry of the versions table has from: null, and every caller passes the
// version. The contract registers it with "keyKind": "text".
import { latestVersion } from '@/core/dates/generator-versions';
import { drawSample } from '@/core/rng/seeded-draws';
import { hashSeed, seedRng } from '@/core/rng/sfc32';

import type { GeneratorVersion } from '@/core/dates/generator-versions';

/** Frozen on first ship, unique in the app (the contract records 1814008741). */
export const STARTER_PACK_SALT = 0x6c1f93a5;

/** No cutover dates: the version travels with the code. Append only. */
export const STARTER_PACK_VERSIONS: readonly GeneratorVersion[] = [
  { version: 1, from: null },
  { version: 2, from: null },
];

/** What one version draws: its catalog (the list and its order) and how many picks. */
type VersionSpec = { readonly catalog: readonly string[]; readonly picks: number };

const CATALOG_V1: readonly string[] = [
  'task-01',
  'task-02',
  'task-03',
  'task-04',
  'task-05',
  'task-06',
  'task-07',
  'task-08',
  'task-09',
  'task-10',
];
const SPEC_V1: VersionSpec = { catalog: CATALOG_V1, picks: 3 };

/** Version 2: two more starter tasks and five picks (a new list, not an edit of version 1's). */
const SPEC_V2: VersionSpec = { catalog: [...CATALOG_V1, 'task-11', 'task-12'], picks: 5 };

export type StarterPack = {
  readonly code: string;
  readonly version: number;
  readonly taskIds: readonly string[];
};

function draw(code: string, version: number, spec: VersionSpec): StarterPack {
  // Draw order (a contract): one drawSample of spec.picks from spec.catalog, nothing else.
  const state = seedRng(hashSeed(code) ^ STARTER_PACK_SALT);
  return { code, version, taskIds: drawSample(spec.catalog, spec.picks, state).value };
}

/**
 * The pack for a share code's body, made with the version the code carries. There is no default
 * version: a text key has no cutover, and "the newest" would show the receiver a different pack.
 */
export function generateStarterPack(code: string, version: number): StarterPack {
  switch (version) {
    case 1:
      return draw(code, 1, SPEC_V1);
    case 2:
      return draw(code, 2, SPEC_V2);
    default:
      throw new RangeError(`no starter-pack generator version ${String(version)}`);
  }
}

export function summarizeStarterPack(pack: StarterPack): string {
  return pack.taskIds.join(' ');
}

/** A new share code carries the newest version this build knows: 'v2:7KQ2'. */
export function formatShareCode(body: string): string {
  return `v${String(latestVersion(STARTER_PACK_VERSIONS))}:${body}`;
}

/**
 * 'v2:7KQ2' -> { version: 2, body: '7KQ2' }. Null for a malformed code or a version this build does
 * not know (a newer app made it): the screen says "update the app to open this pack" instead of
 * generating something else.
 */
export function parseShareCode(
  code: string,
): { readonly version: number; readonly body: string } | null {
  const match = /^v(\d{1,3}):([0-9A-Z]{4,12})$/.exec(code);
  if (match === null) return null;
  const version = Number(match[1]);
  const body = match[2] ?? '';
  return STARTER_PACK_VERSIONS.some((entry) => entry.version === version)
    ? { version, body }
    : null;
}

// The receiving screen's model, in two lines:
//   const parsed = parseShareCode(code);
//   const pack = parsed === null ? null : generateStarterPack(parsed.body, parsed.version);
