// level-checks.mjs: static checks of the level kit (<coreDir>/game/solver, level-kit, testing),
// its prerequisites, the generator scripts and one game's levels folder (<gamesDir>/<id>/levels),
// plus the level quality metrics. Not an entry point.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { notYetCreated, readText, walk } from '../check-lib.mjs';
import { defaultSalt, gameLevelPaths, isInside, isPackless, localTarget, registeredGoldenTests } from './level-layout.mjs';
import { bare, code, exportNames, importsOf, matchesWithLines } from './ts-scan.mjs';

/** Level kit files under <coreDir>/game and the exports other code imports by name. */
export const KIT_FILES = {
  'solver/search-problem.ts': ['SearchProblem', 'SolvableEngine', 'engineProblem'],
  'solver/bfs-solve.ts': ['bfsSolve'],
  'solver/ida-star-solve.ts': ['idaStarSolve', 'HeuristicProblem'],
  'solver/engine-solver.ts': ['createBfsSolver', 'createIdaStarSolver'],
  'solver/verify-line.ts': ['verifyLine'],
  'solver/witness-solver.ts': ['createWitnessSolver', 'WitnessSetup'],
  'level-kit/level-table.ts': ['toLevelEntries'],
  'level-kit/levels-contract.ts': ['levelsContractProblems'],
  'level-kit/pack-progress.ts': ['isLevelUnlocked', 'defaultStarsToUnlock', 'totalStars', 'nextLevel'],
  'level-kit/star-rating.ts': ['starsFor', 'StarCount'],
  'level-kit/daily-start.ts': ['dailyStart'],
  'level-kit/level-plan.ts': ['LevelPlan', 'SolvedCandidate'],
  'level-kit/plan-level-table.ts': ['planLevelTable', 'candidateSeed', 'packsOf'],
  'testing/render-cells.ts': ['renderCells'],
};

/** The generator scripts under <generatorDir> and their exports. */
export const GENERATOR_FILES = {
  'generate-levels.ts': [],
  'run-level-plan.ts': ['runLevelPlan'],
  'app-imports.ts': ['registerAppImports'],
};

/**
 * Files other skills install that the level kit imports: { rel under coreDir, exports, owner }.
 * levels.ts must be the copy whose SolveResult carries `final` (rate() reads the score there).
 */
export const PREREQUISITES = [
  { rel: 'game/levels.ts', names: ['LevelsSpec', 'LevelEntry', 'LevelPack', 'StarRule', 'Solver', 'SolveResult'], owner: 'game-rules-engine' },
  { rel: 'game/difficulty.ts', names: ['ENDLESS_DIFFICULTY', 'MAX_LEVEL_DIFFICULTY'], owner: 'game-rules-engine' },
  { rel: 'game/game-engine.ts', names: ['GameEngine'], owner: 'game-rules-engine' },
  { rel: 'game/messages.ts', names: ['MessageId'], owner: 'game-rules-engine' },
  { rel: 'game/testing/play-bot.ts', names: ['BotPolicy'], owner: 'game-rules-engine' },
  { rel: 'rng/sfc32.ts', names: ['seedRng', 'hashSeed', 'RngState'], owner: 'seeded-determinism-and-golden-vectors' },
  { rel: 'dates/date-key.ts', names: ['DateKey'], owner: 'seeded-determinism-and-golden-vectors' },
  { rel: 'dates/daily-seed.ts', names: ['dailySeed'], owner: 'seeded-determinism-and-golden-vectors' },
];

/** The star rule, run against the real starsFor: par 7 and score thresholds [100, 250, 400]. */
export const STAR_GOLDENS = [
  { rule: { kind: 'par', par: 7 }, run: { isWon: true, moves: 7, score: 0 }, stars: 3 },
  { rule: { kind: 'par', par: 7 }, run: { isWon: true, moves: 9, score: 0 }, stars: 2 },
  { rule: { kind: 'par', par: 7 }, run: { isWon: true, moves: 10, score: 0 }, stars: 1 },
  { rule: { kind: 'par', par: 7 }, run: { isWon: false, moves: 3, score: 0 }, stars: 0 },
  { rule: { kind: 'score', thresholds: [100, 250, 400] }, run: { isWon: true, moves: 12, score: 249 }, stars: 1 },
  { rule: { kind: 'score', thresholds: [100, 250, 400] }, run: { isWon: true, moves: 12, score: 250 }, stars: 2 },
  { rule: { kind: 'score', thresholds: [100, 250, 400] }, run: { isWon: true, moves: 12, score: 400 }, stars: 3 },
  { rule: { kind: 'score', thresholds: [100, 250, 400] }, run: { isWon: false, moves: 12, score: 999 }, stars: 0 },
];

