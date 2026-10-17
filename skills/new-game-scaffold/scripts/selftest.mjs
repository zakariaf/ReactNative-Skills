#!/usr/bin/env node
// selftest.mjs: proves both scripts of this skill against tests/fixtures/ (overlay cases).
//   scaffold-game.mjs: plans a new game on a small app (tests/bases/app + this skill's templates),
//     writes it, refuses a conflicting entry or catalog text, completes with --add-missing, and stops
//     on bad input; with --app it plans a white-label app on a monorepo (tests/bases/monorepo) and
//     fails when the existing apps are not in dependency lockstep.
//   check-game-scaffold.mjs: the scaffold stage on the generator's own output (so the templates, the
//     generator and the checker are proven together; the app variant next to Pods, build/ and out/
//     noise), and the complete stage on that output plus a finished game (tests/bases/complete-game,
//     loadable stand-ins of every part). Every bad-* case plants one bug that fails under its rule;
//     installed and vendored skills holding planted bugs stay silent.
//   the examples: examples/lights-out/games.json and examples/white-label/ (games.json and
//     app-settings.ts) are installed into the same bases and must pass the scaffold stage, so an
//     example can never drift from the schema or the checker.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest } from './check-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skill = join(here, '..');
const bases = join(skill, 'tests', 'bases');
const GAME = ['--game', 'lights-out', '--name', 'Lights Out', '--hints', 'none', '--continue', 'once'];
const FINISHED = [...GAME, '--levels', '3x30', '--daily', '--lose-reason', 'out-of-moves'];

