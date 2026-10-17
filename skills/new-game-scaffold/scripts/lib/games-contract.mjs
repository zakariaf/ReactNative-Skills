// games-contract.mjs: the game id and its forms, where games live in the app repo, and the repo-owned
// declaration contracts/games.json that the generator writes and the checker holds the code to.
// Not an entry point.
//
// Layout keys this skill reads from rn-skills.config.json (all optional): "gamesDir" (default
// <srcDir>/games), "gameCatalogsDir" (default <i18nDir>/catalogs), "gamesContract" (default
// <contractsDir>/games.json), "levelsContract" (default <contractsDir>/levels.json, the key
// level-generation-and-solvers reads) and "copySource" (default <contractsDir>/copy-source.json, the
// key i18n-strings-and-catalogs reads); srcDir, i18nDir, contractsDir, testDir and e2eDir are
// check-lib layout keys.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError, resolveLayout, toPosix } from '../check-lib.mjs';

/** kebab-case ASCII words; the first character is a letter, so the Android package part is valid too. */
export const GAME_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Ids that would collide with the app's own folders, aliases or the generator. */
export const RESERVED_IDS = Object.freeze(new Set(['app', 'apps', 'core', 'game', 'games', 'kit', 'new-game', 'packages', 'shared', 'test', 'testing']));
export const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const GAME_CLASSES = Object.freeze(['turn-based', 'simulate-replay', 'realtime']);
export const PAN_MODES = Object.freeze(['none', 'swipe', 'drag', 'aim']);
export const HINT_KINDS = Object.freeze(['none', 'solver']);
export const CONTINUE_KINDS = Object.freeze(['none', 'once']);
/** Placeholders the skill's own templates and skeleton use, with the form each one takes. */
export const PLACEHOLDER_FORMS = Object.freeze({ __GAME_ID__: 'kebab', __GAME_PASCAL__: 'pascal', __GAME_CAMEL__: 'camel', __GAME_CONST__: 'constant' });

/** The four forms of a game id: kebab (the id), Pascal (types), camel (values), UPPER_SNAKE (constants). */
export function idForms(gameId) {
  const pascal = gameId
    .split('-')
    .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
    .join('');
  return { kebab: gameId, pascal, camel: (pascal[0] ?? '').toLowerCase() + pascal.slice(1), constant: gameId.toUpperCase().replaceAll('-', '_') };
}

/** The placeholder fill table every games skill's templates use. */
export function fillTable(gameId) {
  const forms = idForms(gameId);
  return Object.fromEntries(Object.entries(PLACEHOLDER_FORMS).map(([token, form]) => [token, forms[form]]));
}

/** Why an id cannot be a game id, or null. */
export function gameIdProblem(gameId) {
  if (typeof gameId !== 'string' || !GAME_ID.test(gameId)) return `"${gameId}" is not a kebab-case game id (lowercase letters and digits, words joined by single hyphens, starting with a letter)`;
  if (RESERVED_IDS.has(gameId)) return `"${gameId}" is reserved (it names a folder, alias or tool of the app)`;
  return null;
}

