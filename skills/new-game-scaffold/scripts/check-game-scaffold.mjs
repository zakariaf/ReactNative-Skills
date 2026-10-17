#!/usr/bin/env node
// check-game-scaffold.mjs: proves a game was started right and, at the end, that it is complete.
// --stage scaffold (default; right after scaffold-game.mjs): the declaration in contracts/games.json,
// the game's catalog keys, no template placeholder left and, when multi-package, the game's own app
// skeleton (manifest, lockstep dependencies, tsconfig, Metro cache key, one-statement app config,
// anchored native ignores, per-app settings, derived store ids, fonts). --stage complete (a finished
// game; a completeness gate, so no SKIP and no NOT APPLICABLE): additionally every part, the
// evidence, the host registration, the loaded module agreeing with the declaration, the declared
// ways of losing, and every outward-facing placeholder of the app by name.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-game-scaffold.mjs . --game <id> [--stage scaffold|complete]

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { checkAppConfig, checkAppEntry, checkAppFiles, checkAppSettings, checkFonts, checkGitignore, checkMetro, checkPackage, checkShipPlaceholders, checkTsconfig } from './lib/app-checks.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { readCopySource } from './lib/game-catalogs.mjs';
import { checkAgreement, checkCatalogs, checkCompleteness, checkDeclaration, checkLevelsContract, checkNewGameScript, checkPlaceholders, evidenceFiles, gameFolders } from './lib/game-checks.mjs';
import { appLayout, appsBlockProblems, contractProblems, entryProblems, gameIdProblem, gamesLayout, readContract } from './lib/games-contract.mjs';

