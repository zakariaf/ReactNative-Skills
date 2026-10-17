// game-checks.mjs: the checks of one game, wherever it lives (inside the one app, or inside its own
// white-label app): its declaration, its catalog keys, template placeholders left behind and, at the
// complete stage, every part, the evidence, the host registration and the loaded module agreeing
// with the declaration. One function per area. Not an entry point.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, matchGlob, maskComments, notYetCreated, readText, walkRepo } from '../check-lib.mjs';
import { errorText } from './app-modules.mjs';
import { catalogLocales, frameKeys, namespaceKeys, readCatalog } from './game-catalogs.mjs';
import { entryProblems, idForms, isDir, lineOfEntry, readJsonFile } from './games-contract.mjs';

/** Platform and bundler identifiers that look like placeholders but are real names. */
export const NOT_PLACEHOLDERS = Object.freeze(new Set(['__DEV__', '__OBJC__', '__LINE__', '__FILE__', '__APPLE__', '__GLOBAL__', '__BUNDLE_START_TIME__', '__METRO_GLOBAL_PREFIX__', '__STDC__', '__TIME__', '__DATE__']));
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*[A-Z0-9]__/g;

/** One repo walk per root (check-lib's walkRepo: generated and build output of the app and of every
 * workspace, node_modules, Pods, agent skill folders, and any folder holding a SKILL.md left out). */
const repoWalks = new Map();
function repoFiles(root) {
  if (!repoWalks.has(root)) repoWalks.set(root, walkRepo(root));
  return repoWalks.get(root);
}

/** Every file of a folder (repo-relative) from the one repo walk, optionally only names matching `include`. */
export function folderFiles(root, folder, include) {
  if (!isDir(join(root, folder))) return [];
  const prefix = `${folder}/`;
  return repoFiles(root).filter((rel) => rel.startsWith(prefix) && (include === undefined || include.some((glob) => matchGlob(rel.slice(rel.lastIndexOf('/') + 1), glob))));
}

const isTest = (rel) => /\.test\.tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel);

/** The declaration of one game: present and well-formed. Returns the entry or null. */
export function checkDeclaration(ctx, report) {
  const { games, contract, gameId } = ctx;
  if (!contract.exists) {
    report.problem({ file: games.contract, rule: 'declaration', message: `does not exist, so ${gameId} has no declaration`, fix: `Run node <this skill>/scripts/scaffold-game.mjs . --game ${gameId} --name "<Name>" --hints none|solver --continue none|once --add-missing: it declares the game from its design notes.` });
    return null;
  }
  if (contract.error) {
    report.problem({ file: games.contract, line: 1, rule: 'declaration', message: contract.error, fix: 'Fix the JSON (the schema is contracts/games.schema.json).' });
    return null;
  }
  const entry = Array.isArray(contract.data.games) ? contract.data.games.find((item) => item?.id === gameId) : undefined;
  if (entry === undefined) {
    report.problem({ file: games.contract, line: 1, rule: 'declaration', message: `does not declare ${gameId} (the folder ${ctx.where.gameDir} exists)`, fix: `Declare it: node <this skill>/scripts/scaffold-game.mjs . --game ${gameId} --name "<Name>" --hints none|solver --continue none|once --add-missing.` });
    return null;
  }
  const line = lineOfEntry(contract.text, gameId);
  for (const [field, message] of entryProblems(entry)) report.problem({ file: games.contract, line, rule: 'declaration', message: `${gameId}: ${message}`, fix: field === '' ? 'Remove the keys the schema does not allow: the entry holds only the schema\'s fields (contracts/games.schema.json).' : `Correct ${field} to what the game's rules really do (schema: contracts/games.schema.json).` });
  return entry;
}

/** Every '<id>.*' key literal in the game's non-test source, as [{ rel, line, key }]. */
export function usedKeys(root, gameDir, gameId) {
  const pattern = new RegExp(`(['"\`])(${gameId.replace(/-/g, '\\-')}(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*){1,4})\\1`, 'g');
  const found = [];
  for (const rel of folderFiles(root, gameDir, ['*.ts', '*.tsx']).filter((file) => !isTest(file))) {
    const text = maskComments(readText(join(root, rel)) ?? '');
    for (const match of text.matchAll(pattern)) found.push({ rel, line: lineOf(text, match.index), key: match[2] });
  }
  return found;
}