function scaffold(dir, args) {
  const result = spawnSync(process.execPath, [join(here, 'scaffold-game.mjs'), dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`scaffold-game.mjs ${args.join(' ')} failed while building a fixture base:\n${result.stdout}${result.stderr}`);
}

function writeFile(dir, rel, content) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

/** The small app with this skill's templates in place (contracts/games.json, the new-game script). */
function appWithTemplates(dir) {
  cpSync(join(bases, 'app'), dir, { recursive: true });
  cpSync(join(skill, 'templates'), dir, { recursive: true });
}

/** The monorepo with the templates, then its own contracts/games.json (the apps block) on top. */
function monorepoWithTemplates(dir) {
  cpSync(join(skill, 'templates'), dir, { recursive: true });
  cpSync(join(bases, 'monorepo'), dir, { recursive: true });
}

/** What a first native build leaves in an app: C macros in Pods, build/ and out/ (never placeholders). */
function generatedNoise(dir, app) {
  writeFile(dir, `${app}/ios/Pods/Headers/Public/React-Core/React/RCTDefines.h`, '#if defined(__OBJC__) && __LINE__ > 0\n#define RCT_DEV __DEV__\n#endif\n');
  writeFile(dir, `${app}/android/app/build/generated/source/BuildConfig.java`, '// __GAME_ID__ __APPLE__\n');
  writeFile(dir, `${app}/build/Build/Intermediates.noindex/main.m`, '// __FILE__ __APPLE__ __GLOBAL__\n');
  writeFile(dir, `${app}/out/main.jsbundle`, 'var __DEV__=false;global.__BUNDLE_START_TIME__=0;\n');
}

/**
 * Per-case arguments of the generator suites (a display name holds a space, which ARGS.txt cannot
 * quote); a case not listed runs with the suite's arguments.
 */
const MODULE_ARGS = {
  'pass-write': [...FINISHED, '--write'],
  'pass-new-contract': [...FINISHED, '--write'],
  'pass-add-missing': [...FINISHED, '--add-missing'],
  'pass-declared-game': ['--game', 'lights-out', '--add-missing'],
  'bad-conflict': [...FINISHED, '--write'],
  'error-missing-hints': ['--game', 'lights-out', '--name', 'Lights Out', '--continue', 'once'],
  'error-bad-id': ['--game', 'LightsOut', '--name', 'Lights Out', '--hints', 'none', '--continue', 'once'],
  'error-reserved-id': ['--game', 'core', '--name', 'Core', '--hints', 'none', '--continue', 'once'],
  'error-id-override': [...GAME, '--bundle-id', 'com.acme.lights'],
  'error-zero-packs': [...GAME, '--levels', '0x0', '--endless'],
  'pass-daily-only': [...GAME, '--daily', '--endless', '--write'],
  'error-write-and-add-missing': [...GAME, '--write', '--add-missing'],
  'error-app-without-block': [...GAME, '--app'],
};
const APP_ARGS = {
  'bad-app-conflict': [...GAME, '--app', '--write'],
  'pass-add-missing-app': [...GAME, '--app', '--add-missing'],
  'pass-add-missing-real-entry': [...GAME, '--app', '--add-missing'],
};

/** The single-app example: its declaration as the app's contract, completed by the generator (catalog keys). */
const lightsOutExample = {
  build: async (dir) => {
    appWithTemplates(dir);
    cpSync(join(skill, 'examples/lights-out/games.json'), join(dir, 'contracts/games.json'));
    scaffold(dir, ['--game', 'lights-out', '--add-missing']);
  },
};

/** The white-label example: its declaration on the monorepo, the generated app, then the example's app-settings.ts on top. */
const whiteLabelExample = {
  build: async (dir) => {
    monorepoWithTemplates(dir);
    cpSync(join(skill, 'examples/white-label/games.json'), join(dir, 'contracts/games.json'));
    scaffold(dir, ['--game', 'arena-chase', '--add-missing']);
    cpSync(join(skill, 'examples/white-label/app-settings.ts'), join(dir, 'apps/arena-chase/app-settings.ts'));
  },
};

const moduleScaffolded = { build: async (dir) => { appWithTemplates(dir); scaffold(dir, [...FINISHED, '--write']); } };
const appScaffolded = {
  build: async (dir) => {
    monorepoWithTemplates(dir);
    scaffold(dir, [...FINISHED, '--app', '--write']);
    generatedNoise(dir, 'apps/lights-out');
  },
};

/**
 * A finished white-label app: the scaffolded app, every part of the game (tests/bases/complete-game)
 * and its real root: "main" is expo-router/entry and the placeholder entry is gone. (Each build layer
 * is built in its own folder, so this one builds the whole tree.)
 */
const appFinished = {
  build: async (dir) => {
    await appScaffolded.build(dir);
    cpSync(join(bases, 'complete-game'), join(dir, 'apps/lights-out'), { recursive: true });
    const manifestPath = join(dir, 'apps/lights-out/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, main: 'expo-router/entry' }, null, 2)}\n`);
    rmSync(join(dir, 'apps/lights-out/index.ts'));
  },
};

await runSelftest(import.meta.url, [
  { script: 'scaffold-game.mjs', fixtures: '../tests/fixtures/scaffold-game', base: ['@tests/bases/app', { templates: true }], args: (dir, { name }) => [dir, ...(MODULE_ARGS[name] ?? FINISHED)] },
  { script: 'scaffold-game.mjs', fixtures: '../tests/fixtures/scaffold-game-app', base: [{ templates: true }, '@tests/bases/monorepo'], args: (dir, { name }) => [dir, ...(APP_ARGS[name] ?? [...GAME, '--app'])] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-game-scaffold', base: [moduleScaffolded], args: (dir) => [dir] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-game-complete', base: [moduleScaffolded, '@tests/bases/complete-game'], args: (dir) => [dir, '--game', 'lights-out', '--stage', 'complete'] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-game-app', base: [appScaffolded], args: (dir) => [dir] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-game-app-complete', base: [appFinished], extends: 'good', args: (dir) => [dir, '--stage', 'complete'] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-example-lights-out', base: [lightsOutExample], args: (dir) => [dir] },
  { script: 'check-game-scaffold.mjs', fixtures: '../tests/fixtures/check-example-white-label', base: [whiteLabelExample], args: (dir) => [dir] },
]);
