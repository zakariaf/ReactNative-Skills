#!/usr/bin/env node
// check-determinism.mjs: proves the app's determinism core still computes the frozen values, and
// that no code on a seeded path reads a clock, ambient randomness, a second PRNG, inexact maths or
// the locale. The canonical modules (src/core/rng/sfc32.ts, seeded-draws.ts, fingerprint.ts,
// src/core/dates/date-key.ts, daily-seed.ts) are imported and run against an independent BigInt /
// Date.UTC implementation and the pinned goldens; the seeded paths, and every local file they import
// (directly or through other files), are scanned as text.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, isRepoScanIgnored, lineOf, maskComments, matchGlob, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { enableAppImports, errorText, lineOfExport } from './lib/app-modules.mjs';
import * as spec from './lib/determinism-spec.mjs';
import { enclosingWorkspaceRoot, moduleSpecifiers, packageNameOf, reachableFiles, workspacePackageResolver } from './lib/module-graph.mjs';
import { findClosing, hasWorkletDirective, isTestFile, maskCode } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-determinism',
  summary: 'Runs the app\'s determinism core (sfc32, seeded draws, fingerprint, date keys, daily seed) against an independent implementation and the pinned goldens, checks that the canonical tests pin those goldens, and scans every seeded path, and every local file a seeded path imports, for wall-clock reads, ambient randomness, a second PRNG, inexact maths, locale-dependent calls and unmixed seeds.',
  usage: '[repo-root] [options]',
  options: {
    'core-dir': { type: 'string', value: 'dir', help: 'The pure core folder holding rng/ and dates/ (default: src/core from resolveLayout)' },
    contract: { type: 'string', value: 'file', help: 'The generators contract (default: contracts/seeded-generators.json); its "paths" and each generator module are scanned too, relative to the repo root' },
    path: { type: 'string', multiple: true, value: 'glob', help: 'Another repo-relative glob of seeded code to scan (repeatable)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: rng-golden, draws-golden, fingerprint-golden, date-key-golden, daily-seed-golden, golden-pins,',
    'wall-clock, ambient-random, foreign-prng, inexact-math, locale-dependent, unmixed-seed, contract-paths.',
    'Seeded paths: <core>/rng/**, <core>/dates/**, <src>/games/*/{rules,levels,sim,geom}/**, the contract\'s',
    '"paths" and generator modules, every --path glob, and every local file a seeded file imports through',
    'value imports, import() or require(), at any depth (relative, tsconfig paths, workspace packages, and,',
    'when the root is one app of a workspaces repo, that repo\'s other packages; never node_modules; the',
    'import chain is printed). Test files on the seeded paths are scanned for',
    'wall-clock and ambient-random only, and may build fixed instants with Date.UTC or new Date(<arguments>).',
    'Run once per app, with the app folder as the root (contract paths are relative to it); a contract',
    'module or "paths" glob that matches nothing there is a contract-paths problem. Nothing seeded found at',
    'all is exit 2.',
  ].join('\n'),
};

const CODE_FILES = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const ALLOWED_MATH = new Set(spec.ALLOWED_MATH);
const APPROXIMATED_MATH = new Set(spec.APPROXIMATED_MATH);
// Matched by package name, so subpaths count too ('uuid/v4', 'nanoid/non-secure').
const RANDOM_PACKAGES = new Set(['expo-crypto', 'expo-random', 'uuid', 'nanoid', 'react-native-get-random-values', 'react-native-uuid', 'react-native-quick-crypto', 'react-native-randombytes', 'crypto', 'node:crypto']);
const PRNG_PACKAGES = new Set(['seedrandom', 'pure-rand', 'random-js', 'chance', '@faker-js/faker', 'alea', 'prando', 'mersenne-twister', 'random-seed', 'fast-check']);
// Platform randomness on any object named *crypto (crypto, QuickCrypto, Crypto from expo-crypto) ...
const RANDOM_METHODS = 'getRandomValues|getRandomBytes|getRandomBytesAsync|randomUUID|randomBytes|randomInt|randomFill|randomFillSync';
// ... and as bare calls after a named import. Names an app may give its own seeded helpers (randomInt)
// are left to the import check.
const RANDOM_CALLS = 'getRandomValues|getRandomBytes|getRandomBytesAsync|randomUUID';

