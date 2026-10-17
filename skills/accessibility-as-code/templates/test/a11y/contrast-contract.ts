// test/a11y/contrast-contract.ts
// Evaluates contracts/contrast.json inside Jest: the same keys, pairs, compositing and colour-blind
// separation as the accessibility-as-code skill's check-contrast.mjs, so a colour change fails a
// test before it reaches a screen. WCAG 2.2: text 4.5:1 (1.4.3), graphics and shapes 3:1 (1.4.11);
// quality-gates.json may raise those floors, never lower them.
import { contrastRatio, parseHex } from '@/theme/contrast';

import { categoricalProblems, MIN_CVD_DISTANCE } from './cvd';

type Pair = readonly [string, string];
type Shape = readonly [string, string] | readonly [string, string, string];
export type ColorSet = Readonly<Record<string, string>>;

export type ContrastPalette = {
  readonly name: string;
  readonly file: string;
  readonly export?: string;
  readonly sets: readonly string[];
  readonly optionalSets?: readonly string[];
  readonly base?: string;
  readonly edge?: string;
  readonly text?: readonly Pair[];
  readonly graphics?: readonly Pair[];
  readonly shapes?: readonly Shape[];
  readonly distinct?: readonly (readonly string[])[];
  readonly distinctSets?: readonly string[];
};

export type ContrastException = {
  readonly palette: string;
  readonly set: string;
  readonly fg: string;
  readonly bg: string;
  readonly reason: string;
  readonly approvedBy: string;
};

export type ContrastContract = {
  readonly palettes: readonly ContrastPalette[];
  readonly exceptions?: readonly ContrastException[];
};

/** The ratios and the colour-blind distance a run holds the contract to. */
export type Thresholds = { readonly text: number; readonly nonText: number; readonly cvd: number };

/** WCAG 2.2 AA and 3.5 JND: a gate may raise them, never lower them. */
export const FLOORS: Thresholds = { text: 4.5, nonText: 3, cvd: MIN_CVD_DISTANCE };
export const DEFAULT_CONTRACT = 'contracts/contrast.json';

const TOP_KEYS = ['$schema', '$comment', 'palettes', 'exceptions'];
const PALETTE_KEYS = [
  '$comment',
  'name',
  'file',
  'export',
  'sets',
  'optionalSets',
  'distinctSets',
  'base',
  'edge',
  'text',
  'graphics',
  'shapes',
  'distinct',
];
const EXCEPTION_KEYS = ['$comment', 'palette', 'set', 'fg', 'bg', 'reason', 'approvedBy'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(value: unknown, known: readonly string[], where: string): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `${where} has the unknown key "${key}"`);
}

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/**
 * The parsed contract. Throws on a wrong shape and on any unknown key: a misspelt "grapics" would
 * turn a whole category of checks off (check-contrast.mjs names the line).
 */
export function asContract(value: unknown): ContrastContract {
  if (!isRecord(value) || !Array.isArray(value['palettes'])) {
    throw new Error('the contrast contract is missing or has no "palettes" list');
  }
  const problems = [
    ...unknownKeys(value, TOP_KEYS, 'the contract'),
    ...listOf(value['palettes']).flatMap((entry, index) =>
      unknownKeys(entry, PALETTE_KEYS, `palettes[${String(index)}]`),
    ),
    ...listOf(value['exceptions']).flatMap((entry, index) =>
      unknownKeys(entry, EXCEPTION_KEYS, `exceptions[${String(index)}]`),
    ),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
  return value as ContrastContract;
}

/** JSON with // and /* *\/ comments and trailing commas, as rn-skills.config.json may be written. */
export function parseJsonc(text: string): unknown {
  const strings = /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  const commas = /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g;
  return JSON.parse(
    text
      .replace(strings, (_match: string, quoted?: string) => quoted ?? '')
      .replace(commas, (_match: string, quoted?: string, close?: string) => quoted ?? close ?? ''),
  );
}

/** The contract's repo path: rn-skills.config.json "contrastContract", else <contractsDir>/contrast.json. */
export function contractPathOf(config: unknown): string {
  if (!isRecord(config)) return DEFAULT_CONTRACT;
  const configured = config['contrastContract'];
  if (typeof configured === 'string' && configured !== '') return configured;
  const dir = config['contractsDir'];
  return typeof dir === 'string' && dir !== '' ? `${dir}/contrast.json` : DEFAULT_CONTRACT;
}

/** quality-gates.json's a11y block raises the floors (never lowers them), as check-contrast.mjs does. */
export function thresholdsOf(gates: unknown): Thresholds {
  const a11y = isRecord(gates) && isRecord(gates['a11y']) ? gates['a11y'] : {};
  const raise = (key: string, floor: number): number => {
    const value = a11y[key];
    return typeof value === 'number' ? Math.max(value, floor) : floor;
  };
  return {
    text: raise('textContrastMin', FLOORS.text),
    nonText: raise('nonTextContrastMin', FLOORS.nonText),
    cvd: raise('minCvdDistanceOk', FLOORS.cvd),
  };
}

function atPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}