/**
 * The game's keys in every catalog: readable flat catalogs, non-empty texts, <id>.name, the same
 * namespace keys in every locale, every key the declaration and the code name, approved copy kept,
 * retired keys gone. Returns { locales, catalogs } for the later checks.
 */
export function checkCatalogs(ctx, entry, report) {
  const { root, gameId, where, stage, copy } = ctx;
  const catalogsDir = where.catalogsDir;
  const locales = catalogLocales(root, catalogsDir);
  if (locales.length === 0) {
    const reason = stage === 'scaffold' && !where.isApp ? notYetCreated(root, { file: `${catalogsDir}/en.json`, owner: 'i18n-strings-and-catalogs' }) : null;
    if (reason) report.skip({ file: catalogsDir, rule: 'catalog-missing-key', message: reason });
    else report.problem({ file: catalogsDir, rule: 'catalogs', message: 'holds no <locale>.json catalog, so the game has no texts', fix: where.isApp ? `Run scaffold-game.mjs . --game ${gameId} --add-missing: it writes the app's catalogs.` : 'Create the app\'s catalogs (i18n-strings-and-catalogs), then run scaffold-game.mjs --add-missing.' });
    return { locales: [], catalogs: {} };
  }
  const catalogs = {};
  for (const locale of locales) {
    const read = readCatalog(root, catalogsDir, locale);
    catalogs[locale] = read;
    if (read.error) {
      report.problem({ file: read.rel, line: 1, rule: 'catalogs', message: read.error, fix: 'Catalogs are flat: key -> ICU message, no nesting (i18n-strings-and-catalogs).' });
      continue;
    }
    for (const key of namespaceKeys(read.catalog, gameId).filter((item) => read.catalog[item].trim() === '')) report.problem({ file: read.rel, line: lineOf(read.text, read.text.indexOf(`"${key}"`)), rule: 'catalogs', message: `${key} is empty`, fix: 'Write the text (source language first; drafts go on the review queue).' });
  }
  const readable = locales.filter((locale) => !catalogs[locale].error);
  // Every locale holds the union of the game's keys; each gap is reported on the catalog that lacks it.
  const union = [...new Set(readable.flatMap((locale) => namespaceKeys(catalogs[locale].catalog, gameId)))].sort();
  for (const locale of readable) {
    const missing = union.filter((key) => !(key in catalogs[locale].catalog));
    if (missing.length === 0) continue;
    const holders = (key) => readable.filter((other) => key in catalogs[other].catalog).map((other) => `${other}.json`).join(', ');
    report.problem({ file: catalogs[locale].rel, line: 1, rule: 'catalog-keys', message: `lacks ${gameId}.* keys other catalogs have: ${missing.map((key) => `${key} (in ${holders(key)})`).join(', ')}`, fix: 'Every locale has the same keys: write the source text first, then every language (drafts on the review queue), or delete a key from every catalog at once.' });
  }
  const needed = [
    // An undeclared or malformed game is the declaration rule's: only its code's keys are checked here.
    ...(entry === null ? [] : frameKeys(entry).map(({ key }) => ({ key, rel: ctx.games.contract, line: lineOfEntry(ctx.contract.text, gameId) }))),
    ...usedKeys(root, where.gameDir, gameId),
  ];
  const seen = new Set();
  for (const { key, rel, line } of needed) {
    const missing = readable.filter((locale) => !(key in catalogs[locale].catalog));
    const id = `${rel}:${key}`;
    if (missing.length === 0 || seen.has(id)) continue;
    seen.add(id);
    report.problem({ file: rel, line, rule: 'catalog-missing-key', message: `${key} is missing in ${missing.map((locale) => `${locale}.json`).join(', ')}`, fix: `Add it to every catalog in ${catalogsDir} (scaffold-game.mjs --add-missing adds the name and lose keys; other keys go in with the i18n workflow).` });
  }
  if (copy.exists) {
    for (const [key, row] of Object.entries(copy.strings)) {
      if (!key.startsWith(`${gameId}.`) || row === null || typeof row !== 'object') continue;
      for (const locale of readable) {
        const have = catalogs[locale].catalog[key];
        if (have === undefined || typeof row[locale] !== 'string' || have === row[locale]) continue;
        report.problem({ file: catalogs[locale].rel, line: lineOf(catalogs[locale].text, catalogs[locale].text.indexOf(`"${key}"`)), rule: 'copy-source-text', message: `${key} is ${JSON.stringify(have)}, but the approved copy (${copy.rel}) says ${JSON.stringify(row[locale])}`, fix: 'Copy the approved text (sync-copy.mjs apply, i18n-strings-and-catalogs); a wording change goes into the copy source first, never into one catalog.' });
      }
    }
    for (const key of Object.keys(copy.retired).filter((item) => item.startsWith(`${gameId}.`))) {
      for (const locale of readable.filter((item) => key in catalogs[item].catalog)) report.problem({ file: catalogs[locale].rel, line: lineOf(catalogs[locale].text, catalogs[locale].text.indexOf(`"${key}"`)), rule: 'retired-key', message: `${key} is retired (${copy.retired[key]})`, fix: 'Delete it from every catalog and use its replacement.' });
      for (const use of usedKeys(root, where.gameDir, gameId).filter((item) => item.key === key)) report.problem({ file: use.rel, line: use.line, rule: 'retired-key', message: `uses the retired key ${key} (${copy.retired[key]})`, fix: 'Use its replacement.' });
    }
  }
  return { locales: readable, catalogs };
}

