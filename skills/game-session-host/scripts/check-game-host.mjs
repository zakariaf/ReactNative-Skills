#!/usr/bin/env node
// check-game-host.mjs: checks that the app hosts its games through one generic seam: the host's
// files and tests; its invariants proven by running the repo's own run store, controller and host
// against the repo's tally game (save before publish, one run-end write, one rescue, feedback once,
// stars and counters, a failed write shown, an unreadable run dropped alone, debug ends through the
// real write, an abandoned loss recorded, save points, the tutorial beside the saved run, Back);
// casts, type-erased screens, intents only through the game; the composition (hosts
// created once, never at import time, provided, options from the config); the Game screen's wiring;
// and each game's binding, registration, options against its rules, save policy and gameFacing.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-game-host.mjs [repo-root] [--game <id>]

import { createReporter, parseArgs, requireDir, run } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { discoverGames, hostLayout } from './lib/host-layout.mjs';
import { loadHostModules, probeGameRules, runHostProbes } from './lib/host-probes.mjs';
import { checkCasts, checkComposition, checkGameBinding, checkGameScreen, checkHostFiles, checkIntentLegality, checkTypeErasure } from './lib/host-static.mjs';
import { registerZustandStandIn } from './lib/zustand-stand-in.mjs';

const SPEC = {
  name: 'check-game-host',
  summary: 'Checks the game host (src/services/game-host, the run store in src/stores/game-session, the run repository port) and every game\'s assembly into the app, statically and by running the repo\'s own host modules against its tally test game.',
  usage: '[repo-root] [options]',
  options: {
    game: { type: 'string', multiple: true, value: 'id', help: 'Check only this game id (default: every <games-dir>/<id> with rules/, canvas/, <id>-game.ts or <id>-hosted.ts)' },
    'games-dir': { type: 'string', value: 'dir', help: 'Folder of the games (default: "gamesDir" in rn-skills.config.json, else <srcDir>/games)' },
    'host-dir': { type: 'string', value: 'dir', help: 'Folder of the host (default: "gameHostDir" in rn-skills.config.json, else <servicesDir>/game-host)' },
    'no-run': { type: 'boolean', help: 'Skip running code (the behaviour probes and the per-game option checks)' },
    'stand-ins': { type: 'boolean', help: 'Self-tests only: resolve zustand to a built-in stand-in when the repo has no node_modules' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (host):',
    '  host-file-missing / host-export-missing / host-test-missing  the host files, their exports, a test beside each runtime file',
    '  host-load              a host module or a game module cannot run in Node (a runtime React Native import, JSX in a .ts)',
    '  save-before-publish    the run store persists a change before set(); a failed write publishes nothing (run)',
    '  moves-only-while-playing / undo-not-after-loss / continue-once  the run reducer (run, on the tally game)',
    '  saved-run-validated    restore uses the game\'s parsers, keeps the snapshot, resumes paused; the host drops an',
    '                         unreadable saved run at boot, alone (run)',
    '  run-end-once           a decided run is recorded in ONE repository write before the result is published (run)',
    '  result-feedback        the deciding move plays win or lose once, after the end is on disk (run)',
    '  daily-practice         a replayed daily is practice: no new best, no best raised, the first result stays (run)',
    '  rescue-pending         a rescuable loss stays saved and unrecorded until declined (run)',
    '  abandoned-run-recorded a new run first records an abandoned decided run of the game, and never',
    '                         overwrites it unrecorded when that write fails (run)',
    '  save-point-write       a save-points (real-time) game writes at its save points, never per move (run)',
    '  tutorial-beside-run    the tutorial plays only each step\'s move, beside the saved run, writing nothing (run)',
    '  back-guard             Back pauses in play, resumes in Pause, finishes a pending loss (backCommandOf, run)',
    '  intent-legality        only the game\'s intentToMove makes moves; screens never apply or dispatch moves',
    '  stars-from-table / counters-from-log  stars from the level rule; counters from the kept moves only (run)',
    '  save-failure-shown     a failed write changes nothing on screen and sets saveFailure (run)',
    '  debug-run-end          the debug controls end a run through the real run-end write (run)',
    '  loss-not-stranded      isLossStranded is true exactly for a pending loss whose rescue is hidden (run)',
    '  play-time              only playing time counts, each step clamped to 0..300000 ms (run)',
    '  unsafe-cast            no cast in the seam, the run store, the registry or a game binding',
    '  screens-type-erased    routes, features, UI, stores and shared hooks never import a game or a typed seam part',
    'Rules (composition and screen):',
    '  host-not-created / host-at-import / host-in-render / host-not-provided  the registry creates hosts, never at',
    '                         import or in a render (outside a useState initializer), provided once',
    '  continue-from-config   the rescue switch comes from src/config/game-host-config.ts, never a literal',
    '  game-screen-wiring     the feature that calls useGameSession pauses on background, guards Back (usePreventRemove',
    '                         with backCommandOf), renders BoardHost, finishes a stranded loss (SKIP until it exists)',
    'Rules (each game):',
    '  hosted-binding         <id>-hosted.ts is { ...<ID>_GAME, Surface[, tutorial] } typed HostedGame',
    '  tutorial-legal         a tutorial lives in <id>/tutorial/<id>-tutorial.ts and every step is legal from its start (run)',
    '  game-registered        the registry imports the binding and calls createGameHost with it',
    '  config-rules           the game\'s options promise no rescue or free hint its rules cannot give (run)',
    '  save-policy            a game with sim/ saves at save points; a turn-based game after every move (run)',
    '  game-facing-recorded   contracts/architecture.json gameFacing lists the seam a binding imports',
    '',
    'NOT APPLICABLE when the app has no game and no host (games are an optional plugin).',
    'SKIP lines: src/features/game [game-screen-wiring] before the Game screen exists; contracts/architecture.json',
    '[game-facing-recorded] before architecture-and-boundaries created it.',
    'When multi-package: run once per app with the app folder as the repo root.',
    '',
    'Example: node check-game-host.mjs . --game lights-out',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-game-host', json: options.json });
  const host = hostLayout(root, options);
  const ids = discoverGames(host, options.game ?? []);
  if (ids.length === 0 && !host.exists(host.hostDir)) {
    return report.notApplicable(`the app has no game and no game host (no ${host.gamesDir}/<game-id>/ and no ${host.hostDir}/)`);
  }
  let checked = checkHostFiles(host, report);
  checkCasts(host, ids, report);
  checkTypeErasure(host, report);
  checkIntentLegality(host, report);
  checkComposition(host, ids.length > 0, report);
  checked += checkGameScreen(host, ids.length > 0, report);
  for (const id of ids) {
    checked += 1;
    checkGameBinding(host, id, report);
  }
  if (!options['no-run']) {
    const app = enableAppImports(root);
    // Registered after the app's hooks, so it runs first and falls back only when zustand is missing.
    if (options['stand-ins']) registerZustandStandIn();
    checked += runHostProbes(host, await loadHostModules(host, app, report), report);
    for (const id of ids) checked += await probeGameRules(host, app, id, report);
  }
  return report.finish({ checked, unit: 'host files, rules and games' });
});
