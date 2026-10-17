#!/usr/bin/env node
// check-sim-setup.mjs: checks the repo setup that Release simulator builds depend on, before a build
// is trusted: the Xcode pin and tool environment, the build script and its npm entry, the scripts it
// runs after the prebuild, the variant exported once, Metro's cache key, device safety in every
// tooling file (simulators, Maestro, adb, emulators), the contract file and the .gitignore lines.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-sim-setup.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { deviceSafetyProblems } from './lib/device-safety.mjs';
import { maestroSpawnProblems } from './lib/maestro-spawns.mjs';
import { readJsonFile, readSimContract, readXcodePin, sdkMajor, simulatorPrefix } from './lib/sim-contract.mjs';

const SPEC = {
  name: 'check-sim-setup',
  summary: 'Checks the repo setup that Release iOS simulator builds depend on: the Xcode pin, the build script and its npm entry, post-prebuild scripts, the variant environment, the Metro cache key, device safety in tooling, the contract file and .gitignore.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: "The app folder (app.config.ts, metro.config.js, ios/) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile)" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract         contracts/ios-sim-build.json (optional) has only known keys, valid values and no unfilled __PLACEHOLDER__',
    '  xcode-pin        scripts/ios/toolchain.ts pins XCODE_VERSION = \'<major>.<minor>[.<patch>]\' and IOS_RUNTIME, and its tool env sets',
    '                   DEVELOPER_DIR, EXPO_NO_TELEMETRY and CI',
    '  scene-support    XCODE_VERSION 27 or newer with Expo SDK 57 or older needs expo-build-properties ios.enableSceneSupport:',
    '                   a literal entry in the app config, or plugins: addSceneSupport([...]) (expo-sdk-upgrade\'s helper);',
    '                   the iOS 27 SDK expects the scene life cycle, black screen without it',
    '  sim-build-args   scripts/build/sim-build-plan.ts builds Release, -sdk iphonesimulator, -destination id=<udid>, CODE_SIGNING_ALLOWED=NO',
    '  variant-env      scripts/build/build-ios-sim.ts exports the variant once for the whole run with variantEnv() from the',
    '                   app resolver, never APP_VARIANT or EXPO_PUBLIC_APP_VARIANT on their own',
    '  metro-cache-key  metro.config.js sets config.cacheVersion from the EXPO_PUBLIC_* values (the build sets CI=1, so the',
    '                   Release bundling phase keeps a warm Metro cache; app-variants-and-environment owns the key)',
    '  npm-script       package.json "build:ios:sim" runs node scripts/build/build-ios-sim.ts, and that file exists',
    '  build-prereqs    every contract postPrebuild npm script exists and its target file exists (the build runs them after',
    '                   every prebuild; its own preflight stops with exit 2 otherwise)',
    '  no-xcode-select  no tooling file or npm script runs xcode-select --switch/-s or sudo',
    '  sim-safety       no simctl call targets booted, all or a literal simulator name (a UDID or a variable only), every',
    '                   simulator a tooling file creates is named <prefix>-*, xcodebuild always gets',
    '                   -destination id=<udid> (or generic/platform=...), and an iOS eas build:run passes --simulator <udid>',
    '  maestro-device   every Maestro call (JS/TS spawns and command strings, .sh files, npm scripts) starts with --device <udid> and',
    '                   --driver-host-port <port> (maestroGlobalArgs), never a fixed port',
    '  adb-device       every adb call selects its device with -s <serial> (or an adbArgs helper), never -e/-d; every',
    '                   emulator launch names its AVD with -avd',
    '  gitignore        .gitignore ignores ios/, android/, build/ and reports/',
    'Tooling files: scripts/**/*.{ts,mts,cts,js,mjs,cjs,sh} and any *.sh in the repo (tests left out), plus package.json scripts.',
    'Installed skills (.agents/, .claude/, skills/, any folder holding a SKILL.md) are never scanned.',
    'The device rules read text: in JS/TS, argument lists and whole command strings that start with xcrun, simctl, maestro or',
    'eas; values held in variables are not judged (references/contract-and-checks.md lists the limits).',
    'NOT APPLICABLE when package.json has no expo dependency.',
  ].join('\n'),
};

const TOOLING_EXT = /\.(?:ts|mts|cts|js|mjs|cjs|sh)$/;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\//;