/**
 * Template placeholders (__GAME_ID__, __BUNDLE_ID__, ...) left in the game folder (or its whole app)
 * and in the game's evidence files elsewhere in the repo (`files`: its sims, board golden and flow).
 */
export function checkPlaceholders(ctx, folders, report, files = []) {
  const seen = new Set();
  for (const list of [...folders.map((folder) => folderFiles(ctx.root, folder)), files]) {
    for (const rel of list) {
      if (seen.has(rel) || rel.includes('/assets/fonts/')) continue;
      seen.add(rel);
      const text = readText(join(ctx.root, rel));
      if (text === null) continue;
      const match = [...text.matchAll(PLACEHOLDER)].find((item) => !NOT_PLACEHOLDERS.has(item[0]));
      if (match) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'placeholder-left', message: `template placeholder ${match[0]} was not replaced`, fix: `Fill it from the scaffold's table (__GAME_ID__=${ctx.gameId}, __GAME_PASCAL__=${idForms(ctx.gameId).pascal}, __GAME_CAMEL__=${idForms(ctx.gameId).camel}, __GAME_CONST__=${idForms(ctx.gameId).constant}) or the value the template names.` });
    }
  }
}

/**
 * Every part of a finished game: files (any one satisfies the part) and the skill that builds it.
 * The surface is skia-canvas-rendering's canvas/<id>-surface.ts (rendered by the shared surface host);
 * a real-time board is realtime-game-loop's canvas/draw-*.ts (rendered by the real-time host).
 */
