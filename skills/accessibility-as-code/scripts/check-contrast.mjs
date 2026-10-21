#!/usr/bin/env node
// check-contrast.mjs: proves the colours an app paints are readable and tell apart. It reads the
// repo-owned contract contracts/contrast.json (which colour tables exist, which colour sets they
// hold, which colour sits on which), then checks every declared pair in every set against WCAG 2.2
// AA, every "distinct" list under colour-blind simulation, and the a11y budgets in
// quality-gates.json. The contract is the app's one pair table: design-system-structure's
// write-palette and check-design-system read its theme palette entry too, so every colour table
// (the theme palette, chart series, tag colours) is declared here, once. A Skia canvas surface keeps
// its own pairs beside its palettes (skia-canvas-rendering's canvas-palettes.json + canvas-contrast.json),
// and this checker measures those too, with the same maths. The facts belong to the app; the thresholds
// never go below WCAG.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-contrast.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, posix, relative } from 'node:path';

import { createReporter, fail, globToRegExp, notYetCreated, parseArgs, parseJsonc, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { ConstantsError, loadTsConstants } from './lib/load-ts-constants.mjs';
import { composite, contrastRatio, DEFICIENCIES, MIN_CVD_DISTANCE, minPairwiseDistance } from './lib/wcag.mjs';

const SPEC = {
  name: 'check-contrast',
  summary: 'Checks the colour pairs and colour-blind separation an app declares in contracts/contrast.json against WCAG 2.2 AA, and the a11y budgets in quality-gates.json.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The contrast contract, repo-relative or absolute (default: rn-skills.config.json "contrastContract", else <contractsDir>/contrast.json)' },
    categorical: { type: 'string', multiple: true, value: 'list', help: 'Also check comma-separated #RRGGBB colours that must stay apart (chart series, tags)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contrast-contract  contracts/contrast.json exists and is valid (unknown keys are refused: a misspelt key',
    '                     turns its checks off), names existing files, sets and tokens, declares at least one pair',
    '                     per palette, and every exception carries a reason and an approver and still matches a',
    '                     failing pair; the theme palette (src/theme/palette.ts, or each palette that',
    '                     contracts/design-system.json lists) and every other colour table under src/ (a *colors',
    '                     or *palette .ts/.json file holding hex colours) is declared',
    '  palette-shape      each palette file loads as literal data (a .ts module with type imports only, or .json),',
    '                     every required set exists, every optional set that exists is checked, all sets hold the',
    '                     same token names, every value is #RRGGBB or #RRGGBBAA, and the base token is opaque',
    '  text-contrast      "text" pairs [fg, bg]: at least 4.5:1 (WCAG 1.4.3; a11y.textContrastMin when higher)',
    '  non-text-contrast  "graphics" pairs [fg, bg] (icons, edges, focus, chart lines): at least 3:1 (WCAG 1.4.11)',
    '  shape-contrast     "shapes" [fill, ground] or [fill, ground, edge]: the filled shape stands 3:1 off its edge',
    '                     (the palette "edge" token by default) or off its ground, whichever is higher',
    '  cvd-separation     every "distinct" list (and --categorical) stays at least 0.07 apart in OKLab under',
    '                     protanopia, deuteranopia and tritanopia (Machado 2009; a11y.minCvdDistanceOk when higher)',
    '  canvas-contrast    every canvas surface folder (src/features/*/canvas, src/games/*/canvas, each dir in',
    '                     contracts/canvas-surfaces.json, or rn-skills.config.json "canvasSurfaceDirs") whose',
    '                     canvas-palettes.json exists has a valid canvas-contrast.json (format 1 keys: base, edge,',
    '                     text, graphics, shapes, distinct, distinctSets) naming known tokens; its pairs are measured',
    '                     in every palette set (contracts/canvas-surfaces.json "paletteSets", default light, dark) by',
    '                     the rules above, and a surface palette is never declared again in the contrast contract',
    '  a11y-gates         quality-gates.json "a11y": minTouchPt >= 44, maxFontScale >= 2, textContrastMin >= 4.5,',
    '                     nonTextContrastMin >= 3, minCvdDistanceOk >= 0.07 (SKIP while quality-gates.json does not exist)',
    '',
    'Translucent #RRGGBBAA colours are composited over their ground first, and a translucent ground over the',
    'palette "base" token (default "background"). Contract keys: references/contrast-and-colour.md.',
    'In an app (a package.json exists) the contract is required; --categorical alone is enough only outside an app.',
    '',
    'Examples: node check-contrast.mjs .    node check-contrast.mjs . --categorical "#0072B2,#D55E00,#009E73,#CC79A7"',
  ].join('\n'),
};