const FIX = {
  'rng-golden': 'Restore src/core/rng/sfc32.ts from the skill template verbatim: its sequence is a compatibility contract. A different algorithm is a new module under a new name, behind a generator version.',
  'draws-golden': 'Restore src/core/rng/seeded-draws.ts from the template: the draw order and draw count are part of every generator\'s output.',
  'fingerprint-golden': 'Restore src/core/rng/fingerprint.ts from the template: every vectors file was fingerprinted with this exact spec.',
  'date-key-golden': 'Restore src/core/dates/date-key.ts from the template (integer civil-date arithmetic, no Date).',
  'daily-seed-golden': 'Restore src/core/dates/daily-seed.ts from the template: changing it changes every day-keyed output on every installed copy.',
  'golden-pins': 'Pin the golden values as literals in the test (copy the template test); never compute an expected value with the module under test.',
  'wall-clock': 'Take the key (a DateKey from ClockPort.today() at the edge) as an argument; seeded code never reads a clock.',
  'ambient-random': 'Draw from the seeded RNG you were given (src/core/rng/sfc32.ts, seeded-draws.ts); never platform randomness.',
  'foreign-prng': 'Use the app\'s one PRNG (src/core/rng/sfc32.ts): a library PRNG has no frozen cross-version sequence.',
  'inexact-math': 'Use only + - * / % bitwise, Math.sqrt/imul/floor/round/abs/min/max/PI; multiply instead of **, use integer tables instead of sin/cos/exp/log/pow.',
  'inexact-math-exact': 'Rewrite it with the allowed operations, or add the member to this checker\'s allow-list and the ESLint DETERMINISTIC block together (one list in both places).',
  'locale-dependent': 'Compare with < on a fixed key and keep Intl/toLocale* at the edge (src/i18n): Hermes uses each platform\'s own locale data.',
  'unmixed-seed': 'Pass the seed to seedRng() and draw (nextInt, drawOne, drawSample); a raw FNV seed changes by a near-constant step between neighbouring keys.',
  'contract-paths': 'Point each generator "module" and each "paths" glob at code that exists, relative to the app folder that holds contracts/; run the checker once per app, with that folder as the root.',
};

// ---------------------------------------------------------------------------------------------
// Runtime checks of the canonical modules
// ---------------------------------------------------------------------------------------------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

function missingExports(mod, names) {
  return names.filter((name) => typeof mod[name] !== 'function').map((name) => ({ fn: name, message: `does not export the function ${name}` }));
}

function appDraws(mod, state, count) {
  const values = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = mod.nextU32(current);
    values.push(draw.value);
    current = draw.state;
  }
  return values;
}

