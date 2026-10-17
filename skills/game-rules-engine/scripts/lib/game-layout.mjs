// game-layout.mjs: where the game kit, the seeded RNG, the games and the catalogs live in the app
// repo, from check-lib's resolveLayout(), rn-skills.config.json and the checker's options; and the
// small path and source helpers the checks share. Not an entry point.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, readText, resolveAlias, resolveLayout, toPosix, walk } from '../check-lib.mjs';

/** A repo-relative folder option or config value: posix, no leading './', no trailing '/'. */
function folderValue(value, what) {
  if (value === undefined || value === null) return undefined;
  const text = toPosix(String(value)).replace(/^\.\//, '').replace(/\/+$/, '');
  if (text === '' || text.startsWith('/') || text.split('/').includes('..')) {
    throw new UsageError(`${what} must be a repo-relative folder, got ${JSON.stringify(value)}`, `Pass a folder inside the repo, for example ${what === '--games-dir' ? 'src/games' : 'src/i18n/catalogs'}.`);
  }
  return text;
}

/**
 * The folders every check reads. Keys of rn-skills.config.json this skill documents: "gamesDir"
 * (default <srcDir>/games) and "gameCatalogsDir" (default <i18nDir>/catalogs); coreDir, srcDir and
 * i18nDir are check-lib layout keys.
 */
export function gameLayout(root, options = {}) {
  const layout = resolveLayout(root, { coreDir: folderValue(options['core-dir'], '--core-dir') });
  const gamesDir = folderValue(options['games-dir'], '--games-dir') ?? folderValue(layout.config.gamesDir, 'gamesDir') ?? `${layout.srcDir}/games`;
  const catalogsDir = folderValue(options['catalogs-dir'], '--catalogs-dir') ?? folderValue(layout.config.gameCatalogsDir, 'gameCatalogsDir') ?? `${layout.i18nDir}/catalogs`;
  const aliases = layout.aliases.length > 0 ? layout.aliases : [{ pattern: '@/*', targets: [`${layout.srcDir}/*`] }];
  return {
    root: layout.root,
    srcDir: layout.srcDir,
    coreDir: layout.coreDir,
    kitDir: `${layout.coreDir}/game`,
    rngDir: `${layout.coreDir}/rng`,
    gamesDir,
    catalogsDir,
    aliases,
    exists: (rel) => existsSync(join(layout.root, rel)),
  };
}

function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isGameFolder(dir, id) {
  return ['rules', 'testing', 'canvas'].some((name) => isDir(join(dir, name))) || existsSync(join(dir, `${id}-game.ts`));
}

/**
 * Game ids, in name order: folders of gamesDir that hold rules/, testing/, canvas/ or their
 * <id>-game.ts (a game new-game-scaffold started before its rules exist is still a game, and its
 * missing rules folder is a problem). A folder holding a SKILL.md (an installed or vendored skill)
 * is never a game. `wanted` (from --game) replaces the discovery.
 */
export function discoverGames(games, wanted = []) {
  if (wanted.length > 0) return [...wanted];
  const abs = join(games.root, games.gamesDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((id) => !existsSync(join(abs, id, 'SKILL.md')) && isGameFolder(join(abs, id), id))
    .sort();
}

/** The paths one game's checks read. */
export function gamePaths(games, gameId) {
  const gameDir = `${games.gamesDir}/${gameId}`;
  const rulesDir = `${gameDir}/rules`;
  return {
    gameId,
    gameDir,
    rulesDir,
    types: `${rulesDir}/${gameId}-types.ts`,
    engine: `${rulesDir}/${gameId}-engine.ts`,
    persistence: `${rulesDir}/${gameId}-persistence.ts`,
    stats: `${rulesDir}/${gameId}-stats.ts`,
    testing: `${gameDir}/testing/${gameId}-testing.ts`,
    module: `${gameDir}/${gameId}-game.ts`,
    intent: `${gameDir}/canvas/intent-to-move.ts`,
  };
}

/** Files of a folder as { rel, text, isTest }; folders holding a SKILL.md are pruned. */
export function sources(root, folder) {
  const abs = join(root, folder);
  if (!isDir(abs)) return [];
  return walk(abs, { include: ['*.ts', '*.tsx'], pruneDirsContaining: ['SKILL.md'] }).map((rel) => ({
    rel: `${folder}/${rel}`,
    text: readText(join(abs, rel)) ?? '',
    isTest: /\.test\.tsx?$/.test(rel),
  }));
}

/**
 * The repo-relative target of a local import (relative, or through a tsconfig alias), or null for
 * a package. The extension is not probed: the checks compare folders.
 */
export function localTarget(fromRel, specifier, aliases) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
  const candidates = resolveAlias(specifier, aliases);
  return candidates === null || candidates.length === 0 ? null : posix.normalize(toPosix(candidates[0]).replace(/^\.\//, ''));
}

export function isInside(rel, folder) {
  return rel === folder || rel.startsWith(`${folder}/`);
}

export function pascal(id) {
  return id.split('-').map((word) => (word[0] ?? '').toUpperCase() + word.slice(1)).join('');
}

export function constant(id) {
  return id.toUpperCase().replaceAll('-', '_');
}
