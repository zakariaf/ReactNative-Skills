// kit-checks.mjs: the kit side of check-rules-engine: the game contract files in <coreDir>/game,
// the canonical seeded RNG in <coreDir>/rng and its golden values (run for real), and the exact
// fast-check pin the kit's and the rules' tests need. Not an entry point.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readText, walk } from '../check-lib.mjs';
import { errorText } from './app-modules.mjs';
import { code, exportNames, importsOf } from './ts-scan.mjs';

/** Every kit file a game needs (relative to <coreDir>/game), with the exports that must be there. */
export const KIT_FILES = {
  'game-engine.ts': ['GameEngine', 'Outcome', 'ApplyResult'],
  'game-input.ts': ['GameInput', 'GameIntent', 'PanMode'],
  'game-module.ts': ['GameModule', 'GameIdentity'],
  'game-rules.ts': ['GameRules', 'Hud', 'UndoPolicy', 'HintPolicy', 'ContinuePolicy'],
  'messages.ts': ['MessageId', 'Message'],
  'levels.ts': ['LevelsSpec', 'LevelEntry', 'LevelPack', 'StarRule', 'Solver', 'SolveResult'],
  'stats.ts': ['StatsSpec', 'CounterSpec'],
  'testing.ts': ['TestingSpec', 'ExampleStateId'],
  'persistence.ts': ['PersistenceSpec', 'SavePolicy', 'SavePoint'],
  'difficulty.ts': ['ENDLESS_DIFFICULTY', 'MAX_LEVEL_DIFFICULTY', 'clampDifficulty', 'isEndlessDifficulty', 'rowFor'],
  'difficulty.test.ts': [],
  'testing/play-choices.ts': ['playChoices', 'PlayableRules'],
  'testing/play-bot.ts': ['playBot', 'randomPolicy', 'BotPolicy', 'BotGame'],
  'testing/json-shape.ts': ['jsonShapeProblems', 'jsonOf'],
  'testing/engine-contract.ts': ['engineContractProblems', 'EngineContractInput'],
  'testing/contract-intents.ts': ['contractIntentProblems', 'inputMemberProblems'],
};

/** The canonical RNG files (relative to <coreDir>/rng; seeded-determinism-and-golden-vectors owns them). */
export const RNG_FILES = {
  'sfc32.ts': ['RngState', 'RngDraw', 'mix32', 'hashU32', 'nextU32', 'seedRng', 'nextInt', 'nextUnit', 'hashSeed'],
  'sfc32.test.ts': [],
};

/**
 * Members a current kit file names; an older copy lacks them (written before the tap-then-tap
 * selection, the solver's final state, the endless property or the generic input contract).
 */
export const KIT_MEMBERS = {
  'game-input.ts': ['selectRegions', 'GameIntent'],
  'levels.ts': ['final'],
  'testing/engine-contract.ts': ['endless', 'contractIntentProblems', 'input'],
};

/** The pinned sfc32 values: the compatibility contract of every seeded output. */
export const GOLDEN_SEED_1 = [1828152527, 3394835397, 2967886022, 2251045104, 4148684523];
export const GOLDEN_TEXT_HASH = 2847463752;
export const GOLDEN_HASH_KEY = 'tasks:2026-09-26';

/** Packages the kit's and the rules' tests import, which the root devDependencies pin exactly. */
export const TEST_DEPENDENCIES = ['fast-check'];
/** The exact pins the install fix names (verified on 2026-10-03; re-verify: npm view fast-check version). */
const TEST_DEPENDENCY_PINS = { 'fast-check': '4.10.2' };

function checkFileSet(games, report, folder, files, owner, templateFolder) {
  let checked = 0;
  for (const [rel, exports] of Object.entries(files)) {
    const path = `${folder}/${rel}`;
    checked += 1;
    if (!games.exists(path)) {
      report.problem({ file: path, rule: 'kit-file-missing', message: `a file every game needs is missing${owner}`, fix: `Copy templates/${templateFolder}/${rel} from this skill verbatim (with its test); the contract files are canonical.` });
      continue;
    }
    const text = readText(join(games.root, path)) ?? '';
    const names = exportNames(text);
    for (const name of exports.filter((item) => !names.has(item))) {
      report.problem({ file: path, line: 1, rule: 'kit-export-missing', message: `does not export ${name}`, fix: `Restore the file from this skill's templates; games import ${name} by this name.` });
    }
    for (const member of (KIT_MEMBERS[rel] ?? []).filter((item) => !new RegExp(`\\b${item}\\b`).test(code(text)))) {
      report.problem({ file: path, line: 1, rule: 'kit-member-missing', message: `is an older copy: it never names ${member}`, fix: `Copy the template again (verbatim): the contract gained ${member}; then fix what tsc reports.` });
    }
  }
  return checked;
}

export function checkKitFiles(games, report) {
  return checkFileSet(games, report, games.kitDir, KIT_FILES, '', 'src/core/game') + checkFileSet(games, report, games.rngDir, RNG_FILES, ' (the canonical seeded RNG, owned by seeded-determinism-and-golden-vectors)', 'src/core/rng');
}

/** The first file under `folders` that imports `name`, or null. */
function firstImporter(games, folders, name) {
  for (const folder of folders.filter((item) => games.exists(item))) {
    for (const rel of walk(join(games.root, folder), { include: ['*.ts', '*.tsx'], pruneDirsContaining: ['SKILL.md'] })) {
      const text = readText(join(games.root, folder, rel)) ?? '';
      if (importsOf(text).some((item) => item.specifier === name || item.specifier.startsWith(`${name}/`))) return `${folder}/${rel}`;
    }
  }
  return null;
}

