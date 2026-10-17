#!/usr/bin/env node
// check-levels.mjs: checks the level kit (solvers, witness solver, level tables, the star rule run
// against its golden values), its prerequisites and the generator scripts, and every game's levels
// folder: the levels contract, pack tables, numbering, quality metrics, modes, goldens, the contract
// test, the import zone, and that the committed packs are exactly what the game's plan generates.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-levels.mjs [repo-root] [--game <id>] [--report]

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { checkKit, checkPackNames, checkPlaceholders, checkPrerequisites, checkPurityAndDeterminism, checkSaltsUnique, checkSpec, checkTable, checkTestDependencies, levelFiles, metrics, readCatalogs, readPacks } from './lib/level-checks.mjs';
import { contractMarkers, gameLevelPaths, gamesWithLevels, isPackless, levelLayout, readLevelsContract } from './lib/level-layout.mjs';
import { checkPlan, checkStarRule } from './lib/level-run.mjs';

const SPEC = {
  name: 'check-levels',
  summary: 'Checks the level kit in <coreDir>/game (solvers, witness solver, level tables, pack progress, the star rule run against its golden values), its prerequisites and the generator in scripts/levels, and each game\'s <gamesDir>/<id>/levels: the levels contract, pack JSON, numbering, duplicates, the difficulty and par curves, trivial levels, daily/endless modes, pack name keys, data goldens with committed snapshots and a [contract] daily entry, the levels contract test, the import zone, determinism, and a regeneration of the table from the game\'s plan compared value by value and byte by byte.',
  usage: '[repo-root] [options]',
  options: {
    game: { type: 'string', multiple: true, value: 'id', help: 'Check only this game id (default: every <games-dir>/<id> with a levels/ folder, and every game in the levels contract)' },
    'games-dir': { type: 'string', value: 'dir', help: 'Folder of the games (default: "gamesDir" in rn-skills.config.json, else <srcDir>/games)' },
    'core-dir': { type: 'string', value: 'dir', help: 'Pure core folder holding game/, rng/ and dates/ (default: coreDir from the layout, src/core)' },
    contract: { type: 'string', value: 'file', help: 'The levels contract (default: "levelsContract", else <contractsDir>/levels.json)' },
    'catalogs-dir': { type: 'string', value: 'dir', help: 'The app\'s message catalogs, <locale>.json (default: "gameCatalogsDir", else <i18nDir>/catalogs)' },
    'generator-dir': { type: 'string', value: 'dir', help: 'Folder of the generator scripts (default: "levelsGeneratorDir", else <scriptsDir>/levels)' },
    report: { type: 'boolean', help: 'Also print per-pack metrics (levels, difficulty and par ranges)' },
    'no-run': { type: 'boolean', help: 'Skip running code (the star rule and the plan regeneration)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  kit-file-missing / kit-export-missing  the level kit (<core>/game/solver, level-kit, testing/render-cells.ts)',
    '                         and the generator scripts (scripts/levels: generate-levels, run-level-plan, app-imports)',
    '  kit-prerequisite       the game kit (game-rules-engine) and the RNG and date keys (seeded-determinism-and-golden-vectors)',
    '  kit-test-dependency    the kit or levels tests import fast-check: the root package.json pins it exactly',
    '  star-rule              the real starsFor: par 3 / par + 2: 2 / finished: 1 / loss: 0; score thresholds',
    '  levels-config          contracts/levels.json exists, is well formed and lists every game with levels',
    '                         (a daily- or endless-only game: packCount 0, levelsPerPack 0, no starRule; its',
    '                         plan, pack, numbering, curve, pack-name and contract-test rules do not apply)',
    '  levels-file-missing    <id>-levels.ts, <id>-level-plan.ts, pack-1.json (or a contract or --game id without levels/)',
    '  pack-json / level-numbering / pack-size / pack-config / duplicate-level',
    '  difficulty-curve / trivial-level / par-curve   level quality metrics',
    '  solver-required / daily-mode / endless-mode / daily-salt-shared / levels-contract-test / pack-name-key',
    '  level-golden / golden-snapshot-missing / daily-golden / daily-golden-contract   data goldens pinned and committed',
    '  pure-import            levels import only <core>/** and the game\'s own rules/, levels/ and geom/ (never testing/)',
    '  determinism            no Math.random, clocks, **, Intl, toLocale*, localeCompare or inexact Math',
    '  placeholder-left       a __GAME_*__ template placeholder is still in a levels file',
    '  plan-run / plan-failure / pack-stale   the plan regenerates exactly the committed levels',
    '  pack-format            the pack bytes are what generate-levels.ts writes (the repo\'s Prettier, json parser)',
    '',
    'Exit 2 when the root has no package.json (not an app repo root).',
    'NOT APPLICABLE when the app has no levels: no <games-dir>/<id>/levels/, no levels contract and no',
    '<core>/game/solver or level-kit folder. SKIP pack-name-key before the app has catalogs.',
    'When multi-package: run once per app with the app folder as the repo root.',
    '',
    'Example: node check-levels.mjs . --game lights-out --report',
  ].join('\n'),
};

function contractEntryFor(paths, contract, gameId, report) {
  const entry = contract.entries.get(gameId);
  if (entry !== undefined) return { ...entry, file: paths.contract };
  if (contract.exists && contract.problems.length === 0) report.problem({ file: paths.contract, rule: 'levels-config', message: `${gameId} has a levels folder but no entry in the levels contract`, fix: 'Add { "id", "packCount", "levelsPerPack", "starRule", "daily", "endless" } for the game (templates/contracts/levels.json); a daily- or endless-only game is { "id", "packCount": 0, "levelsPerPack": 0, "daily", "endless" }.' });
  return null;
}

async function checkGame(context, gameId) {
  const { paths, contract, modules, markers, catalogs, options, report } = context;
  const game = gameLevelPaths(paths, gameId);
  if (!paths.exists(game.levelsDir)) {
    const inContract = contract.entries.has(gameId);
    const message = inContract ? 'the levels contract lists this game, but it has no levels folder' : `--game ${gameId} names a game that has no levels folder`;
    const undo = inContract ? 'or remove the contract entry' : 'or check the id and --games-dir';
    report.problem({ file: game.levelsDir, rule: 'levels-file-missing', message, fix: `Create it from this skill's templates (solver, plan, LevelsSpec, tests), then generate the packs; ${undo}.` });
    return 1;
  }
  const entry = contractEntryFor(paths, contract, gameId, report);
  const files = levelFiles(paths, gameId);
  // A daily- or endless-only game (packCount 0) has no plan, packs or pack names to check.
  const packless = isPackless(entry);
  const packs = packless ? [] : readPacks(paths, gameId, report);
  const entries = packless ? [] : checkTable(packs, entry, report);
  checkSpec(paths, gameId, files, entries, entry, markers, report);
  checkPurityAndDeterminism(paths, gameId, files, report);
  checkPlaceholders(files, report);
  if (!packless) checkPackNames(paths, gameId, files, catalogs, report);
  let checked = 1;
  if (modules && !packless) checked += await checkPlan(paths, modules, gameId, report);
  if (options.report) for (const line of metrics(packs)) report.note(`${gameId} ${line}`);
  return checked;
}

function checkContract(paths, contract, games, report) {
  if (!contract.exists && games.length > 0) report.problem({ file: paths.contract, rule: 'levels-config', message: `${games.join(', ')} ${games.length === 1 ? 'has' : 'have'} levels but the levels contract is missing`, fix: 'Copy templates/contracts/levels.json and levels.schema.json from this skill and add one entry per game with levels.' });
  for (const message of contract.problems) report.problem({ file: paths.contract, rule: 'levels-config', message, fix: 'Follow templates/contracts/levels.schema.json: { "games": [{ "id", "packCount", "levelsPerPack", "starRule": "par" | "score", "daily", "endless" }] }; a daily- or endless-only game has packCount 0, levelsPerPack 0 and no starRule.' });
}

function catalogsOrSkip(paths, games, report) {
  const catalogs = readCatalogs(paths);
  const reason = games.length > 0 ? notYetCreated(paths.root, { file: paths.catalogsDir, owner: 'i18n-strings-and-catalogs' }) : null;
  if (reason) report.skip({ file: paths.catalogsDir, rule: 'pack-name-key', message: reason });
  return catalogs;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${positionals[0] ?? '.'} has no package.json, so it is not an app repo root`, 'Run it from the app repo root, or pass the root: node check-levels.mjs <repo-root>.');
  const report = createReporter({ name: 'check-levels', json: options.json });
  const paths = levelLayout(root, options);
  const contract = readLevelsContract(paths);
  const withLevels = gamesWithLevels(paths);
  const hasKit = paths.exists(`${paths.kitDir}/solver`) || paths.exists(`${paths.kitDir}/level-kit`);
  if (withLevels.length === 0 && !contract.exists && !hasKit && (options.game ?? []).length === 0) {
    return report.notApplicable(`the app has no levels (no ${paths.gamesDir}/<game-id>/levels/, no ${paths.contract} and no ${paths.kitDir}/solver or ${paths.kitDir}/level-kit)`);
  }
  const games = (options.game ?? []).length > 0 ? [...options.game] : [...new Set([...withLevels, ...contract.entries.keys()])].sort();
  const modules = options['no-run'] ? null : enableAppImports(root);
  let checked = checkKit(paths, report);
  checkPrerequisites(paths, report);
  checkTestDependencies(paths, [`${paths.kitDir}/solver`, `${paths.kitDir}/level-kit`, `${paths.kitDir}/testing`, paths.generatorDir, ...games.map((id) => gameLevelPaths(paths, id).levelsDir)], report);
  if (modules) checked += await checkStarRule(paths, modules, report);
  checkContract(paths, contract, withLevels, report);
  const context = { paths, contract, modules, markers: contractMarkers(paths), catalogs: catalogsOrSkip(paths, games, report), options, report };
  for (const gameId of games) checked += await checkGame(context, gameId);
  checkSaltsUnique(paths, withLevels, games, report);
  return report.finish({ checked, unit: 'kit files, games and runs' });
});
