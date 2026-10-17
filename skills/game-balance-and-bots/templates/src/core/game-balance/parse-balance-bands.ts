// src/core/game-balance/parse-balance-bands.ts
import { ENDLESS_DIFFICULTY, MAX_LEVEL_DIFFICULTY } from '@/core/game/difficulty';

import { BAND_METRICS } from './balance-bands';

import type { BalanceBands } from './balance-bands';

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMetric(value: unknown): boolean {
  return typeof value === 'string' && (BAND_METRICS as readonly string[]).includes(value);
}

/** A whole level difficulty 0..99: the curve never samples the endless difficulty. */
function isLevelDifficulty(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= MAX_LEVEL_DIFFICULTY;
}

function fieldProblems(
  json: Json,
  fields: Readonly<Record<string, (v: unknown) => boolean>>,
  at: string,
): string[] {
  return Object.entries(fields)
    .filter(([key, isValid]) => !isValid(json[key]))
    .map(([key]) => `${at}.${key} is missing or invalid`);
}

const isText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
const isPolicyList = (value: unknown): boolean =>
  Array.isArray(value) && value.length >= 2 && value.every((item) => isText(item));

const TOP_FIELDS = {
  gameId: isText,
  status: (value: unknown) => value === 'proposed' || value === 'approved',
  seedsPerCell: (value: unknown) => isNumber(value) && value >= 100,
  maxMoves: (value: unknown) => isNumber(value) && value > 0,
  notes: isText,
};
const BAND_FIELDS = {
  policy: isText,
  difficulty: isNumber,
  metric: isMetric,
  min: isNumber,
  max: isNumber,
  why: isText,
};
const ENDLESS_BAND_FIELDS = {
  metric: (value: unknown) => isMetric(value) && value !== 'winRate',
  min: isNumber,
  max: isNumber,
  why: isText,
};
const RULE_FIELDS: Readonly<Record<string, Readonly<Record<string, (v: unknown) => boolean>>>> = {
  curve: {
    policy: isText,
    metric: isMetric,
    direction: (value) => value === 'up' || value === 'down',
    minStep: isNumber,
  },
  skillGap: {
    difficulty: isNumber,
    metric: isMetric,
    order: isPolicyList,
    better: (value) => value === 'higher' || value === 'lower',
    minStep: isNumber,
  },
  firstPayoff: {
    policy: isText,
    difficulty: isNumber,
    withinMoves: (value) => isNumber(value) && value >= 1 && value <= 10,
    minShare: (value) => isNumber(value) && value > 0 && value <= 1,
  },
  twist: { policy: isText, difficulty: isNumber, minPerRun: isNumber },
};

function gridProblems(grid: unknown): string[] {
  if (!isObject(grid) || Object.keys(grid).length === 0) return ['grid is missing or empty'];
  return Object.entries(grid)
    .filter(
      ([, levels]) =>
        !(Array.isArray(levels) && levels.length > 0 && levels.every(isLevelDifficulty)),
    )
    .map(
      ([policy]) =>
        `grid.${policy} must list level difficulties 0..${String(MAX_LEVEL_DIFFICULTY)} (the endless run has its own block)`,
    );
}

function endlessProblems(endless: unknown): string[] {
  if (endless === undefined || endless === null) return [];
  if (!isObject(endless)) return ['endless must be an object or null'];
  const problems = fieldProblems(endless, { policy: isText }, 'endless');
  if (endless['difficulty'] !== ENDLESS_DIFFICULTY)
    problems.push(`endless.difficulty must be ${String(ENDLESS_DIFFICULTY)} (ENDLESS_DIFFICULTY)`);
  const list = Array.isArray(endless['bands']) ? endless['bands'] : [];
  if (list.length === 0) problems.push('endless.bands must list at least one band');
  return [
    ...problems,
    ...list.flatMap((band: unknown, index) =>
      isObject(band)
        ? fieldProblems(band, ENDLESS_BAND_FIELDS, `endless.bands[${String(index)}]`)
        : [`endless.bands[${String(index)}] is not an object`],
    ),
  ];
}

function ruleProblems(json: Json): string[] {
  return Object.entries(RULE_FIELDS).flatMap(([name, fields]) => {
    const rule = json[name];
    if (name === 'twist' && rule === null) return [];
    return isObject(rule) ? fieldProblems(rule, fields, name) : [`${name} is missing`];
  });
}

/**
 * Validates balance-bands.json (imported as untyped JSON) and returns it typed. Throws one error
 * listing every problem, so a broken bands file fails the sim with a readable message.
 */
export function parseBands(json: unknown): BalanceBands {
  if (!isObject(json)) throw new Error('balance bands: not a JSON object');
  const bands = Array.isArray(json['bands']) ? json['bands'] : [];
  const problems = [
    ...fieldProblems(json, TOP_FIELDS, 'bands file'),
    ...gridProblems(json['grid']),
    ...(bands.length === 0 ? ['bands must list at least one band'] : []),
    ...bands.flatMap((band: unknown, index) =>
      isObject(band)
        ? fieldProblems(band, BAND_FIELDS, `bands[${String(index)}]`)
        : [`bands[${String(index)}] is not an object`],
    ),
    ...ruleProblems(json),
    ...endlessProblems(json['endless']),
  ];
  if (json['status'] === 'approved' && !isText(json['approvedOn']))
    problems.push('approved bands need approvedOn (YYYY-MM-DD)');
  if (problems.length > 0) throw new Error(`balance bands: ${problems.join('; ')}`);
  return json as BalanceBands;
}