const HEX = /^#[0-9a-f]{6}$/i;
const HEX_ALPHA = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const DATA_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.json']);
const PAIR_KINDS = [
  ['text', 'textContrastMin', 'text-contrast'],
  ['graphics', 'nonTextContrastMin', 'non-text-contrast'],
];
/** WCAG floors: a gate may raise them, never lower them. */
const FLOORS = { minTouchPt: 44, maxFontScale: 2, textContrastMin: 4.5, nonTextContrastMin: 3, minCvdDistanceOk: MIN_CVD_DISTANCE };
const CONTRACT_FIX = 'Fix contracts/contrast.json (copy the skill template; references/contrast-and-colour.md lists every key).';
const TOP_KEYS = ['$schema', '$comment', 'palettes', 'exceptions'];
const PALETTE_KEYS = ['$comment', 'name', 'file', 'export', 'sets', 'optionalSets', 'distinctSets', 'base', 'edge', 'text', 'graphics', 'shapes', 'distinct'];
const EXCEPTION_KEYS = ['$comment', 'palette', 'set', 'fg', 'bg', 'reason', 'approvedBy'];
const PAIR_LISTS = ['text', 'graphics', 'shapes'];
/** design-system-structure's contract, which names the theme palette files. */
const DESIGN_CONTRACT = 'design-system.json';
/** A file whose name says it holds colours: chart-colors.ts, tagColours.ts, board-palettes.json. */
const COLOUR_TABLE_NAME = /(?:^|[-_.]|(?<=[a-z]))(?:colou?rs|palettes?)\.(?:ts|json)$/i;
const HEX_LITERAL = /['"](#[0-9a-f]{6}(?:[0-9a-f]{2})?)['"]/gi;
/** skia-canvas-rendering's per-surface files and contract (its format 1; both checkers read them). */
const CANVAS_SURFACES = 'canvas-surfaces.json';
const CANVAS_PALETTES = 'canvas-palettes.json';
const CANVAS_CONTRAST = 'canvas-contrast.json';
const CANVAS_CONTRAST_KEYS = ['$comment', 'base', 'edge', 'text', 'graphics', 'shapes', 'distinct', 'distinctSets'];
const DEFAULT_CANVAS_SETS = ['light', 'dark'];
const CANVAS_FIX = `Write ${CANVAS_CONTRAST} beside ${CANVAS_PALETTES} in skia-canvas-rendering's format 1: { "edge": "edge", "text": [["label", "cell"]], "graphics": [["mark", "done"]], "shapes": [["done", "background"]], "distinct": [["done", "cell"]] }, naming the tokens draw() paints on each other.`;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTextList = (value) => Array.isArray(value) && value.every(isText);

/** 1-based line of the first match of a regex in a text, else 1. */
function lineMatching(text, regex) {
  const match = regex.exec(text ?? '');
  if (!match) return 1;
  return text.slice(0, match.index).split('\n').length;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pairRegex = (names) => new RegExp(`\\[\\s*${names.map((n) => `"${escapeRegex(String(n))}"`).join('\\s*,\\s*')}`);
const tokenRegex = (name) => new RegExp(`["']?\\b${escapeRegex(name)}\\b["']?\\s*:`);

/** Where a set's value starts: after `set:`, or at `const NAME` when the value is a named constant (`dark: DARK`). */
function setValueStart(text, from) {
  const ref = /^\s*([A-Za-z_$][\w$]*)\s*[,}\n]/.exec(text.slice(from));
  if (!ref) return from;
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegex(ref[1])}\\b`).exec(text);
  return declaration ? declaration.index + declaration[0].length : from;
}

/** 1-based line of a token inside the colour set `set` (a dotted path), else of its first occurrence. */
function tokenLine(text, set, name) {
  let from = 0;
  for (const segment of String(set).split('.')) {
    const match = tokenRegex(segment).exec(text.slice(from));
    if (!match) return lineMatching(text, tokenRegex(name));
    from = setValueStart(text, from + match.index + match[0].length);
  }
  const match = tokenRegex(name).exec(text.slice(from));
  return match ? text.slice(0, from + match.index).split('\n').length : lineMatching(text, tokenRegex(name));
}

/** Edit distance, for "did you mean" on a misspelt key. */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}

/** One problem per key the schema does not know (additionalProperties: false), at the key's line. */
function unknownKeyProblems(object, known, where, text) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
  return Object.keys(object).filter((key) => !known.includes(key)).map((key) => {
    const near = known.find((name) => distance(key.toLowerCase(), name.toLowerCase()) <= 2);
    return {
      message: `${where} has the unknown key "${key}"${near ? ` (did you mean "${near}"?)` : ''}: a misspelt key turns its checks off`,
      line: lineMatching(text, new RegExp(`"${escapeRegex(key)}"\\s*:`)),
    };
  });
}

/** The contract's structural problems ([] when usable): [{ message, line }]. */
function contractProblems(contract, text) {
  const problems = [];
  const at = (message) => problems.push({ message, line: 1 });
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return [{ message: 'the contract is not a JSON object', line: 1 }];
  problems.push(...unknownKeyProblems(contract, TOP_KEYS, 'the contract', text));
  if (!Array.isArray(contract.palettes) || contract.palettes.length === 0) return [...problems, { message: '"palettes" must list at least one colour table (the theme palette first)', line: lineMatching(text, /"palettes"/) }];
  const names = new Set();
  contract.palettes.forEach((entry, index) => {
    const where = `palettes[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return at(`${where} is not an object`);
    problems.push(...unknownKeyProblems(entry, PALETTE_KEYS, where, text));
    if (!isText(entry.name)) at(`${where} has no "name"`);
    else if (names.has(entry.name)) at(`${where} repeats the name "${entry.name}"`);
    names.add(entry.name);
    if (!isText(entry.file)) at(`${where} has no "file"`);
    else if (isAbsolute(entry.file) || entry.file.split(/[\\/]/).includes('..')) at(`${where} "file" must be repo-relative`);
    if (!isTextList(entry.sets) || entry.sets.length === 0) at(`${where} "sets" must list at least one colour set`);
    for (const key of ['optionalSets', 'distinctSets']) if (entry[key] !== undefined && !isTextList(entry[key])) at(`${where} "${key}" must be a list of set paths`);
    for (const key of ['export', 'base', 'edge']) if (entry[key] !== undefined && !isText(entry[key])) at(`${where} "${key}" must be a token or export name`);
    for (const kind of ['text', 'graphics', 'shapes']) {
      const pairs = entry[kind] ?? [];
      if (!Array.isArray(pairs)) at(`${where} "${kind}" is not a list`);
      else for (const pair of pairs) {
        const size = kind === 'shapes' ? [2, 3] : [2];
        if (!isTextList(pair) || !size.includes(pair.length)) at(`${where} "${kind}" entry ${JSON.stringify(pair)} is not ${kind === 'shapes' ? '[fill, ground] or [fill, ground, edge]' : '[fg, bg]'}`);
      }
    }
    if (entry.distinct !== undefined && (!Array.isArray(entry.distinct) || !entry.distinct.every((list) => isTextList(list) && list.length >= 2))) at(`${where} "distinct" must be a list of token lists (two or more tokens each)`);
    if (!hasPairs(entry)) at(`palette "${entry.name ?? index}" declares no text, graphics or shapes pair`);
    if ((entry.shapes ?? []).some((shape) => Array.isArray(shape) && shape.length === 2) && !isText(entry.edge)) at(`palette "${entry.name ?? index}" has [fill, ground] shapes but no "edge" token`);
    return undefined;
  });
  if (contract.exceptions !== undefined && !Array.isArray(contract.exceptions)) at('"exceptions" must be a list');
  for (const [index, exception] of (Array.isArray(contract.exceptions) ? contract.exceptions : []).entries()) {
    const where = `exceptions[${index}]`;
    problems.push(...unknownKeyProblems(exception, EXCEPTION_KEYS, where, text));
    for (const key of ['palette', 'set', 'fg', 'bg']) if (!isText(exception?.[key])) at(`${where} has no "${key}"`);
    if (!isText(exception?.reason)) at(`${where} has no "reason": an exception without a recorded reason is a silenced failure`);
    if (!isText(exception?.approvedBy)) at(`${where} has no "approvedBy": the developer or reviewer who accepted it`);
    if (isText(exception?.palette) && !names.has(exception.palette)) at(`${where} names the unknown palette "${exception.palette}"`);
  }
  return problems;
}