/**
 * Packages the kit's and the levels' tests import that a fresh Expo app does not install, with the
 * pin of the versions table (verified on 2026-10-03; re-verify: npm view fast-check version).
 */
export const TEST_DEPENDENCIES = { 'fast-check': '4.10.2' };

const IMPURE = /^(react|react-native|expo|zustand)(\/|-|$)|^@(shopify|expo|react-native|react-navigation)\/|^node:/;
const ALLOWED_MATH = new Set(['sqrt', 'imul', 'floor', 'round', 'abs', 'min', 'max', 'PI']);
const UINT32_MAX = 4294967295;
const PLACEHOLDER = /__([A-Z][A-Z0-9_]*[A-Z0-9])__/g;

function exportsOf(root, rel) {
  return exportNames(readText(join(root, rel)) ?? '');
}

export function checkKit(paths, report) {
  let checked = 0;
  const groups = [
    { dir: paths.kitDir, files: KIT_FILES, template: (rel) => `templates/src/core/game/${rel}`, what: 'level kit file' },
    { dir: paths.generatorDir, files: GENERATOR_FILES, template: (rel) => `templates/scripts/levels/${rel}`, what: 'level generator script' },
  ];
  for (const group of groups) {
    for (const [rel, names] of Object.entries(group.files)) {
      const path = `${group.dir}/${rel}`;
      checked += 1;
      if (!paths.exists(path)) {
        report.problem({ file: path, rule: 'kit-file-missing', message: `${group.what} is missing`, fix: `Copy ${group.template(rel)} from this skill (with its test); pack-<n>.json files are generated, never typed.` });
        continue;
      }
      const exported = exportsOf(paths.root, path);
      for (const name of names.filter((item) => !exported.has(item))) {
        report.problem({ file: path, line: 1, rule: 'kit-export-missing', message: `does not export ${name} (an older or edited copy)`, fix: `Restore the file from ${group.template(rel)}.` });
      }
    }
  }
  return checked;
}

export function checkPrerequisites(paths, report) {
  for (const { rel, names, owner } of PREREQUISITES) {
    const path = `${paths.coreDir}/${rel}`;
    if (!paths.exists(path)) {
      report.problem({ file: path, rule: 'kit-prerequisite', message: `the level kit imports ${path}, which is missing`, fix: `Install it with ${owner} first (this skill carries synced copies under templates/ only so its templates compile).` });
      continue;
    }
    const text = readText(join(paths.root, path)) ?? '';
    const missing = names.filter((name) => !exportNames(text).has(name));
    const isOldLevels = rel === 'game/levels.ts' && !/\bfinal\b/.test(code(text));
    if (missing.length > 0 || isOldLevels) {
      const what = missing.length > 0 ? `does not export ${missing.join(', ')}` : 'is an older copy: SolveResult has no final state';
      report.problem({ file: path, line: 1, rule: 'kit-prerequisite', message: what, fix: `Replace it with the current copy from ${owner} and fix what tsc reports.` });
    }
  }
}

/** The first file under `folders` that imports `name`, or null. */
function firstImporter(paths, folders, name) {
  for (const folder of folders.filter((item) => paths.exists(item))) {
    for (const rel of walk(join(paths.root, folder), { include: ['*.ts', '*.tsx'], pruneDirsContaining: ['SKILL.md'] })) {
      const text = readText(join(paths.root, folder, rel)) ?? '';
      if (importsOf(text).some((item) => item.specifier === name)) return `${folder}/${rel}`;
    }
  }
  return null;
}

function readRootManifest(paths) {
  try {
    return JSON.parse(readText(join(paths.root, 'package.json')) ?? '');
  } catch {
    return null;
  }
}