export function gameParts(entry, gameId) {
  const rules = ['create', 'list-moves', 'apply-move', 'outcome'].map((name) => ({ part: `rules ${name}`, any: [`rules/${name}.ts`], skill: 'game-rules-engine' }));
  const surfaces = [`canvas/${gameId}-surface.ts`, `canvas/${gameId}-surface.tsx`];
  const isRealtime = entry?.class === 'realtime';
  return [
    { part: 'rules types', any: [`rules/${gameId}-types.ts`], skill: 'game-rules-engine' },
    ...rules,
    { part: 'tuning (every balance number)', any: [`rules/${gameId}-tuning.ts`], skill: 'game-rules-engine' },
    { part: 'engine assembly', any: [`rules/${gameId}-engine.ts`], skill: 'game-rules-engine' },
    { part: 'persistence', any: [`rules/${gameId}-persistence.ts`], skill: 'game-rules-engine' },
    { part: 'statistics counters', any: [`rules/${gameId}-stats.ts`], skill: 'game-rules-engine' },
    { part: 'bot and example states', any: [`testing/${gameId}-testing.ts`], skill: 'game-rules-engine' },
    { part: 'intent function', any: ['canvas/intent-to-move.ts'], skill: 'canvas-gestures-and-hit-testing' },
    isRealtime
      ? { part: 'the board (canvas/<id>-surface.ts or a real-time canvas/draw-*.ts)', test: (files) => files.some((rel) => surfaces.includes(rel) || (/^canvas\/draw-[^/]+\.ts$/.test(rel) && !isTest(rel))), any: [`canvas/draw-<board>.ts`], skill: 'realtime-game-loop' }
      : { part: `canvas surface (canvas/${gameId}-surface.ts)`, any: surfaces, skill: 'skia-canvas-rendering' },
    { part: 'game module', any: [`${gameId}-game.ts`], skill: 'game-rules-engine' },
    { part: 'game module contract test', any: [`${gameId}-game.test.ts`], skill: 'game-rules-engine' },
    { part: 'hosted binding (the module plus its Surface)', any: [`${gameId}-hosted.ts`, `${gameId}-hosted.tsx`], skill: 'game-session-host' },
    // A daily- or endless-only game (levels: null) still has a LevelsSpec: its daily or endless mode.
    ...(entry?.levels || entry?.daily || entry?.endless ? [{ part: 'levels spec', any: [`levels/${gameId}-levels.ts`], skill: 'level-generation-and-solvers' }] : []),
    ...(isRealtime
      ? [
          { part: 'real-time sim (sim/)', test: (files) => files.some((rel) => /^sim\/.+\.ts$/.test(rel) && !isTest(rel)), any: ['sim/<sim>.ts'], skill: 'realtime-game-loop' },
          { part: 'real-time spec (the RealtimeSpec the module joins as realtime)', any: [`${gameId}-realtime.ts`], skill: 'realtime-game-loop' },
        ]
      : []),
  ];
}

const escapeId = (gameId) => gameId.replace(/-/g, '\\-');

/**
 * Evidence files, matched by name (a heuristic: references/checker.md lists what it cannot see).
 * Board golden: a <id>[-.]*.golden.test.ts(x) anywhere under <testDir>/goldens/ (skia-canvas-rendering
 * writes test/goldens/canvas/<id>.golden.test.ts); the level table's value golden
 * (levels/<id>-levels.golden.test.ts) is not a picture of the board.
 * E2E flow: e2e-maestro's .maestro/flows/<area>/<nn>-<name>.yaml, with the id as the area folder or
 * as the name (01-lights-out.yaml), or any .yaml whose name or folder is the id.
 */
export function isBoardGolden(rel, gameId) {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return new RegExp(`^${escapeId(gameId)}([.-][^/]*)?\\.golden\\.test\\.tsx?$`).test(name) && !new RegExp(`^${escapeId(gameId)}-(levels|daily)\\b`).test(name) && !rel.split('/').includes('levels');
}

export function isGameFlow(rel, gameId) {
  const segments = rel.split('/');
  const name = segments.at(-1);
  const named = (segment) => segment === gameId || segment.startsWith(`${gameId}.`) || segment.startsWith(`${gameId}-`);
  return segments.some(named) || new RegExp(`^\\d+-${escapeId(gameId)}([.-]|$)`).test(name);
}

/**
 * The game's files outside its folder that the complete stage counts as evidence: the sims folder,
 * board goldens and E2E flows naming the game. The placeholder scan reads them at both stages.
 */
export function evidenceFiles(ctx) {
  const { root, gameId, where } = ctx;
  return [
    ...folderFiles(root, `${where.testDir}/sims/${gameId}`),
    ...folderFiles(root, `${where.testDir}/goldens`).filter((rel) => isBoardGolden(rel, gameId)),
    ...folderFiles(root, where.e2eDir, ['*.yaml', '*.yml']).filter((rel) => isGameFlow(rel.slice(where.e2eDir.length + 1), gameId)),
  ];
}