const SPEC = {
  name: 'check-game-scaffold',
  summary: 'Checks each game against its declaration in contracts/games.json: at --stage scaffold the start (declaration, catalog keys, placeholders, and when multi-package the game\'s own app skeleton), at --stage complete a finished game (every part, evidence, host registration, the module agreeing with the declaration, no outward-facing placeholder).',
  usage: '[repo-root] [--game <id>]... [--stage scaffold|complete] [options]',
  options: {
    game: { type: 'string', multiple: true, value: 'id', help: 'Check only these games (default: every declared game and every folder in the games folder)' },
    stage: { type: 'string', default: 'scaffold', value: 'stage', help: 'scaffold (the start) or complete (the finished game; never skips)' },
    'games-dir': { type: 'string', value: 'dir', help: 'Where the games live (default: gamesDir in rn-skills.config.json, else <srcDir>/games)' },
    'catalogs-dir': { type: 'string', value: 'dir', help: 'The catalogs folder (default: gameCatalogsDir, else <i18nDir>/catalogs)' },
    contract: { type: 'string', value: 'file', help: 'The declaration (default: gamesContract, else <contractsDir>/games.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (both stages): declaration, catalogs, catalog-keys, catalog-missing-key, copy-source-text, retired-key,',
    '  placeholder-left, new-game-script; when multi-package (the game has "app"): app-file-missing, package-json,',
    '  deps-lockstep, tsconfig, metro-cache, app-config, gitignore, app-settings, settings-null, bundle-id,',
    '  product-id, fonts.',
    'Rules (complete): part-missing, evidence-missing, host-registration, module-load, module-identity,',
    '  declaration-mismatch (the module, and contracts/levels.json of level-generation-and-solvers), lose-reasons;',
    '  when multi-package entry (the app renders its root, not the placeholder) and ship-placeholder (each',
    '  placeholder by name; no option passes one).',
    'A passing scaffold stage may print SKIP <catalogs> [catalog-missing-key] not yet created',
    '  (i18n-strings-and-catalogs creates it) before the app has catalogs. An app with no game prints',
    '  NOT APPLICABLE at the scaffold stage; the complete stage exits 2 for it (nothing to prove). A folder',
    '  without package.json is not an app repo: exit 2.',
    '',
    'Examples:',
    '  node check-game-scaffold.mjs . --game lights-out',
    '  node check-game-scaffold.mjs . --game lights-out --stage complete',
  ].join('\n'),
};

/** Where one game's files are, inside the one app or inside its own app. */
function whereOf(games, gameId, entry) {
  if (entry?.app !== undefined) {
    const app = appLayout(games, entry.app);
    return { isApp: true, appDir: app.appDir, srcDir: app.srcDir, gameDir: `${app.gamesDir}/${gameId}`, catalogsDir: app.catalogsDir, e2eDir: app.e2eDir, testDir: app.testDir, registry: `${app.gamesDir}/game-registry.ts`, levelsContract: app.levelsContract, moduleRoot: app.appDir, moduleRootPrefix: `${app.appDir}/` };
  }
  // The registry is game-session-host's fixed <gamesDir>/game-registry.ts, so both skills read one file.
  return { isApp: false, gameDir: `${games.gamesDir}/${gameId}`, catalogsDir: games.catalogsDir, e2eDir: games.e2eDir, testDir: games.testDir, registry: `${games.gamesDir}/game-registry.ts`, levelsContract: games.levelsContract, moduleRoot: '.', moduleRootPrefix: '' };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`not an app repo: ${positionals[0] ?? '.'} has no package.json`, 'Run from the root of the Expo app (or of the monorepo when multi-package), or pass that folder as the first argument.');
  if (!['scaffold', 'complete'].includes(options.stage)) fail(`--stage ${options.stage} is not scaffold or complete`, 'Pass --stage scaffold or --stage complete.');
  for (const id of options.game) {
    const problem = gameIdProblem(id);
    if (problem) fail(`--game ${problem}`, 'Pass the game id as declared in contracts/games.json.');
  }
  const stage = options.stage;
  const games = gamesLayout(root, options);
  const contract = readContract(games);
  const report = createReporter({ name: 'check-game-scaffold', json: options.json });
  const declared = Array.isArray(contract.data?.games) ? contract.data.games.map((item) => item?.id).filter((id) => typeof id === 'string') : [];
  const appGames = (Array.isArray(contract.data?.games) ? contract.data.games : []).filter((item) => typeof item?.app === 'string');
  const found = [...new Set([...declared, ...gameFolders(games.root, games.gamesDir)])].sort();
  const ids = options.game.length > 0 ? options.game : found;
  checkNewGameScript(games.root, report);
  if (contract.data !== null) for (const [key, message] of contractProblems(contract.data)) report.problem({ file: games.contract, line: Math.max(1, contract.text.slice(0, Math.max(0, contract.text.indexOf(`"${key}"`))).split('\n').length), rule: 'declaration', message, fix: `Remove "${key}": the declaration holds only the schema's keys (contracts/games.schema.json); the hosted games are game-session-host's <gamesDir>/game-registry.ts, never a contract key.` });
  if (ids.length === 0) {
    if (stage === 'complete') fail(`nothing to check: ${contract.exists ? `${games.contract} declares no game` : `${games.contract} does not exist`} and ${games.gamesDir} has no game folder`, 'Start the game with scaffold-game.mjs first; the complete stage proves a game that exists.');
    if (report.count === 0) return report.notApplicable(`the app has no game (${contract.exists ? `${games.contract} declares none` : `no ${games.contract}`} and ${games.gamesDir} has no game folder)`);
    return report.finish({ checked: 0, unit: 'games' });
  }
  const copy = readCopySource(games.root, games.copySource);
  const apps = contract.data?.apps;
  if (appGames.length > 0) {
    if (apps === undefined) report.problem({ file: games.contract, line: 1, rule: 'declaration', message: `${appGames.map((item) => item.id).join(', ')} name an app, but there is no "apps" block`, fix: 'Add the apps block (references/white-label-apps.md) or remove "app" from the entries.' });
    else for (const [field, message] of appsBlockProblems(apps)) report.problem({ file: games.contract, line: 1, rule: 'declaration', message, fix: `Correct ${field} (schema: contracts/games.schema.json).` });
  }
  const appsOk = apps !== undefined && appsBlockProblems(apps).length === 0;
  // App roots first: a module under apps/<id>/ resolves @/ through that app's own tsconfig.
  const roots = new Map();
  const modulesFor = (where) => {
    if (!roots.has(where.moduleRoot)) roots.set(where.moduleRoot, enableAppImports(where.moduleRoot === '.' ? games.root : `${games.root}/${where.moduleRoot}`));
    return roots.get(where.moduleRoot);
  };
  const entries = ids.map((gameId) => ({ gameId, entry: Array.isArray(contract.data?.games) ? contract.data.games.find((item) => item?.id === gameId) : undefined }));
  for (const { gameId, entry } of [...entries].sort((a, b) => Number(b.entry?.app !== undefined) - Number(a.entry?.app !== undefined))) modulesFor(whereOf(games, gameId, entry));
  for (const { gameId, entry: raw } of entries) {
    const where = whereOf(games, gameId, raw);
    const ctx = { root: games.root, games, contract, copy, gameId, where, stage, modules: modulesFor(where) };
    const entry = checkDeclaration(ctx, report);
    const valid = entry !== null && entry !== undefined && entryProblems(entry).length === 0;
    let settings = null;
    if (where.isApp && appsOk) {
      checkAppFiles(ctx, apps, report);
      if (stage === 'complete') checkAppEntry(ctx, report);
      checkPackage(ctx, apps, report);
      checkTsconfig(ctx, report);
      checkMetro(ctx, report);
      checkAppConfig(ctx, apps, report);
      checkGitignore(ctx, report);
      settings = await checkAppSettings(ctx, apps, report);
      checkFonts(ctx, apps, report);
    }
    checkCatalogs(ctx, valid ? entry : null, report);
    checkPlaceholders(ctx, where.isApp ? [where.appDir] : [where.gameDir], report, where.isApp ? [] : evidenceFiles(ctx));
    if (stage === 'complete' && valid) {
      checkCompleteness(ctx, entry, report);
      checkLevelsContract(ctx, entry, report);
      await checkAgreement(ctx, entry, report);
      if (settings !== null) checkShipPlaceholders(ctx, settings, report);
    }
  }
  return report.finish({ checked: ids.length, unit: 'games' });
});