/** The kit's and the levels' tests import fast-check; without an exact root pin tsc fails with TS2307. */
export function checkTestDependencies(paths, folders, report) {
  const manifest = readRootManifest(paths);
  for (const [name, pin] of Object.entries(TEST_DEPENDENCIES)) {
    const importer = firstImporter(paths, folders, name);
    if (importer === null) continue;
    const install = `Run npm install -D -E ${name}@${pin} at the repo root (an exact pin in the root devDependencies).`;
    const version = manifest?.devDependencies?.[name];
    if (version === undefined) {
      report.problem({ file: 'package.json', line: 1, rule: 'kit-test-dependency', message: `${importer} imports ${name}, but the root package.json has no ${name} devDependency`, fix: install });
    } else if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
      report.problem({ file: 'package.json', line: 1, rule: 'kit-test-dependency', message: `${name} is "${version}", not an exact version`, fix: install });
    }
  }
}

/** Every file of a game's levels folder: { rel, name, text, isTest }. */
export function levelFiles(paths, gameId) {
  const { levelsDir } = gameLevelPaths(paths, gameId);
  if (!paths.exists(levelsDir)) return [];
  return walk(join(paths.root, levelsDir), { pruneDirsContaining: ['SKILL.md'] }).map((rel) => ({
    rel: `${levelsDir}/${rel}`,
    name: rel,
    text: readText(join(paths.root, levelsDir, rel)) ?? '',
    isTest: /\.test\.tsx?$/.test(rel),
  }));
}

/**
 * The levels import zone (the canonical ESLint PURE zone): src/core and the game's own rules/,
 * levels/ and geom/, never its testing/ (a witness's evaluation lives in rules/), never another
 * game, React Native, Expo or node:. Returns why a specifier is outside it, or null.
 */
function zoneProblem(paths, gameId, fileRel, specifier) {
  if (IMPURE.test(specifier)) return 'levels must run headless in Node, in Jest and in the generator';
  const target = localTarget(fileRel, specifier, paths.aliases);
  if (target === null) return null;
  const gameDir = `${paths.gamesDir}/${gameId}`;
  if (isInside(target, paths.coreDir)) return null;
  if (['rules', 'levels', 'geom'].some((folder) => isInside(target, `${gameDir}/${folder}`))) return null;
  if (isInside(target, `${gameDir}/testing`)) return 'not testing/: move the evaluation a witness needs into rules/ and let testing/ re-export it';
  return `it reaches ${target}, outside ${paths.coreDir} and the game's rules/, levels/ and geom/`;
}

