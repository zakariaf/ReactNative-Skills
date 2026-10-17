// src/core/game/level-kit/level-table.ts
import type { LevelEntry, StarRule } from '@/core/game/levels';

const UINT32_MAX = 4_294_967_295;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function toStarRule(json: unknown): StarRule | null {
  if (!isRecord(json)) return null;
  if (json['kind'] === 'par') {
    return isIntegerIn(json['par'], 1, 9999) ? { kind: 'par', par: json['par'] } : null;
  }
  const t = json['thresholds'];
  if (json['kind'] !== 'score' || !Array.isArray(t) || t.length !== 3) return null;
  const values: readonly unknown[] = t;
  const [one, two, three] = values;
  const isAscending =
    isIntegerIn(one, 0, Number.MAX_SAFE_INTEGER) &&
    isIntegerIn(two, one + 1, Number.MAX_SAFE_INTEGER) &&
    isIntegerIn(three, two + 1, Number.MAX_SAFE_INTEGER);
  return isAscending ? { kind: 'score', thresholds: [one, two, three] } : null;
}

function toEntry(json: unknown, index: number): LevelEntry {
  const stars = isRecord(json) ? toStarRule(json['stars']) : null;
  if (
    !isRecord(json) ||
    stars === null ||
    !isIntegerIn(json['level'], 1, 9999) ||
    !isIntegerIn(json['seed'], 0, UINT32_MAX) ||
    !isIntegerIn(json['difficulty'], 0, 100)
  ) {
    throw new RangeError(`level table entry ${String(index)} is invalid: ${JSON.stringify(json)}`);
  }
  return { level: json['level'], seed: json['seed'], difficulty: json['difficulty'], stars };
}

/**
 * Validates a committed pack-<n>.json (an array of LevelEntry) and returns it typed. JSON widens
 * `kind` to string, so the table is checked here instead of cast; a bad table is a build bug.
 */
export function toLevelEntries(json: unknown): readonly LevelEntry[] {
  if (!Array.isArray(json)) throw new RangeError('a level table must be a JSON array');
  const entries: readonly unknown[] = json;
  return entries.map((entry, index) => toEntry(entry, index));
}
