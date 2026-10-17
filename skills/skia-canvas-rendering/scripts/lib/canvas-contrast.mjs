// canvas-contrast.mjs: reads a surface's canvas-contrast.json and measures its pairs in every palette
// set of canvas-palettes.json: WCAG 2.2 contrast (1.4.3 text, 1.4.11 non-text) and colour-vision-
// deficiency separation (Machado 2009 at severity 1.0, distance in OKLab). The formulas, thresholds and
// pair semantics are accessibility-as-code's: its check-contrast measures the same two files (its
// canvas-contrast rule), so both checkers agree on every pair. Not an entry point.

/** The keys of canvas-contrast.json (format 1). A key outside this list is refused: a misspelt key turns its checks off. */
export const CONTRAST_KEYS = ['$comment', 'base', 'edge', 'text', 'graphics', 'shapes', 'distinct', 'distinctSets'];
/** WCAG floors; quality-gates.json "a11y" may raise them, never lower them. */
export const CONTRAST_FLOORS = { textContrastMin: 4.5, nonTextContrastMin: 3, minCvdDistanceOk: 0.07 };
export const DEFICIENCIES = ['protanopia', 'deuteranopia', 'tritanopia'];

const HEX = /^#[0-9a-f]{6}$/i;
const HEX_ALPHA = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

function parseHex(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return { r: parseInt(match[1], 16) / 255, g: parseInt(match[2], 16) / 255, b: parseInt(match[3], 16) / 255 };
}

/** sRGB transfer function, WCAG 2.2 definition (threshold 0.04045). */
const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio of two opaque colours, 1..21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** #RRGGBBAA (or #RRGGBB) drawn over an opaque #RRGGBB ground, as the opaque colour the eye sees. */
export function composite(hex, ground) {
  const match = HEX_ALPHA.exec(String(hex));
  if (!match) throw new Error(`Not a #RRGGBB(AA) colour: ${hex}`);
  if (match[2] === undefined) return `#${match[1]}`;
  const alpha = parseInt(match[2], 16) / 255;
  const fg = parseHex(`#${match[1]}`);
  const bg = parseHex(ground);
  const channel = (a, b) => Math.round((a * alpha + b * (1 - alpha)) * 255).toString(16).padStart(2, '0');
  return `#${channel(fg.r, bg.r)}${channel(fg.g, bg.g)}${channel(fg.b, bg.b)}`;
}

/** Machado, Oliveira & Fernandes (2009), severity 1.0, on linear RGB. */
const MACHADO = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const LINEAR_TO_LMS = [0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005];
const LMS_TO_OKLAB = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766];
const multiply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const clamp01 = (v) => v.map((c) => Math.min(1, Math.max(0, c)));

function simulatedOklab(hex, deficiency) {
  const { r, g, b } = parseHex(hex);
  const seen = clamp01(multiply(MACHADO[deficiency], [toLinear(r), toLinear(g), toLinear(b)]));
  const [l, m, s] = multiply(LINEAR_TO_LMS, seen);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]);
}

/** Smallest OKLab distance between any two colours as seen with the deficiency (0.02 is about one JND), and their indices. */
export function minPairwiseDistance(colors, deficiency) {
  const points = colors.map((hex) => simulatedOklab(hex, deficiency));
  let best = { distance: Number.POSITIVE_INFINITY, pair: null };
  points.forEach((a, i) => {
    points.slice(i + 1).forEach((b, k) => {
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (distance < best.distance) best = { distance, pair: [i, i + 1 + k] };
    });
  });
  return best;
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTextList = (value) => Array.isArray(value) && value.every(isText);
const PAIR_LISTS = ['text', 'graphics', 'shapes'];

/**
 * Structural problems of a parsed canvas-contrast.json against the palette's token names and sets:
 * [{ message, needle }] (needle: a string to find the line by). [] when the file can be measured.
 */
export function contrastFileProblems(data, tokens, sets) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [{ message: 'is not a JSON object', needle: null }];
  const problems = [];
  const add = (message, needle = null) => problems.push({ message, needle });
  for (const key of Object.keys(data)) if (!CONTRAST_KEYS.includes(key)) add(`has the unknown key "${key}" (format 1 keys: ${CONTRAST_KEYS.join(', ')}); a misspelt key turns its checks off`, `"${key}"`);
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
  if (!PAIR_LISTS.some((kind) => (data[kind] ?? []).length > 0)) add('declares no text, graphics or shapes pair, so nothing proves the canvas readable');
  if ((data.shapes ?? []).some((shape) => shape.length === 2) && !isText(data.edge)) add('has [fill, ground] shapes but no "edge" token (the outline draw() puts around a filled shape)', '"shapes"');
  const known = (name) => tokens.includes(name);
  for (const kind of PAIR_LISTS) for (const pair of data[kind] ?? []) for (const name of pair) if (!known(name)) add(`"${kind}" entry ${JSON.stringify(pair)} names "${name}", which canvas-palettes.json does not have`, `"${name}"`);
  for (const list of data.distinct ?? []) for (const name of list) if (!known(name)) add(`"distinct" list ${JSON.stringify(list)} names "${name}", which canvas-palettes.json does not have`, `"${name}"`);
  for (const key of ['base', 'edge']) if (data[key] !== undefined && !known(data[key])) add(`"${key}" token "${data[key]}" is not in canvas-palettes.json`, `"${key}"`);
  if (data.base === undefined && !known('background')) add('names no "base" token and canvas-palettes.json has no "background" (translucent grounds are composited over it)');
  for (const set of data.distinctSets ?? []) if (!sets.includes(set)) add(`"distinctSets" names "${set}", which is not one of the palette sets (${sets.join(', ')})`, `"${set}"`);
  return problems;
}