function readText(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readPackage(root, rel) {
  const pkg = readJsonFile(root, rel);
  if (pkg !== null && (typeof pkg !== 'object' || Array.isArray(pkg))) throw new UsageError(`${rel} is not a JSON object`, 'Fix package.json.');
  return pkg;
}

function checkContract(ctx) {
  for (const found of ctx.contract.problems) ctx.problem(ctx.contract.rel, found.line, 'contract', found.message, found.fix);
}

function checkXcodePin(ctx) {
  const pin = ctx.pin;
  const fix = 'Copy the skill\'s templates/scripts/ios/toolchain.ts (the canonical toolchain module) and keep XCODE_VERSION a literal.';
  if (pin.text === null) return ctx.problem(pin.rel, 0, 'xcode-pin', 'the toolchain module is missing, so no Xcode is pinned', fix);
  if (pin.version === null) return ctx.problem(pin.rel, 1, 'xcode-pin', "XCODE_VERSION is not pinned as a literal '<major>.<minor>[.<patch>]'", fix);
  const code = maskComments(pin.text);
  if (!/export\s+const\s+IOS_RUNTIME\s*=\s*'com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+-\d+'/.test(code)) ctx.problem(pin.rel, 1, 'xcode-pin', 'IOS_RUNTIME is not pinned to the simulator runtime of the pinned Xcode', fix);
  const missing = ['DEVELOPER_DIR', 'EXPO_NO_TELEMETRY', 'CI'].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(code));
  if (missing.length > 0) ctx.problem(pin.rel, 1, 'xcode-pin', `the tool environment does not set ${missing.join(', ')}`, 'Build every child-process env with toolEnv(): DEVELOPER_DIR selects the pinned Xcode per process, EXPO_NO_TELEMETRY=1 and CI=1 keep runs quiet and unattended.');
  return undefined;
}