function rngFindings(mod, source) {
  const missing = missingExports(mod, ['mix32', 'hashU32', 'nextU32', 'seedRng', 'nextInt', 'nextUnit', 'hashSeed']);
  if (missing.length > 0) return missing;
  const out = [];
  const add = (fn, message) => out.push({ fn, message });
  if (!same(appDraws(mod, [1, 2, 3, 4], 50), spec.specDraws([1, 2, 3, 4], 50))) add('nextU32', 'nextU32 does not match the PractRand sfc32 reference (50 draws from [1, 2, 3, 4])');
  const seeded = appDraws(mod, mod.seedRng(1), 5);
  if (!same(seeded, spec.GOLDENS.seed1)) add('seedRng', `seedRng(1) draws ${seeded.join(', ')}; the golden sequence is ${spec.GOLDENS.seed1.join(', ')}`);
  for (const seed of [0, -1, 2 ** 31, 123456789, 0xffffffff]) {
    if (!same(mod.seedRng(seed), spec.specSeedRng(seed))) add('seedRng', `seedRng(${seed}) differs from the reference seeding (4 mixed words, 12 warm-up draws)`);
  }
  for (const text of [spec.GOLDENS.textKey, '', 'a', 'é ✓ tasks']) {
    if (mod.hashSeed(text) !== spec.specHashSeed(text)) add('hashSeed', `hashSeed(${JSON.stringify(text)}) is ${mod.hashSeed(text)}; FNV-1a gives ${spec.specHashSeed(text)}`);
  }
  if (mod.mix32(1) !== spec.GOLDENS.mix1 || mod.mix32(-7) !== spec.specMix32(-7)) add('mix32', 'mix32 is not the murmur3 finaliser');
  if (mod.hashU32(7, 3) !== spec.GOLDENS.hash73 || mod.hashU32(-5, 99) !== spec.specHashU32(-5, 99)) add('hashU32', 'hashU32(a, b) is not mix32(a ^ imul(b, 0x9e3779b9))');
  let state = mod.seedRng(42);
  const ints = [];
  for (let i = 0; i < 8; i += 1) {
    const draw = mod.nextInt(state, 6);
    ints.push(draw.value);
    state = draw.state;
  }
  if (!same(ints, spec.GOLDENS.int42)) add('nextInt', `nextInt(…, 6) from seedRng(42) draws ${ints.join(', ')}; the golden values are ${spec.GOLDENS.int42.join(', ')}`);
  for (const max of [1, 3, 7, 1000, 2 ** 31 + 1, 2 ** 32]) {
    const start = mod.seedRng(max);
    if (!same(mod.nextInt(start, max), spec.specNextInt(start, max))) add('nextInt', `nextInt(state, ${max}) is not unbiased rejection sampling`);
  }
  if (!same(mod.nextInt([0xffffffff, 0, 0, 0], 3), spec.specNextInt([0xffffffff, 0, 0, 0], 3))) add('nextInt', 'nextInt does not redraw the biased top of the range');
  if (mod.nextUnit(mod.seedRng(3)).value !== spec.GOLDENS.unit3) add('nextUnit', `nextUnit(seedRng(3)) is not ${spec.GOLDENS.unit3} (value / 2^32)`);
  if (!hasWorkletDirective(source)) add('nextU32', "sfc32.ts lost its file-level 'worklet' directive (callers on the UI thread crash at runtime)");
  return out;
}

function drawsFindings(mod) {
  const missing = missingExports(mod, ['drawOne', 'shuffle', 'drawSample']);
  if (missing.length > 0) return missing;
  const out = [];
  const letters = [...'abcdefgh'];
  const g = spec.GOLDENS.draws42;
  const start = spec.specSeedRng(42);
  if (mod.drawOne(letters, start).value !== g.one) out.push({ fn: 'drawOne', message: `drawOne from seedRng(42) is not '${g.one}'` });
  if (!same(mod.shuffle(letters, start).value, g.shuffle)) out.push({ fn: 'shuffle', message: `shuffle from seedRng(42) is not ${g.shuffle.join('')}` });
  if (!same(mod.drawSample(letters, 3, start).value, g.sample3)) out.push({ fn: 'drawSample', message: `drawSample(3) from seedRng(42) is not ${g.sample3.join('')}` });
  for (const seed of [1, 7, 99]) {
    for (let n = 1; n <= 12; n += 1) {
      const items = letters.concat(letters).slice(0, n);
      const state = spec.specSeedRng(seed * 31 + n);
      const count = `${n} item${n === 1 ? '' : 's'}`;
      if (!same(mod.shuffle(items, state), spec.specShuffle(items, state))) out.push({ fn: 'shuffle', message: `shuffle of ${count} consumes or orders draws differently from the spec (n - 1 draws, from the end)` });
      if (!same(mod.drawSample(items, n, state), spec.specDrawSample(items, n, state))) out.push({ fn: 'drawSample', message: `drawSample(${n}) of ${count} differs from the spec (count draws, from the front)` });
      if (!same(mod.drawOne(items, state), spec.specDrawOne(items, state))) out.push({ fn: 'drawOne', message: `drawOne of ${count} differs from the spec (one draw)` });
    }
  }
  return out.filter((entry, index) => out.findIndex((other) => other.message === entry.message) === index);
}

