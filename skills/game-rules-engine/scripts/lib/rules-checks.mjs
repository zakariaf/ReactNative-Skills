// rules-checks.mjs: static checks of the kit's purity and determinism and of one game's rules
// folder, its assembly and its catalog keys. Not an entry point.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { notYetCreated, readText } from '../check-lib.mjs';
import { constant, isInside, localTarget, pascal } from './game-layout.mjs';
import { bare, code, exportNames, importsOf, matchesWithLines, typeBlock } from './ts-scan.mjs';

/** The four engine functions live one per file, under these names. */
export const RULE_FILES = {
  'create.ts': 'create',
  'list-moves.ts': 'listMoves',
  'apply-move.ts': 'applyMove',
  'outcome.ts': 'outcome',
};

const IMPURE = [
  { test: (s) => s === 'react-native' || s.startsWith('react-native-') || s.startsWith('react-native/') || s.startsWith('@react-native'), what: 'React Native' },
  { test: (s) => s === 'react' || s.startsWith('react/') || s.startsWith('react-'), what: 'React' },
  { test: (s) => s === 'expo' || s.startsWith('expo-') || s.startsWith('@expo/'), what: 'Expo' },
  { test: (s) => s.startsWith('@shopify/'), what: 'Skia' },
  { test: (s) => s === 'zustand' || s.startsWith('zustand/'), what: 'a state library' },
  { test: (s) => s.startsWith('node:'), what: 'a Node built-in' },
];

/** Math members the determinism policy allows: exactly specified by IEEE 754 / ECMA-262. */
const ALLOWED_MATH = new Set(['sqrt', 'imul', 'floor', 'round', 'abs', 'min', 'max', 'PI']);

const PAST_TENSE_WORDS = new Set([
  'won', 'lost', 'hit', 'dealt', 'drawn', 'drew', 'shot', 'swept', 'spun', 'built', 'set', 'split',
  'fell', 'fallen', 'began', 'begun', 'ran', 'broke', 'broken', 'made', 'found', 'struck', 'held',
  'cut', 'put', 'shut', 'spent', 'sent', 'bent', 'left', 'met', 'lit', 'led', 'fed', 'fled', 'sped',
  'slid', 'bit', 'hid', 'shed', 'spread', 'burst', 'cast', 'dug', 'hung', 'stuck', 'swung', 'flung',
  'wound', 'bound', 'sold', 'told', 'done', 'gone', 'seen', 'taken', 'given', 'thrown', 'blown',
  'grown', 'shown', 'flown', 'chosen', 'frozen', 'woken', 'risen', 'ridden', 'written', 'eaten',
  'fought', 'caught', 'taught', 'brought', 'bought', 'kept', 'slept', 'felt', 'meant', 'burnt',
  'over', 'froze', 'rose', 'rode', 'wrote', 'ate', 'became', 'came', 'went', 'got', 'gave', 'took',
]);

