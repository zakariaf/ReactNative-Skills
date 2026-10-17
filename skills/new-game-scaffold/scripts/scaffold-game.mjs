#!/usr/bin/env node
// scaffold-game.mjs: starts a new game. It declares the game in contracts/games.json (its design
// notes as data: class, pan mode, levels, daily, endless, hints, continue, the ways of losing), adds
// its name and lose keys to every message catalog of the app (the approved copy wins), and, with
// --app (when multi-package: one game = one white-label app), writes the app skeleton apps/<id>/
// with dependencies in lockstep with the other apps. Dry run by default; --write writes only when
// nothing conflicts; --add-missing writes only what is absent. It never changes an existing value.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/scaffold-game.mjs . --game <id> --name "<Name>" --hints none --continue none [--write]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { AD_UNIT_NAMES } from './lib/app-skeleton.mjs';
import { readCopySource } from './lib/game-catalogs.mjs';
import { CONTINUE_KINDS, GAME_CLASSES, HINT_KINDS, PAN_MODES, SLUG, appLayout, appsBlockProblems, entryProblems, fillTable, gameIdProblem, gamesLayout, readContract } from './lib/games-contract.mjs';
import { buildPlan, existingApps } from './lib/scaffold-plan.mjs';

const SPEC = {
  name: 'scaffold-game',
  summary: 'Plans (default), writes (--write) or completes (--add-missing) a new game: its entry in contracts/games.json, its name and lose keys in every catalog of the app, and with --app its own white-label app skeleton. It never changes an existing value.',
  usage: '[repo-root] --game <id> [--name "<Name>"] [--hints none|solver] [--continue none|once] [options]',
  options: {
    game: { type: 'string', value: 'id', help: 'The game id, kebab-case and permanent (lights-out): the folder, identity.id, the catalog namespace, the saved-run key' },
    name: { type: 'string', value: 'text', help: 'The display name in the source language (required for a new game)' },
    hints: { type: 'string', value: 'kind', help: 'none, or solver when a solver proves the next move (required for a new game: the rules decide it)' },
    continue: { type: 'string', value: 'kind', help: 'none, or once when the rules offer one continue after a loss (required for a new game)' },
    class: { type: 'string', value: 'class', help: `${GAME_CLASSES.join(' | ')} (default turn-based)` },
    'pan-mode': { type: 'string', value: 'mode', help: `${PAN_MODES.join(' | ')}: the pan gesture the board uses (default none: taps only)` },
    levels: { type: 'string', value: 'PxL', help: 'none (default; also a daily- or endless-only game), or <packs>x<levels per pack> such as 3x30 when the game ships generated level packs' },
    daily: { type: 'boolean', help: 'The game has a daily level (the plan prints its deterministic default salt)' },
    endless: { type: 'boolean', help: 'The game has an endless run at difficulty 100' },
    'lose-reason': { type: 'string', multiple: true, value: 'slug', help: 'A way of losing, one <id>.lose.<slug> key each (repeatable; none for a game that cannot be lost)' },
    app: { type: 'boolean', help: 'When multi-package: also write the game\'s own app <apps.dir>/<id>/ (needs the apps block in contracts/games.json)' },
    write: { type: 'boolean', help: 'Write the plan (writes nothing when any file conflicts)' },
    'add-missing': { type: 'boolean', help: 'Write only what is absent (files, keys, the entry) and list what it keeps' },
    'games-dir': { type: 'string', value: 'dir', help: 'Where the games live (default: gamesDir in rn-skills.config.json, else <srcDir>/games)' },
    'catalogs-dir': { type: 'string', value: 'dir', help: 'The catalogs folder (default: gameCatalogsDir, else <i18nDir>/catalogs)' },
    contract: { type: 'string', value: 'file', help: 'The declaration (default: gamesContract, else <contractsDir>/games.json)' },
    'source-locale': { type: 'string', value: 'tag', help: 'The language of --name (default: en when the app has it, else the first catalog); every other catalog gets drafts' },
    'bundle-id': { type: 'string', value: 'id', help: 'Not accepted: a white-label app\'s bundle id is derived from apps.bundlePrefix (exit 2)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Plan lines: "new <file>", "same <file>", "edit <file> (+ ...)" (additions only), "keep <file>: <why>"',
    '(--add-missing: an existing value differs and stays), "draft <file>: <keys>" (source-language text in',
    'another language: translate it, then it goes on the review queue) and "FAIL <file> [conflict]".',
    'Rules: conflict (an existing value differs; --write writes nothing), deps-lockstep (--app: the existing',
    'apps disagree on their dependencies, so the new app has no single set to copy).',
    'A game already declared takes its entry\'s values; an option that differs from the entry is a conflict.',
    '',
    'Examples:',
    '  node scaffold-game.mjs . --game lights-out --name "Lights Out" --hints none --continue once',
    '  node scaffold-game.mjs . --game lights-out --name "Lights Out" --hints none --continue once --levels 3x30 --daily --lose-reason out-of-moves --write',
    '  node scaffold-game.mjs . --game lights-out --add-missing          (complete a declared game)',
    '  node scaffold-game.mjs . --game lights-out ... --app --write      (when multi-package: the game\'s own app)',
  ].join('\n'),
};

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function choice(value, allowed, option) {
  if (value !== undefined && !allowed.includes(value)) fail(`--${option} ${value} is not ${allowed.join(' or ')}`, `Pass --${option} ${allowed.join('|')}.`);
  return value;
}

function levelsOption(value) {
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) fail(`--levels ${value} is not none or <packs>x<levels per pack> with at least one pack of at least one level`, 'Pass --levels 3x30 for three packs of thirty levels, or --levels none for a game without level packs (a daily- or endless-only game too: --daily or --endless alone).');
  return { packs: Number(match[1]), levelsPerPack: Number(match[2]) };
}