function fingerprintFindings(mod) {
  const missing = missingExports(mod, ['canonicalJson', 'fingerprint']);
  if (missing.length > 0) return missing;
  const out = [];
  if (mod.FINGERPRINT_ALGORITHM !== spec.FINGERPRINT_ALGORITHM) out.push({ fn: 'FINGERPRINT_ALGORITHM', message: `FINGERPRINT_ALGORITHM is ${JSON.stringify(mod.FINGERPRINT_ALGORITHM)}, not "${spec.FINGERPRINT_ALGORITHM}"` });
  for (const [value, hex] of spec.GOLDENS.fingerprints) {
    let got;
    try {
      got = mod.fingerprint(value);
    } catch (error) {
      got = errorText(error);
    }
    if (got !== hex) out.push({ fn: 'fingerprint', message: `fingerprint(${JSON.stringify(value)}) is ${got}; the golden value is ${hex}` });
  }
  const reordered = { version: 2, key: 'k', nested: { z: [1, { b: true, a: null }], a: 'x' } };
  if (!throws(() => mod.canonicalJson(reordered)) && mod.canonicalJson(reordered) !== spec.specCanonicalJson(reordered)) out.push({ fn: 'canonicalJson', message: 'canonicalJson does not sort object keys by UTF-16 code units' });
  for (const [label, value] of [['0.5', 0.5], ['-0', -0], ['NaN', Number.NaN], ['an undefined property', { a: undefined }], ['a Map', new Map()]]) {
    if (!throws(() => mod.canonicalJson(value))) out.push({ fn: 'canonicalJson', message: `canonicalJson accepts ${label}; the spec rejects it (freeze floats to integers first)` });
  }
  return out;
}

function dateKeyFindings(mod) {
  const missing = missingExports(mod, ['dayNumber', 'fromDayNumber', 'addDays', 'isoWeekday', 'daysBetween']);
  if (missing.length > 0) return missing;
  const out = [];
  for (const [key, days] of spec.GOLDENS.dayNumbers) {
    if (mod.dayNumber(key) !== days) out.push({ fn: 'dayNumber', message: `dayNumber('${key}') is ${mod.dayNumber(key)}, not ${days}` });
  }
  for (const [key, weekday] of spec.GOLDENS.weekdays) {
    if (mod.isoWeekday(key) !== weekday) out.push({ fn: 'isoWeekday', message: `isoWeekday('${key}') is ${mod.isoWeekday(key)}, not ${weekday}` });
  }
  for (const [key, plus, want] of [['2026-12-31', 1, '2027-01-01'], ['2028-02-28', 1, '2028-02-29'], ['2100-02-28', 1, '2100-03-01'], ['2000-02-28', 1, '2000-02-29']]) {
    if (mod.addDays(key, plus) !== want) out.push({ fn: 'addDays', message: `addDays('${key}', ${plus}) is ${mod.addDays(key, plus)}, not ${want}` });
  }
  for (const bad of ['2026-9-26', '2026-09-26T00:00:00Z', 'x2026-09-26']) {
    if (!Number.isNaN(mod.dayNumber(bad))) out.push({ fn: 'dayNumber', message: `dayNumber('${bad}') is not NaN` });
  }
  for (let days = -25567; days <= 157419; days += 37) {
    const key = spec.specFromDayNumber(days);
    if (mod.fromDayNumber(days) !== key || mod.dayNumber(key) !== days) {
      out.push({ fn: 'fromDayNumber', message: `day ${days} is ${mod.fromDayNumber(days)} in the app and ${key} by Date.UTC` });
      break;
    }
  }
  if (typeof mod.isDateKey === 'function' && (mod.isDateKey('2026-02-29') || !mod.isDateKey('2028-02-29'))) out.push({ fn: 'isDateKey', message: 'isDateKey does not accept exactly the real calendar days' });
  return out;
}

function dailySeedFindings(mod) {
  const missing = missingExports(mod, ['dailySeed']);
  if (missing.length > 0) return missing;
  const out = [];
  for (const [key, salt, seed] of spec.GOLDENS.dailySeeds) {
    if (mod.dailySeed(key, salt) !== seed) out.push({ fn: 'dailySeed', message: `dailySeed('${key}', ${salt}) is ${mod.dailySeed(key, salt)}; the golden value is ${seed}` });
  }
  for (const salt of [1, 0xffff, 0x7fffffff, 0xffffffff, -1]) {
    let key = '2026-01-01';
    for (let i = 0; i < 40; i += 1, key = spec.specAddDays(key, 1)) {
      if (mod.dailySeed(key, salt) !== spec.specDailySeed(key, salt)) {
        out.push({ fn: 'dailySeed', message: `dailySeed('${key}', ${salt}) differs from FNV-1a with the salt in the offset basis` });
        return out;
      }
    }
  }
  return out;
}