/** A repo-relative folder from an option or a config value, or undefined. */
function folderValue(value, what) {
  if (value === undefined || value === null) return undefined;
  const text = toPosix(String(value)).replace(/^\.\//, '').replace(/\/+$/, '');
  if (text === '' || text.startsWith('/') || text.split('/').includes('..')) throw new UsageError(`${what} must be a repo-relative path, got ${JSON.stringify(value)}`, `Pass a path inside the repo, for example ${what.includes('catalog') ? 'src/i18n/catalogs' : what.includes('levels') ? 'contracts/levels.json' : what.includes('copy') ? 'contracts/copy-source.json' : what.includes('ontract') ? 'contracts/games.json' : 'src/games'}.`);
  return text;
}

/**
 * Where the games, their catalogs and the declaration live, from check-lib's layout,
 * rn-skills.config.json and the script's options.
 */
export function gamesLayout(root, options = {}) {
  const layout = resolveLayout(root);
  const config = layout.config ?? {};
  return {
    layout,
    root: layout.root,
    srcDir: layout.srcDir,
    e2eDir: layout.e2eDir,
    testDir: layout.testDir,
    contractsDir: layout.contractsDir,
    gamesDir: folderValue(options['games-dir'], '--games-dir') ?? folderValue(config.gamesDir, 'gamesDir') ?? `${layout.srcDir}/games`,
    catalogsDir: folderValue(options['catalogs-dir'], '--catalogs-dir') ?? folderValue(config.gameCatalogsDir, 'gameCatalogsDir') ?? `${layout.i18nDir}/catalogs`,
    contract: folderValue(options.contract, '--contract') ?? folderValue(config.gamesContract, 'gamesContract') ?? `${layout.contractsDir}/games.json`,
    levelsContract: folderValue(config.levelsContract, 'levelsContract') ?? `${layout.contractsDir}/levels.json`,
    copySource: folderValue(config.copySource, 'copySource') ?? `${layout.contractsDir}/copy-source.json`,
  };
}

/**
 * The folders of one app of a white-label monorepo (apps/<id>): its own layout when it is a
 * workspace already, else the single-app defaults under the app folder.
 */
export function appLayout(games, appDir) {
  const workspace = games.layout.workspaces.find((entry) => entry.dir === appDir);
  const srcDir = workspace?.layout.srcDir ?? `${appDir}/src`;
  const i18nDir = workspace?.layout.i18nDir ?? `${srcDir}/i18n`;
  const contractsDir = workspace?.layout.contractsDir ?? `${appDir}/contracts`;
  return { appDir, srcDir, gamesDir: `${srcDir}/games`, catalogsDir: `${i18nDir}/catalogs`, e2eDir: workspace?.layout.e2eDir ?? `${appDir}/.maestro`, testDir: workspace?.layout.testDir ?? `${appDir}/test`, levelsContract: `${contractsDir}/levels.json` };
}

export function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

export function readJsonFile(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The declaration file: { exists, data, error, text } (data is null when absent or invalid). */
export function readContract(games) {
  const abs = join(games.root, games.contract);
  if (!existsSync(abs)) return { exists: false, data: null, error: null, text: '' };
  const text = readFileSync(abs, 'utf8');
  const { value, error } = readJsonFile(abs);
  if (error) return { exists: true, data: null, error: `is not valid JSON: ${error}`, text };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { exists: true, data: null, error: 'is not a JSON object', text };
  return { exists: true, data: value, error: null, text };
}

const isCount = (value, min) => Number.isInteger(value) && value >= min;

/**
 * The keys the shipped schema allows (templates/contracts/games.schema.json, read once): top level,
 * per game entry, and in the apps block. Read from the schema itself, so the checker and the schema
 * cannot drift (a key a revision dropped, such as an old "registry", is reported, not ignored).
 */
let schemaKeysCache = null;
export function schemaKeys() {
  if (schemaKeysCache === null) {
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'contracts', 'games.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    schemaKeysCache = Object.freeze({ top: Object.keys(schema.properties), entry: Object.keys(schema.properties.games.items.properties), apps: Object.keys(schema.properties.apps.properties) });
  }
  return schemaKeysCache;
}

/** Top-level problems of the declaration file (keys the schema does not allow), as [key, message]. */
export function contractProblems(data) {
  const { top } = schemaKeys();
  return Object.keys(data ?? {})
    .filter((key) => !top.includes(key))
    .map((key) => [key, `has the key "${key}", which the schema does not allow (allowed: ${top.join(', ')})`]);
}

/** Every problem of one declared game, as [field, message]. */
export function entryProblems(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [['', 'is not an object']];
  const problems = [];
  const need = (isOk, field, message) => {
    if (!isOk) problems.push([field, message]);
  };
  const unknown = Object.keys(entry).filter((key) => !schemaKeys().entry.includes(key));
  need(unknown.length === 0, '', `has ${unknown.map((key) => `"${key}"`).join(', ')}, which the schema does not allow (allowed: ${schemaKeys().entry.join(', ')})`);
  const idProblem = gameIdProblem(entry.id);
  need(idProblem === null, 'id', idProblem ?? '');
  need(typeof entry.name === 'string' && entry.name.trim() !== '', 'name', 'name is not the display name (a non-empty string)');
  need(GAME_CLASSES.includes(entry.class), 'class', `class is ${JSON.stringify(entry.class)}, not ${GAME_CLASSES.join(', ')}`);
  need(PAN_MODES.includes(entry.panMode), 'panMode', `panMode is ${JSON.stringify(entry.panMode)}, not ${PAN_MODES.join(', ')}`);
  need(HINT_KINDS.includes(entry.hints), 'hints', `hints is ${JSON.stringify(entry.hints)}, not ${HINT_KINDS.join(' or ')} (the game's rules decide it)`);
  need(CONTINUE_KINDS.includes(entry.continue), 'continue', `continue is ${JSON.stringify(entry.continue)}, not ${CONTINUE_KINDS.join(' or ')} (the game's rules decide it)`);
  need(typeof entry.daily === 'boolean' && typeof entry.endless === 'boolean', 'daily', 'daily and endless must be true or false');
  const { levels } = entry;
  // The pack layout matches level-generation-and-solvers' contracts/levels.json: a daily- or
  // endless-only game ships no packs, so it declares levels: null and its levels entry has packCount 0.
  const levelsOk = levels === null || (levels !== undefined && typeof levels === 'object' && !Array.isArray(levels) && isCount(levels.packs, 1) && isCount(levels.levelsPerPack, 1));
  need(levelsOk, 'levels', 'levels must be null (no level packs, also for a daily- or endless-only game) or { "packs": n >= 1, "levelsPerPack": n >= 1 }');
  const reasons = entry.loseReasons;
  need(Array.isArray(reasons) && reasons.every((reason) => typeof reason === 'string' && SLUG.test(reason)) && new Set(reasons).size === reasons.length, 'loseReasons', 'loseReasons must list distinct kebab-case reasons (one <id>.lose.<reason> key each; [] for a game that cannot be lost)');
  need(entry.app === undefined || (typeof entry.app === 'string' && !entry.app.startsWith('/') && !entry.app.split('/').includes('..')), 'app', 'app must be the repo-relative folder of the game\'s own app (multi-app only)');
  return problems;
}

/** Problems of the apps block (multi-app only), as [field, message]. */
export function appsBlockProblems(apps) {
  if (apps === null || typeof apps !== 'object' || Array.isArray(apps)) return [['apps', 'is not an object']];
  const problems = [];
  const need = (isOk, field, message) => {
    if (!isOk) problems.push([field, message]);
  };
  const unknown = Object.keys(apps).filter((key) => !schemaKeys().apps.includes(key));
  need(unknown.length === 0, 'apps', `apps has ${unknown.map((key) => `"${key}"`).join(', ')}, which the schema does not allow (allowed: ${schemaKeys().apps.join(', ')})`);
  need(typeof apps.dir === 'string' && apps.dir !== '' && !apps.dir.startsWith('/') && !apps.dir.includes('..'), 'apps.dir', 'apps.dir must be the repo-relative apps folder (apps)');
  need(typeof apps.scope === 'string' && /^@[a-z0-9][a-z0-9-._]*$/.test(apps.scope), 'apps.scope', 'apps.scope must be the npm scope of the apps (@acme)');
  need(typeof apps.bundlePrefix === 'string' && /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(apps.bundlePrefix), 'apps.bundlePrefix', 'apps.bundlePrefix must be a lowercase reverse-DNS prefix (com.acme)');
  need(Array.isArray(apps.products) && apps.products.every((item) => typeof item === 'string' && /^[a-z][a-z0-9_]*$/.test(item)), 'apps.products', 'apps.products must list product suffixes ([] or ["premium"])');
  need(Array.isArray(apps.locales) && apps.locales.length > 0 && apps.locales.every((item) => typeof item === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(item)), 'apps.locales', 'apps.locales must list the apps\' language tags (["en", "ar"])');
  const composer = apps.composer;
  need(composer !== null && typeof composer === 'object' && typeof composer.import === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(composer.name ?? '') && /^[A-Z][A-Za-z0-9]*$/.test(composer.type ?? ''), 'apps.composer', 'apps.composer must be { "import": "<module of the shared composer>", "name": "<its function>", "type": "<its settings type>" }');
  need(apps.fontsDir === undefined || (typeof apps.fontsDir === 'string' && !apps.fontsDir.startsWith('/') && !apps.fontsDir.includes('..')), 'apps.fontsDir', 'apps.fontsDir must be the repo-relative folder of the shared font files');
  need(apps.adUnits === null || (Array.isArray(apps.adUnits) && apps.adUnits.every((item) => typeof item === 'string' && /^[a-z][a-z0-9-]*$/.test(item))), 'apps.adUnits', 'apps.adUnits must be null (no ads) or the ad unit names (["banner", "interstitial", "rewarded"])');
  return problems;
}

/** The bundle id (iOS) and package (Android) of a game's app: <prefix>.<id without hyphens>. */
export function bundleIdFor(gameId, prefix) {
  return `${prefix}.${gameId.replaceAll('-', '')}`.toLowerCase();
}

/** The line of `"id": "<gameId>"` in the contract text (1 when absent). */
export function lineOfEntry(text, gameId) {
  const at = text.indexOf(`"id": "${gameId}"`);
  return at < 0 ? 1 : text.slice(0, at).split('\n').length;
}