/** The entry to declare: the existing one, with explicit options on top (a difference is a conflict). */
function entryFor(options, existing) {
  const required = (key, what) => {
    const value = options[key] ?? existing?.[key === 'continue' ? 'continue' : key];
    if (value === undefined) fail(`--${key} is required for a new game: ${what}`, key === 'name' ? 'Pass --name "Lights Out".' : `Pass --${key} ${key === 'hints' ? HINT_KINDS.join('|') : CONTINUE_KINDS.join('|')}: the game's rules decide it, so there is no default.`);
    return value;
  };
  const reasons = options['lose-reason'].length > 0 ? options['lose-reason'] : existing?.loseReasons ?? [];
  for (const reason of reasons) if (!SLUG.test(reason)) fail(`--lose-reason ${reason} is not kebab-case words`, 'Name what happened: --lose-reason out-of-moves.');
  const levels = levelsOption(options.levels);
  const entry = {
    id: options.game,
    name: required('name', 'the display name'),
    class: choice(options.class, GAME_CLASSES, 'class') ?? existing?.class ?? 'turn-based',
    panMode: choice(options['pan-mode'], PAN_MODES, 'pan-mode') ?? existing?.panMode ?? 'none',
    levels: levels !== undefined ? levels : existing?.levels ?? null,
    daily: options.daily ? true : existing?.daily ?? false,
    endless: options.endless ? true : existing?.endless ?? false,
    hints: choice(required('hints', 'only the rules know whether a solver proves the next move'), HINT_KINDS, 'hints'),
    continue: choice(required('continue', 'only the rules know whether a lost run can continue once'), CONTINUE_KINDS, 'continue'),
    loseReasons: reasons,
  };
  if (existing?.app !== undefined) entry.app = existing.app;
  return entry;
}