/** Loads a palette file as data: { data } or { error }. */
function loadPaletteData(file, label) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    try {
      return { data: JSON.parse(text), text };
    } catch (error) {
      return { error: `${label} is not valid JSON (${error.message})`, text };
    }
  }
  try {
    return { data: loadTsConstants(text, label), text, isModule: true };
  } catch (error) {
    if (error instanceof ConstantsError) return { error: error.message, text };
    throw error;
  }
}

const atPath = (value, path) => path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), value);

/** The export that holds the palette: the named one, or the only constant whose required sets all resolve. */
function pickExport(loaded, entry) {
  if (!loaded.isModule) return entry.export ? { value: atPath(loaded.data, entry.export) } : { value: loaded.data };
  if (entry.export) return loaded.data[entry.export] === undefined ? { error: `exports no constant "${entry.export}"` } : { value: loaded.data[entry.export] };
  const found = Object.values(loaded.data).filter((value) => entry.sets.every((set) => atPath(value, set) !== undefined));
  if (found.length === 1) return { value: found[0] };
  return { error: `has ${found.length} constants holding the sets ${entry.sets.join(', ')}; name one with "export"` };
}

/** The colour sets to check, or false when the palette's shape is broken (problems reported). */
function readSets(entry, value, ctx) {
  const { report, label, text, setsSource = '"sets" in the contract' } = ctx;
  const sets = new Map();
  let isValid = true;
  const shape = (message, fix, line = 1) => {
    report.problem({ file: label, line, rule: 'palette-shape', message: `${entry.name}: ${message}`, fix });
    isValid = false;
  };
  for (const path of [...entry.sets, ...(entry.optionalSets ?? [])]) {
    const tokens = atPath(value, path);
    const isOptional = !entry.sets.includes(path);
    if (tokens === undefined && isOptional) continue;
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || Object.keys(tokens).length === 0) {
      shape(`set "${path}" is missing or empty`, `Give the palette the set ${path}, or remove it from ${setsSource}.`);
      continue;
    }
    const bad = Object.entries(tokens).filter(([, color]) => typeof color !== 'string' || !HEX_ALPHA.test(color)).map(([name]) => name);
    if (bad.length > 0) shape(`${path}: ${bad.join(', ')} not #RRGGBB(AA)`, 'Write every colour token as a literal #RRGGBB or #RRGGBBAA string.', lineMatching(text, tokenRegex(bad[0])));
    sets.set(path, tokens);
  }
  const [first, ...rest] = [...sets.entries()];
  if (!first) return false;
  const reference = Object.keys(first[1]).sort().join(',');
  for (const [path, tokens] of rest) {
    if (Object.keys(tokens).sort().join(',') !== reference) shape(`set "${path}" has other tokens than "${first[0]}"`, 'Give every colour set exactly the same token names.');
  }
  const base = entry.base ?? 'background';
  for (const [path, tokens] of sets) {
    if (tokens[base] !== undefined && !HEX.test(tokens[base])) shape(`${path}: the base token "${base}" is translucent`, `Make ${base} opaque, or name an opaque "base" token in the contract.`);
  }
  return isValid ? sets : false;
}