/**
 * Every failing pair of a valid contrast file in a valid palette: [{ rule, set, pair, message }].
 * Translucent tokens are composited over their ground, and a translucent ground over the base token.
 */
export function contrastFailures(data, palettes, sets, thresholds) {
  const failures = [];
  const base = data.base ?? 'background';
  for (const set of sets) {
    const tokens = palettes[set];
    if (!HEX.test(tokens[base])) {
      failures.push({ rule: 'contrast-file', set, pair: [base], message: `${set}: the base token "${base}" is ${tokens[base]}, not an opaque #RRGGBB (every translucent ground is composited over it)` });
      continue;
    }
    const solid = (name, ground = tokens[base]) => composite(tokens[name], ground);
    for (const [kind, rule, min] of [['text', 'text-contrast', thresholds.textContrastMin], ['graphics', 'non-text-contrast', thresholds.nonTextContrastMin]]) {
      for (const pair of data[kind] ?? []) {
        const ground = solid(pair[1]);
        const ratio = contrastRatio(solid(pair[0], ground), ground);
        if (ratio < min) failures.push({ rule, set, pair, message: `${set}: ${kind} ${pair[0]} on ${pair[1]} is ${ratio.toFixed(2)}:1, below ${min}:1 (WCAG 2.2 ${kind === 'text' ? '1.4.3' : '1.4.11'})` });
      }
    }
    for (const pair of data.shapes ?? []) {
      const [fill, groundName, edgeName = data.edge] = pair;
      const ground = solid(groundName);
      const shape = solid(fill, ground);
      const best = Math.max(contrastRatio(solid(edgeName, shape), shape), contrastRatio(shape, ground));
      const min = thresholds.nonTextContrastMin;
      if (best < min) failures.push({ rule: 'shape-contrast', set, pair, message: `${set}: shape ${fill} on ${groundName} stands ${best.toFixed(2)}:1 off its edge ${edgeName} and its ground, below ${min}:1 (WCAG 2.2 1.4.11)` });
    }
  }
  for (const set of data.distinctSets ?? sets) {
    const tokens = palettes[set];
    if (tokens === undefined || !HEX.test(tokens[base] ?? '')) continue;
    for (const list of data.distinct ?? []) {
      const colors = list.map((name) => composite(tokens[name], tokens[base]));
      for (const deficiency of DEFICIENCIES) {
        const { distance, pair } = minPairwiseDistance(colors, deficiency);
        if (distance < thresholds.minCvdDistanceOk) {
          const names = pair.map((index) => list[index]);
          failures.push({ rule: 'cvd-separation', set, pair: list, message: `${set} ${deficiency}: ${names.join(' and ')} are ${distance.toFixed(3)} apart in OKLab, below ${thresholds.minCvdDistanceOk}` });
        }
      }
    }
  }
  return failures;
}

/** The thresholds: the WCAG floors, raised (never lowered) by numbers in quality-gates.json "a11y". */
export function contrastThresholds(gatesText) {
  let gates = {};
  try {
    gates = gatesText === null ? {} : JSON.parse(gatesText)?.a11y ?? {};
  } catch {
    gates = {};
  }
  return Object.fromEntries(Object.entries(CONTRAST_FLOORS).map(([key, floor]) => [key, typeof gates?.[key] === 'number' ? Math.max(gates[key], floor) : floor]));
}
