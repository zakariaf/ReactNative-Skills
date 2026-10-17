// determinism-spec.mjs: the checkers' own, independent implementation of the determinism core
// (a helper, not an entry point). Written from the algorithm descriptions in BigInt arithmetic and
// with Date.UTC, so it shares no code and no style with the app's 32-bit integer modules: when the
// app's sfc32.ts, date-key.ts, daily-seed.ts, seeded-draws.ts or fingerprint.ts drift, the two
// disagree. The golden constants were computed a third way (Python integers and datetime); the
// skill's references/seeded-rng-and-seeds.md shows that oracle.

const U32 = 0xffffffffn;
const TWO_32 = 1n << 32n;
const GAMMA = 0x9e3779b9n;
const FNV_BASIS = 0x811c9dc5n;
const FNV_PRIME = 0x01000193n;
const DAY_MS = 86_400_000;

/** The pinned values: a compatibility contract with every installed copy of the app. */
export const GOLDENS = Object.freeze({
  seed1: [1828152527, 3394835397, 2967886022, 2251045104, 4148684523],
  raw1234: [7, 34, 56623200, 188882296, 3431242869],
  textKey: 'tasks:2026-09-26',
  textHash: 2847463752,
  mix1: 1364076727,
  hash73: 2535364964,
  int42: [3, 4, 2, 0, 4, 0, 1, 2],
  unit3: 0.4118875162675977,
  dailySeeds: [
    ['2026-09-26', 17, 2599028541],
    ['2026-09-27', 17, 2582250922],
    ['2027-01-01', 17, 2349681313],
    ['2026-09-26', 0, 2362601272],
    ['2028-02-29', 4242, 773016242],
  ],
  dayNumbers: [
    ['1970-01-01', 0],
    ['2026-09-26', 20722],
    ['2000-03-01', 11017],
    ['1900-01-01', -25567],
    ['2400-12-31', 157419],
  ],
  weekdays: [
    ['1970-01-01', 4],
    ['2026-09-26', 6],
    ['1969-12-28', 7],
    ['2024-02-29', 4],
  ],
  draws42: { one: 'h', shuffle: ['f', 'b', 'd', 'e', 'a', 'c', 'g', 'h'], sample3: ['h', 'a', 'e'] },
  fingerprints: [
    [null, '77074ba4'],
    [-12, 'd7c6e55b'],
    [{ b: 1, a: [2, 3], Z: { y: false } }, 'd8d5639e'],
    [{ key: '2026-09-26', version: 1, itemIds: ['item-01', 'item-02'] }, 'cfb59da0'],
  ],
});

/** What each canonical test must pin as literals: numbers (with or without _ separators) and raw text. */
export const TEST_PINS = Object.freeze({
  'rng/sfc32.test.ts': [...GOLDENS.seed1, GOLDENS.textHash],
  'dates/date-key.test.ts': [20722, 11017, 25567, 157419],
  'dates/daily-seed.test.ts': GOLDENS.dailySeeds.map(([, , seed]) => seed),
  'rng/fingerprint.test.ts': GOLDENS.fingerprints.map(([, hex]) => `'${hex}'`),
  'rng/seeded-draws.test.ts': [`'f', 'b', 'd', 'e', 'a', 'c', 'g', 'h'`, `'h', 'a', 'e'`],
});

/** True when a test text pins one TEST_PINS entry. */
export function hasPin(text, pin) {
  if (typeof pin === 'number') return hasPinnedNumber(text, pin);
  const squeeze = (value) => value.replace(/\s+/g, '').replaceAll('"', "'");
  return squeeze(text).includes(squeeze(pin));
}

export const FINGERPRINT_ALGORITHM = 'fnv1a32/canonical-json-v1';

/**
 * The Math members seeded code may use: the same list as the ESLint DETERMINISTIC block (one list in
 * both places). Math.random is reported as ambient-random, not here.
 */
export const ALLOWED_MATH = Object.freeze(['sqrt', 'imul', 'floor', 'round', 'abs', 'min', 'max', 'PI']);

/**
 * The Math functions ECMA-262 leaves "implementation-approximated" (V8 ships its own, Hermes calls the
 * platform's C library). Number::exponentiate (`**`) is approximated too; an operator cannot be
 * trapped at runtime, so only the text scan sees it.
 */
export const APPROXIMATED_MATH = Object.freeze([
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cbrt', 'cos', 'cosh', 'exp', 'expm1',
  'hypot', 'log', 'log1p', 'log10', 'log2', 'pow', 'sin', 'sinh', 'tan', 'tanh',
]);

/** Exactly specified Math members outside the allow-list, with a rewrite that stays on it. */
export const EXACT_MATH_REWRITES = Object.freeze({
  ceil: '-Math.floor(-x)',
  trunc: 'x < 0 ? -Math.floor(-x) : Math.floor(x)',
  sign: 'x > 0 ? 1 : x < 0 ? -1 : 0',
  fround: 'integers (freeze the value with Math.round(x * 1000))',
  clz32: 'a shift loop over the 32 bits',
  E: 'a numeric literal',
  LN2: 'a numeric literal',
  LN10: 'a numeric literal',
  LOG2E: 'a numeric literal',
  LOG10E: 'a numeric literal',
  SQRT2: 'Math.sqrt(2)',
  SQRT1_2: 'Math.sqrt(0.5)',
});