/** Contract pairs that name tokens the palette lacks. */
function unknownTokenProblems(entry, tokens) {
  const known = (name) => Object.hasOwn(tokens, name);
  const problems = [];
  for (const kind of ['text', 'graphics', 'shapes']) {
    for (const pair of entry[kind] ?? []) if (!pair.every(known)) problems.push({ pair, message: `"${kind}" entry ${JSON.stringify(pair)} names a token the palette lacks` });
  }
  for (const key of ['base', 'edge']) if (entry[key] !== undefined && !known(entry[key])) problems.push({ pair: [entry[key]], message: `"${key}" token "${entry[key]}" is not in the palette` });
  if (entry.base === undefined && !known('background')) problems.push({ pair: ['background'], message: 'no "base" token named and the palette has no "background"' });
  for (const list of entry.distinct ?? []) if (!list.every(known)) problems.push({ pair: list, message: `"distinct" list ${JSON.stringify(list)} names a token the palette lacks` });
  for (const set of entry.distinctSets ?? []) if (![...entry.sets, ...(entry.optionalSets ?? [])].includes(set)) problems.push({ pair: [set], message: `"distinctSets" names "${set}", which is not one of the checked colour sets (${[...entry.sets, ...(entry.optionalSets ?? [])].join(', ')})` });
  return problems;
}

/** Every pair failure of one palette: [{ set, kind, rule, fg, bg, ratio, min, message }]. */
function pairFailures(entry, sets, thresholds) {
  const failures = [];
  const base = entry.base ?? 'background';
  for (const [set, tokens] of sets) {
    const solid = (name, ground = tokens[base]) => composite(tokens[name], ground);
    for (const [kind, gate, rule] of PAIR_KINDS) {
      for (const [fg, bg] of entry[kind] ?? []) {
        const ground = solid(bg);
        const ratio = contrastRatio(solid(fg, ground), ground);
        const min = thresholds[gate];
        if (ratio < min) failures.push({ set, rule, fg, bg, message: `${set}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1 < ${min}:1` });
      }
    }
    for (const [fill, bg, edgeName = entry.edge] of entry.shapes ?? []) {
      const ground = solid(bg);
      const shape = solid(fill, ground);
      const best = Math.max(contrastRatio(solid(edgeName, shape), shape), contrastRatio(shape, ground));
      const min = thresholds.nonTextContrastMin;
      if (best < min) failures.push({ set, rule: 'shape-contrast', fg: fill, bg, edge: edgeName, message: `${set}: ${fill} on ${bg} has no ${min}:1 edge or ground (${best.toFixed(2)}:1 against ${edgeName} and ${bg})` });
    }
  }
  return failures;
}

function cvdFailures(entry, sets, minDistance) {
  const failures = [];
  const base = entry.base ?? 'background';
  const chosen = entry.distinctSets ?? [...sets.keys()];
  for (const set of chosen) {
    const tokens = sets.get(set);
    if (!tokens) continue;
    for (const list of entry.distinct ?? []) {
      const colors = list.map((name) => composite(tokens[name], tokens[base]));
      for (const deficiency of DEFICIENCIES) {
        const { distance, pair } = minPairwiseDistance(colors, deficiency);
        if (distance < minDistance) failures.push({ set, list, message: `${set} ${deficiency}: ${list.join(', ')} are only ${distance.toFixed(3)} apart (${pair.join(' and ')}, < ${minDistance})` });
      }
    }
  }
  return failures;
}

const PAIR_FIX = {
  'text-contrast': 'Change one of the two colours (keep the hue, move the lightness) in the palette until the pair reaches the ratio; never weaken the contract.',
  'non-text-contrast': 'Raise the icon, edge or line colour to 3:1 against its ground in the palette.',
  'shape-contrast': 'Darken or lighten the fill, or give it an edge colour that stands 3:1 off it.',
};

function checkGates(file, label, report) {
  let gates;
  try {
    gates = JSON.parse(readFileSync(file, 'utf8')).a11y;
  } catch (error) {
    report.problem({ file: label, line: 1, rule: 'a11y-gates', message: `quality-gates.json is not valid JSON (${error.message})`, fix: 'Repair the JSON (quality-gates owns the file).' });
    return { ...FLOORS };
  }
  if (!gates || typeof gates !== 'object') {
    report.problem({ file: label, line: 1, rule: 'a11y-gates', message: 'quality-gates.json has no "a11y" section', fix: 'Add "a11y": { "minTouchPt": 44, "maxFontScale": 2, "textContrastMin": 4.5, "nonTextContrastMin": 3, "minCvdDistanceOk": 0.07 }.' });
    return { ...FLOORS };
  }
  const text = readFileSync(file, 'utf8');
  for (const [key, floor] of Object.entries(FLOORS)) {
    if (typeof gates[key] !== 'number' || gates[key] < floor) {
      report.problem({ file: label, line: lineMatching(text, new RegExp(`"${key}"`)), rule: 'a11y-gates', message: `a11y.${key} is ${JSON.stringify(gates[key])}, needs a number >= ${floor}`, fix: 'Restore the budget; a stricter value is fine, a looser one is never the fix (changing it needs a Gate-Change trailer and the reviewer).' });
    }
  }
  return Object.fromEntries(Object.entries(FLOORS).map(([key, floor]) => [key, typeof gates[key] === 'number' ? Math.max(gates[key], floor) : floor]));
}