function appModeFor(games, contract, entry, report, isNeeded) {
  const apps = contract.data?.apps;
  if (apps === undefined) fail(`${games.contract} has no "apps" block, so there is no white-label app to write`, 'Add the apps block (dir, scope, bundlePrefix, products, locales, composer, adUnits; see the skill\'s templates/contracts/games.json and references/white-label-apps.md), or drop --app for a game inside the one app.');
  const problems = appsBlockProblems(apps);
  if (problems.length > 0) fail(`${games.contract} ${problems.map(([, message]) => message).join('; ')}`, 'Fix the apps block (references/white-label-apps.md), then rerun.');
  const workspaces = games.layout.workspaces.map((item) => item.dir);
  const manifest = JSON.parse(readFileSync(join(games.root, 'package.json'), 'utf8'));
  const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages ?? [];
  if (!patterns.some((pattern) => pattern === `${apps.dir}/*` || pattern === `${apps.dir}/**`) && !workspaces.some((dir) => dir.startsWith(`${apps.dir}/`))) fail(`the root package.json "workspaces" does not include ${apps.dir}/*`, `Add "${apps.dir}/*" to "workspaces" (expo-project-bootstrap, when multi-package), then rerun.`);
  const appDir = entry.app ?? `${apps.dir}/${entry.id}`;
  entry.app = appDir;
  const others = existingApps(games.root, apps.dir, appDir.split('/').at(-1));
  let dependencies = null;
  if (others.length > 0) {
    const [first, ...rest] = others;
    for (const other of rest) {
      if (isNeeded && JSON.stringify(other.dependencies) !== JSON.stringify(first.dependencies)) report.problem({ file: `${other.dir}/package.json`, rule: 'deps-lockstep', message: `dependencies differ from ${first.dir}/package.json, so a new app has no single set to copy`, fix: 'Give every app the same dependency set at the same versions first (dependency-management), then scaffold.' });
    }
    dependencies = first.dependencies;
  }
  const copy = readCopySource(games.root, games.copySource);
  const names = Object.fromEntries(apps.locales.map((locale) => [locale, copy.strings[`${entry.id}.name`]?.[locale] ?? entry.name]));
  for (const unit of apps.adUnits ?? []) if (!AD_UNIT_NAMES.includes(unit)) fail(`apps.adUnits lists ${unit}, which has no sample id`, `Use the unit names ${AD_UNIT_NAMES.join(', ')}.`);
  return { apps, appDir, appCatalogsDir: appLayout(games, appDir).catalogsDir, dependencies, names };
}


/**
 * The default daily salt of a game id, the same value level-generation-and-solvers' check-levels
 * prints: FNV-1a over the id, folded to 16 bits. Deterministic, so every run of the plan agrees.
 */
