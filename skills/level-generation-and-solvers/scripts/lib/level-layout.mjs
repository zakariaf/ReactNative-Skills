// level-layout.mjs: where the level kit, the games, the levels contract, the catalogs and the
// generator live in the app repo (check-lib's resolveLayout(), rn-skills.config.json and the
// checker's options), which games have levels, and the levels contract reader. Not an entry point.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, readText, resolveAlias, resolveLayout, toPosix } from '../check-lib.mjs';

/** A repo-relative folder or file option or config value: posix, no leading './', no trailing '/'. */
function relValue(value, what) {
  if (value === undefined || value === null) return undefined;
  const text = toPosix(String(value)).replace(/^\.\//, '').replace(/\/+$/, '');
  if (text === '' || text.startsWith('/') || text.split('/').includes('..')) {
    throw new UsageError(`${what} must be a repo-relative path, got ${JSON.stringify(value)}`, 'Pass a path inside the repo, for example src/games or contracts/levels.json.');
  }
  return text;
}

/**
 * The paths every check reads. rn-skills.config.json keys this skill documents: "gamesDir"
 * (default <srcDir>/games, shared with game-rules-engine), "levelsContract" (default
 * <contractsDir>/levels.json), "gameCatalogsDir" (default <i18nDir>/catalogs) and
 * "levelsGeneratorDir" (default <scriptsDir>/levels). coreDir, srcDir, i18nDir, scriptsDir and
 * contractsDir are check-lib layout keys.
 */
export function levelLayout(root, options = {}) {
  const layout = resolveLayout(root, { coreDir: relValue(options['core-dir'], '--core-dir') });
  const config = layout.config;
  const gamesDir = relValue(options['games-dir'], '--games-dir') ?? relValue(config.gamesDir, 'gamesDir') ?? `${layout.srcDir}/games`;
  const contract = relValue(options.contract, '--contract') ?? relValue(config.levelsContract, 'levelsContract') ?? `${layout.contractsDir}/levels.json`;
  const catalogsDir = relValue(options['catalogs-dir'], '--catalogs-dir') ?? relValue(config.gameCatalogsDir, 'gameCatalogsDir') ?? `${layout.i18nDir}/catalogs`;
  const generatorDir = relValue(options['generator-dir'], '--generator-dir') ?? relValue(config.levelsGeneratorDir, 'levelsGeneratorDir') ?? `${layout.scriptsDir}/levels`;
  const aliases = layout.aliases.length > 0 ? layout.aliases : [{ pattern: '@/*', targets: [`${layout.srcDir}/*`] }];
  return {
    root: layout.root,
    srcDir: layout.srcDir,
    coreDir: layout.coreDir,
    kitDir: `${layout.coreDir}/game`,
    gamesDir,
    contract,
    catalogsDir,
    generatorDir,
    goldensContract: `${layout.contractsDir}/goldens.json`,
    aliases,
    exists: (rel) => existsSync(join(layout.root, rel)),
  };
}

function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Game ids whose folder holds levels/ (a folder holding a SKILL.md is an installed skill, never a game). */
export function gamesWithLevels(paths) {
  const abs = join(paths.root, paths.gamesDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((id) => !existsSync(join(abs, id, 'SKILL.md')) && isDir(join(abs, id, 'levels')))
    .sort();
}

/** The paths of one game's level files. */
export function gameLevelPaths(paths, gameId) {
  const gameDir = `${paths.gamesDir}/${gameId}`;
  const levelsDir = `${gameDir}/levels`;
  return {
    gameId,
    gameDir,
    levelsDir,
    spec: `${levelsDir}/${gameId}-levels.ts`,
    plan: `${levelsDir}/${gameId}-level-plan.ts`,
    pack: (number) => `${levelsDir}/pack-${number}.json`,
  };
}

const GAME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A daily- or endless-only game: a levels contract entry with packCount 0 (and levelsPerPack 0, no
 * starRule). Its levels/ folder holds only the LevelsSpec (packs: [], table: []), its tests and,
 * with a daily level, the daily goldens: no plan, no packs, no pack names.
 */
export function isPackless(entry) {
  return entry !== null && entry !== undefined && entry.packCount === 0;
}
const ENTRY_KEYS = ['id', 'packCount', 'levelsPerPack', 'starRule', 'daily', 'endless'];

function entryProblem(entry, index) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return `games[${index}] is not an object`;
  const extra = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
  if (extra.length > 0) return `games[${index}] has unknown keys ${extra.join(', ')}`;
  if (typeof entry.id !== 'string' || !GAME_ID.test(entry.id)) return `games[${index}].id ${JSON.stringify(entry.id)} is not a kebab-case game id`;
  for (const key of ['packCount', 'levelsPerPack']) {
    if (!Number.isInteger(entry[key]) || entry[key] < 0) return `${entry.id}: ${key} ${JSON.stringify(entry[key])} is not a whole number >= 0`;
  }
  for (const key of ['daily', 'endless']) {
    if (typeof entry[key] !== 'boolean') return `${entry.id}: ${key} ${JSON.stringify(entry[key])} is not true or false`;
  }
  if (isPackless(entry)) {
    if (entry.levelsPerPack !== 0) return `${entry.id}: packCount 0 (a daily- or endless-only game) needs levelsPerPack 0, got ${entry.levelsPerPack}`;
    if (!entry.daily && !entry.endless) return `${entry.id}: packCount 0 with neither daily nor endless ships nothing (a game without levels has no entry)`;
    if (entry.starRule !== undefined) return `${entry.id}: packCount 0 has no levels to rate; leave starRule out`;
    return null;
  }
  if (entry.levelsPerPack < 1) return `${entry.id}: levelsPerPack ${entry.levelsPerPack} must be >= 1 when packCount is ${entry.packCount}`;
  if (entry.starRule !== 'par' && entry.starRule !== 'score') return `${entry.id}: starRule ${JSON.stringify(entry.starRule)} is neither "par" nor "score"`;
  return null;
}

/**
 * Reads the levels contract: { exists, entries: Map(id -> entry), problems: [message] }. Invalid
 * JSON is bad input (exit 2); a wrong shape is a list of problems.
 */
export function readLevelsContract(paths) {
  const path = join(paths.root, paths.contract);
  const text = existsSync(path) ? readText(path) : null;
  if (text === null) return { exists: false, entries: new Map(), problems: [] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${paths.contract} is not valid JSON: ${error.message}`, 'Fix the JSON (templates/contracts/levels.json shows the shape).');
  }
  const problems = [];
  const entries = new Map();
  if (data === null || typeof data !== 'object' || !Array.isArray(data.games)) return { exists: true, entries, problems: ['the contract has no "games" array'] };
  data.games.forEach((entry, index) => {
    const problem = entryProblem(entry, index);
    if (problem !== null) problems.push(problem);
    else if (entries.has(entry.id)) problems.push(`${entry.id} is listed twice`);
    else entries.set(entry.id, entry);
  });
  return { exists: true, entries, problems };
}

/** The contract markers of contracts/goldens.json (golden-and-snapshot-tests), default ['[contract]']. */
export function contractMarkers(paths) {
  try {
    const data = JSON.parse(readText(join(paths.root, paths.goldensContract)) ?? 'null');
    if (Array.isArray(data?.contractMarkers) && data.contractMarkers.every((marker) => typeof marker === 'string')) return data.contractMarkers;
  } catch {
    // An unreadable goldens contract is golden-and-snapshot-tests' finding; use the default marker.
  }
  return ['[contract]'];
}

/**
 * The tests contracts/goldens.json registers as compatibility contracts (golden-and-snapshot-tests'
 * `contracts[].test`), or null when the file does not exist yet.
 */
export function registeredGoldenTests(paths) {
  const path = join(paths.root, paths.goldensContract);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readText(path) ?? 'null');
    return new Set((Array.isArray(data?.contracts) ? data.contracts : []).map((entry) => entry?.test).filter((test) => typeof test === 'string'));
  } catch {
    return new Set(); // an unreadable goldens contract is golden-and-snapshot-tests' finding; nothing is registered
  }
}

/** The repo-relative target of a local import (relative, or through a tsconfig alias), or null for a package. */
export function localTarget(fromRel, specifier, aliases) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
  const candidates = resolveAlias(specifier, aliases);
  return candidates === null || candidates.length === 0 ? null : posix.normalize(toPosix(candidates[0]).replace(/^\.\//, ''));
}

export function isInside(rel, folder) {
  return rel === folder || rel.startsWith(`${folder}/`);
}

/** The default daily salt of a game id: FNV-1a over the id, folded to 16 bits. */
export function defaultSalt(gameId) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < gameId.length; index += 1) hash = Math.imul(hash ^ gameId.charCodeAt(index), 0x01000193) >>> 0;
  return (hash ^ (hash >>> 16)) & 0xffff;
}