function checkCategorical(list, minDistance, report) {
  const colors = list.split(',').map((c) => c.trim()).filter(Boolean);
  if (colors.length < 2 || colors.some((c) => !HEX.test(c))) fail(`--categorical needs two or more #RRGGBB colours, got: ${list}`, 'Pass --categorical "#0072B2,#D55E00,#009E73".');
  for (const deficiency of DEFICIENCIES) {
    const { distance, pair } = minPairwiseDistance(colors, deficiency);
    if (distance < minDistance) report.problem({ file: '--categorical', line: 0, rule: 'cvd-separation', message: `${deficiency}: ${pair.join(' and ')} are ${distance.toFixed(3)} apart in OKLab (< ${minDistance})`, fix: 'Pick colours from a colour-blind-safe set (Okabe-Ito) and give every category a shape, icon or label as well.' });
  }
}

/** Checks one palette entry; returns the failures an exception may cover. */
function checkPalette(entry, ctx) {
  const { root, report, contractLabel, contractText, thresholds } = ctx;
  const abs = join(root, entry.file);
  const label = toPosix(entry.file);
  const contractProblem = (message, regex) => report.problem({ file: contractLabel, line: lineMatching(contractText, regex), rule: 'contrast-contract', message, fix: CONTRACT_FIX });
  if (!existsSync(abs)) {
    contractProblem(`palette "${entry.name}" names the file ${label}, which does not exist`, new RegExp(`"${escapeRegex(entry.file)}"`));
    return [];
  }
  if (!DATA_EXTENSIONS.has(extname(abs))) {
    contractProblem(`palette "${entry.name}" file ${label} is not a .ts, .js or .json data module`, new RegExp(`"${escapeRegex(entry.file)}"`));
    return [];
  }
  const loaded = loadPaletteData(abs, label);
  if (loaded.error) {
    report.problem({ file: label, line: 1, rule: 'palette-shape', message: loaded.error, fix: 'Keep palettes literal data: #RRGGBB strings, type imports only, no runtime imports or calls.' });
    return [];
  }
  const picked = pickExport(loaded, entry);
  if (picked.error) {
    report.problem({ file: label, line: 1, rule: 'palette-shape', message: `${entry.name}: ${label} ${picked.error}`, fix: 'Name the exported constant in the contract ("export").' });
    return [];
  }
  const sets = readSets(entry, picked.value, { report, label, text: loaded.text });
  if (!sets) return [];
  const unknown = unknownTokenProblems(entry, [...sets.values()][0]);
  for (const { pair, message } of unknown) contractProblem(`palette "${entry.name}": ${message}`, pairRegex(pair));
  if (unknown.length > 0) return [];
  const failures = pairFailures(entry, sets, thresholds).map((failure) => ({ ...failure, palette: entry.name, label, line: tokenLine(loaded.text, failure.set, failure.fg) }));
  for (const failure of cvdFailures(entry, sets, thresholds.minCvdDistanceOk)) {
    report.problem({ file: label, line: tokenLine(loaded.text, failure.set, failure.list[0]), rule: 'cvd-separation', message: `${entry.name} ${failure.message}`, fix: 'Choose the list from a colour-blind-safe family (Okabe-Ito) and keep a shape, icon or label on every category.' });
  }
  return failures;
}