const SCENE_ENTRY = /["']?enableSceneSupport["']?\s*:\s*true\b/;

/**
 * Scene support counts in either form: a literal ios.enableSceneSupport: true entry (in the app config
 * or a config plugin under plugins/), or expo-sdk-upgrade's helper, plugins: addSceneSupport([...]),
 * imported from scripts/config/scene-support.ts. When the helper is imported from a relative file that
 * exists, that file must set enableSceneSupport: true.
 */
function sceneSupportProblem(ctx, configRel, configCode) {
  if (!/\baddSceneSupport\s*\(/.test(configCode)) return 'missing';
  const from = /import\s*\{[^}]*\baddSceneSupport\b[^}]*\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/.exec(configCode)?.[1];
  if (from === undefined) return null;
  const helperRel = posix.normalize(posix.join(posix.dirname(configRel), from));
  const helper = readText(ctx.root, helperRel);
  if (helper === null || SCENE_ENTRY.test(maskComments(helper))) return null;
  return helperRel;
}

function checkSceneSupport(ctx) {
  const sdk = sdkMajor(ctx.appPkg) ?? sdkMajor(ctx.pkg);
  if (ctx.pin.major === null || ctx.pin.major < 27 || sdk === null || sdk > 57) return;
  const configRel = ['app.config.ts', 'app.config.js', 'app.json'].map((name) => posix.join(ctx.appDir, name)).find((rel) => existsSync(join(ctx.root, rel))) ?? posix.join(ctx.appDir, 'app.config.ts');
  const configCode = maskComments(readText(ctx.root, configRel) ?? '');
  const plugins = walkRepo(ctx.root, { include: [`${posix.join(ctx.appDir, 'plugins').replace(/^\.\//, '')}/**`] });
  const sources = [configCode, ...plugins.map((rel) => maskComments(readText(ctx.root, rel) ?? ''))];
  if (sources.some((code) => SCENE_ENTRY.test(code))) return;
  const found = sceneSupportProblem(ctx, configRel, configCode);
  if (found === null) return;
  const fix = "Wrap the plugin list with expo-sdk-upgrade's helper, plugins: addSceneSupport([...]) imported from './scripts/config/scene-support.ts' (expo-sdk-upgrade owns it), or add ['expo-build-properties', { ios: { enableSceneSupport: true } }] to the plugins (merge into an existing expo-build-properties entry). Both need Expo SDK 57.0.23 or newer. Otherwise keep the Xcode 26 pin until the Expo SDK 58 upgrade.";
  const what = found === 'missing' ? 'without ios.enableSceneSupport' : `and the addSceneSupport() it calls (${found}) never sets enableSceneSupport: true`;
  ctx.problem(configRel, 0, 'scene-support', `XCODE_VERSION ${ctx.pin.version} builds with the iOS ${ctx.pin.major} SDK, and Expo SDK ${sdk} still uses the application life cycle ${what}: the app launches to a black screen`, fix);
}

function checkBuildPlan(ctx) {
  const rel = posix.join(ctx.layout.scriptsDir, 'build', 'sim-build-plan.ts');
  const code = readText(ctx.root, rel);
  const needed = ["'Release'", "'iphonesimulator'", 'CODE_SIGNING_ALLOWED=NO', 'id=${'];
  const missing = code === null ? needed : needed.filter((token) => !maskComments(code).includes(token));
  if (missing.length > 0) ctx.problem(rel, code === null ? 0 : 1, 'sim-build-args', code === null ? 'the build plan is missing' : `the simulator build lacks ${missing.join(', ')}`, 'Copy the skill\'s templates/scripts/build/sim-build-plan.ts: Release (the embedded bundle users run), -sdk iphonesimulator, -destination id=<udid>, CODE_SIGNING_ALLOWED=NO (no signing material is touched).');
}

function checkVariantEnv(ctx) {
  const rel = posix.join(ctx.layout.scriptsDir, 'build', 'build-ios-sim.ts');
  const text = readText(ctx.root, rel);
  if (text === null) return; // npm-script reports the missing file
  const code = maskComments(text);
  const fix = 'Spread variantEnv(options.variant) from src/config/app-variant.ts into the one env object every step gets: prebuild, the Constants build phase and Metro each read the variant in their own process.';
  const own = /\b(?:EXPO_PUBLIC_)?APP_VARIANT['"]?\s*:/.exec(code);
  if (own) ctx.problem(rel, lineOf(code, own.index), 'variant-env', 'sets a variant variable on its own instead of through variantEnv()', fix);
  else if (!/\bvariantEnv\s*\(/.test(code)) ctx.problem(rel, 1, 'variant-env', 'does not export the variant with variantEnv(), so the native app and its bundle can disagree', fix);
}

function checkMetro(ctx) {
  const rel = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].map((name) => posix.join(ctx.appDir, name)).find((path) => existsSync(join(ctx.root, path))) ?? posix.join(ctx.appDir, 'metro.config.js');
  const text = readText(ctx.root, rel);
  const fix = "Copy app-variants-and-environment's metro.config.js: config.cacheVersion = publicEnvCacheVersion(process.env). The build runs with CI=1, and @expo/cli then skips --reset-cache in the Release bundling phase, so without the key a production build after a preview build can ship the preview bundle.";
  if (text === null) return ctx.problem(rel, 0, 'metro-cache-key', 'metro.config.js is missing, so Metro keys its cache on nothing the variant changes', fix);
  const code = maskComments(text);
  const assignment = /\bcacheVersion\s*=\s*([^;\n]+)/.exec(code);
  if (!assignment || !/process\.env|publicEnvCacheVersion\s*\(/.test(assignment[1])) ctx.problem(rel, assignment ? lineOf(code, assignment.index) : 1, 'metro-cache-key', 'config.cacheVersion is not keyed on the EXPO_PUBLIC_* values', fix);
  return undefined;
}

function checkNpmScripts(ctx) {
  const scripts = ctx.pkg.scripts ?? {};
  const target = posix.join(ctx.layout.scriptsDir, 'build', 'build-ios-sim.ts');
  const command = scripts['build:ios:sim'];
  if (typeof command !== 'string' || !command.startsWith(`node ${target}`)) ctx.problem('package.json', 0, 'npm-script', `scripts["build:ios:sim"] is ${JSON.stringify(command ?? null)}`, `Set it to "node ${target}" (add --app-dir <dir> when multi-package): npx expo run:ios builds Debug on whatever Xcode xcode-select points at.`);
  else if (!existsSync(join(ctx.root, target))) ctx.problem(target, 0, 'npm-script', 'build:ios:sim runs this file, which does not exist', 'Copy the skill\'s templates/scripts/build/ and templates/scripts/ios/ (with their tests).');
  for (const name of ctx.contract.data.postPrebuild ?? []) {
    const script = scripts[name];
    if (typeof script !== 'string') {
      ctx.problem('package.json', 0, 'build-prereqs', `scripts["${name}"] is missing, and the build runs it after every prebuild (${ctx.contract.rel} postPrebuild)`, `Add the "${name}" script and the tooling it runs, or remove "${name}" from postPrebuild.`);
      continue;
    }
    for (const file of script.split(/\s+/).filter((word) => /^[\w@.-]+(\/[\w@.-]+)+\.(ts|mts|js|mjs|cjs)$/.test(word))) {
      if (!existsSync(join(ctx.root, file))) ctx.problem(file, 0, 'build-prereqs', `does not exist, and the build runs it through "${name}" after every prebuild`, 'Install the tooling that script runs before the first build (never drop the step to make the build start).');
    }
  }
}

function toolingFiles(ctx) {
  const scriptsGlob = `${ctx.layout.scriptsDir}/**`;
  return walkRepo(ctx.root, { include: ['*.sh', scriptsGlob] })
    .filter((rel) => TOOLING_EXT.test(rel) && !TEST_FILE.test(rel))
    .map((rel) => ({ rel, code: maskComments(readFileSync(join(ctx.root, rel), 'utf8')), shell: rel.endsWith('.sh') }));
}

function npmScriptFiles(ctx) {
  const text = readText(ctx.root, 'package.json') ?? '';
  return Object.entries(ctx.pkg.scripts ?? {})
    .filter(([, command]) => typeof command === 'string')
    .map(([name, command]) => ({ rel: 'package.json', code: command, shell: true, line: lineOf(text, Math.max(0, text.indexOf(`"${name}"`))) }));
}

function checkTooling(ctx) {
  const files = toolingFiles(ctx);
  const prefix = simulatorPrefix(ctx.contract.data, ctx.pkg);
  for (const found of deviceSafetyProblems([...files, ...npmScriptFiles(ctx)], { prefix })) ctx.problem(found.file, found.line, found.rule, found.message, found.fix);
  const fix = 'Start the arguments with maestroGlobalArgs({ udid, driverPort }) from scripts/e2e/maestro-args.ts (a free port per run): another session\'s simulator or driver can answer otherwise.';
  for (const found of maestroSpawnProblems(files.filter((file) => !file.shell), { fix })) ctx.problem(found.file, found.line, 'maestro-device', found.message, found.fix);
  return files.length;
}

function checkGitignore(ctx) {
  const lines = (readText(ctx.root, '.gitignore') ?? '').split('\n').map((line) => line.trim().replace(/^\*\*\//, '').replace(/^\//, '').replace(/\/$/, ''));
  for (const name of ['ios', 'android', 'build', 'reports']) {
    const accepted = [name, posix.join(ctx.appDir, name)];
    if (!lines.some((line) => accepted.includes(line))) ctx.problem('.gitignore', 0, 'gitignore', `does not ignore ${name}/`, `Add the line ${name}/: ios/ and android/ are regenerated by every prebuild, build/ holds DerivedData and logs, reports/ the screenshots.`);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const pkg = readPackage(root, 'package.json');
  if (pkg === null) throw new UsageError('nothing to check: no package.json in the repo root', 'Run from the root of the Expo app, or pass it: check-sim-setup.mjs <repo-root>.');
  const appDir = posix.normalize(options['app-dir'] ?? '.');
  requireDir(join(root, appDir), 'app folder (--app-dir)');
  const appPkg = appDir === '.' ? pkg : (readPackage(root, posix.join(appDir, 'package.json')) ?? pkg);
  const report = createReporter({ name: 'check-sim-setup', json: options.json });
  if (sdkMajor(appPkg) === null && sdkMajor(pkg) === null) return report.notApplicable('package.json has no expo dependency: this skill builds Expo apps');
  const layout = resolveLayout(root);
  const ctx = {
    root, appDir, pkg, appPkg, layout,
    contract: readSimContract(root, layout),
    pin: readXcodePin(root, layout),
    problem: (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix }),
  };
  checkContract(ctx);
  checkXcodePin(ctx);
  checkSceneSupport(ctx);
  checkBuildPlan(ctx);
  checkVariantEnv(ctx);
  checkMetro(ctx);
  checkNpmScripts(ctx);
  const tooling = checkTooling(ctx);
  checkGitignore(ctx);
  return report.finish({ checked: tooling + 5, unit: 'setup and tooling files' });
});
