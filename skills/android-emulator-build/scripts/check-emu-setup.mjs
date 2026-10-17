#!/usr/bin/env node
// check-emu-setup.mjs: checks the repo setup that Release Android emulator builds depend on, before a
// build is trusted: the JDK and SDK pins and the tool environment, the build plan (Release, one ABI,
// no daemon, debug-keystore signing only), the variant exported once, Metro's cache key, the npm
// entry and the scripts it runs after the prebuild, device and shared-machine safety in every tooling
// file (adb, emulators, AVDs, Gradle), no global JDK switch, the contract file and the .gitignore lines.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-emu-setup.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { androidSafetyProblems } from './lib/android-device-safety.mjs';
import { avdPrefix, readEmuContract, readJsonFile, readRnCatalog, readRnJvmToolchain, readToolchainPin, sdkMajor } from './lib/emu-contract.mjs';

const SPEC = {
  name: 'check-emu-setup',
  summary: 'Checks the repo setup that Release Android emulator builds depend on: the JDK and SDK pins, the build plan, signing, the variant environment, the Metro cache key, the npm entry and post-prebuild scripts, device and shared-machine safety in tooling, the contract file and .gitignore.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: "The app folder (app.config.ts, metro.config.js, android/) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile)" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract          contracts/android-emu-build.json (optional) has only known keys, valid values and no unfilled __PLACEHOLDER__',
    '  toolchain-pin     scripts/android/toolchain.ts pins JDK_MAJOR, ANDROID_API and BUILD_TOOLS_VERSION as literals, they agree with',
    '                    the installed React Native catalog (node_modules/react-native/gradle/libs.versions.toml) and JDK_MAJOR',
    '                    the jvmToolchain(<n>) of node_modules/@react-native/gradle-plugin when present,',
    '                    and its tool env sets JAVA_HOME, ANDROID_HOME, EXPO_NO_TELEMETRY and CI',
    '  emu-build-args    scripts/build/emu-build-plan.ts prebuilds android with --clean and assembles :app:assembleRelease for',
    '                    one ABI (-PreactNativeArchitectures=) with --no-daemon; never a Debug or install task',
    '  emu-signing       the emulator build files name no upload keystore, .jks, android.injected.signing or store password',
    '                    (the template signs Release with the debug keystore; upload signing is android-release-play)',
    '  variant-env       scripts/build/build-android-emu.ts exports the variant once with variantEnv() from the app resolver,',
    '                    never APP_VARIANT or EXPO_PUBLIC_APP_VARIANT on their own',
    '  metro-cache-key   metro.config.js sets config.cacheVersion from the EXPO_PUBLIC_* values (the build sets CI=1, so the',
    '                    Release bundling task keeps a warm Metro cache; app-variants-and-environment owns the key)',
    '  npm-script        package.json "build:android:emu" runs node scripts/build/build-android-emu.ts, and that file exists',
    '  build-prereqs     every contract postPrebuild npm script exists and its target file exists',
    '  adb-device        every adb device command has -s <serial> first (or an adbArgs helper), never -e/-d; no eas build:run',
    '                    for Android (it installs on the first running emulator)',
    '  emulator-avd      every emulator launch names its AVD with -avd; literal AVD names in emulator, avdmanager create and',
    '                    delete are <prefix>-*',
    '  shared-machine    no adb kill-server, adb disconnect without a serial, gradlew --stop, Gradle install* tasks, or',
    '                    pkill/killall of emulators, adb, Java or Gradle',
    '  no-global-switch  no sudo, jenv global, sdk default java, update-alternatives for java, or sdkmanager --licenses',
    '  gitignore         .gitignore ignores android/, build/ and reports/',
    'Tooling files: scripts/**/*.{ts,mts,cts,js,mjs,cjs,sh} and any *.sh in the repo (tests left out), plus package.json scripts.',
    'Installed skills (.agents/, .claude/, skills/, any folder holding a SKILL.md) are never scanned.',
    'The device rules read text: argument lists and whole command strings; values held in variables are not judged.',
    'NOT APPLICABLE when package.json has no expo dependency.',
  ].join('\n'),
};

const TOOLING_EXT = /\.(?:ts|mts|cts|js|mjs|cjs|sh)$/;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\//;
const BUILD_FILES = ['build-android-emu.ts', 'emu-build-plan.ts', 'emu-build-steps.ts', 'emu-build-args.ts', 'emu-build-config.ts'];

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