const repoPath = (file) => toPosix(String(file)).replace(/^\.\//, '');
const hasPairs = (entry) => PAIR_LISTS.some((kind) => Array.isArray(entry[kind]) && entry[kind].length > 0);

/** The palette files design-system-structure's contract names (root app only), else <themeDir>/palette.ts. */
function themePaletteFiles(root, appLayout, isRootApp) {
  const design = join(root, appLayout.contractsDir, DESIGN_CONTRACT);
  if (isRootApp && existsSync(design)) {
    try {
      const listed = (parseJsonc(readFileSync(design, 'utf8')).palettes ?? []).map((entry) => entry?.file).filter(isText).map(repoPath);
      if (listed.length > 0) return listed;
    } catch {
      // A broken design-system.json is design-system-structure's problem; fall back to the default palette.
    }
  }
  return [posix.join(appLayout.themeDir, 'palette.ts')];
}

/** Every existing theme palette file of the app and of each workspace. */
function themePalettes(root, layout) {
  const files = [layout, ...layout.workspaces.map((workspace) => workspace.layout)].flatMap((appLayout, index) => themePaletteFiles(root, appLayout, index === 0));
  return [...new Set(files)].filter((file) => existsSync(join(root, file)));
}

/** Colour tables under every source folder that the contract does not declare: [{ file, colours }]. */
function colourTables(root, layout, known) {
  const dirs = [...new Set([layout.srcDir, ...layout.workspaces.map((workspace) => workspace.layout.srcDir)])].filter((dir) => existsSync(join(root, dir)));
  if (dirs.length === 0) return [];
  const files = walkRepo(root, { include: dirs.flatMap((dir) => [`${dir}/**/*.ts`, `${dir}/**/*.json`]), ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'] });
  return files
    .filter((file) => COLOUR_TABLE_NAME.test(basename(file)) && !known.has(file))
    .map((file) => ({ file, colours: new Set([...readFileSync(join(root, file), 'utf8').matchAll(HEX_LITERAL)].map((m) => m[1].toUpperCase())).size }))
    .filter(({ colours }) => colours >= 2);
}

/** The palette sets every canvas-palettes.json holds and the declared surface folders (contracts/canvas-surfaces.json, skia-canvas-rendering's). */
function canvasContract(root, layout) {
  const rel = posix.join(layout.contractsDir, CANVAS_SURFACES);
  if (!existsSync(join(root, rel))) return { sets: DEFAULT_CANVAS_SETS, dirs: [] };
  let data;
  try {
    data = parseJsonc(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON (${error.message})`, 'Repair it (skia-canvas-rendering owns the file); this checker reads its "paletteSets" and "surfaces".');
  }
  const sets = data?.paletteSets ?? DEFAULT_CANVAS_SETS;
  if (!isTextList(sets) || sets.length < 2) fail(`${rel} "paletteSets" must list two or more colour set names`, 'Write "paletteSets": ["light", "dark"], plus any colour-blind or high-contrast set the app offers (skia-canvas-rendering owns the file).');
  const dirs = (Array.isArray(data?.surfaces) ? data.surfaces : []).map((surface) => surface?.dir).filter(isText).map((dir) => repoPath(dir).replace(/\/+$/, ''));
  return { sets, dirs };
}

// Surface folder globs: rn-skills.config.json "canvasSurfaceDirs", else <featuresDir>/*/canvas and
// <srcDir>/games/*/canvas of each app (skia-canvas-rendering's conventional surface folders).
function surfaceGlobs(layout) {
  const configured = layout.config?.canvasSurfaceDirs;
  if (configured !== undefined) return (Array.isArray(configured) ? configured : [configured]).filter(isText).map((glob) => repoPath(glob).replace(/\/+$/, ''));
  const layouts = [layout, ...layout.workspaces.map((workspace) => workspace.layout)];
  return [...new Set(layouts.flatMap((appLayout) => [`${appLayout.featuresDir}/*/canvas`, `${appLayout.srcDir}/games/*/canvas`]))];
}

/** Every canvas surface folder that holds canvas-palettes.json (repo-relative, sorted). */
function canvasSurfaceDirs(root, layout, declaredDirs) {
  const patterns = surfaceGlobs(layout).map((glob) => globToRegExp(glob));
  const dirs = walkRepo(root, { include: [`**/${CANVAS_PALETTES}`] }).map((file) => posix.dirname(file));
  return [...new Set(dirs)].filter((dir) => declaredDirs.includes(dir) || patterns.some((re) => re.test(dir))).sort();
}

/** Structural problems of a parsed canvas-contrast.json (format 1): [{ message, needle }]. */
function canvasContrastProblems(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [{ message: 'is not a JSON object', needle: null }];
  const problems = [];
  const add = (message, needle = null) => problems.push({ message, needle });
  for (const key of Object.keys(data).filter((name) => !CANVAS_CONTRAST_KEYS.includes(name))) {
    const near = CANVAS_CONTRAST_KEYS.find((name) => distance(key.toLowerCase(), name.toLowerCase()) <= 2);
    add(`has the unknown key "${key}"${near ? ` (did you mean "${near}"?)` : ''}: a misspelt key turns its checks off`, `"${key}"`);
  }
  for (const key of ['base', 'edge']) if (data[key] !== undefined && !isText(data[key])) add(`"${key}" must be a token name`, `"${key}"`);
  for (const kind of PAIR_LISTS) {
    const pairs = data[kind] ?? [];
    if (!Array.isArray(pairs)) {
      add(`"${kind}" is not a list`, `"${kind}"`);
      continue;
    }
    const sizes = kind === 'shapes' ? [2, 3] : [2];
    for (const pair of pairs) if (!isTextList(pair) || !sizes.includes(pair.length)) add(`"${kind}" entry ${JSON.stringify(pair)} is not ${kind === 'shapes' ? '[fill, ground] or [fill, ground, edge]' : '[fg, bg]'}`, `"${kind}"`);
  }
  if (data.distinct !== undefined && (!Array.isArray(data.distinct) || !data.distinct.every((list) => isTextList(list) && list.length >= 2))) add('"distinct" must be a list of token lists (two or more tokens each)', '"distinct"');
  if (data.distinctSets !== undefined && !isTextList(data.distinctSets)) add('"distinctSets" must be a list of palette set names', '"distinctSets"');
  if (problems.length > 0) return problems;
  if (!hasPairs(data)) add('declares no text, graphics or shapes pair, so nothing proves the canvas readable');
  if ((data.shapes ?? []).some((shape) => shape.length === 2) && !isText(data.edge)) add('has [fill, ground] shapes but no "edge" token (the outline draw() puts around a filled shape)', '"shapes"');
  return problems;
}

/** Measures one canvas surface: its palettes in every palette set against its own canvas-contrast.json. */
function checkCanvasSurface(dir, ctx) {
  const { root, report, canvasSets, thresholds } = ctx;
  const palettesRel = `${dir}/${CANVAS_PALETTES}`;
  const contrastRel = `${dir}/${CANVAS_CONTRAST}`;
  const name = `canvas ${dir}`;
  const loaded = loadPaletteData(join(root, palettesRel), palettesRel);
  if (loaded.error) {
    report.problem({ file: palettesRel, line: 1, rule: 'palette-shape', message: loaded.error, fix: 'Keep canvas palettes literal JSON: one object per palette set, of #RRGGBB(AA) strings.' });
    return;
  }
  if (!existsSync(join(root, contrastRel))) {
    report.problem({ file: palettesRel, line: 1, rule: 'canvas-contrast', message: `${name} has palettes but no ${CANVAS_CONTRAST}, so nothing proves the canvas readable`, fix: CANVAS_FIX });
    return;
  }
  const contrastText = readFileSync(join(root, contrastRel), 'utf8');
  const at = (needle) => (needle ? lineMatching(contrastText, new RegExp(escapeRegex(needle))) : 1);
  let data;
  try {
    data = JSON.parse(contrastText);
  } catch (error) {
    report.problem({ file: contrastRel, line: 1, rule: 'canvas-contrast', message: `${contrastRel} is not valid JSON (${error.message})`, fix: CANVAS_FIX });
    return;
  }
  const structural = canvasContrastProblems(data);
  for (const { message, needle } of structural) report.problem({ file: contrastRel, line: at(needle), rule: 'canvas-contrast', message: `${CANVAS_CONTRAST} ${message}`, fix: CANVAS_FIX });
  if (structural.length > 0) return;
  const entry = { ...data, name, sets: canvasSets };
  const sets = readSets(entry, loaded.data, { report, label: palettesRel, text: loaded.text, setsSource: `"paletteSets" in contracts/${CANVAS_SURFACES}` });
  if (!sets) return;
  const unknown = unknownTokenProblems(entry, [...sets.values()][0]);
  for (const { pair, message } of unknown) report.problem({ file: contrastRel, line: at(`"${pair[0]}"`), rule: 'canvas-contrast', message: `${CANVAS_CONTRAST} ${message}`, fix: `Name only tokens of ${CANVAS_PALETTES}, and only its palette sets in "distinctSets".` });
  if (unknown.length > 0) return;
  for (const failure of pairFailures(entry, sets, thresholds)) {
    report.problem({ file: palettesRel, line: tokenLine(loaded.text, failure.set, failure.fg), rule: failure.rule, message: `${name} ${failure.message}`, fix: PAIR_FIX[failure.rule] });
  }
  for (const failure of cvdFailures(entry, sets, thresholds.minCvdDistanceOk)) {
    report.problem({ file: palettesRel, line: tokenLine(loaded.text, failure.set, failure.list[0]), rule: 'cvd-separation', message: `${name} ${failure.message}`, fix: 'Choose the list from a colour-blind-safe family (Okabe-Ito) and keep a shape, icon or label on every category.' });
  }
}

/** The contract file: --contract and contrastContract are repo-relative (or absolute), like every other path option. */
function contractPath(root, layout, given) {
  if (given) return isAbsolute(given) ? given : join(root, given);
  const configured = layout.config?.contrastContract;
  return join(root, isText(configured) ? configured : join(layout.contractsDir, 'contrast.json'));
}

/** Every declared pair, distinct list and exception of a valid contract. */
function checkContractPalettes(contract, ctx) {
  const { report, contractLabel, contractText } = ctx;
  const failures = contract.palettes.flatMap((entry) => checkPalette(entry, ctx));
  const exceptions = contract.exceptions ?? [];
  const used = new Set();
  for (const failure of failures) {
    const index = exceptions.findIndex((e) => e.palette === failure.palette && e.set === failure.set && e.fg === failure.fg && e.bg === failure.bg);
    if (index >= 0) {
      used.add(index);
      report.note(`note: ${failure.label} ${failure.palette} ${failure.message} (exception: ${exceptions[index].reason}; approved by ${exceptions[index].approvedBy})`);
      continue;
    }
    report.problem({ file: failure.label, line: failure.line, rule: failure.rule, message: `${failure.palette} ${failure.message}`, fix: PAIR_FIX[failure.rule] });
  }
  exceptions.forEach((exception, index) => {
    if (used.has(index)) return;
    report.problem({ file: contractLabel, line: lineMatching(contractText, /"exceptions"/), rule: 'contrast-contract', message: `exceptions[${index}] (${exception.palette} ${exception.set}: ${exception.fg} on ${exception.bg}) matches no failing pair`, fix: 'Remove the stale exception: the pair passes now.' });
  });
}

/** Reads and checks the contract; returns the palettes it declares, or null when it is unusable. */
function checkContract(contractFile, ctx) {
  const contractText = readFileSync(contractFile, 'utf8');
  const { report, contractLabel } = ctx;
  let contract;
  try {
    // JSON with comments, as design-system-structure reads the same file (write-palette, check-design-system).
    contract = parseJsonc(contractText);
  } catch (error) {
    report.problem({ file: contractLabel, line: 1, rule: 'contrast-contract', message: `${contractLabel} is not valid JSON (${error.message})`, fix: CONTRACT_FIX });
    return null;
  }
  const structural = contractProblems(contract, contractText);
  for (const { message, line } of structural) report.problem({ file: contractLabel, line, rule: 'contrast-contract', message, fix: CONTRACT_FIX });
  if (structural.length > 0) return null;
  checkContractPalettes(contract, { ...ctx, contractText });
  return { count: contract.palettes.length, files: new Set(contract.palettes.map((entry) => repoPath(entry.file))), text: contractText };
}

/** The theme palette and every other colour table under src/ that the contract does not declare; no canvas surface palette declared again. */
function checkCoverage(declared, ctx) {
  const { root, layout, report, contractLabel, surfacePalettes } = ctx;
  for (const file of [...declared.files].filter((rel) => surfacePalettes.has(rel))) {
    report.problem({ file: contractLabel, line: lineMatching(declared.text, new RegExp(`"${escapeRegex(file)}"`)), rule: 'contrast-contract', message: `${contractLabel} declares the canvas surface palette ${file}, whose pairs live in ${posix.join(posix.dirname(file), CANVAS_CONTRAST)}: two pair tables for one palette drift`, fix: `Remove this palette entry and keep the surface's pairs in ${CANVAS_CONTRAST} only (both this checker and skia-canvas-rendering's measure it).` });
  }
  const theme = themePalettes(root, layout);
  for (const file of theme.filter((rel) => !declared.files.has(rel))) {
    report.problem({ file, line: 1, rule: 'contrast-contract', message: `${file} is the theme palette, but no palette in ${contractLabel} declares its pairs, so nothing proves the app's text and controls are readable`, fix: `Add its palette entry (the template's "app" entry: file, export, sets, text, graphics, shapes); design-system-structure's write-palette and check-design-system read the same entry.` });
  }
  for (const { file, colours } of colourTables(root, layout, new Set([...declared.files, ...theme, ...surfacePalettes]))) {
    report.problem({ file, line: 1, rule: 'contrast-contract', message: `${file} looks like a colour table (its name and ${colours} hex colours), but no palette in ${contractLabel} says which of its colours sit on which`, fix: 'Declare it in the contract (references/contrast-and-colour.md): its colour sets, the text, graphics and shapes pairs it paints, and its distinct lists. If it holds no colours the UI paints, rename it.' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const rootArg = positionals[0] ?? '.';
  const root = requireDir(rootArg, 'app repo root');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-contrast', json: options.json });
  const shown = (abs) => toPosix(relative(root, abs)) || abs;
  const contractFile = contractPath(root, layout, options.contract);
  const contractLabel = shown(contractFile);
  const gatesFile = join(root, 'quality-gates.json');
  const hasContract = existsSync(contractFile);
  const isApp = existsSync(join(root, 'package.json'));
  if (!hasContract && !isApp && options.categorical.length === 0) {
    fail(`nothing to check: no ${contractLabel}, no package.json and no --categorical under ${rootArg}`, 'Run from the app repo root, or pass --contract or --categorical.');
  }
  if (options.contract && !hasContract) fail(`contract ${options.contract} does not exist (looked for ${contractFile})`, 'Pass the contract path relative to the repo root (the positional argument), or an absolute path.');

  let checked = 0;
  let thresholds = { ...FLOORS };
  const gatesSkip = notYetCreated(root, { file: 'quality-gates.json', owner: 'quality-gates' });
  if (gatesSkip) report.skip({ file: 'quality-gates.json', rule: 'a11y-gates', message: gatesSkip });
  else {
    thresholds = checkGates(gatesFile, shown(gatesFile), report);
    checked += 1;
  }

  const canvas = canvasContract(root, layout);
  const surfaces = canvasSurfaceDirs(root, layout, canvas.dirs);
  const surfacePalettes = new Set(surfaces.map((dir) => `${dir}/${CANVAS_PALETTES}`));
  const ctx = { root, layout, report, contractLabel, thresholds, canvasSets: canvas.sets, surfacePalettes };
  if (hasContract) {
    const declared = checkContract(contractFile, ctx);
    if (declared !== null) {
      checked += declared.count;
      checkCoverage(declared, ctx);
    }
  } else if (isApp) {
    // --categorical checks extra colours; it never stands in for the app's own pair table.
    report.problem({ file: contractLabel, line: 1, rule: 'contrast-contract', message: `${contractLabel} is missing: the app declares no colour pairs, so nothing proves its text and controls are readable`, fix: 'Copy templates/contracts/contrast.json (and its schema) from the skill and list the pairs your components paint.' });
  }

  for (const dir of surfaces) {
    checked += 1;
    checkCanvasSurface(dir, ctx);
  }
  for (const list of options.categorical) {
    checked += 1;
    checkCategorical(list, thresholds.minCvdDistanceOk, report);
  }
  return report.finish({ checked, unit: 'palettes, canvas surfaces, colour lists and gate files' });
});