export function checkPurityAndDeterminism(paths, gameId, files, report) {
  for (const file of files.filter((item) => /\.tsx?$/.test(item.name))) {
    for (const { specifier, line } of importsOf(file.text)) {
      const why = zoneProblem(paths, gameId, file.rel, specifier);
      if (why !== null) {
        report.problem({ file: file.rel, line, rule: 'pure-import', message: `imports ${specifier}; ${why}`, fix: `Level code imports only ${paths.coreDir}/** and the game's own rules/, levels/ and geom/ (the canonical ESLint pure zone).` });
      }
    }
    const text = bare(file.text);
    const hits = [...matchesWithLines(text, /\bMath\.random\b|\bDate\.now\b|\bnew\s+Date\b|\bperformance\.now\b/g)];
    if (!file.isTest) {
      hits.push(...matchesWithLines(text, /\bMath\.([A-Za-z0-9_]+)/g).filter(({ match }) => !ALLOWED_MATH.has(match[1]) && match[1] !== 'random'));
      hits.push(...matchesWithLines(text, /\*\*=?|\bIntl\.|\.toLocale[A-Za-z]*\(|\blocaleCompare\(/g));
    }
    for (const { match, line } of hits) {
      report.problem({ file: file.rel, line, rule: 'determinism', message: `uses ${match[0]}; generated levels would differ between devices and machines`, fix: 'Use only exact arithmetic and the seeded RNG (seeded-determinism-and-golden-vectors); levels are regenerated and compared byte for byte.' });
    }
  }
}

export function checkPlaceholders(files, report) {
  for (const file of files) {
    for (const { match, line } of matchesWithLines(file.text, PLACEHOLDER)) {
      if (match[0] === '__DEV__') continue;
      report.problem({ file: file.rel, line, rule: 'placeholder-left', message: `still holds the template placeholder ${match[0]}`, fix: 'Replace __GAME_ID__ (kebab case), __GAME_PASCAL__ and __GAME_CONST__ with the game\'s names, in file names too.' });
    }
  }
}

function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function entryProblem(entry) {
  if (entry === null || typeof entry !== 'object') return 'is not an object';
  if (!isInt(entry.level, 1, 9999)) return `level ${JSON.stringify(entry.level)} is not 1..9999`;
  if (!isInt(entry.seed, 0, UINT32_MAX)) return `seed ${JSON.stringify(entry.seed)} is not a uint32`;
  if (!isInt(entry.difficulty, 0, 99)) return `difficulty ${JSON.stringify(entry.difficulty)} is not 0..99 (levels; 100 is the endless run)`;
  const stars = entry.stars;
  if (stars?.kind === 'par') return isInt(stars.par, 1, 9999) ? null : `par ${JSON.stringify(stars.par)} is not a whole number >= 1`;
  if (stars?.kind === 'score') {
    const t = stars.thresholds;
    const ok = Array.isArray(t) && t.length === 3 && t.every((value) => isInt(value, 0, Number.MAX_SAFE_INTEGER)) && t[0] < t[1] && t[1] < t[2];
    return ok ? null : `score thresholds ${JSON.stringify(t)} are not three ascending whole numbers`;
  }
  return `stars ${JSON.stringify(stars)} is neither { kind: 'par' } nor { kind: 'score' }`;
}

const REGENERATE = (gameId) => `node scripts/levels/generate-levels.ts --game ${gameId}`;

/** Reads pack-1.json, pack-2.json, ... in order; returns [{ rel, entries }] (entries null when unreadable). */
export function readPacks(paths, gameId, report) {
  const { levelsDir } = gameLevelPaths(paths, gameId);
  const abs = join(paths.root, levelsDir);
  const names = existsSync(abs) ? readdirSync(abs).filter((name) => /^pack-\d+\.json$/.test(name)) : [];
  const numbers = names.map((name) => Number(/\d+/.exec(name)[0])).sort((a, b) => a - b);
  numbers.forEach((number, index) => {
    if (number !== index + 1) report.problem({ file: `${levelsDir}/pack-${number}.json`, rule: 'level-numbering', message: `pack files are not numbered 1..n (found pack-${number}.json at position ${index + 1})`, fix: `Regenerate the packs (${REGENERATE(gameId)}); never rename them by hand.` });
  });
  return numbers.map((number) => {
    const rel = `${levelsDir}/pack-${number}.json`;
    let entries = null;
    try {
      entries = JSON.parse(readText(join(paths.root, rel)) ?? 'null');
    } catch (error) {
      report.problem({ file: rel, rule: 'pack-json', message: `is not valid JSON: ${error.message}`, fix: `Regenerate it: ${REGENERATE(gameId)}` });
      return { rel, entries: null };
    }
    if (!Array.isArray(entries)) {
      report.problem({ file: rel, rule: 'pack-json', message: 'is not a JSON array of level entries', fix: `Regenerate it: ${REGENERATE(gameId)}` });
      return { rel, entries: null };
    }
    entries.forEach((entry, index) => {
      const problem = entryProblem(entry);
      if (problem) report.problem({ file: rel, rule: 'pack-json', message: `entry ${index} ${problem}`, fix: 'Regenerate the pack with the level generator; fix the plan, not the JSON.' });
    });
    return { rel, entries };
  });
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function checkLayoutAgainstContract(packs, valid, contract, report) {
  if (contract === null) return;
  const where = contract.file;
  const sizes = valid.map((pack) => pack.entries.length);
  if (contract.packCount !== packs.length) report.problem({ file: where, rule: 'pack-config', message: `${contract.id}: the levels contract says ${contract.packCount} packs, the levels folder has ${packs.length} pack files`, fix: 'Make packCount in the contract, the plan\'s packs and the generated files agree, then regenerate.' });
  if (sizes.some((size) => size !== contract.levelsPerPack)) report.problem({ file: where, rule: 'pack-config', message: `${contract.id}: the levels contract says ${contract.levelsPerPack} levels per pack, the packs hold ${sizes.join(', ')}`, fix: 'Make levelsPerPack agree in the contract and the plan, then regenerate.' });
  const other = valid.flatMap((pack) => pack.entries.map((entry) => ({ entry, rel: pack.rel }))).find(({ entry }) => entryProblem(entry) === null && entry.stars.kind !== contract.starRule);
  if (other !== undefined) report.problem({ file: other.rel, rule: 'pack-config', message: `level ${other.entry.level} is ${other.entry.stars.kind}-rated, the levels contract says starRule "${contract.starRule}"`, fix: 'One star rule per game: fix the plan\'s rate() or the contract, then regenerate.' });
}

function checkQuality(all, valid, report) {
  const seen = new Map();
  for (const { entry, rel } of all) {
    const key = `${entry.seed}/${entry.difficulty}`;
    if (seen.has(key)) report.problem({ file: rel, rule: 'duplicate-level', message: `level ${entry.level} repeats level ${seen.get(key)} (seed/difficulty ${key})`, fix: 'The generator skips repeated boards; regenerate instead of copying entries.' });
    else seen.set(key, entry.level);
  }
  all.forEach(({ entry, rel }, index) => {
    const previous = all[index - 1]?.entry;
    if (previous !== undefined && entry.difficulty < previous.difficulty) report.problem({ file: rel, rule: 'difficulty-curve', message: `level ${entry.level} difficulty ${entry.difficulty} is below level ${previous.level}'s ${previous.difficulty}`, fix: 'Make difficultyFor non-decreasing and regenerate.' });
    if (entry.stars.kind === 'par' && entry.stars.par < 2 && entry.level > 3) report.problem({ file: rel, rule: 'trivial-level', message: `level ${entry.level} is won in ${entry.stars.par} move`, fix: 'Reject candidates below a minimum par in the plan\'s rate() (only the first three levels may be one-movers).' });
  });
  const parAverages = valid.map((pack) => average(pack.entries.filter((entry) => entryProblem(entry) === null && entry.stars.kind === 'par').map((entry) => entry.stars.par)));
  parAverages.forEach((value, index) => {
    if (index > 0 && value > 0 && value < parAverages[index - 1]) report.problem({ file: valid[index].rel, rule: 'par-curve', message: `pack ${index + 1} averages par ${value.toFixed(2)}, below pack ${index}'s ${parAverages[index - 1].toFixed(2)}`, fix: 'Later packs are never easier: raise the minimum par or the difficulty of later packs.' });
  });
}

/** Numbering, sizes, the contract layout, duplicates and the quality metrics of the whole table. */
export function checkTable(packs, contract, report) {
  const valid = packs.filter((pack) => Array.isArray(pack.entries));
  // Positions count every listed entry, so one invalid entry (already a pack-json problem) does not
  // shift the numbering of every level after it.
  const listed = valid.flatMap((pack) => pack.entries.map((entry) => ({ entry, rel: pack.rel })));
  const all = listed.filter(({ entry }) => entryProblem(entry) === null);
  listed.forEach(({ entry, rel }, index) => {
    if (entryProblem(entry) === null && entry.level !== index + 1) report.problem({ file: rel, rule: 'level-numbering', message: `level ${entry.level} is at position ${index + 1}; levels run 1..n across packs`, fix: 'Regenerate the packs from the plan.' });
  });
  const sizes = valid.map((pack) => pack.entries.length);
  if (new Set(sizes).size > 1) report.problem({ file: valid[0]?.rel ?? '', rule: 'pack-size', message: `packs have different sizes (${sizes.join(', ')})`, fix: 'Every pack holds levelsPerPack levels; regenerate from the plan.' });
  checkLayoutAgainstContract(packs, valid, contract, report);
  checkQuality(all, valid, report);
  return all.map(({ entry }) => entry);
}

/** Per-pack metrics for --report: levels, difficulty and par ranges. */
export function metrics(packs) {
  return packs.filter((pack) => Array.isArray(pack.entries)).map((pack, index) => {
    const entries = pack.entries.filter((entry) => entryProblem(entry) === null);
    const pars = entries.filter((entry) => entry.stars.kind === 'par').map((entry) => entry.stars.par);
    const difficulties = entries.map((entry) => entry.difficulty);
    const range = (values) => (values.length === 0 ? '-' : `${Math.min(...values)}..${Math.max(...values)} (avg ${average(values).toFixed(2)})`);
    return `pack ${index + 1}: ${entries.length} levels, difficulty ${range(difficulties)}, par ${range(pars)}`;
  });
}

function goldenSnapshotExists(paths, file) {
  const dir = join(paths.root, file.rel.slice(0, file.rel.length - file.name.length));
  const base = file.name.split('/').pop();
  const sub = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/') + 1) : '';
  return ['.snap.ios', '.snap.android', '.snap'].some((ext) => existsSync(join(dir, sub, `${base}${ext}`)) || existsSync(join(dir, sub, '__snapshots__', `${base}${ext}`)));
}

/** A game's daily salt from its LevelsSpec (inline or through a constant), or null. */
export function dailySaltOf(paths, gameId) {
  const path = join(paths.root, gameLevelPaths(paths, gameId).spec);
  const text = existsSync(path) ? code(readText(path) ?? '') : '';
  const ref = /\bsalt:\s*([A-Za-z0-9_]+)/.exec(text)?.[1];
  if (ref === undefined) return null;
  const literal = /^(0x[0-9a-fA-F_]+|[0-9_]+)$/.test(ref) ? ref : new RegExp(`\\b${ref}\\s*=\\s*(0x[0-9a-fA-F_]+|[0-9_]+)\\b`).exec(text)?.[1];
  return literal === undefined ? null : Number(literal.replaceAll('_', ''));
}

const hex = (value) => `0x${value.toString(16).padStart(4, '0')}`;

/** Each game has its own daily salt; a copied template salt makes two games share their daily levels. */
export function checkSaltsUnique(paths, allGames, checkedGames, report) {
  const salts = allGames.map((id) => ({ id, salt: dailySaltOf(paths, id) })).filter((game) => game.salt !== null);
  for (const game of salts.filter((item) => checkedGames.includes(item.id))) {
    const other = salts.find((item) => item.id !== game.id && item.salt === game.salt);
    if (other === undefined) continue;
    report.problem({ file: gameLevelPaths(paths, game.id).spec, line: 1, rule: 'daily-salt-shared', message: `the daily salt ${hex(game.salt)} is also ${other.id}'s`, fix: `Give every game its own 16-bit salt before its first release, usually the FNV-1a of its id folded to 16 bits (default for ${game.id}: ${hex(defaultSalt(game.id))}, for ${other.id}: ${hex(defaultSalt(other.id))}); keep the one that already shipped and never change it afterwards.` });
  }
}

function checkModes(game, spec, entries, contract, report) {
  const text = code(spec.text);
  const isDaily = /daily:\s*\{\s*kind:\s*'daily'/.test(text);
  const isEndless = /endless:\s*\{\s*kind:\s*'endless'/.test(text);
  const hasNullSolver = /solver:\s*null\b/.test(text);
  const isPar = entries.some((entry) => entry.stars.kind === 'par') || contract?.starRule === 'par';
  if (hasNullSolver && isPar) report.problem({ file: spec.rel, line: 1, rule: 'solver-required', message: 'levels are rated against par but the LevelsSpec has solver: null', fix: 'Par comes from a solver: add the game\'s exact solver and prove every level with it.' });
  if (isDaily && !/\bsalt:/.test(text)) report.problem({ file: spec.rel, line: 1, rule: 'daily-mode', message: 'the daily mode has no salt', fix: 'daily: { kind: \'daily\', difficulty: <the approved daily difficulty, default 40 to 50>, salt: <fixed per game, forever> }' });
  if (contract !== null && contract.daily !== isDaily) report.problem({ file: spec.rel, line: 1, rule: 'daily-mode', message: `the levels contract says daily ${contract.daily} but the LevelsSpec daily is ${isDaily ? 'on' : 'off'}`, fix: `Make ${contract.file} and levels.daily agree.` });
  if (contract !== null && contract.endless !== isEndless) report.problem({ file: spec.rel, line: 1, rule: 'endless-mode', message: `the levels contract says endless ${contract.endless} but the LevelsSpec endless is ${isEndless ? 'on' : 'off'}`, fix: `Make ${contract.file} and levels.endless agree (endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY }).` });
  return isDaily;
}

const DATE = /'(\d{4})-(\d{2})-(\d{2})'/g;
/** A golden test pins the daily level when it calls dailyStart(levels, date) or dailySeed(date, salt). */
const DAILY_CALL = /\b(?:dailyStart|dailySeed)\s*\(/;

function hasYearBoundary(dates) {
  return dates.some((date) => date.endsWith('-12-31') && dates.includes(`${Number(date.slice(0, 4)) + 1}-01-01`));
}

function checkGoldens(paths, game, tests, isDaily, markers, report, packless) {
  const goldens = tests.filter((file) => /\.golden\.test\.ts$/.test(file.name));
  // A pack-less game has no level table to pin: only its daily level (below), when it has one.
  if (goldens.length === 0 && !packless) {
    report.problem({ file: game.levelsDir, rule: 'level-golden', message: 'no data golden test for the level table', fix: 'Copy templates/src/games/__GAME_ID__/levels/__GAME_ID__-levels.golden.test.ts, run it once with -u, read the snapshot, commit it with a Gate-Change: trailer.' });
    return;
  }
  for (const golden of goldens.filter((file) => !goldenSnapshotExists(paths, file))) {
    report.problem({ file: golden.rel, rule: 'golden-snapshot-missing', message: 'the golden test has no committed snapshot (jest --ci fails and nothing is pinned)', fix: 'Run npx jest <this file> --selectProjects golden -u once, open the .snap.ios and read the boards, commit it with a Gate-Change: trailer.' });
  }
  if (!isDaily) return;
  const daily = goldens.find((file) => DAILY_CALL.test(code(file.text)));
  const dates = daily ? [...new Set([...code(daily.text).matchAll(DATE)].map((match) => match[0].slice(1, -1)))] : [];
  if (daily === undefined || dates.length < 3 || !hasYearBoundary(dates)) {
    const found = daily === undefined
      ? `no *.golden.test.ts in ${game.levelsDir} calls dailyStart or dailySeed`
      : `found ${dates.length === 0 ? 'no quoted YYYY-MM-DD dates' : dates.join(', ')}`;
    report.problem({ file: daily?.rel ?? game.levelsDir, rule: 'daily-golden', message: `the daily level is not pinned for at least 3 fixed dates with a year boundary (${found})`, fix: 'Pin the daily board for 3 quoted dates, a YYYY-12-31 / next YYYY-01-01 pair included, with dailyStart(levels, date) (or dailySeed(date, salt)) in a *.golden.test.ts: the same daily level for every player is a hard contract.' });
    return;
  }
  const titles = [...code(daily.text).matchAll(/\bdescribe\s*\(\s*(['"`])((?:(?!\1).)*)\1/g)].map((match) => match[2]);
  if (!titles.some((title) => markers.some((marker) => title.includes(marker)))) {
    report.problem({ file: daily.rel, rule: 'daily-golden-contract', message: `no describe title of the daily goldens carries a contract marker (${markers.join(', ')})`, fix: `Title it describe('${markers[0]} <game-id> daily goldens', ...) and register the test in contracts/goldens.json (golden-and-snapshot-tests), so a changed daily board is refused.` });
    return;
  }
  const registered = registeredGoldenTests(paths);
  if (registered === null) {
    report.skip({ file: paths.goldensContract, rule: 'daily-golden-contract', message: notYetCreated(paths.root, { file: paths.goldensContract, owner: 'golden-and-snapshot-tests' }) ?? 'not yet created' });
  } else if (!registered.has(daily.rel)) {
    report.problem({ file: paths.goldensContract, rule: 'daily-golden-contract', message: `${daily.rel} holds the daily goldens but is not listed in "contracts"`, fix: `Add { "id": "${game.gameId}-daily-goldens", "test": "${daily.rel}", "why": "Every player gets the same daily level on the same date; a changed board is refused." } to "contracts" (golden-and-snapshot-tests' check-goldens then passes too).` });
  }
}

/**
 * The LevelsSpec, the plan, the packs, modes against the contract, goldens and the contract test.
 * A pack-less game (contract packCount 0) needs only the LevelsSpec, its modes and the daily goldens.
 */
export function checkSpec(paths, gameId, files, entries, contract, markers, report) {
  const game = gameLevelPaths(paths, gameId);
  const packless = isPackless(contract);
  const spec = files.find((file) => file.rel === game.spec);
  if (spec === undefined) report.problem({ file: game.spec, rule: 'levels-file-missing', message: 'the LevelsSpec file is missing', fix: packless ? 'Write the LevelsSpec with packs: [], table: [] and only its daily or endless mode (references/levels-model.md, "Daily-only and endless-only games").' : 'Copy templates/src/games/__GAME_ID__/levels/__GAME_ID__-levels.ts and adapt it.' });
  const tests = files.filter((file) => file.isTest);
  if (packless) {
    const packFile = files.find((file) => /^pack-\d+\.json$/.test(file.name));
    if (packFile !== undefined) report.problem({ file: packFile.rel, rule: 'pack-config', message: `${contract.id}: the levels contract says packCount 0 (no packs), but the levels folder has pack files`, fix: 'Either declare the packs in the contract (packCount, levelsPerPack, starRule) or delete the pack files and the plan.' });
  } else {
    if (!files.some((file) => file.rel === game.plan)) report.problem({ file: game.plan, rule: 'levels-file-missing', message: 'the level plan (generator recipe) is missing', fix: 'Copy templates/src/games/__GAME_ID__/levels/__GAME_ID__-level-plan.ts and adapt create, curve and rate().' });
    if (!files.some((file) => /^pack-\d+\.json$/.test(file.name))) report.problem({ file: game.pack(1), rule: 'levels-file-missing', message: 'no generated pack tables', fix: `Run the level generator: ${REGENERATE(gameId)}` });
    if (!tests.some((file) => /levelsContractProblems\s*\(/.test(code(file.text)))) report.problem({ file: game.levelsDir, rule: 'levels-contract-test', message: 'no test runs levelsContractProblems on the shipped table', fix: 'Copy templates/src/games/__GAME_ID__/levels/__GAME_ID__-levels.test.ts: every level solver-proven by a replayed line, packs matching the contract.' });
  }
  const isDaily = spec === undefined ? false : checkModes(game, spec, entries, contract, report);
  checkGoldens(paths, game, tests, isDaily, markers, report, packless);
}

/** Every pack nameId of the plan is a key of every catalog of the app (or a SKIP before catalogs exist). */
export function checkPackNames(paths, gameId, files, catalogs, report) {
  const plan = files.find((file) => file.rel === gameLevelPaths(paths, gameId).plan);
  if (plan === undefined || catalogs === null) return;
  const text = code(plan.text);
  for (const match of text.matchAll(/\bnameId:\s*'([^']+)'/g)) {
    const key = match[1];
    const missing = catalogs.filter((catalog) => typeof catalog.messages?.[key] !== 'string').map((catalog) => catalog.rel);
    if (missing.length > 0) report.problem({ file: plan.rel, line: text.slice(0, match.index).split('\n').length, rule: 'pack-name-key', message: `the pack name key ${key} is missing from ${missing.join(', ')}`, fix: 'Add the key to every catalog of the app (i18n-strings-and-catalogs); pack names are shown on the levels screen in the user\'s language.' });
  }
}

/** The app's catalogs [{ rel, messages }], or null when the catalogs folder does not exist yet. */
export function readCatalogs(paths) {
  const abs = join(paths.root, paths.catalogsDir);
  if (!existsSync(abs)) return null;
  return readdirSync(abs).filter((name) => /^[A-Za-z0-9_-]+\.json$/.test(name)).sort().map((name) => {
    const rel = `${paths.catalogsDir}/${name}`;
    try {
      return { rel, messages: JSON.parse(readText(join(abs, name)) ?? 'null') };
    } catch {
      return { rel, messages: null };
    }
  });
}