/** The palette's colour sets by path: every required set, and each optional set that exists. */
export function colorSetsOf(palette: ContrastPalette, module: unknown): Map<string, ColorSet> {
  const root = palette.export === undefined ? module : atPath(module, palette.export);
  const sets = new Map<string, ColorSet>();
  for (const path of [...palette.sets, ...(palette.optionalSets ?? [])]) {
    const set = atPath(root, path);
    if (isRecord(set)) sets.set(path, set as ColorSet);
    else if (palette.sets.includes(path))
      throw new Error(`${palette.name}: set "${path}" is missing`);
  }
  return sets;
}

/** A #RRGGBBAA colour drawn over an opaque ground, as the opaque #RRGGBB the eye sees. */
export function composite(hex: string, ground: string): string {
  if (hex.length === 7) return hex;
  const alpha = parseInt(hex.slice(7, 9), 16) / 255;
  const fg = parseHex(hex.slice(0, 7));
  const bg = parseHex(ground);
  const channel = (a: number, b: number): string =>
    Math.round((a * alpha + b * (1 - alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(fg.r, bg.r)}${channel(fg.g, bg.g)}${channel(fg.b, bg.b)}`;
}

function colorOf(set: ColorSet, token: string): string {
  const value = set[token];
  if (value === undefined) throw new Error(`the palette has no token "${token}"`);
  return value;
}

type SetInput = { readonly name: string; readonly set: ColorSet; readonly min: Thresholds };

function setProblems(palette: ContrastPalette, { name: setName, set, min }: SetInput): string[] {
  const base = colorOf(set, palette.base ?? 'background');
  const solid = (token: string, ground = base): string => composite(colorOf(set, token), ground);
  const ratioOf = ([fg, bg]: Pair): number => contrastRatio(solid(fg, solid(bg)), solid(bg));
  const pairs = [
    ...(palette.text ?? []).map((pair) => [pair, min.text] as const),
    ...(palette.graphics ?? []).map((pair) => [pair, min.nonText] as const),
  ]
    .filter(([pair, min]) => ratioOf(pair) < min)
    .map(
      ([pair, min]) =>
        `${setName}: ${pair[0]} on ${pair[1]} is ${ratioOf(pair).toFixed(2)}:1 < ${String(min)}:1`,
    );
  const shapes = (palette.shapes ?? []).flatMap(([fill, bg, edge = palette.edge ?? 'border']) => {
    const shape = solid(fill, solid(bg));
    const best = Math.max(
      contrastRatio(solid(edge, shape), shape),
      contrastRatio(shape, solid(bg)),
    );
    return best < min.nonText
      ? [`${setName}: ${fill} on ${bg} has no ${String(min.nonText)}:1 edge or ground`]
      : [];
  });
  return [...pairs, ...shapes];
}

function isExcepted(
  message: string,
  palette: ContrastPalette,
  exceptions: readonly ContrastException[],
): boolean {
  return exceptions.some(
    (e) => e.palette === palette.name && message.startsWith(`${e.set}: ${e.fg} on ${e.bg} `),
  );
}

export type ContrastOptions = {
  readonly exceptions?: readonly ContrastException[];
  readonly min?: Thresholds;
};

/** Every declared pair that fails in any set; recorded exceptions are left out. */
export function contrastProblems(
  palette: ContrastPalette,
  sets: ReadonlyMap<string, ColorSet>,
  { exceptions = [], min = FLOORS }: ContrastOptions = {},
): readonly string[] {
  return [...sets.entries()]
    .flatMap(([name, set]) => setProblems(palette, { name, set, min }))
    .filter((message) => !isExcepted(message, palette, exceptions));
}

/** Every distinct list that colour-blind eyes cannot tell apart, per set. */
export function distinctProblems(
  palette: ContrastPalette,
  sets: ReadonlyMap<string, ColorSet>,
  min: number = FLOORS.cvd,
): readonly string[] {
  const chosen = palette.distinctSets ?? [...sets.keys()];
  return chosen.flatMap((setName) => {
    const set = sets.get(setName);
    if (set === undefined) return [];
    const base = colorOf(set, palette.base ?? 'background');
    return (palette.distinct ?? []).flatMap((list) =>
      categoricalProblems(
        list.map((token) => composite(colorOf(set, token), base)),
        min,
      ).map((problem) => `${setName} ${list.join(', ')}: ${problem}`),
    );
  });
}