/** Stage complete: every part, the evidence and the host registration exist. */
export function checkCompleteness(ctx, entry, report) {
  const { root, gameId, where } = ctx;
  const files = folderFiles(root, where.gameDir).map((rel) => rel.slice(where.gameDir.length + 1));
  for (const part of gameParts(entry, gameId)) {
    const isThere = part.test ? part.test(files) : part.any.some((rel) => files.includes(rel));
    if (!isThere) report.problem({ file: `${where.gameDir}/${part.any[0]}`, rule: 'part-missing', message: `${part.part} is missing`, fix: `Build it with the ${part.skill} skill (test-first), then rerun.` });
  }
  const evidence = [
    { part: 'bot simulations (*.sim.test.ts)', where: `${where.testDir}/sims/${gameId}/*.sim.test.ts`, ok: () => folderFiles(root, `${where.testDir}/sims/${gameId}`).some((rel) => rel.endsWith('.sim.test.ts')), fix: 'Add the balance sims with the game-balance-and-bots skill: winnable, the difficulty curve inside its bands, every run ends.' },
    { part: 'a pixel golden of the board (<id>*.golden.test.ts under the goldens folder)', where: `${where.testDir}/goldens/canvas/${gameId}.golden.test.ts`, ok: () => folderFiles(root, `${where.testDir}/goldens`).some((rel) => isBoardGolden(rel, gameId)), fix: 'Add the surface golden with the skia-canvas-rendering skill (realtime-game-loop for a real-time board; golden-and-snapshot-tests owns the matcher and the register). The level table\'s value golden does not count.' },
    { part: 'an E2E flow that plays the game (.maestro/flows/<area>/<nn>-<name>.yaml naming the game)', where: `${where.e2eDir}/flows/games/01-${gameId}.yaml`, ok: () => folderFiles(root, where.e2eDir, ['*.yaml', '*.yml']).some((rel) => isGameFlow(rel.slice(where.e2eDir.length + 1), gameId)), fix: `Add a flow that opens the game and makes one real move with the e2e-maestro skill (.maestro/flows/games/01-${gameId}.yaml or .maestro/flows/${gameId}/01-play.yaml); run it on a named iOS simulator and a named Android emulator.` },
  ];
  for (const item of evidence) if (!item.ok()) report.problem({ file: item.where, rule: 'evidence-missing', message: `missing for ${gameId}: ${item.part}`, fix: item.fix });
  // game-session-host's registry: one factory per game, createGameHost(<CONST>_HOSTED, ...), the
  // binding imported from the game's <id>-hosted module.
  const hosted = `${idForms(gameId).constant}_HOSTED`;
  const registry = where.registry;
  const text = existsSync(join(root, registry)) ? maskComments(readText(join(root, registry)) ?? '') : null;
  const imports = text !== null && new RegExp(`import\\s*\\{[^}]*\\b${hosted}\\b[^}]*\\}\\s*from\\s*['"](?:@/games/${gameId}|\\./${gameId})/${gameId}-hosted(?:\\.tsx?)?['"]`).test(text);
  const hosts = text !== null && new RegExp(`createGameHost\\s*\\(\\s*${hosted}\\b`).test(text);
  if (!imports || !hosts) report.problem({ file: registry, line: 1, rule: 'host-registration', message: text === null ? `does not exist, so the app hosts no game and ${gameId} cannot be played` : `does not host ${gameId} (import ${hosted} from '@/games/${gameId}/${gameId}-hosted' and call createGameHost(${hosted}, ...))`, fix: `Add one factory per game with game-session-host: (deps) => createGameHost(${hosted}, { ...deps, options: GAME_HOST_CONFIG['${gameId}'] }).` });
}