function defaultDailySalt(gameId) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < gameId.length; index += 1) hash = Math.imul(hash ^ gameId.charCodeAt(index), 0x01000193) >>> 0;
  return (hash ^ (hash >>> 16)) & 0xffff;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options['bundle-id'] !== undefined) fail(`--bundle-id ${options['bundle-id']} is not accepted: a white-label app's bundle id is <apps.bundlePrefix>.<game id without hyphens>`, 'Set apps.bundlePrefix in contracts/games.json once (it is the same for every app) and rerun without --bundle-id.');
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (options.game === undefined) fail('--game is required', 'Pass the game id: --game lights-out.');
  const idProblem = gameIdProblem(options.game);
  if (idProblem) fail(`--game ${idProblem}`, 'Pass a kebab-case id that starts with a letter, e.g. --game lights-out.');
  if (options.write && options['add-missing']) fail('pass --write or --add-missing, not both', '--write writes a new game; --add-missing completes one that exists.');
  const games = gamesLayout(root, options);
  const contract = readContract(games);
  if (contract.error) fail(`${games.contract} ${contract.error}`, 'Fix the declaration file first; the generator never rewrites a file it cannot read.');
  const existing = Array.isArray(contract.data?.games) ? contract.data.games.find((item) => item?.id === options.game) : undefined;
  const entry = entryFor(options, existing);
  const report = createReporter({ name: 'scaffold-game' });
  const isAppMode = Boolean(options.app) || existing?.app !== undefined;
  const appMode = isAppMode ? appModeFor(games, contract, entry, report, true) : null;
  const problems = entryProblems(entry);
  if (problems.length > 0) fail(problems.map(([, message]) => message).join('; '), 'Fix the options and rerun.');
  const copy = readCopySource(games.root, games.copySource);
  const schemaText = readFileSync(join(skillDir, 'templates', 'contracts', 'games.schema.json'), 'utf8');
  const contractTemplate = JSON.parse(readFileSync(join(skillDir, 'templates', 'contracts', 'games.json'), 'utf8'));
  const plan = buildPlan({ games, contract, entry, copy, appMode, schemaText, contractTemplate, sourceLocale: options['source-locale'] });
  const addMissing = Boolean(options['add-missing']);
  for (const item of plan) {
    if (item.status === 'new') report.note(`new  ${item.rel}`);
    else if (item.status === 'same') report.note(`same ${item.rel}`);
    else if (item.status === 'edit') report.note(`edit ${item.rel} (${item.added})`);
    if ((item.status === 'new' || item.status === 'edit') && item.drafted?.length > 0) report.note(`draft ${item.rel}: ${item.drafted.join(', ')} (source-language text: translate it, then list it on the review queue)`);
    for (const why of item.conflicts) {
      if (addMissing) report.note(`keep ${item.rel}: ${why} (--add-missing never changes a value)`);
      else report.problem({ file: item.rel, rule: 'conflict', message: why, fix: `Compare it with the plan; to complete a game that exists, run scaffold-game.mjs . --game ${entry.id} --add-missing, which adds only what is absent.` });
    }
  }
  if (appMode === null && !plan.some((item) => item.rel.startsWith(`${games.catalogsDir}/`))) report.note(`no catalogs in ${games.catalogsDir} yet (i18n-strings-and-catalogs creates them); rerun with --add-missing once they exist`);
  const writes = (addMissing || options.write) && report.count === 0;
  const written = plan.filter((item) => (item.status === 'new' || item.status === 'edit') && item.content !== undefined && item.content !== null);
  if (writes) {
    for (const item of written) {
      mkdirSync(dirname(join(games.root, item.rel)), { recursive: true });
      writeFileSync(join(games.root, item.rel), item.content);
    }
  }
  const fills = Object.entries(fillTable(entry.id)).map(([token, value]) => `${token}=${value}`).join(' ');
  report.note(`${writes ? 'wrote' : 'would write'} ${written.length} files for ${entry.id} (${entry.class}, pan ${entry.panMode}, levels ${entry.levels === null ? 'none' : `${entry.levels.packs}x${entry.levels.levelsPerPack}`}, daily ${entry.daily ? 'on' : 'off'}, endless ${entry.endless ? 'on' : 'off'}, hints ${entry.hints}, continue ${entry.continue}, lose ${entry.loseReasons.length === 0 ? 'none' : entry.loseReasons.map((reason) => `${entry.id}.lose.${reason}`).join(', ')})`);
  report.note(`placeholders for every games skill's templates: ${fills}`);
  if (entry.levels !== null) report.note(`levels: level-generation-and-solvers adds { "id": "${entry.id}", "packCount": ${entry.levels.packs}, "levelsPerPack": ${entry.levels.levelsPerPack}, "starRule": ..., "daily": ${entry.daily}, "endless": ${entry.endless} } to contracts/levels.json; the complete stage holds both contracts to one layout`);
  else if (entry.daily || entry.endless) report.note(`levels: no packs (daily ${entry.daily ? 'on' : 'off'}, endless ${entry.endless ? 'on' : 'off'}); level-generation-and-solvers adds { "id": "${entry.id}", "packCount": 0, "levelsPerPack": 0, "daily": ${entry.daily}, "endless": ${entry.endless} } to contracts/levels.json (no starRule, no packs); the complete stage holds both contracts to one layout`);
  if (entry.daily) {
    const salt = defaultDailySalt(entry.id);
    report.note(`daily salt: 0x${salt.toString(16).padStart(4, '0')} (${salt}), the 16-bit default for this id (FNV-1a of the id folded to 16 bits, level-generation-and-solvers' rule); freeze it in levels.daily.salt when the levels step starts and never change it after release`);
  }
  if (appMode !== null) report.note(`app ${appMode.appDir}: the links and ad ids are placeholders until the developer supplies them; check-game-scaffold --stage complete refuses each by name`);
  if (writes && report.count === 0) report.note(`next: node <this skill>/scripts/check-game-scaffold.mjs . --game ${entry.id} --stage scaffold${appMode !== null ? ' (after npm install links the new workspace)' : ''}`);
  return report.finish({ checked: plan.length, unit: 'planned files' });
});
