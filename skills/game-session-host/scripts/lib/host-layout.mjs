// host-layout.mjs: where the game host, its run store, its data port, the app's games, the registry
// and the per-game config live in the app repo (check-lib's resolveLayout, rn-skills.config.json
// and the checker's options), the files the host must hold, and small source helpers. Not an
// entry point.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, readText, resolveLayout, toPosix, walkRepo } from '../check-lib.mjs';
import { isTestFile, maskCode } from './source-scan.mjs';

/** A repo-relative folder option or config value: posix, no leading './', no trailing '/'. */
function folderValue(value, what) {
  if (value === undefined || value === null) return undefined;
  const text = toPosix(String(value)).replace(/^\.\//, '').replace(/\/+$/, '');
  if (text === '' || text.startsWith('/') || text.split('/').includes('..')) {
    throw new UsageError(`${what} must be a repo-relative folder, got ${JSON.stringify(value)}`, 'Pass a folder inside the repo, for example src/games.');
  }
  return text;
}

/**
 * The folders every check reads. rn-skills.config.json keys this skill documents: "gamesDir"
 * (default <srcDir>/games, shared with game-rules-engine) and "gameHostDir" (default
 * <servicesDir>/game-host). The rest are check-lib layout keys.
 */
export function hostLayout(root, options = {}) {
  const layout = resolveLayout(root);
  const gamesDir = folderValue(options['games-dir'], '--games-dir') ?? folderValue(layout.config.gamesDir, 'gamesDir') ?? `${layout.srcDir}/games`;
  const hostDir = folderValue(options['host-dir'], '--host-dir') ?? folderValue(layout.config.gameHostDir, 'gameHostDir') ?? `${layout.servicesDir}/game-host`;
  return {
    root: layout.root,
    layout,
    srcDir: layout.srcDir,
    gamesDir,
    hostDir,
    storeDir: `${layout.storesDir}/game-session`,
    dataDir: `${layout.dataDir}/game-runs`,
    resultsDir: `${layout.coreDir}/game-results`,
    kitDir: `${layout.coreDir}/game`,
    hooksDir: `${layout.srcDir}/hooks`,
    testGamesDir: `${layout.testDir}/games`,
    registry: `${gamesDir}/game-registry.ts`,
    config: `${layout.configDir}/game-host-config.ts`,
    contract: `${layout.contractsDir}/architecture.json`,
    exists: (rel) => existsSync(join(layout.root, rel)),
    read: (rel) => (existsSync(join(layout.root, rel)) ? (readText(join(layout.root, rel)) ?? '') : ''),
  };
}

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** Game ids: folders of gamesDir that hold rules/, canvas/, <id>-game.ts or <id>-hosted.ts(x). */
export function discoverGames(host, wanted = []) {
  if (wanted.length > 0) return [...wanted];
  const abs = join(host.root, host.gamesDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !existsSync(join(abs, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .filter((id) => ['rules', 'canvas'].some((name) => isDir(join(abs, id, name))) || ['-game.ts', '-hosted.ts', '-hosted.tsx'].some((end) => existsSync(join(abs, id, `${id}${end}`))))
    .sort();
}

/**
 * The files the host is made of, each with the exports others rely on and whether it carries
 * runtime code (and so needs a test beside it). Paths are relative to the layout folders above.
 */
export function hostFiles(host) {
  const at = (dir, file, exports, isRuntime = true) => ({ rel: `${dir}/${file}`, exports, isRuntime });
  return [
    at(host.resultsDir, 'run-ref.ts', ['RunRef', 'runKeyOf']),
    // The one star formula is level-generation-and-solvers' file; the host carries a synced copy.
    at(`${host.kitDir}/level-kit`, 'star-rating.ts', ['starsFor', 'isScoreRule', 'StarCount']),
    at(host.storeDir, 'game-session-types.ts', ['GameSession', 'SessionAction', 'SessionRules'], false),
    at(host.storeDir, 'game-session-transitions.ts', ['gameSessionReducer', 'startGameSession', 'canUndo', 'isRescuePending']),
    at(host.storeDir, 'game-session-store.ts', ['createGameSessionStore', 'useGameSessionStore']),
    at(host.storeDir, 'saved-run.ts', ['toSavedRun', 'restoreRun']),
    at(host.dataDir, 'game-runs-repository.ts', ['GameRunsRepository', 'SavedRun', 'RunEndRecord'], false),
    at(host.dataDir, 'fake-game-runs-repository.ts', ['createFakeGameRunsRepository']),
    at(host.hostDir, 'hosted-game.ts', ['HostedGame', 'GameSurfaceProps', 'TutorialSpec'], false),
    at(host.hostDir, 'session-view.ts', ['SessionView', 'SessionCommand', 'SessionHandle'], false),
    at(host.hostDir, 'session-view-of.ts', ['sessionViewOf', 'continueStateOf']),
    at(host.hostDir, 'session-extras.ts', ['createSessionExtras']),
    at(host.hostDir, 'play-clock.ts', ['createPlayClock', 'MAX_PLAY_DELTA_MS']),
    at(host.hostDir, 'measure-counters.ts', ['measureCounters']),
    at(host.hostDir, 'run-summary.ts', ['summarizeRun', 'runEndOf']),
    at(host.hostDir, 'run-end-policy.ts', ['isLossStranded', 'RescueOffer', 'backCommandOf']),
    at(host.hostDir, 'open-session.ts', ['newSession', 'resumeSession', 'sessionRulesFor']),
    at(host.hostDir, 'tutorial-script.ts', ['isTutorialMoveAccepted', 'tutorialCoachOf', 'isSameMove']),
    at(host.hostDir, 'session-persist.ts', ['persistStep', 'recordFinishedRun', 'isDecided']),
    at(host.hostDir, 'session-controller.ts', ['createSessionController']),
    at(host.hostDir, 'host-runs.ts', ['openRun', 'savedSession', 'settleAbandoned']),
    at(host.hostDir, 'game-host.ts', ['createGameHost', 'GameHost', 'GameHostDeps', 'GameHostOptions']),
    at(host.hostDir, 'board-host-model.ts', ['routeIntent', 'selectedAt']),
    at(host.hostDir, 'create-board-host.tsx', ['createBoardHost']),
    at(host.hostDir, 'game-host-context.tsx', ['GameHostsProvider', 'useGameHost', 'useGameHosts']),
    at(host.hostDir, 'use-game-session.ts', ['useGameSession']),
    at(host.hooksDir, 'use-pause-on-background.ts', ['usePauseOnBackground', 'shouldPauseRun']),
    at(host.testGamesDir, 'tally-game.ts', ['TALLY_GAME', 'TALLY_TUTORIAL', 'tallyTap'], false),
  ];
}

/** `export (const|function|type|...) Name` and `export { Name }` names of a source. */
export function exportNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|type|interface|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Source files under a folder (repo walk: installed skills and build output are never read). */
export function sourcesUnder(host, dir, { tests = false } = {}) {
  if (!host.exists(dir)) return [];
  return walkRepo(host.root, { include: ['*.ts', '*.tsx'] })
    .filter((rel) => rel.startsWith(`${dir}/`) && !rel.endsWith('.d.ts') && (tests || !isTestFile(rel)))
    .map((rel) => ({ rel, source: host.read(rel), masked: maskCode(host.read(rel)) }));
}

/** Every runtime source of the app (src/, not tests). */
export function appSources(host) {
  return sourcesUnder(host, host.srcDir);
}

/** 1-based line of an index. */
export function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

export const pascalOf = (id) => id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
export const constOf = (id) => id.toUpperCase().replace(/-/g, '_');