/** Past tense (heuristic): some word ends in -ed or is an irregular past form. */
export function isPastTense(kind) {
  return kind.split('-').some((word) => word.endsWith('ed') || PAST_TENSE_WORDS.has(word));
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Pure code imports no UI, platform or state library, and no local file outside `allowed` folders
 * (the kit: <coreDir>; rules: <coreDir> plus the game's own rules, levels and geom; a rules test
 * may also reach the game's other folders).
 */
export function checkPurity(files, scope, report) {
  for (const file of files) {
    const allowed = file.isTest && scope.testAllowed ? scope.testAllowed : scope.allowed;
    for (const { specifier, line } of importsOf(file.text)) {
      const impure = IMPURE.find((entry) => entry.test(specifier));
      if (impure) {
        report.problem({ file: file.rel, line, rule: 'pure-import', message: `imports ${specifier} (${impure.what}); ${scope.what} must run headless in Node`, fix: `${scope.what} import only ${allowed.join(', ')} and their own files; UI and platform code belongs in the game's canvas/ folder or the app.` });
        continue;
      }
      const target = localTarget(file.rel, specifier, scope.aliases);
      if (target !== null && !allowed.some((folder) => isInside(target, folder))) {
        report.problem({ file: file.rel, line, rule: 'pure-import', message: `imports ${specifier} (${target}), app code outside ${allowed.join(', ')}; ${scope.what} must run headless and alone`, fix: 'Pass the value in as an argument, or move the pure logic into src/core or the game\'s own rules/levels/geom; another game\'s code moves to src/core when two games share it.' });
      }
    }
  }
}

export function checkDeterminism(files, report) {
  for (const file of files) {
    const text = bare(file.text);
    const hits = [
      ...matchesWithLines(text, /\bMath\.random\b/g).map((hit) => ({ ...hit, what: 'Math.random' })),
      ...matchesWithLines(text, /\bDate\.now\b|\bnew\s+Date\b/g).map((hit) => ({ ...hit, what: 'the wall clock (Date)' })),
      ...matchesWithLines(text, /\bperformance\.now\b/g).map((hit) => ({ ...hit, what: 'performance.now' })),
    ];
    if (!file.isTest) {
      hits.push(...matchesWithLines(text, /\bMath\.([A-Za-z0-9_]+)/g).filter(({ match }) => !ALLOWED_MATH.has(match[1]) && match[1] !== 'random').map((hit) => ({ ...hit, what: `Math.${hit.match[1]}` })));
      hits.push(...matchesWithLines(text, /\*\*=?/g).map((hit) => ({ ...hit, what: 'the ** operator' })));
      hits.push(...matchesWithLines(text, /\bIntl\./g).map((hit) => ({ ...hit, what: 'Intl' })));
      hits.push(...matchesWithLines(text, /\.(localeCompare|toLocale[A-Za-z]*)\s*\(/g).map((hit) => ({ ...hit, what: `${hit.match[1]} (locale data differs between iOS, Android and Node)` })));
      hits.push(...matchesWithLines(text, /(?<![.\w])Date\b/g).filter(({ line }) => !/\bDate\.now\b|\bnew\s+Date\b/.test(text.split('\n')[line - 1] ?? '')).map((hit) => ({ ...hit, what: 'Date' })));
    }
    for (const { line, what } of hits) {
      report.problem({ file: file.rel, line, rule: 'determinism', message: `uses ${what}; results would differ between devices, Jest and replays`, fix: 'Use only + - * /, %, bitwise ops, Math.sqrt/imul/floor/round/abs/min/max/PI and the seeded RNG in src/core/rng; take time as ticks or values passed in; compare ids with < (seeded-determinism-and-golden-vectors owns the policy).' });
    }
  }
}

export function checkRuleFiles(games, paths, report) {
  if (!games.exists(paths.types)) report.problem({ file: paths.types, rule: 'rules-file-missing', message: 'the state, move and event types file is missing', fix: 'Copy templates/src/games/__GAME_ID__/rules/__GAME_ID__-types.ts and adapt it.' });
  for (const [file, name] of Object.entries(RULE_FILES)) {
    const rel = `${paths.rulesDir}/${file}`;
    if (!games.exists(rel)) {
      report.problem({ file: rel, rule: 'rules-file-missing', message: `${name} has no file of its own`, fix: `Write ${name} test-first in ${rel} (one engine function per file; start from the template).` });
    } else if (!exportNames(readText(join(games.root, rel)) ?? '').has(name)) {
      report.problem({ file: rel, line: 1, rule: 'rules-export-missing', message: `does not export ${name}`, fix: `Export the engine function by name: export function ${name}(...)` });
    }
  }
}

const DRAWS = /\b(next(?:Int|U32|Unit)|drawOne|drawSample|shuffle)\s*\(/;
const RNG_MODULE = /\/rng\/(?:sfc32|seeded-draws)(?:\.ts)?$/;

export function checkStateTypes(paths, files, report) {
  const types = files.find((file) => file.rel === paths.types);
  if (types === undefined) return;
  const text = bare(types.text);
  for (const { match, line } of matchesWithLines(text, /\b(Map|Set|WeakMap|ReadonlyMap|ReadonlySet|Date|bigint|symbol|(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array|Float(?:32|64)Array|Big(?:Ui|I)nt64Array|ArrayBuffer|SharedArrayBuffer|DataView)\b|\bclass\s/g)) {
    report.problem({ file: paths.types, line, rule: 'state-not-json', message: `uses ${match[0].trim()}; states, moves and events are saved and compared as JSON`, fix: 'Use plain objects, arrays, finite numbers, strings, booleans and null only.' });
  }
  const drawsAfterCreate = files
    .filter((file) => !file.isTest && !file.rel.endsWith('/create.ts'))
    .some((file) => importsOf(file.text).some(({ specifier, isType }) => !isType && RNG_MODULE.test(specifier)) && DRAWS.test(bare(file.text)));
  if (drawsAfterCreate && !/\bRngState\b/.test(code(types.text))) {
    report.problem({ file: paths.types, line: 1, rule: 'rng-not-in-state', message: 'rules draw random numbers after create() but the state holds no RngState', fix: 'Keep `rng: RngState` in the state and thread it: const draw = nextInt(state.rng, n); ... { ...state, rng: draw.state }. Never re-seed from the move count.' });
  }
  const eventName = `${pascal(paths.gameId)}Event`;
  const events = typeBlock(types.text, eventName);
  if (events === null) {
    report.problem({ file: paths.types, line: 1, rule: 'event-kind', message: `no exported ${eventName} type`, fix: `Declare export type ${eventName} = { readonly kind: '<past-tense-kebab>'; ... } | ...` });
    return;
  }
  for (const { match } of matchesWithLines(events.text, /kind:\s*'([^']*)'/g)) {
    const kind = match[1];
    if (!KEBAB.test(kind) || !isPastTense(kind)) {
      report.problem({ file: paths.types, line: events.line, rule: 'event-kind', message: `event kind '${kind}' is not a past-tense kebab-case name`, fix: "Name what happened: 'cells-toggled', 'die-rolled', 'board-cleared'." });
    }
  }
}

export function checkPlaceholders(files, report) {
  for (const file of files) {
    for (const { match, line } of matchesWithLines(file.text, /__GAME_[A-Z]+__/g)) {
      report.problem({ file: file.rel, line, rule: 'placeholder-left', message: `template placeholder ${match[0]} was not replaced`, fix: 'Replace __GAME_ID__ (kebab case), __GAME_PASCAL__ and __GAME_CONST__ (UPPER_SNAKE) with the forms of the game id.' });
    }
  }
}

export function checkMoveHandling(paths, files, report) {
  const applyRel = `${paths.rulesDir}/apply-move.ts`;
  const apply = files.find((file) => file.rel === applyRel);
  if (apply !== undefined && !/throw\s+new\s+RangeError\s*\(/.test(code(apply.text))) {
    report.problem({ file: applyRel, line: 1, rule: 'illegal-move-throws', message: 'applyMove never throws a RangeError for an illegal move', fix: 'Throw new RangeError(`illegal move ${JSON.stringify(move)}`) instead of returning the old or a corrupted state.' });
  }
  for (const file of files.filter((item) => !item.isTest)) {
    for (const { match, line } of matchesWithLines(code(file.text), /reasonKey:\s*['"`]([^'"`]*)['"`]/g)) {
      if (!match[1].startsWith(`${paths.gameId}.`)) {
        report.problem({ file: file.rel, line, rule: 'reason-key', message: `lose reason '${match[1]}' is not a ${paths.gameId}.* catalog key`, fix: `Use a semantic key in the app's catalogs, e.g. '${paths.gameId}.lose.out-of-moves'.` });
      }
    }
  }
}

export function checkRuleTests(paths, files, report) {
  const all = files.filter((file) => file.isTest).map((file) => code(file.text)).join('\n');
  if (!/\bfc\.assert\s*\(/.test(all)) report.problem({ file: paths.rulesDir, rule: 'property-tests', message: 'no fast-check property test in the rules folder', fix: 'Add fc.assert properties: same seed and moves give the same states (playChoices), invariants after any legal sequence, JSON round trip.' });
  if (!/JSON\.parse\s*\(\s*JSON\.stringify|engineContractProblems\s*\(/.test(all)) report.problem({ file: paths.rulesDir, rule: 'property-tests', message: 'no JSON round-trip test of a played state', fix: 'Assert JSON.parse(JSON.stringify(state)) deep-equals the state after random play, or run engineContractProblems.' });
  if (!/\bGOLDEN_[A-Z0-9_]+\b/.test(all)) report.problem({ file: paths.rulesDir, rule: 'pinned-golden', message: 'no pinned golden value (a GOLDEN_* constant) in the rules tests', fix: 'Pin one exact example, e.g. the board create(1, 0) makes, as GOLDEN_SEED_1_BOARD next to the properties.' });
}

function namesEvery(text, members) {
  return members.filter((member) => !new RegExp(`\\b${member}\\b`).test(text));
}

/** The rules-level assembly: <id>-engine.ts with GameEngine and GameRules, its contract test, persistence and stats. */
export function checkEngineAssembly(games, paths, files, report) {
  const assembled = games.exists(paths.module);
  const name = constant(paths.gameId);
  const engine = files.find((file) => file.rel === paths.engine);
  if (engine === undefined && assembled) report.problem({ file: paths.engine, rule: 'engine-missing', message: `the game module is assembled (${paths.module}) but the rules have no engine file`, fix: `Copy templates/src/games/__GAME_ID__/rules/__GAME_ID__-engine.ts: ${name}_ENGINE and ${name}_RULES.` });
  if (engine !== undefined) {
    const text = code(engine.text);
    if (!/:\s*GameEngine</.test(text) || !/:\s*GameRules</.test(text)) report.problem({ file: paths.engine, line: 1, rule: 'engine-typed', message: 'the engine and rules objects are not typed GameEngine<...> and GameRules<...>', fix: `export const ${name}_ENGINE: GameEngine<State, Move, Event> = {...}; export const ${name}_RULES: GameRules<State, Move, Event> = {...}` });
    for (const member of namesEvery(text, ['create', 'listMoves', 'applyMove', 'outcome', 'hud', 'undo', 'hints', 'continueRun'])) {
      report.problem({ file: paths.engine, line: 1, rule: 'engine-typed', message: `the engine assembly never names ${member}`, fix: 'Assemble the four engine functions and the four rules members by their canonical names.' });
    }
    if (!files.some((file) => file.isTest && /engineContractProblems\s*\(/.test(code(file.text)))) report.problem({ file: paths.rulesDir, rule: 'engine-contract-test', message: 'no rules test runs engineContractProblems on the engine', fix: 'Copy templates/src/games/__GAME_ID__/rules/__GAME_ID__-engine.test.ts.' });
  }
  const persistence = files.find((file) => file.rel === paths.persistence);
  if (persistence === undefined && assembled) report.problem({ file: paths.persistence, rule: 'persistence-missing', message: 'the game module is assembled but the rules have no persistence file', fix: 'Copy templates/src/games/__GAME_ID__/rules/__GAME_ID__-persistence.ts (parseState, parseMove, migrateState, savePolicy).' });
  if (persistence !== undefined) {
    for (const member of namesEvery(code(persistence.text), ['stateVersion', 'parseState', 'parseMove', 'migrateState', 'savePolicy'])) {
      report.problem({ file: paths.persistence, line: 1, rule: 'persistence-members', message: `PersistenceSpec member ${member} is missing`, fix: 'Declare every PersistenceSpec member; a run the game cannot parse is dropped alone.' });
    }
  }
  const stats = files.find((file) => file.rel === paths.stats);
  if (stats === undefined && assembled) report.problem({ file: paths.stats, rule: 'stats-missing', message: 'the game module is assembled but declares no statistics counters', fix: 'Copy templates/src/games/__GAME_ID__/rules/__GAME_ID__-stats.ts and declare 2 to 4 counters.' });
  if (stats !== undefined) checkCounters(stats, paths, report);
}

function checkCounters(stats, paths, report) {
  const text = code(stats.text);
  const ids = [...text.matchAll(/\bid:\s*'([^']*)'/g)].map((match) => match[1]);
  if (ids.length < 2 || ids.length > 4) report.problem({ file: paths.stats, line: 1, rule: 'stats-counters', message: `${ids.length} counters declared; a game's statistics card shows 2 to 4`, fix: 'Declare 2 to 4 CounterSpec entries.' });
  for (const id of ids.filter((item) => !KEBAB.test(item))) report.problem({ file: paths.stats, line: 1, rule: 'stats-counters', message: `counter id '${id}' is not kebab-case`, fix: 'Counter ids are kebab-case keys of stored statistics; choose them once and never rename.' });
  for (const match of text.matchAll(/labelId:\s*'([^']*)'/g)) {
    if (!match[1].startsWith(`${paths.gameId}.`)) report.problem({ file: paths.stats, line: 1, rule: 'stats-counters', message: `counter label '${match[1]}' is not a ${paths.gameId}.* catalog key`, fix: `Use '${paths.gameId}.stats.<counter-id>' and add it to every catalog.` });
  }
}

const PAN_MODES = ['none', 'swipe', 'drag', 'aim'];

/**
 * The module assembly <gamesDir>/<id>/<id>-game.ts: a typed GameModule with the input members
 * (panMode and selectRegions as literals), the game's id, and a test that runs the contract with
 * the input. Before the canvas surface exists the whole assembly is a SKIP.
 */
export function checkModuleAssembly(games, paths, gameFiles, report) {
  if (!games.exists(paths.module)) {
    if (games.exists(paths.intent)) {
      report.problem({ file: paths.module, rule: 'module-missing', message: `the canvas surface has an intent function (${paths.intent}) but the game is not assembled into a GameModule`, fix: 'Write the module file from this skill\'s examples/lights-out-module/: identity, engine, input (panMode, selectRegions, intentToMove), rules, persistence, stats, testing, levels; then its contract test with the input.' });
    } else {
      const reason = notYetCreated(games.root, { file: paths.intent, owner: 'canvas-gestures-and-hit-testing' });
      report.skip({ file: paths.intent, rule: 'module-missing', message: reason ?? 'not yet created' });
    }
    return;
  }
  const source = gameFiles.find((file) => file.rel === paths.module);
  const text = code(source?.text ?? '');
  if (!/:\s*GameModule</.test(text)) report.problem({ file: paths.module, line: 1, rule: 'module-typed', message: 'the module is not typed GameModule<State, Move, Event, Intent>', fix: `export const ${constant(paths.gameId)}_GAME: GameModule<State, Move, Event, CanvasIntent> = {...}` });
  for (const member of namesEvery(text, ['identity', 'engine', 'input', 'rules', 'persistence', 'stats', 'testing', 'levels', 'intentToMove'])) {
    report.problem({ file: paths.module, line: 1, rule: 'module-typed', message: `the module never names ${member}`, fix: 'Assemble every GameModule member by its canonical name (levels: null until the game has levels).' });
  }
  const id = /\bid:\s*['"]([^'"]*)['"]/.exec(text);
  if (id === null || id[1] !== paths.gameId) {
    report.problem({ file: paths.module, line: id ? text.slice(0, id.index).split('\n').length : 1, rule: 'identity-id', message: `identity.id is ${id ? `'${id[1]}'` : 'not a literal'}, but the game's folder is ${paths.gameDir}`, fix: `Set identity: { id: '${paths.gameId}', nameId: '${paths.gameId}.name' }: the id names the folder, the catalog namespace and every saved run.` });
  }
  checkPanMode(paths.module, text, report);
  if (!/\bselectRegions\s*:/.test(text)) report.problem({ file: paths.module, line: 1, rule: 'select-regions', message: 'the module sets no selectRegions', fix: "Set selectRegions: [] when every tap acts, or the regions whose taps only select (['tray']); the screen keeps the selection as UI state." });
  const tests = gameFiles.filter((file) => file.isTest && !isInside(file.rel, paths.rulesDir)).map((file) => code(file.text));
  if (!tests.some((test) => /engineContractProblems\s*\(/.test(test) && /\binput\s*[:,}]/.test(test))) {
    report.problem({ file: paths.module, line: 1, rule: 'module-contract-test', message: 'no test beside the module runs engineContractProblems with the input members', fix: 'Copy examples/lights-out-module/lights-out-game.test.ts: engineContractProblems({ ..., input: MODULE.input, intents: everyTap }) with the intents the surface sends.' });
  }
}

/** The module states the surface's pan gesture as a literal the screen hands to the gesture layer. */
function checkPanMode(rel, text, report) {
  const match = /\bpanMode\s*:\s*(['"])([^'"]*)\1/.exec(text);
  const line = match ? text.slice(0, match.index).split('\n').length : 1;
  const fix = "Set panMode: 'none' (taps only), 'swipe', 'drag' or 'aim' in the module's input, the mode whose intents intentToMove turns into moves (canvas-gestures-and-hit-testing has the patterns).";
  if (match === null) report.problem({ file: rel, line, rule: 'pan-mode', message: 'the module sets no panMode literal', fix });
  else if (!PAN_MODES.includes(match[2])) report.problem({ file: rel, line, rule: 'pan-mode', message: `panMode '${match[2]}' is not one of ${PAN_MODES.join(', ')}`, fix });
}

/** String literals that are this game's catalog keys ('<id>.<segment>...'), with where they are used. */
function catalogKeysUsed(gameId, files) {
  const pattern = new RegExp(`['"\`](${gameId.replaceAll('-', '\\-')}(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)+)['"\`]`, 'g');
  const used = new Map();
  for (const file of files.filter((item) => !item.isTest)) {
    for (const { match, line } of matchesWithLines(code(file.text), pattern)) {
      if (!used.has(match[1])) used.set(match[1], { file: file.rel, line });
    }
  }
  return used;
}

function readCatalog(root, rel) {
  try {
    const data = JSON.parse(readText(join(root, rel)) ?? 'null');
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Every catalog key the rules and the module name (lose reasons, the top-bar goal, the continue
 * text, counter labels, the game's name) is in every catalog of the app (<catalogsDir>/<locale>.json).
 */
export function checkCatalogKeys(games, paths, files, report) {
  const used = catalogKeysUsed(paths.gameId, files);
  if (used.size === 0) return;
  const reason = notYetCreated(games.root, { file: games.catalogsDir, owner: 'i18n-strings-and-catalogs' });
  if (reason !== null) {
    report.skip({ file: games.catalogsDir, rule: 'catalog-key-missing', message: reason });
    return;
  }
  const locales = readdirSync(join(games.root, games.catalogsDir)).filter((name) => name.endsWith('.json')).sort();
  if (locales.length === 0) {
    report.problem({ file: games.catalogsDir, rule: 'catalog-key-missing', message: `the catalogs folder holds no <locale>.json, and the game uses ${used.size} catalog keys`, fix: 'Create the app\'s catalogs (i18n-strings-and-catalogs), then add every key the game uses to each.' });
    return;
  }
  for (const locale of locales) {
    const rel = `${games.catalogsDir}/${locale}`;
    const catalog = readCatalog(games.root, rel);
    if (catalog === null) {
      report.problem({ file: rel, rule: 'catalog-key-missing', message: `${rel} is not a JSON object of messages`, fix: 'Repair the catalog (i18n-strings-and-catalogs owns its format).' });
      continue;
    }
    for (const [key, where] of used) {
      if (!Object.hasOwn(catalog, key)) report.problem({ file: where.file, line: where.line, rule: 'catalog-key-missing', message: `'${key}' is not in ${rel}`, fix: `Add '${key}' to every catalog (this skill's assets/template-catalog-keys.json has the template keys with an English and an RTL text); translations go through the app's review queue.` });
    }
  }
}

/** True when the game declares an endless mode (levels.endless or an endless tuning row). */
export function hasEndlessMode(gameFiles) {
  return gameFiles.filter((file) => !file.isTest).some((file) => /kind:\s*['"]endless['"]|\bisEndlessDifficulty\s*\(/.test(code(file.text)));
}