const u32 = (value) => value & U32;

/** FNV-1a 32 over UTF-16 code units (a Number). */
export function fnv1a32(text, basis = FNV_BASIS) {
  let hash = basis;
  for (let index = 0; index < text.length; index += 1) hash = u32((hash ^ BigInt(text.charCodeAt(index))) * FNV_PRIME);
  return Number(hash);
}

export const specHashSeed = (text) => fnv1a32(text);
export const specDailySeed = (key, salt) => fnv1a32(key, FNV_BASIS ^ BigInt.asUintN(32, BigInt(salt)));

function fmix32(value) {
  let z = u32(value);
  z = u32((z ^ (z >> 16n)) * 0x85ebca6bn);
  z = u32((z ^ (z >> 13n)) * 0xc2b2ae35n);
  return z ^ (z >> 16n);
}

export const specMix32 = (value) => Number(fmix32(BigInt.asIntN(32, BigInt(value))));
export const specHashU32 = (a, b) => Number(fmix32(BigInt.asIntN(32, BigInt(a)) ^ BigInt.asIntN(32, BigInt.asIntN(32, BigInt(b)) * GAMMA)));

/** One sfc32 step on Number state words: { value, state }. */
export function specNextU32(state) {
  const [a, b, c, d] = state.map((word) => BigInt(word));
  const out = u32(a + b + d);
  const rotated = u32(c << 21n) | (c >> 11n);
  const next = [b ^ (b >> 9n), u32(c + (c << 3n)), u32(rotated + out), u32(d + 1n)];
  return { value: Number(out), state: next.map((word) => Number(word)) };
}

export function specSeedRng(seed) {
  const signed = BigInt.asIntN(32, BigInt(Math.trunc(seed)));
  let state = [1n, 2n, 3n, 4n].map((k) => Number(fmix32(signed + k * GAMMA)));
  for (let i = 0; i < 12; i += 1) state = specNextU32(state).state;
  return state;
}

export function specNextInt(state, maxExclusive) {
  const n = BigInt(maxExclusive);
  const limit = TWO_32 - (TWO_32 % n);
  let draw = specNextU32(state);
  while (BigInt(draw.value) >= limit) draw = specNextU32(draw.state);
  return { value: Number(BigInt(draw.value) % n), state: draw.state };
}

export function specDraws(state, count) {
  const values = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = specNextU32(current);
    values.push(draw.value);
    current = draw.state;
  }
  return values;
}

export function specDrawOne(items, state) {
  const draw = specNextInt(state, items.length);
  return { value: items[draw.value], state: draw.state };
}

export function specShuffle(items, state) {
  const out = [...items];
  let current = state;
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const draw = specNextInt(current, i + 1);
    [out[i], out[draw.value]] = [out[draw.value], out[i]];
    current = draw.state;
  }
  return { value: out, state: current };
}

export function specDrawSample(items, count, state) {
  const out = [...items];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = specNextInt(current, out.length - i);
    [out[i], out[i + draw.value]] = [out[i + draw.value], out[i]];
    current = draw.state;
  }
  return { value: out.slice(0, count), state: current };
}

/** Days since 1970-01-01 by the platform's own calendar (Date.UTC), or NaN. */
export function specDayNumber(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return Number.NaN;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round(date.getTime() / DAY_MS);
}

export function specFromDayNumber(days) {
  const date = new Date(days * DAY_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export const isSpecDateKey = (key) => typeof key === 'string' && !Number.isNaN(specDayNumber(key)) && specFromDayNumber(specDayNumber(key)) === key;
export const specAddDays = (key, days) => specFromDayNumber(specDayNumber(key) + days);
export const specIsoWeekday = (key) => ((((specDayNumber(key) + 3) % 7) + 7) % 7) + 1;

/** The canonical JSON of the fingerprint spec; throws a TypeError for anything outside it. */
export function specCanonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError(`${value} is not a safe integer`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => specCanonicalJson(item)).join(',')}]`;
  const proto = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (proto === Object.prototype || proto === null) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) => {
      if (value[key] === undefined) throw new TypeError(`"${key}" is undefined`);
      return `${JSON.stringify(key)}:${specCanonicalJson(value[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`unsupported ${typeof value} value`);
}

export const specFingerprint = (value) => fnv1a32(specCanonicalJson(value)).toString(16).padStart(8, '0');

/** "2_599_028_541" and "2599028541" both count as the number. */
export function hasPinnedNumber(text, value) {
  const digits = String(value);
  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '_');
  const pattern = new RegExp(`(?<![\\d_])(?:${digits}|${withSeparators})(?![\\d_])`);
  return pattern.test(text);
}