function readRootManifest(games) {
  const path = join(games.root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readText(path) ?? '');
  } catch {
    return null;
  }
}

/**
 * The kit's tests, the RNG test and the rules templates import fast-check. Without it tsc and
 * ESLint fail with TS2307 on every copied test, and an unpinned range moves property runs.
 */
export function checkTestDependencies(games, folders, report) {
  const manifest = readRootManifest(games);
  for (const name of TEST_DEPENDENCIES) {
    const importer = firstImporter(games, folders, name);
    if (importer === null) continue;
    const install = `Run npm install -D -E ${name}@${TEST_DEPENDENCY_PINS[name]} at the repo root (verified on 2026-10-03; re-verify: npm view ${name} version; an exact pin in the root devDependencies; unit-and-component-tests owns the test stack).`;
    const version = manifest?.devDependencies?.[name];
    if (version === undefined) {
      report.problem({ file: 'package.json', line: 1, rule: 'kit-test-dependency', message: `${importer} imports ${name}, but the root package.json has no ${name} devDependency`, fix: install });
    } else if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
      report.problem({ file: 'package.json', line: 1, rule: 'kit-test-dependency', message: `${name} is "${version}", not an exact version`, fix: install });
    }
  }
}

export function checkRngSource(games, report) {
  const rngPath = `${games.rngDir}/sfc32.ts`;
  const testPath = `${games.rngDir}/sfc32.test.ts`;
  if (games.exists(rngPath)) {
    const text = code(readText(join(games.root, rngPath)) ?? '');
    if (!/^['"]worklet['"];/.test(text.trimStart())) {
      report.problem({ file: rngPath, line: 1, rule: 'rng-worklet', message: "sfc32.ts has no file-level 'worklet'; directive (real-time sims draw on the UI thread)", fix: "Restore the canonical file: 'worklet'; is the first statement after the path comment." });
    }
  }
  if (games.exists(testPath)) {
    const digits = (readText(join(games.root, testPath)) ?? '').replace(/_/g, '');
    const missing = [...GOLDEN_SEED_1, GOLDEN_TEXT_HASH].filter((value) => !digits.includes(String(value)));
    if (missing.length > 0) {
      report.problem({ file: testPath, line: 1, rule: 'rng-golden-test', message: `the RNG test does not pin the golden values (missing ${missing.join(', ')})`, fix: 'Restore the canonical sfc32.test.ts (templates/src/core/rng/sfc32.test.ts); its values come from an independent oracle and never change.' });
    }
  }
}

function drawMany(rng, state, count) {
  const values = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = rng.nextU32(current);
    values.push(draw.value);
    current = draw.state;
  }
  return values;
}

/** Independent transcription of PractRand's C sfc32 (the oracle). */
function referenceSfc32(seed, count) {
  let [a, b, c, d] = seed;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const tmp = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((((c << 21) | (c >>> 11)) >>> 0) + tmp) >>> 0;
    out.push(tmp);
  }
  return out;
}

function rngProblems(rng) {
  const problems = [];
  const reference = referenceSfc32([1, 2, 3, 4], 50);
  if (JSON.stringify(drawMany(rng, [1, 2, 3, 4], 50)) !== JSON.stringify(reference)) problems.push('nextU32 does not match the PractRand sfc32 reference algorithm');
  const seeded = drawMany(rng, rng.seedRng(1), 5);
  if (JSON.stringify(seeded) !== JSON.stringify(GOLDEN_SEED_1)) problems.push(`seedRng(1) draws ${seeded.join(', ')}, the golden sequence is ${GOLDEN_SEED_1.join(', ')}`);
  const hash = rng.hashSeed(GOLDEN_HASH_KEY);
  if (hash !== GOLDEN_TEXT_HASH) problems.push(`hashSeed('${GOLDEN_HASH_KEY}') is ${hash}, the golden value is ${GOLDEN_TEXT_HASH}`);
  for (const max of [1, 2, 3, 7, 1000]) {
    let state = rng.seedRng(max);
    for (let i = 0; i < 200; i += 1) {
      const draw = rng.nextInt(state, max);
      if (!Number.isInteger(draw.value) || draw.value < 0 || draw.value >= max) {
        problems.push(`nextInt(state, ${max}) returned ${draw.value}`);
        return problems;
      }
      state = draw.state;
    }
  }
  const unit = rng.nextUnit(rng.seedRng(3)).value;
  if (!(unit >= 0 && unit < 1)) problems.push(`nextUnit returned ${unit}, outside [0, 1)`);
  return problems;
}

/** Runs the real sfc32.ts and compares it with the reference algorithm and the golden values. */
export async function checkRngGolden(games, modules, report) {
  const rngPath = `${games.rngDir}/sfc32.ts`;
  if (!games.exists(rngPath)) return 0;
  let rng;
  try {
    rng = await modules.load(rngPath);
  } catch (error) {
    report.problem({ file: rngPath, line: 1, rule: 'rng-load', message: `sfc32.ts cannot be loaded: ${errorText(error)}`, fix: 'Restore the canonical file: it has no imports and only exact integer operations.' });
    return 1;
  }
  for (const message of rngProblems(rng)) {
    report.problem({ file: rngPath, line: 1, rule: 'rng-golden', message, fix: 'Restore templates/src/core/rng/sfc32.ts verbatim: the sequence is a compatibility contract; a different generator is a new module under a new name (seeded-determinism-and-golden-vectors).' });
  }
  return 1;
}