const CANONICAL = [
  { rel: 'rng/sfc32.ts', rule: 'rng-golden', findings: rngFindings },
  { rel: 'rng/seeded-draws.ts', rule: 'draws-golden', findings: drawsFindings },
  { rel: 'rng/fingerprint.ts', rule: 'fingerprint-golden', findings: fingerprintFindings },
  { rel: 'dates/date-key.ts', rule: 'date-key-golden', findings: dateKeyFindings },
  { rel: 'dates/daily-seed.ts', rule: 'daily-seed-golden', findings: dailySeedFindings },
];

/** One problem per function: the first failure, and how many more checks of it failed. */
function collapse(findings) {
  const byFn = new Map();
  for (const entry of findings) {
    const group = byFn.get(entry.fn) ?? { ...entry, more: 0 };
    if (byFn.has(entry.fn)) group.more += 1;
    byFn.set(entry.fn, group);
  }
  return [...byFn.values()].map(({ fn, message, more }) => ({ fn, message: more > 0 ? `${message} (and ${more} more ${fn} check${more > 1 ? 's' : ''})` : message }));
}

async function checkCanonical(root, layout, report) {
  const present = CANONICAL.filter((entry) => existsSync(join(root, layout.coreDir, entry.rel)));
  if (present.length === 0) return [];
  const app = enableAppImports(root);
  let rngBroken = false;
  for (const entry of present) {
    const file = posix.join(layout.coreDir, entry.rel);
    if (entry.rule === 'draws-golden' && rngBroken) {
      report.note(`${file}: draw checks skipped until sfc32.ts passes rng-golden (the draws are built on it)`);
      checkPins(root, file, entry.rel, report);
      continue;
    }
    const source = readFileSync(join(root, file), 'utf8');
    let mod;
    try {
      mod = await app.load(file);
    } catch (error) {
      report.problem({ file, line: 1, rule: entry.rule, message: `cannot be loaded in plain Node: ${errorText(error)}`, fix: FIX[entry.rule] });
      if (entry.rule === 'rng-golden') rngBroken = true;
      continue;
    }
    let findings;
    try {
      findings = entry.findings(mod, source);
    } catch (error) {
      findings = [{ fn: '', message: `threw while running the golden checks: ${errorText(error)}` }];
    }
    if (entry.rule === 'rng-golden' && findings.length > 0) rngBroken = true;
    for (const { fn, message } of collapse(findings)) report.problem({ file, line: fn ? lineOfExport(source, fn) : 1, rule: entry.rule, message, fix: FIX[entry.rule] });
    checkPins(root, file, entry.rel, report);
  }
  return present.map((entry) => posix.join(layout.coreDir, entry.rel));
}

function checkPins(root, file, rel, report) {
  const testFile = file.replace(/\.ts$/, '.test.ts');
  const pins = spec.TEST_PINS[rel.replace(/\.ts$/, '.test.ts')] ?? [];
  if (!existsSync(join(root, testFile))) {
    report.problem({ file: testFile, line: 1, rule: 'golden-pins', message: `${file} has no test, so nothing in CI pins its golden values`, fix: FIX['golden-pins'] });
    return;
  }
  // A value that survives only in a comment pins nothing: `const GOLDEN = hashSeed(...); // 2847463752`.
  const code = maskComments(readFileSync(join(root, testFile), 'utf8'));
  const missing = pins.filter((pin) => !spec.hasPin(code, pin));
  if (missing.length > 0) report.problem({ file: testFile, line: 1, rule: 'golden-pins', message: `the test does not pin the golden values ${missing.join(', ')} as literals in code (a value in a comment pins nothing)`, fix: FIX['golden-pins'] });
}

// ---------------------------------------------------------------------------------------------
// Text scans of the seeded paths
// ---------------------------------------------------------------------------------------------

