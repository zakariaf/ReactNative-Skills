#!/usr/bin/env node
// check-rules-engine.mjs: checks the game kit (the contract files in <coreDir>/game and the seeded
// RNG in <coreDir>/rng, run against its golden values) and every game's pure rules engine, statically
// and by running the real rules modules over seeded games.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-rules-engine.mjs [repo-root] [--game <id>]

import { createReporter, parseArgs, requireDir, run } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { runEngineContract } from './lib/engine-run.mjs';
import { discoverGames, gameLayout, gamePaths, sources } from './lib/game-layout.mjs';
import { checkKitFiles, checkRngGolden, checkRngSource, checkTestDependencies } from './lib/kit-checks.mjs';
import { checkCatalogKeys, checkDeterminism, checkEngineAssembly, checkModuleAssembly, checkMoveHandling, checkPlaceholders, checkPurity, checkRuleFiles, checkRuleTests, checkStateTypes, hasEndlessMode } from './lib/rules-checks.mjs';

const SPEC = {
  name: 'check-rules-engine',
  summary: 'Checks the game kit (contract files, the seeded RNG run against its golden values) and each game\'s rules: pure imports, determinism, JSON-safe state, past-tense events, illegal moves throwing, catalog lose reasons and keys, property tests, a pinned golden, the engine and module assembly with panMode and selectRegions, and a seeded run of the real rules (an endless run is never won).',
  usage: '[repo-root] [options]',
  options: {
    game: { type: 'string', multiple: true, value: 'id', help: 'Check only this game id (default: every <games-dir>/<id> with a rules/ folder)' },
    'games-dir': { type: 'string', value: 'dir', help: 'Folder of the games (default: "gamesDir" in rn-skills.config.json, else <srcDir>/games)' },
    'core-dir': { type: 'string', value: 'dir', help: 'Pure core folder holding game/ and rng/ (default: coreDir from the layout, src/core)' },
    'catalogs-dir': { type: 'string', value: 'dir', help: 'The app\'s message catalogs, <locale>.json (default: "gameCatalogsDir", else <i18nDir>/catalogs)' },
    'no-run': { type: 'boolean', help: 'Skip running code (the RNG goldens and the seeded engine run)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  kit-file-missing / kit-export-missing  the kit files every game needs (<core>/game, <core>/rng/sfc32.ts) and their exports',
    '  kit-member-missing     an older kit copy (no selectRegions, generic GameIntent, solver final, endless or input check)',
    '  kit-test-dependency    the kit, RNG or rules tests import fast-check: the root package.json pins it exactly',
    '  rng-worklet            sfc32.ts starts with the file-level worklet directive',
    '  rng-golden / rng-load  the real sfc32.ts matches the PractRand reference and the pinned golden values',
    '  rng-golden-test        sfc32.test.ts pins the seedRng(1) sequence and the hashSeed golden',
    '  pure-import            kit and rules import no React, React Native, Expo, Skia, state library, node:, or app code',
    '                         outside src/core and the game\'s own rules, levels and geom',
    '  determinism            no Math.random, Date, performance.now, Intl, toLocale*/localeCompare, ** or inexact Math.*',
    '                         (tests: no clock, no randomness)',
    '  rules-file-missing / rules-export-missing  <id>-types.ts, create.ts, list-moves.ts, apply-move.ts, outcome.ts',
    '  state-not-json         the types file uses Map, Set, Date, bigint, symbol or a class',
    '  rng-not-in-state       rules draw after create() but the state holds no RngState',
    '  event-kind             <Pascal>Event kinds are past-tense kebab-case',
    '  illegal-move-throws    applyMove throws a RangeError for illegal moves',
    '  reason-key             lose reasons are <id>.* catalog keys',
    '  catalog-key-missing    every <id>.* key the rules and the module name is in every <catalogs-dir>/<locale>.json',
    '  property-tests / pinned-golden  fast-check properties, a JSON round trip, a GOLDEN_* value',
    '  engine-missing / engine-typed / engine-contract-test  rules/<id>-engine.ts: GameEngine + GameRules and its contract test',
    '  persistence-missing / persistence-members / stats-missing / stats-counters',
    '  module-missing         the canvas has canvas/intent-to-move.ts but there is no <id>-game.ts (SKIP before the canvas exists)',
    '  module-typed / identity-id / pan-mode / select-regions / module-contract-test  the GameModule assembly',
    '  placeholder-left       a __GAME_*__ template placeholder is still in a game file',
    '  engine-load / engine-contract / persistence-roundtrip  the real rules over seeds 1-3 x difficulty 0, 50, 100,',
    '                         played with random moves and (once testing/<id>-testing.ts exists) the game\'s bot',
    '  testing-bot / testing-examples  the bot picks offered moves; examples start/middle/win/lose match their outcome',
    '  endless-won            a game with an endless mode never wins at difficulty 100',
    '',
    'NOT APPLICABLE when the app has no game (no <games-dir>/<id>/ with rules/, testing/, canvas/ or <id>-game.ts)',
    'and no <core>/game kit. A game folder without rules/ is a rules-file-missing problem.',
    'When multi-package: run once per app with the app folder as the repo root.',
    '',
    'Example: node check-rules-engine.mjs . --game lights-out',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-rules-engine', json: options.json });
  const games = gameLayout(root, options);
  const ids = discoverGames(games, options.game ?? []);
  if (ids.length === 0 && !games.exists(games.kitDir)) {
    return report.notApplicable(`the app has no game (no ${games.gamesDir}/<game-id>/ folder with rules, testing, canvas or <game-id>-game.ts, and no ${games.kitDir} kit)`);
  }
  const modules = options['no-run'] ? null : enableAppImports(root);
  let checked = checkKitFiles(games, report);
  checkRngSource(games, report);
  checkTestDependencies(games, [games.kitDir, games.rngDir, ...ids.map((id) => `${games.gamesDir}/${id}`)], report);
  if (modules) checked += await checkRngGolden(games, modules, report);
  const kitFiles = sources(root, games.kitDir);
  checkPurity(kitFiles, { what: 'the game kit', allowed: [games.coreDir], aliases: games.aliases }, report);
  checkDeterminism(kitFiles, report);
  for (const gameId of ids) {
    const paths = gamePaths(games, gameId);
    checked += 1;
    if (!games.exists(paths.rulesDir)) {
      report.problem({ file: paths.rulesDir, rule: 'rules-file-missing', message: 'the game has no rules folder', fix: 'Create it from this skill\'s templates/src/games/__GAME_ID__/rules (types, create, list-moves, apply-move, outcome).' });
      continue;
    }
    const files = sources(root, paths.rulesDir);
    const gameFiles = sources(root, paths.gameDir);
    const pureFolders = [games.coreDir, paths.rulesDir, `${paths.gameDir}/levels`, `${paths.gameDir}/geom`];
    checkRuleFiles(games, paths, report);
    checkPlaceholders(gameFiles, report);
    checkPurity(files, { what: 'game rules', allowed: pureFolders, testAllowed: [games.coreDir, paths.gameDir], aliases: games.aliases }, report);
    checkDeterminism(files, report);
    checkStateTypes(paths, files, report);
    checkMoveHandling(paths, files, report);
    checkRuleTests(paths, files, report);
    checkEngineAssembly(games, paths, files, report);
    checkModuleAssembly(games, paths, gameFiles, report);
    checkCatalogKeys(games, paths, [...files, ...gameFiles.filter((file) => file.rel === paths.module)], report);
    if (modules) checked += await runEngineContract(modules, games, paths, hasEndlessMode(gameFiles), report);
  }
  return report.finish({ checked, unit: 'kit files, games and runs' });
});