/** Bare imports that cannot load in Node: React Native, Expo and Skia (a package's own source fails to parse). */
const UI_PACKAGE = /^(?:react-native(?:-[\w-]+)?|expo(?:-[\w-]+)?|@expo\/[\w./-]+|@shopify\/react-native-skia|@react-native[\w./-]*)(?:\/|$)/;
const IMPORT_SPECIFIER = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveLocal(root, fromRel, specifier, srcDir) {
  let base;
  if (specifier.startsWith('@/')) base = `${srcDir}/${specifier.slice(2)}`;
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = join(fromRel, '..', specifier).replace(/\\/g, '/');
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

/**
 * The first React Native, Expo or Skia import in the module's static import graph (relative and @/
 * specifiers, type-only imports skipped), with the chain of files that reaches it, or null. Node's own
 * error names only the package's source ("Unexpected token 'typeof'"), so the check names the importer.
 */
function firstUiImport(root, startRel, srcDir) {
  const seen = new Set([startRel]);
  const queue = [[startRel]];
  while (queue.length > 0) {
    const chain = queue.shift();
    const rel = chain.at(-1);
    const code = maskComments(readText(join(root, rel)) ?? '');
    for (const match of code.matchAll(IMPORT_SPECIFIER)) {
      if (/^(?:import|export)\s+type\b/.test(match[0])) continue;
      const specifier = match[1] ?? match[2];
      if (UI_PACKAGE.test(specifier)) return { chain, specifier };
      const next = resolveLocal(root, rel, specifier, srcDir);
      if (next !== null && !seen.has(next)) {
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return null;
}

/** The game module value of <id>-game.ts: the export with identity, engine, input and rules. */
function moduleValue(exports) {
  return Object.values(exports ?? {}).find((value) => value !== null && typeof value === 'object' && 'identity' in value && 'engine' in value && 'input' in value && 'rules' in value);
}

/** The levels contract of level-generation-and-solvers: { rel, exists, error, entry, text }. */
function readLevelsContract(root, rel, gameId) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { rel, exists: false, error: null, entry: undefined, text: '' };
  const text = readFileSync(abs, 'utf8');
  const { value, error } = readJsonFile(abs);
  if (error || value === null || typeof value !== 'object' || !Array.isArray(value.games)) return { rel, exists: true, error: error ? `is not valid JSON: ${error}` : 'has no "games" list', entry: undefined, text };
  return { rel, exists: true, error: null, entry: value.games.find((item) => item?.id === gameId), text };
}

/**
 * Stage complete: the declaration and level-generation-and-solvers' contracts/levels.json state one
 * pack layout. A game with packs, or with only a daily level or an endless run (levels: null, which
 * the levels contract writes as packCount 0 and levelsPerPack 0), has an entry there with the same
 * packCount, levelsPerPack, daily and endless; a game with none of them has no entry.
 */
export function checkLevelsContract(ctx, entry, report) {
  const { root, gameId, where } = ctx;
  const levels = readLevelsContract(root, where.levelsContract, gameId);
  const at = (text) => (text ? lineOfEntry(text, gameId) : 1);
  const mismatch = (message, line) => report.problem({ file: levels.rel, line, rule: 'declaration-mismatch', message: `${gameId}: ${message}`, fix: 'contracts/levels.json (level-generation-and-solvers) and contracts/games.json state one pack layout (a daily- or endless-only game: packCount 0, levelsPerPack 0): correct whichever is wrong, regenerate the packs if the layout changed, and commit both together.' });
  const hasModes = entry.daily || entry.endless;
  if (entry.levels === null && !hasModes) {
    if (levels.entry !== undefined) mismatch('the levels contract lists the game, but its declaration has no level packs, no daily level and no endless run', at(levels.text));
    return;
  }
  const layout = entry.levels ?? { packs: 0, levelsPerPack: 0 };
  if (levels.error) return mismatch(`the levels contract ${levels.error}`, 1);
  const declared = entry.levels === null ? `no packs but ${[entry.daily ? 'a daily level' : null, entry.endless ? 'an endless run' : null].filter(Boolean).join(' and ')}` : `${layout.packs} packs of ${layout.levelsPerPack} levels`;
  if (!levels.exists || levels.entry === undefined) return mismatch(`the declaration has ${declared}, but ${levels.exists ? 'the levels contract has no entry for the game' : 'the levels contract does not exist'}`, 1);
  const line = at(levels.text);
  if (entry.levels === null && (levels.entry.packCount !== 0 || levels.entry.levelsPerPack !== 0)) {
    mismatch(`the levels contract says packCount: ${JSON.stringify(levels.entry.packCount)} and levelsPerPack: ${JSON.stringify(levels.entry.levelsPerPack)}, the declaration says levels: null (no packs: a pack-less entry has packCount 0 and levelsPerPack 0)`, line);
  }
  const pairs = [
    ...(entry.levels === null
      ? []
      : [
          ['packCount', levels.entry.packCount, 'levels.packs', layout.packs],
          ['levelsPerPack', levels.entry.levelsPerPack, 'levels.levelsPerPack', layout.levelsPerPack],
        ]),
    ['daily', levels.entry.daily, 'daily', entry.daily],
    ['endless', levels.entry.endless, 'endless', entry.endless],
  ];
  for (const [field, have, declared, want] of pairs) if (have !== want) mismatch(`the levels contract says ${field}: ${JSON.stringify(have)}, the declaration says ${declared}: ${JSON.stringify(want)}`, line);
}

/**
 * Stage complete: the loaded module agrees with the declaration (identity, pan mode, hints, continue,
 * levels, daily, endless), and the rules' lose keys are exactly the declared ways of losing.
 */
export async function checkAgreement(ctx, entry, report) {
  const { root, gameId, where, modules } = ctx;
  const moduleRel = `${where.gameDir}/${gameId}-game.ts`;
  const contractLine = lineOfEntry(ctx.contract.text, gameId);
  const mismatch = (message) => report.problem({ file: ctx.games.contract, line: contractLine, rule: 'declaration-mismatch', message: `${gameId}: ${message}`, fix: 'Make the declaration and the code say the same thing: correct whichever is wrong (the declaration is the design; the code is what ships).' });
  if (existsSync(join(root, moduleRel))) {
    let game;
    try {
      game = moduleValue(await modules.load(moduleRel.slice(where.moduleRootPrefix.length)));
      if (game === undefined) throw new Error('no export has identity, engine, input and rules');
    } catch (error) {
      const ui = firstUiImport(root, moduleRel, where.srcDir ?? ctx.games.srcDir);
      const found = ui === null ? '' : ` (${ui.chain.join(' -> ')} imports ${ui.specifier})`;
      report.problem({ file: moduleRel, line: 1, rule: 'module-load', message: `cannot be loaded headless${found}: ${errorText(error)}`, fix: 'The module and everything it imports must be pure TypeScript (no React Native, Expo or Skia import): bots, solvers and this check load it in Node.' });
    }
    if (game !== undefined) {
      const identity = game.identity ?? {};
      if (identity.id !== gameId || identity.nameId !== `${gameId}.name`) {
        const code = maskComments(readText(join(root, moduleRel)) ?? '');
        const at = code.search(/\bidentity\s*:/);
        report.problem({ file: moduleRel, line: at < 0 ? 1 : lineOf(code, at), rule: 'module-identity', message: `identity is ${JSON.stringify({ id: identity.id, nameId: identity.nameId })}, not { id: '${gameId}', nameId: '${gameId}.name' }`, fix: `Set identity to { id: '${gameId}', nameId: '${gameId}.name' }: the id keys every saved run and statistic, so a copied game's id files this game's runs under the other game.` });
      }
      if ((entry.class === 'realtime') !== (game.realtime !== undefined && game.realtime !== null)) mismatch(entry.class === 'realtime' ? 'the declaration says class "realtime", but the module has no realtime spec (realtime-game-loop joins <id>-realtime.ts as realtime)' : `the module has a realtime spec, the declaration says class ${JSON.stringify(entry.class)}`);
      if (game.input?.panMode !== entry.panMode) mismatch(`the module's input.panMode is ${JSON.stringify(game.input?.panMode)}, the declaration says ${JSON.stringify(entry.panMode)}`);
      if (game.rules?.hints?.kind !== entry.hints) mismatch(`the module's rules.hints.kind is ${JSON.stringify(game.rules?.hints?.kind)}, the declaration says ${JSON.stringify(entry.hints)} (a declared hint the rules lack is a promise the game breaks)`);
      if (game.rules?.continueRun?.kind !== entry.continue) mismatch(`the module's rules.continueRun.kind is ${JSON.stringify(game.rules?.continueRun?.kind)}, the declaration says ${JSON.stringify(entry.continue)}`);
      // A LevelsSpec without packs carries only a daily or an endless mode: declared as levels: null.
      const levels = game.levels ?? null;
      const packs = levels !== null && Array.isArray(levels.packs) ? levels.packs : [];
      if (entry.levels === null && packs.length > 0) mismatch(`the module has ${packs.length} level packs, the declaration says levels: null`);
      if (entry.levels !== null) {
        if (levels === null) mismatch('the declaration has level packs, the module\'s levels is null');
        else {
          if (packs.length !== entry.levels.packs) mismatch(`the module has ${packs.length} level packs, the declaration says ${entry.levels.packs}`);
          if (packs.some((pack) => pack?.levelCount !== entry.levels.levelsPerPack)) mismatch(`a pack does not hold ${entry.levels.levelsPerPack} levels (levelsPerPack)`);
        }
      }
      if ((levels?.daily?.kind === 'daily') !== entry.daily) mismatch(`the module's levels.daily is ${JSON.stringify(levels === null ? null : levels.daily?.kind)}, the declaration says daily: ${entry.daily}`);
      if ((levels?.endless?.kind === 'endless') !== entry.endless) mismatch(`the module's levels.endless is ${JSON.stringify(levels === null ? null : levels.endless?.kind)}, the declaration says endless: ${entry.endless}`);
    }
  }
  const rulesDir = `${where.gameDir}/rules`;
  const produced = new Map();
  for (const rel of folderFiles(root, rulesDir, ['*.ts']).filter((file) => !isTest(file))) {
    const text = maskComments(readText(join(root, rel)) ?? '');
    for (const match of text.matchAll(new RegExp(`(['"\`])${gameId.replace(/-/g, '\\-')}\\.lose\\.([a-z0-9]+(?:-[a-z0-9]+)*)\\1`, 'g'))) {
      if (!produced.has(match[2])) produced.set(match[2], { rel, line: lineOf(text, match.index) });
    }
  }
  for (const [reason, at] of produced) if (!entry.loseReasons.includes(reason)) report.problem({ file: at.rel, line: at.line, rule: 'lose-reasons', message: `the rules can end a run with ${gameId}.lose.${reason}, which the declaration does not list`, fix: `Add "${reason}" to loseReasons in contracts/games.json (and its text to every catalog), or remove the way of losing.` });
  if (isDir(join(root, rulesDir))) {
    for (const reason of entry.loseReasons.filter((item) => !produced.has(item))) report.problem({ file: ctx.games.contract, line: contractLine, rule: 'lose-reasons', message: `${gameId}: declares the way of losing "${reason}", but no rules file returns ${gameId}.lose.${reason}`, fix: 'Remove it from loseReasons, or make outcome() return that reason key.' });
  }
}

/** Game folders of a games folder: every child folder without a SKILL.md (a vendored skill is never a game). */
export function gameFolders(root, gamesDir) {
  const abs = join(root, gamesDir);
  if (!isDir(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('.') && !existsSync(join(abs, item.name, 'SKILL.md')))
    .map((item) => item.name)
    .sort();
}

/** The root package.json "new-game" script, when declared, runs a file that exists. */
export function checkNewGameScript(root, report) {
  let script;
  try {
    script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.scripts?.['new-game'];
  } catch {
    return;
  }
  const target = typeof script === 'string' ? /\bnode\s+(?:--\S+\s+)*(\S+\.(?:ts|mjs|js))\b/.exec(script)?.[1] : undefined;
  if (typeof script === 'string' && (target === undefined || !existsSync(join(root, target)))) report.problem({ file: 'package.json', line: 1, rule: 'new-game-script', message: target === undefined ? `the "new-game" script (${script}) runs no file through node` : `the "new-game" script runs ${target}, which does not exist`, fix: 'Copy templates/scripts/games/new-game.ts and find-generator.ts (with its test) from this skill and set "new-game": "node scripts/games/new-game.ts".' });
}