/** The message for a Math member outside the allow-list (Math.random is ambient-random, reported apart). */
function mathFinding(name) {
  if (APPROXIMATED_MATH.has(name)) return { message: `Math.${name} is implementation-approximated (it differs between engines and C maths libraries)`, fix: FIX['inexact-math'] };
  const rewrite = spec.EXACT_MATH_REWRITES[name];
  if (rewrite !== undefined) return { message: `Math.${name} is exactly specified but outside the shared allow-list (the ESLint DETERMINISTIC block uses the same list): use ${rewrite}, or add it to both lists`, fix: FIX['inexact-math-exact'] };
  return { message: `Math.${name} is outside the shared allow-list (${spec.ALLOWED_MATH.join(', ')})`, fix: FIX['inexact-math'] };
}

const verbOf = (kind) => (kind === 'require' ? 'requires' : kind === 'dynamic' ? 'imports (with import())' : 'imports');

/**
 * Scans one file with the seeded rules. `chain` is set for a file that is not a seeded path itself but
 * is imported by one: [seeded start, ..., file]; every message then names how it was reached.
 */
function scanFile(file, source, report, chain = null) {
  const masked = maskCode(source);
  const isTest = isTestFile(file);
  const via = chain === null ? '' : ` (reached from ${chain[0]} via ${chain.slice(1).join(' -> ')})`;
  const hit = (index, rule, message, fix = FIX[rule]) => report.problem({ file, line: lineOf(source, index), rule, message: `${message}${via}`, fix });
  const each = (re, rule, message) => {
    for (const match of masked.matchAll(re)) hit(match.index, rule, typeof message === 'function' ? message(match) : message);
  };
  // Test files may build fixed instants (Date.UTC, new Date(<arguments>)) to compare with: they read
  // no clock (and Jest pins TZ=UTC). Date.now, Date.parse, a bare new Date or Date() stay banned there.
  for (const match of masked.matchAll(/(?<![\w$.])Date\s*\.\s*(now|parse|UTC)\b/g)) if (!(isTest && match[1] === 'UTC')) hit(match.index, 'wall-clock', `Date.${match[1]} on a seeded path`);
  for (const match of masked.matchAll(/\bnew\s+Date\b/g)) if (!(isTest && hasArguments(masked, match.index + match[0].length))) hit(match.index, 'wall-clock', isTest ? 'new Date without arguments reads the clock' : 'new Date on a seeded path');
  for (const match of masked.matchAll(/(?<![\w$.])Date\s*\(/g)) if (!/new\s+$/.test(masked.slice(Math.max(0, match.index - 8), match.index))) hit(match.index, 'wall-clock', 'Date() on a seeded path');
  each(/\bperformance\s*\.\s*now\b/g, 'wall-clock', 'performance.now on a seeded path');
  each(/\bMath\s*\.\s*random\b/g, 'ambient-random', 'Math.random on a seeded path');
  // crypto.randomBytes, QuickCrypto.randomBytes, Crypto.getRandomBytes: any object named *crypto.
  each(new RegExp(String.raw`(?<![\w$])([A-Za-z_$][\w$]*)?(crypto)\s*\.\s*(${RANDOM_METHODS})\b`, 'gi'), 'ambient-random', (m) => `${m[1] ?? ''}${m[2]}.${m[3]} on a seeded path`);
  each(new RegExp(String.raw`(?<![\w$.])(${RANDOM_CALLS})\s*\(`, 'g'), 'ambient-random', (m) => `${m[1]}() on a seeded path`);
  // const { random } = Math (or { random: draw }): the destructured form of Math.random, test files included.
  for (const match of masked.matchAll(/\{([^{}]*)\}\s*=\s*Math\b(?!\s*\.)/g)) {
    if (match[1].split(',').some((part) => part.split(/[:=]/)[0].trim() === 'random')) hit(match.index, 'ambient-random', 'Math.random (destructured from Math) on a seeded path');
  }
  for (const { from, index, kind, typeOnly } of moduleSpecifiers(source)) {
    if (typeOnly) continue;
    const name = packageNameOf(from);
    if (/(^|\/)services\/clock(\/|$)/.test(from)) hit(index, 'wall-clock', `${verbOf(kind)} the clock service (${from}) on a seeded path`);
    if (RANDOM_PACKAGES.has(name)) hit(index, 'ambient-random', `${verbOf(kind)} ${from} on a seeded path`);
    if (!isTest && PRNG_PACKAGES.has(name)) hit(index, 'foreign-prng', `${verbOf(kind)} the PRNG package ${from}`);
  }
  if (isTest) return;
  for (const match of masked.matchAll(/\bMath\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (match[1] === 'random' || ALLOWED_MATH.has(match[1])) continue;
    const { message, fix } = mathFinding(match[1]);
    hit(match.index, 'inexact-math', message, fix);
  }
  // const { exp, sin: sine, floor = Math.floor } = Math. A module-level capture like this (and
  // `const { random } = Math` above) is invisible to check-golden-vectors' runtime trap, which replaces
  // the functions only during each call: this text scan is its only check.
  for (const match of masked.matchAll(/\{([^{}]*)\}\s*=\s*Math\b(?!\s*\.)/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(/[:=]/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === 'random' || ALLOWED_MATH.has(name)) continue;
      const { message, fix } = mathFinding(name);
      hit(match.index, 'inexact-math', message, fix);
    }
  }
  each(/\*\*=?/g, 'inexact-math', '** (Number::exponentiate) is implementation-approximated');
  each(/\bIntl\s*\.\s*(\w+)/g, 'locale-dependent', (m) => `Intl.${m[1]} on a seeded path`);
  each(/\.\s*(toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleUpperCase|toLocaleLowerCase|localeCompare)\s*\(/g, 'locale-dependent', (m) => `${m[1]}() depends on the device locale and platform`);
  scanUnmixed(masked, hit);
}

/** True when `new Date` at `index` is called with at least one argument: `new Date(2026, 8, 26)`. */
function hasArguments(masked, index) {
  const open = masked.slice(index).match(/^\s*\(/);
  if (!open) return false;
  const start = index + open[0].length - 1;
  const close = findClosing(masked, start);
  return close !== -1 && masked.slice(start + 1, close).trim() !== '';
}

function scanUnmixed(masked, hit) {
  const after = (index) => masked.slice(index).match(/^\s*(%|&(?!&)|>>>?|\/(?![/*]))/);
  for (const match of masked.matchAll(/(?<![\w$.])(dailySeed|hashSeed)\s*\(/g)) {
    const close = findClosing(masked, match.index + match[0].length - 1);
    if (close !== -1 && after(close + 1)) hit(match.index, 'unmixed-seed', `the raw ${match[1]}() value is used with ${after(close + 1)[1]} instead of being passed to seedRng()`);
  }
  for (const match of masked.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(dailySeed|hashSeed)\s*\(/g)) {
    const use = new RegExp(`(?<![\\w$.])${match[1].replace(/\$/g, '\\$')}\\s*(%|&(?!&)|>>>?)`, 'g');
    for (const usage of masked.slice(match.index + match[0].length).matchAll(use)) {
      hit(match.index + match[0].length + usage.index, 'unmixed-seed', `${match[1]} holds a raw ${match[2]}() value and is used with ${usage[1]} instead of being passed to seedRng()`);
    }
  }
}

function readContract(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  try {
    return { text, data: JSON.parse(text) };
  } catch (error) {
    fail(`${rel} is not valid JSON (${String(error.message).split('\n')[0]})`, 'Fix the JSON (check-golden-vectors.mjs documents the format).');
  }
}

const contractList = (data, key) => (data && typeof data === 'object' && Array.isArray(data[key]) ? data[key] : []);
const contractModules = (data) => contractList(data, 'generators').map((entry) => entry?.module).filter((entry) => typeof entry === 'string');
const contractPaths = (data) => contractList(data, 'paths').filter((entry) => typeof entry === 'string');

function seededGlobs(layout, contract, extra) {
  return [`${layout.coreDir}/rng/**`, `${layout.coreDir}/dates/**`, `${layout.srcDir}/games/*/{rules,levels,sim,geom}/**`, ...extra, ...contractPaths(contract?.data), ...contractModules(contract?.data)];
}

/**
 * A contract module or "paths" glob that matches nothing under the root scans nothing: usually a typo,
 * a renamed folder, or the checker run from another folder than the app's (contract paths are
 * relative to the app folder that holds contracts/).
 */
function checkContractPaths(root, contract, contractRel, everything, report) {
  if (contract === null) return;
  const lineOf = (needle) => {
    const index = contract.text.indexOf(needle);
    return index < 0 ? 1 : contract.text.slice(0, index).split('\n').length;
  };
  const present = new Set(everything);
  for (const module of contractModules(contract.data)) {
    if (present.has(posix.normalize(module))) continue;
    const message = existsSync(join(root, module))
      ? `the generator module ${module} is inside a folder the repo scan skips (output folders, installed skills, a folder holding a SKILL.md), so nothing scans it`
      : `the generator module ${module} does not exist under the root, so nothing scans it (contract paths are relative to the app folder that holds contracts/)`;
    report.problem({ file: contractRel, line: lineOf(`"module": ${JSON.stringify(module)}`), rule: 'contract-paths', message, fix: FIX['contract-paths'] });
  }
  for (const glob of contractPaths(contract.data)) {
    if (everything.some((rel) => matchGlob(rel, glob))) continue;
    report.problem({ file: contractRel, line: lineOf(JSON.stringify(glob)), rule: 'contract-paths', message: `the "paths" glob ${glob} matches no file under the root, so it scans nothing`, fix: FIX['contract-paths'] });
  }
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root, { coreDir: options['core-dir'] });
  const contractRel = options.contract ?? posix.join(layout.contractsDir, 'seeded-generators.json');
  const contract = readContract(root, contractRel);
  const report = createReporter({ name: 'check-determinism', json: options.json });
  const canonical = await checkCanonical(root, layout, report);
  const globs = seededGlobs(layout, contract, options.path ?? []);
  const everything = walkRepo(root);
  const code = everything.filter((rel) => CODE_FILES.some((glob) => matchGlob(rel, glob)) && !rel.endsWith('.d.ts'));
  const files = code.filter((rel) => globs.some((glob) => matchGlob(rel, glob)));
  checkContractPaths(root, contract, contractRel, everything, report);
  if (files.length === 0 && canonical.length === 0 && report.problems.length === 0) {
    fail(`nothing to check: no seeded code under ${globs.join(', ')}`, `Copy the skill's templates (src/core/rng, src/core/dates), or name the seeded code with --path or --core-dir.`);
  }
  for (const file of files) scanFile(file, readFileSync(join(root, file), 'utf8'), report);
  // Everything a seeded file imports is seeded too: follow value imports from the generator modules
  // first, then the other seeded files, through any number of local files (never node_modules).
  const modules = new Set(contractModules(contract?.data).map((rel) => posix.normalize(rel)));
  const starts = files.filter((rel) => !isTestFile(rel)).sort((a, b) => Number(modules.has(b)) - Number(modules.has(a)));
  const codeSet = new Set(code);
  const seededSet = new Set(files);
  // An app folder inside a workspaces repo: imports of the repo's other packages (@acme/shared) are
  // followed into them too, labelled relative to the root (packages/shared/src/easing.ts behind one
  // parent step per folder level between the root and the workspace root).
  const workspaceRoot = enclosingWorkspaceRoot(root);
  const outside = (rel) => {
    if (workspaceRoot === null) return false;
    const inRepo = posix.normalize(posix.join(workspaceRoot.appDir, rel));
    return !inRepo.startsWith('../') && CODE_FILES.some((glob) => matchGlob(inRepo, glob)) && !inRepo.endsWith('.d.ts') && !isRepoScanIgnored(inRepo, workspaceRoot.dir);
  };
  const follow = (rel) => !isTestFile(rel) && !seededSet.has(rel) && (rel.startsWith('../') ? outside(rel) : codeSet.has(rel));
  const reached = reachableFiles(root, starts, { aliases: layout.aliases, follow, resolveOutside: workspacePackageResolver(workspaceRoot) });
  for (const [file, chain] of reached) scanFile(file, readFileSync(join(root, file), 'utf8'), report, chain);
  return report.finish({ checked: files.length + reached.size, unit: 'seeded files' });
}

run(main);