function checkToolchainPin(ctx) {
  const pin = ctx.pin;
  const fix = "Copy the skill's templates/scripts/android/toolchain.ts and keep the pins literals (expo-sdk-upgrade moves them with the Expo SDK).";
  if (pin.text === null) return ctx.problem(pin.rel, 0, 'toolchain-pin', 'the toolchain module is missing, so no JDK or Android SDK is pinned', fix);
  const unpinned = [['JDK_MAJOR', pin.jdk], ['ANDROID_API', pin.api], ['BUILD_TOOLS_VERSION', pin.buildTools]].filter(([, value]) => value === null).map(([name]) => name);
  if (unpinned.length > 0) ctx.problem(pin.rel, 1, 'toolchain-pin', `${unpinned.join(', ')} not pinned as a literal`, fix);
  const code = maskComments(pin.text);
  const missing = ['JAVA_HOME', 'ANDROID_HOME', 'EXPO_NO_TELEMETRY', 'CI'].filter((name) => !new RegExp(`\\b${name}\\s*:`).test(code));
  if (missing.length > 0) ctx.problem(pin.rel, 1, 'toolchain-pin', `the tool environment does not set ${missing.join(', ')}`, 'Build every child-process env with toolEnv(): JAVA_HOME and ANDROID_HOME select the pinned JDK and SDK per process, EXPO_NO_TELEMETRY=1 and CI=1 keep runs quiet and unattended.');
  const plugin = readRnJvmToolchain(ctx.root, ctx.appDir);
  if (pin.jdk !== null && plugin !== null && pin.jdk !== plugin.jdk) ctx.problem(pin.rel, lineOf(pin.text, pin.text.indexOf('JDK_MAJOR')), 'toolchain-pin', `JDK_MAJOR is ${pin.jdk}, but React Native's Gradle plugin compiles with jvmToolchain(${plugin.jdk})`, `Set JDK_MAJOR to ${plugin.jdk} (${plugin.rel}); React Native supports that JDK, and another one fails or warns in the Gradle build.`);
  const catalog = readRnCatalog(ctx.root, ctx.appDir);
  if (catalog === null) return undefined;
  const syncFix = `Set the pins to the installed React Native's version catalog (${catalog.rel}); Gradle builds with those, so a stale pin checks and creates the wrong SDK packages and emulator.`;
  if (pin.api !== null && catalog.compileSdk !== null && String(pin.api) !== catalog.compileSdk) ctx.problem(pin.rel, lineOf(pin.text, pin.text.indexOf('ANDROID_API')), 'toolchain-pin', `ANDROID_API is ${pin.api}, but React Native builds with compileSdk ${catalog.compileSdk}`, syncFix);
  if (pin.buildTools !== null && catalog.buildTools !== null && pin.buildTools !== catalog.buildTools) ctx.problem(pin.rel, lineOf(pin.text, pin.text.indexOf('BUILD_TOOLS_VERSION')), 'toolchain-pin', `BUILD_TOOLS_VERSION is ${pin.buildTools}, but React Native builds with buildTools ${catalog.buildTools}`, syncFix);
  return undefined;
}

function checkBuildPlan(ctx) {
  const rel = posix.join(ctx.layout.scriptsDir, 'build', 'emu-build-plan.ts');
  const text = readText(ctx.root, rel);
  const fix = "Copy the skill's templates/scripts/build/emu-build-plan.ts: a clean prebuild, then ./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=<abi> (the embedded Hermes bundle users run, one ABI, no daemon left on a shared machine).";
  if (text === null) return ctx.problem(rel, 0, 'emu-build-args', 'the build plan is missing', fix);
  const code = maskComments(text);
  const needed = ["'android'", "'--clean'", ':app:assembleRelease', '-PreactNativeArchitectures=', "'--no-daemon'"];
  const missing = needed.filter((token) => !code.includes(token));
  if (missing.length > 0) ctx.problem(rel, 1, 'emu-build-args', `the emulator build lacks ${missing.join(', ')}`, fix);
  const debug = /\b(?:assemble|install|bundle)Debug\w*|\binstallRelease\b|\brun:android\b/.exec(code);
  if (debug) ctx.problem(rel, lineOf(code, debug.index), 'emu-build-args', `the build plan runs ${debug[0]}`, 'Debug builds load JS from Metro with a dev menu, and install tasks install on every connected device; assemble Release and install with adb -s <serial>.');
  return undefined;
}

function checkSigning(ctx) {
  const secret = /android\.injected\.signing|\.jks\b|upload[-_.]?keystore|(?:store|key)Password|UPLOAD_STORE|UPLOAD_KEY|\.keystore\b/i;
  for (const name of BUILD_FILES) {
    const rel = posix.join(ctx.layout.scriptsDir, 'build', name);
    const text = readText(ctx.root, rel);
    if (text === null) continue;
    const code = maskComments(text);
    const match = secret.exec(code);
    if (match) ctx.problem(rel, lineOf(code, match.index), 'emu-signing', `the emulator build names signing material (${match[0]})`, 'The emulator lane needs no secret: the prebuild template signs Release with the public debug keystore. Upload signing belongs to android-release-play, outside the emulator build files.');
  }
}

