// palette-rules.mjs: WCAG 2.2 contrast maths and the palette rules, in plain JS, for
// check-design-system.mjs and write-palette.mjs. The pairs come from the app's contrast contract,
// contracts/contrast.json (accessibility-as-code owns that file, its rule and its full key list), so
// this skill and accessibility-as-code share one table. Without the contract the default pairs apply:
// the "app" palette of assets/default-contrast.json, a verbatim copy of accessibility-as-code's
// contract template (the pairs are declared in that one file, never here). The core pairs are a floor
// checked whatever the table says, and no exception lowers them.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError, parseJsonc } from '../check-lib.mjs';

const OPAQUE = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/;
const WITH_ALPHA = /^#([0-9A-F]{6})([0-9A-F]{2})?$/;

/** An uppercase #RRGGBB. */
export function isOpaqueHex(value) {
  return typeof value === 'string' && OPAQUE.test(value);
}

/** An uppercase #RRGGBB or #RRGGBBAA: every palette field (scrim, separator and shadow may be translucent). */
export function isPaletteHex(value) {
  return typeof value === 'string' && WITH_ALPHA.test(value);
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance of an opaque #RRGGBB. */
export function luminance(hex) {
  const [, r, g, b] = OPAQUE.exec(hex);
  return 0.2126 * channel(parseInt(r, 16)) + 0.7152 * channel(parseInt(g, 16)) + 0.0722 * channel(parseInt(b, 16));
}

/** WCAG contrast ratio of two opaque colours, 1..21. */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A #RRGGBBAA colour painted over an opaque ground, as the opaque colour the eye sees; #RRGGBB is returned as is. */
export function composite(hex, ground) {
  const match = WITH_ALPHA.exec(hex);
  if (match[2] === undefined) return hex;
  const alpha = parseInt(match[2], 16) / 255;
  const [, fr, fg, fb] = OPAQUE.exec(`#${match[1]}`);
  const [, gr, gg, gb] = OPAQUE.exec(ground);
  const mix = (f, g) => Math.round(parseInt(f, 16) * alpha + parseInt(g, 16) * (1 - alpha)).toString(16).padStart(2, '0').toUpperCase();
  return `#${mix(fr, gr)}${mix(fg, gg)}${mix(fb, gb)}`;
}

/** The semantic fields every ColorTokens type holds (color-tokens-fields). */
export const CORE_FIELDS = ['background', 'surface', 'text', 'textMuted', 'primary', 'onPrimary', 'border', 'focus', 'danger'];

/** WCAG 2.2 AA: text 4.5:1 (1.4.3); icons, edges, focus and filled shapes 3:1 (1.4.11). */
export const MINIMUMS = { text: 4.5, graphics: 3, shapes: 3 };

/**
 * Pairs checked in every app whatever its contract says: body and muted text on the two grounds,
 * text on the primary fill, and the control boundary and focus indicator on the ground.
 */
export const CORE_PAIRS = {
  text: [['text', 'background'], ['text', 'surface'], ['textMuted', 'background'], ['textMuted', 'surface'], ['onPrimary', 'primary']],
  graphics: [['border', 'background'], ['focus', 'background']],
};

/** This skill's folder (scripts/lib/ is two levels below it). */
const SKILL_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const DEFAULT_CONTRAST_FILE = 'assets/default-contrast.json';

/**
 * The pairs used when the app has no contracts/contrast.json: the "app" palette of the contract
 * template, read from this skill's copy of it. { text, graphics, shapes, base, edge }.
 */
function readDefaultTable() {
  const template = JSON.parse(readFileSync(join(SKILL_DIR, DEFAULT_CONTRAST_FILE), 'utf8'));
  const entry = template.palettes.find((item) => item.name === 'app') ?? template.palettes[0];
  return { text: entry.text ?? [], graphics: entry.graphics ?? [], shapes: entry.shapes ?? [], base: entry.base ?? 'background', edge: entry.edge ?? 'border' };
}

export const DEFAULT_TABLE = readDefaultTable();

export const CONTRAST_CONTRACT_NAME = 'contrast.json';

const isPair = (value, sizes) => Array.isArray(value) && sizes.includes(value.length) && value.every((item) => typeof item === 'string' && item !== '');
const samePair = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Pairs of `first` then those of `extra` not already in it. */
function union(first, extra) {
  const out = [...first];
  for (const pair of extra) if (!out.some((kept) => samePair(kept, pair))) out.push(pair);
  return out;
}

/** The contrast contract's repo-relative path: rn-skills.config.json "contrastContract", else <contractsDir>/contrast.json. */
export function contrastContractPath(layout) {
  const given = layout.config?.contrastContract;
  return typeof given === 'string' && given.trim() !== '' ? given : posix.join(layout.contractsDir, CONTRAST_CONTRACT_NAME);
}

/** The contrast contract, or null when the app has none. A malformed file is bad input (exit 2). */
export function readContrastContract(root, layout) {
  const rel = contrastContractPath(layout);
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, contract: null };
  let contract;
  try {
    contract = parseJsonc(readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix its syntax (accessibility-as-code owns the contrast contract and lists its keys).');
  }
  const palettes = contract?.palettes;
  const valid = Array.isArray(palettes) && palettes.every((entry) => typeof entry?.file === 'string'
    && ['text', 'graphics'].every((kind) => entry[kind] === undefined || (Array.isArray(entry[kind]) && entry[kind].every((pair) => isPair(pair, [2]))))
    && (entry.shapes === undefined || (Array.isArray(entry.shapes) && entry.shapes.every((shape) => isPair(shape, [2, 3])))));
  if (!valid) throw new UsageError(`${rel} has no valid "palettes" list ({ file, text: [[fg, bg]], graphics: [[fg, bg]], shapes: [[fill, ground, edge?]] })`, 'Fix the contract (accessibility-as-code\'s check-contrast.mjs names each problem).');
  return { rel, contract };
}

/**
 * The table a palette is judged by: its contract entry (matched by file, and by export when the
 * entry names one) plus the core pairs, else the default table plus the core pairs.
 * { source, name, text, graphics, shapes, base, edge, exceptions }
 */
export function tableFor(contrastContract, { file, exportName }) {
  const { rel, contract } = contrastContract ?? {};
  const entry = contract?.palettes.find((item) => posix.normalize(item.file) === posix.normalize(file) && (item.export === undefined || item.export === exportName));
  const own = entry ?? DEFAULT_TABLE;
  return {
    source: entry ? rel : null,
    name: entry?.name ?? null,
    text: union(CORE_PAIRS.text, own.text ?? []),
    graphics: union(CORE_PAIRS.graphics, own.graphics ?? []),
    shapes: own.shapes ?? [],
    base: own.base ?? 'background',
    edge: own.edge ?? 'border',
    exceptions: entry ? (contract.exceptions ?? []).filter((item) => item?.palette === entry.name) : [],
  };
}

const fixed = (value) => value.toFixed(2);
const isCore = (kind, pair) => (CORE_PAIRS[kind] ?? []).some((core) => samePair(core, pair));

function pairFailure(label, kind, [fg, bg], solid) {
  const ground = solid(bg);
  const ratio = contrast(solid(fg, ground), ground);
  if (ratio >= MINIMUMS[kind]) return null;
  const core = isCore(kind, [fg, bg]);
  return { rule: 'palette-contrast', fg, bg, core, message: `${label}: ${fg} on ${bg} is ${fixed(ratio)}:1, needs ${MINIMUMS[kind]}:1${core ? ' (a core pair)' : ''}` };
}

function shapeFailure(label, [fill, bg, edge], solid) {
  const ground = solid(bg);
  const shape = solid(fill, ground);
  const best = Math.max(contrast(shape, ground), contrast(solid(edge, shape), shape));
  if (best >= MINIMUMS.shapes) return null;
  return { rule: 'palette-fill', fg: fill, bg, message: `${label}: ${fill} stands only ${fixed(best)}:1 off ${bg} and off ${edge}, needs ${MINIMUMS.shapes}:1 from one of them` };
}

/**
 * Problems of one scheme's colours: [{ rule, message, fg?, bg? }]. Translucent colours are painted
 * over their ground first, and a translucent ground over the table's base colour.
 * rules: palette-hex (every field), palette-contrast (text and graphics pairs), palette-fill (shapes).
 */
export function schemeProblems(label, colors, table) {
  const problems = [];
  for (const [field, value] of Object.entries(colors ?? {})) {
    if (!isPaletteHex(value)) problems.push({ rule: 'palette-hex', message: `${label}.${field} is ${JSON.stringify(value)}, expected an uppercase #RRGGBB (or #RRGGBBAA for a translucent field)` });
  }
  if (problems.length > 0) return problems;
  const shapes = table.shapes.map(([fill, bg, edge = table.edge]) => [fill, bg, edge]);
  const named = [...table.text, ...table.graphics, ...shapes].flat();
  const missing = [...new Set(named)].filter((field) => colors[field] === undefined);
  for (const field of missing) problems.push({ rule: 'palette-contrast', message: `${label}: the contrast table names ${field}, a field the palette does not have` });
  if (!isOpaqueHex(colors[table.base])) problems.push({ rule: 'palette-contrast', message: `${label}: the base colour ${table.base} must be opaque (translucent grounds are painted over it)` });
  if (problems.length > 0) return problems;
  const solid = (name, ground = colors[table.base]) => composite(colors[name], composite(ground, colors[table.base]));
  for (const kind of ['text', 'graphics']) {
    for (const pair of table[kind]) {
      const failure = pairFailure(label, kind, pair, solid);
      if (failure) problems.push(failure);
    }
  }
  for (const shape of shapes) {
    const failure = shapeFailure(label, shape, solid);
    if (failure) problems.push(failure);
  }
  return problems;
}

/**
 * Splits problems into those an approved contract exception accepts (printed as notes) and the rest.
 * A core pair is never accepted: the core pairs are checked whatever the contract says (palette.test.ts
 * keeps them in Jest too), so an exception on one is itself a palette-contrast problem.
 */
export function applyExceptions(set, problems, table) {
  const accepted = [];
  const left = [];
  for (const problem of problems) {
    const exception = problem.fg === undefined ? undefined : table.exceptions.find((item) => item.set === set && item.fg === problem.fg && item.bg === problem.bg);
    if (exception && problem.core) left.push({ ...problem, message: `${problem.message}; the exception in ${table.source} (${exception.reason}) cannot accept it: a core pair cannot be excepted` });
    else if (exception) accepted.push(`${problem.message} (accepted by an exception in ${table.source}: ${exception.reason}; approved by ${exception.approvedBy})`);
    else left.push(problem);
  }
  return { accepted, left };
}