function checkVariantEnv(ctx) {
  const rel = posix.join(ctx.layout.scriptsDir, 'build', 'build-android-emu.ts');
  const text = readText(ctx.root, rel);
  if (text === null) return; // npm-script reports the missing file
  const code = maskComments(text);
  const fix = 'Spread variantEnv(options.variant) from src/config/app-variant.ts into the one env object every step gets: the prebuild, the app.config Gradle task and Metro each read the variant in their own process.';
  const own = /\b(?:EXPO_PUBLIC_)?APP_VARIANT['"]?\s*:/.exec(code);
  if (own) ctx.problem(rel, lineOf(code, own.index), 'variant-env', 'sets a variant variable on its own instead of through variantEnv()', fix);
  else if (!/\bvariantEnv\s*\(/.test(code)) ctx.problem(rel, 1, 'variant-env', 'does not export the variant with variantEnv(), so the native app and its bundle can disagree', fix);
}

function checkMetro(ctx) {
  const rel = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].map((name) => posix.join(ctx.appDir, name)).find((path) => existsSync(join(ctx.root, path))) ?? posix.join(ctx.appDir, 'metro.config.js');
  const text = readText(ctx.root, rel);
  const fix = "Copy app-variants-and-environment's metro.config.js: config.cacheVersion = publicEnvCacheVersion(process.env). The build runs with CI=1, and the Release bundling task then keeps Metro's cache, so without the key a production APK built after a preview APK can ship the preview bundle.";
  if (text === null) return ctx.problem(rel, 0, 'metro-cache-key', 'metro.config.js is missing, so Metro keys its cache on nothing the variant changes', fix);
  const code = maskComments(text);
  const assignment = /\bcacheVersion\s*=\s*([^;\n]+)/.exec(code);
  if (!assignment || !/process\.env|publicEnvCacheVersion\s*\(/.test(assignment[1])) ctx.problem(rel, assignment ? lineOf(code, assignment.index) : 1, 'metro-cache-key', 'config.cacheVersion is not keyed on the EXPO_PUBLIC_* values', fix);
  return undefined;
}

function checkNpmScripts(ctx) {
  const scripts = ctx.pkg.scripts ?? {};
  const target = posix.join(ctx.layout.scriptsDir, 'build', 'build-android-emu.ts');
  const command = scripts['build:android:emu'];
  if (typeof command !== 'string' || !command.startsWith(`node ${target}`)) ctx.problem('package.json', 0, 'npm-script', `scripts["build:android:emu"] is ${JSON.stringify(command ?? null)}`, `Set it to "node ${target}" (add --app-dir <dir> when multi-package): npx expo run:android builds Debug and installs on whichever device it picks.`);
  else if (!existsSync(join(ctx.root, target))) ctx.problem(target, 0, 'npm-script', 'build:android:emu runs this file, which does not exist', "Copy the skill's templates/scripts/build/ and templates/scripts/android/ (with their tests).");
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
  return walkRepo(ctx.root, { include: ['*.sh', `${ctx.layout.scriptsDir}/**`] })
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
  const prefix = avdPrefix(ctx.contract.data, ctx.pkg);
  for (const found of androidSafetyProblems([...files, ...npmScriptFiles(ctx)], { prefix })) ctx.problem(found.file, found.line, found.rule, found.message, found.fix);
  return files.length;
}

function checkGitignore(ctx) {
  const lines = (readText(ctx.root, '.gitignore') ?? '').split('\n').map((line) => line.trim().replace(/^\*\*\//, '').replace(/^\//, '').replace(/\/$/, ''));
  for (const name of ['android', 'build', 'reports']) {
    const accepted = [name, posix.join(ctx.appDir, name)];
    if (!lines.some((line) => accepted.includes(line))) ctx.problem('.gitignore', 0, 'gitignore', `does not ignore ${name}/`, `Add the line ${name}/: android/ is regenerated by every prebuild, build/ holds the kept APKs and logs, reports/ the screenshots.`);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const pkg = readPackage(root, 'package.json');
  if (pkg === null) throw new UsageError('nothing to check: no package.json in the repo root', 'Run from the root of the Expo app, or pass it: check-emu-setup.mjs <repo-root>.');
  const appDir = posix.normalize(options['app-dir'] ?? '.');
  requireDir(join(root, appDir), 'app folder (--app-dir)');
  const appPkg = appDir === '.' ? pkg : (readPackage(root, posix.join(appDir, 'package.json')) ?? pkg);
  const report = createReporter({ name: 'check-emu-setup', json: options.json });
  if (sdkMajor(appPkg) === null && sdkMajor(pkg) === null) return report.notApplicable('package.json has no expo dependency: this skill builds Expo apps');
  const layout = resolveLayout(root);
  const ctx = {
    root, appDir, pkg, appPkg, layout,
    contract: readEmuContract(root, layout),
    pin: readToolchainPin(root, layout),
    problem: (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix }),
  };
  checkContract(ctx);
  checkToolchainPin(ctx);
  checkBuildPlan(ctx);
  checkSigning(ctx);
  checkVariantEnv(ctx);
  checkMetro(ctx);
  checkNpmScripts(ctx);
  const tooling = checkTooling(ctx);
  checkGitignore(ctx);
  return report.finish({ checked: tooling + 5, unit: 'setup and tooling files' });
});
