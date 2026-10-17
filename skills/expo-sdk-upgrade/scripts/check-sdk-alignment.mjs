#!/usr/bin/env node
// check-sdk-alignment.mjs: proves the app repo sits on ONE Expo SDK line: the app (and, when
// multi-package, every Expo app) on the same SDK, every Expo-managed package at the module map's
// specifier, root overrides and the tools that follow the SDK (jest-expo, eslint-config-expo,
// @react-native/*, @types/react, test-renderer, Jest) on its line, held-back tools unchanged, one
// version of every native module, the Jest config the SDK needs, only APIs the SDK supports
// (Gesture Handler major, removed React Native and Jest APIs, config plugin imports, removed app
// config keys), the iOS and Android toolchain the SDK needs (Xcode and scene support, EAS images,
// Android SDK levels, the iOS deployment target), no expo release the SDK's advisory rules out, and
// no stale install-script approval.
// With --target-sdk it also scans for the next SDK: code to fix before the move fails the check, and
// changes that can only land in the move commit are printed as "todo" lines.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-sdk-alignment.mjs . [--target-sdk 58]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EAS_FLOATING,
  androidPins,
  appsSdk,
  bare,
  compareVersions,
  depsOf,
  installedExpo,
  iosPins,
  lineOrder,
  loadSdkLines,
  majorOf,
  maskedText,
  moduleMapFor,
  onLine,
  readRepo,
  repoFiles,
  satisfies,
  sceneSupport,
  xcodeSources,
} from './lib/sdk.mjs';
import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';

// The skill folder, so fix lines can name this skill's own files by a path that works from the app root.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCENE_TEMPLATE = join(SKILL_DIR, 'templates', 'scripts', 'config', 'scene-support.ts');

const SPEC = {
  name: 'check-sdk-alignment',
  summary:
    'Checks that the app (every Expo app and shared package when multi-package) sits on one Expo SDK line: module map specifiers, overrides, the tools that follow the SDK, held-back tools, one copy of every native module, the Jest config the SDK needs, only APIs the SDK supports (Gesture Handler major, removed React Native and Jest APIs, config plugin imports, removed app config keys), the iOS and Android toolchain (Xcode and scene support, EAS images, Android SDK levels, the iOS deployment target), the oldest expo release the SDK allows, and install-script approvals. --target-sdk <n> adds a readiness scan for the next SDK.',
  usage: '[repo-root] [options]',
  options: {
    'target-sdk': { type: 'string', value: 'n', help: 'Also scan the code against this next SDK (readiness before the move)' },
    xcode: { type: 'string', value: 'version', help: 'The Xcode version builds use (default: rn-skills.config.json "xcodeVersionFile", .xcode-version, a toolchain module exporting XCODE_VERSION, exact eas.json ios.image names)' },
    'sdk-lines': { type: 'string', value: 'file', help: "The app's own SDK lines (default: rn-skills.config.json \"expoSdkLines\", else contracts/expo-sdk-lines.json)" },
    'jest-config': { type: 'string', value: 'file', help: 'The root Jest config (default: the first of jest.config.js, .cjs, .mjs, .ts, else package.json "jest")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: sdk-unknown sdk-lines-contract sdk-lockstep app-lockstep module-map core-pins overrides',
    '  sdk-tooling rn-tooling react-line held-back duplicate-native jest-config gesture-api',
    '  config-plugin-import removed-rn-api removed-test-api removed-config scene-support xcode',
    '  eas-image android-sdk ios-deployment-target expo-min skia-approval',
    'A repo without expo in package.json prints NOT APPLICABLE. Without eas.json and any Xcode pin the',
    'xcode rules print: SKIP eas.json [xcode] not yet created (eas-build-and-submit creates it). On an SDK',
    'with Jest config lines, a repo with neither jest.config.* nor package.json "jest" prints:',
    'SKIP jest.config.js [jest-config] not yet created (unit-and-component-tests creates it)',
  ].join('\n'),
};

const GESTURE_BUILDER = /\bGesture\.(Tap|Pan|LongPress|Fling|Pinch|Rotation|Hover|Manual|Native|ForceTouch|Race|Simultaneous|Exclusive)\s*\(/g;
const GESTURE_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]react-native-gesture-handler['"]/g;
const V3_HOOK = /^use\w*Gestures?$/;
const CONFIG_PLUGINS_IMPORT = /\bfrom\s*['"](expo\/config-plugins(?:\.js)?)['"]/g;
const JEST_CONFIGS = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts'];

/** In a readiness scan, changes that can only happen together with the move are listed, not failed. */
function moveTimeReporter(readiness, add) {
  if (!readiness) return add;
  return (file, line, rule, message, fix) => console.log(`todo     ${file}:${line} [${rule}] ${message} Fix: ${fix}`);
}

const inEveryApp = (repo, command) => (repo.mode === 'single' ? `Run ${command}` : `Run ${command} inside every app (${repo.apps.map((app) => app.ws).join(', ')})`);

function checkLockstep(repo, add) {
  if (repo.mode === 'single') return;
  const local = new Set(repo.layout.workspaces.map((workspace) => workspace.name).filter(Boolean));
  const specs = new Map();
  for (const app of repo.apps) {
    for (const [name, spec] of Object.entries(app.manifest.dependencies ?? {})) {
      if (!local.has(name)) specs.set(name, [...(specs.get(name) ?? []), [app.ws, spec]]);
    }
  }
  for (const [name, list] of specs) {
    if (new Set(list.map(([, spec]) => spec)).size < 2) continue;
    const rule = name === 'expo' || name === 'react-native' ? 'sdk-lockstep' : 'app-lockstep';
    add(`${list[0][0]}/package.json`, 1, rule, `${name} differs between apps: ${list.map(([ws, spec]) => `${ws}=${spec}`).join(', ')}`, 'Every app moves in the same commit: run the same npx expo install commands in every app (Expo supports one React Native version per repo).');
  }
}

function checkModuleMap(repo, map, source, add) {
  for (const app of repo.apps) {
    const deps = app.manifest.dependencies ?? {};
    for (const core of ['react', 'react-native']) if (!(core in deps)) add(app.file, 1, 'core-pins', `lacks ${core} in dependencies`, `${inEveryApp(repo, `npx expo install ${core}`)}.`);
    if (!map) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (name === 'expo' || !(name in map) || spec === map[name]) continue;
      add(app.file, 1, 'module-map', `${name} is "${spec}" but the SDK's module map (${source}) expects "${map[name]}"`, `${inEveryApp(repo, 'npx expo install --fix')}, and never edit an Expo-managed specifier by hand.`);
    }
  }
}

/** A tool that must sit on the SDK's line: below it is sdk-tooling (the SDK needs more), above it held-back. */
function checkLine(add, sdk, name, version, want, why) {
  if (!version || !want) return;
  const order = want.split('.').length === 3 ? compareVersions(bare(version), want) : lineOrder(version, want);
  if (order === 0) return;
  if (order < 0) add('package.json', 1, 'sdk-tooling', `${name} is ${version}, but SDK ${sdk} needs ${want}${want.split('.').length === 3 ? '' : '.x'} (${why})`, `Install it in the one root-tools command of the move: npm install -D ${name}@${want}.`);
  else add('package.json', 1, 'held-back', `${name} is ${version}; SDK ${sdk} keeps ${want}${want.split('.').length === 3 ? '' : '.x'} (${why})`, `Go back to ${name} ${want}; a major move needs its own trigger and commit (dependency-management holds the held-back majors).`);
}

function checkRoot(repo, context, add) {
  const { map, line, sdk, appDeps } = context;
  const root = repo.rootManifest ?? {};
  const overrides = root.overrides ?? {};
  for (const name of ['react', 'react-native']) {
    const used = appDeps[name];
    if (!used) continue;
    const value = overrides[name];
    if (repo.mode === 'monorepo' ? value !== used : value !== undefined && value !== used) {
      add('package.json', 1, 'overrides', `overrides.${name} is ${value ?? 'missing'} but ${repo.mode === 'single' ? 'the app uses' : 'the apps use'} ${used}`, `Set "overrides": { "${name}": "${used}" } in the same commit as the app${repo.mode === 'single' ? '' : 's'} (or delete it in a single app); npm ls ${name} must show one version.`);
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    const used = appDeps[name];
    // An override pins the version the apps install (4.26.2 for "~4.26.0"): fine while it lies in the apps' range.
    if (name === 'react' || name === 'react-native' || used === undefined || typeof value !== 'string' || value === used || satisfies(bare(value), used)) continue;
    add('package.json', 1, 'overrides', `overrides.${name} is ${value} but ${repo.mode === 'single' ? 'the app uses' : 'the apps use'} ${used}; a stale override forces the old version`, `Set overrides.${name} to the version npx expo install --fix installed (npm ls ${name}; it lies in ${used}), npm install, then npx expo-doctor must report no duplicate native modules.`);
  }
  const dev = depsOf(root);
  for (const name of ['jest-expo', 'eslint-config-expo']) {
    if (dev[name] && map?.[name] && !satisfies(dev[name], map[name])) add('package.json', 1, 'sdk-tooling', `${name} is ${dev[name]} but SDK ${sdk} expects ${map[name]}`, `npm install -D ${name}@${bare(map[name])} at the root, in the one root-tools command (exact; it lies inside Expo's range).`);
  }
  if (dev['babel-jest'] && dev.jest && majorOf(dev['babel-jest']) !== majorOf(dev.jest)) add('package.json', 1, 'sdk-tooling', `babel-jest is ${dev['babel-jest']} but jest is ${dev.jest}; their majors must match`, `npm install -D babel-jest@${majorOf(dev.jest)} together with jest.`);
  const rn = appDeps['react-native'];
  for (const name of ['@react-native/jest-preset', '@react-native/eslint-plugin']) {
    if (dev[name] && rn && bare(dev[name]) !== bare(rn)) add('package.json', 1, 'rn-tooling', `${name} is ${dev[name]} but react-native is ${rn}; they must be equal`, `npm install -D ${name}@${bare(rn)} at the root.`);
  }
  if (!line) return;
  if (appDeps.react && !onLine(appDeps.react, line.react)) add(repo.apps[0].file, 1, 'core-pins', `the app${repo.mode === 'single' ? ' uses' : 's use'} react ${appDeps.react}, but SDK ${sdk} ships React ${line.react}`, `${inEveryApp(repo, 'npx expo install --fix')}; React moves only with the SDK.`);
  for (const [name, want] of [['@types/react', line.typesReact], ['test-renderer', line.testRenderer]]) {
    if (dev[name] && !onLine(dev[name], want)) add('package.json', 1, 'react-line', `${name} is ${dev[name]}, but SDK ${sdk} (React ${line.react}) needs the ${want}.x line`, `npm install -D ${name}@${want} at the root, in the one root-tools command; save-exact writes the exact version.`);
  }
  checkLine(add, sdk, 'typescript', dev.typescript, line.typescript, "Expo's related packages");
  checkLine(add, sdk, 'jest', dev.jest, line.jest, "the Jest line jest-expo of this SDK peers on");
  checkLine(add, sdk, '@types/jest', dev['@types/jest'], line.typesJest, 'the types of that Jest line');
}

/** True for an app config file Expo evaluates as CommonJS: .cjs, or .js/.ts under a package.json without "type": "module". */
function loadedAsCommonJs(repo, files, rel) {
  if (!files.config.includes(rel) || rel.endsWith('.mjs')) return false;
  if (rel.endsWith('.cjs')) return true;
  const owner = repo.apps.filter((app) => app.ws === '' || rel.startsWith(`${app.ws}/`)).sort((a, b) => b.ws.length - a.ws.length)[0];
  return (owner?.manifest ?? repo.rootManifest)?.type !== 'module';
}

function scanSources(repo, files, context, add) {
  const { gestureMajor, apiLine, apiSdk, readiness } = context;
  const when = readiness ? ` (change it in the move commit to SDK ${apiSdk})` : '';
  const atMove = moveTimeReporter(readiness, add);
  for (const rel of files.app) {
    const text = maskedText(repo.root, rel);
    if (gestureMajor !== null && gestureMajor >= 3) {
      for (const match of text.matchAll(GESTURE_BUILDER)) atMove(rel, lineOf(text, match.index), 'gesture-api', `uses the Gesture Handler builder Gesture.${match[1]}(), deprecated in v3${when}; hook and builder gestures cannot be related`, 'Move every gesture of the app to the v3 hooks in one change (useTapGesture, usePanGesture, useExclusiveGestures; onStart -> onActivate, onEnd -> onDeactivate), each component as a whole, and rerun its gesture tests.');
    }
    if (gestureMajor !== null && gestureMajor < 3) {
      for (const match of text.matchAll(GESTURE_IMPORT)) {
        const hooks = match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).filter((name) => V3_HOOK.test(name));
        if (hooks.length) add(rel, lineOf(text, match.index), 'gesture-api', `imports ${hooks.join(', ')}, which Gesture Handler ${gestureMajor} does not have`, 'Use the builder API (Gesture.Tap() ...) until the SDK move brings Gesture Handler 3.');
      }
    }
  }
  if (apiLine?.configPluginsImport) {
    // Every code file that imports expo/config-plugins, tests and their helpers included: on SDK 58
    // 'expo/config-plugins.js' breaks tsc (TS2307) and Jest (config-plugins.js.js) as much as Node.
    const nodeFiles = new Set(files.node);
    for (const rel of [...new Set([...files.node, ...files.app])].sort()) {
      const text = maskedText(repo.root, rel);
      for (const match of text.matchAll(CONFIG_PLUGINS_IMPORT)) {
        if (match[1] === apiLine.configPluginsImport) continue;
        const isTypeOnly = /^import\s+type\b/.test(text.slice(text.lastIndexOf('import', match.index)));
        if (isTypeOnly && apiLine.configPluginsImport.endsWith('.js')) continue;
        if (apiLine.configPluginsImport.endsWith('.js') && !nodeFiles.has(rel)) {
          // App, test and mock code runs through Babel (Jest, Metro) and TypeScript's bundler
          // resolution, where the bare specifier resolves before SDK 58; only Node ESM needs '.js'.
          console.log(`note     ${rel}:${lineOf(text, match.index)} [config-plugin-import] imports '${match[1]}': Jest and TypeScript resolve it on SDK ${apiSdk} too; the house form is '${apiLine.configPluginsImport}' until the move`);
          continue;
        }
        if (apiLine.configPluginsImport.endsWith('.js') && loadedAsCommonJs(repo, files, rel)) {
          // Expo evaluates a CommonJS app config itself (@expo/require-utils), where the bare
          // specifier resolves; only Node ESM (plugin modules, "type": "module") needs the extension.
          console.log(`note     ${rel}:${lineOf(text, match.index)} [config-plugin-import] imports '${match[1]}': Expo loads this app config as CommonJS (no "type": "module"), so it resolves on SDK ${apiSdk} too; the house form is '${apiLine.configPluginsImport}' until the move`);
          continue;
        }
        atMove(rel, lineOf(text, match.index), 'config-plugin-import', `imports '${match[1]}', but on SDK ${apiSdk} config plugins import '${apiLine.configPluginsImport}'${when}`, apiLine.configPluginsImport.endsWith('.js') ? "This SDK's expo package has no exports map: Node ESM needs the file extension, so write 'expo/config-plugins.js'." : "From SDK 58 expo has an exports map (\"./*\" -> \"./*.js\"), so 'expo/config-plugins.js' resolves to config-plugins.js.js; write 'expo/config-plugins' in the move commit, not before.");
      }
    }
  }
  for (const api of apiLine?.removedApis ?? []) {
    const scope = api.scope === 'test' ? files.tests : files.app;
    for (const rel of scope) {
      const text = maskedText(repo.root, rel);
      for (const match of text.matchAll(new RegExp(api.pattern, 'g'))) add(rel, lineOf(text, match.index), api.rule, `uses ${api.id}, removed in ${api.from} (SDK ${apiSdk})${readiness ? '; replace it now, before the move' : ''}`, api.fix);
    }
  }
  for (const key of apiLine?.removedAppConfigKeys ?? []) {
    for (const rel of files.config) {
      const text = maskedText(repo.root, rel);
      for (const match of text.matchAll(new RegExp(key.pattern, 'g'))) add(rel, lineOf(text, match.index), 'removed-config', `sets ${key.key}, which the app config schema dropped in SDK ${key.since}${readiness ? '; delete it now' : ''}`, key.fix);
    }
  }
}

/**
 * The root Jest config: --jest-config, else the first jest.config.* file, else package.json "jest"
 * (create-expo-app's default; Jest refuses to start when both exist). Returns { file, text, line }
 * with comments masked (a commented-out line does not count), package.json's key as JSON text, or
 * null when the repo has no Jest config.
 */
function jestConfig(repo, option) {
  const file = option ?? JEST_CONFIGS.find((name) => existsSync(join(repo.root, name)));
  if (file && existsSync(join(repo.root, file))) {
    const raw = readFileSync(join(repo.root, file), 'utf8');
    return { file, text: file.endsWith('.json') ? raw : maskComments(raw), line: 1 };
  }
  if (option) return null;
  const jest = repo.rootManifest?.jest;
  if (jest === undefined) return null;
  const raw = readFileSync(join(repo.root, 'package.json'), 'utf8');
  const at = raw.search(/"jest"\s*:/);
  return { file: 'package.json', text: JSON.stringify(jest, null, 2), line: at < 0 ? 1 : lineOf(raw, at), key: true };
}

function checkJestConfig(repo, context, add, report) {
  const { apiLine, apiSdk, readiness, option } = context;
  const wanted = apiLine?.jestConfigMustInclude ?? [];
  if (wanted.length === 0) return;
  const config = jestConfig(repo, option);
  if (!config) {
    const rel = option ?? 'jest.config.js';
    const reason = notYetCreated(repo.root, { file: rel, owner: 'unit-and-component-tests' });
    // Only when neither a jest.config.* file nor package.json "jest" exists.
    if (reason) report.skip({ file: rel, rule: 'jest-config', message: reason });
    return;
  }
  const atMove = moveTimeReporter(readiness, add);
  const where = config.key ? 'its "jest" key ' : '';
  for (const item of wanted) {
    if (!new RegExp(item.pattern).test(config.text)) atMove(config.file, config.line, 'jest-config', `${where}lacks ${item.text} for SDK ${apiSdk}${readiness ? ' (add it in the move commit)' : ''}: ${item.why}`, item.fix);
  }
}

/**
 * The version the apps install: the lockfile copy inside the apps' specifier (4.26.2 for "~4.26.0"),
 * the newest of them when several are; the range floor only when no copy satisfies it.
 */
function appVersion(found, spec) {
  const inRange = found.filter((version) => satisfies(version, spec)).sort(compareVersions);
  return inRange.at(-1) ?? bare(spec);
}

/** Native modules (module-map packages) installed in more than one version, read from the lockfile. */
function checkDuplicates(repo, map, appDeps, add) {
  const lock = repo.lockfile;
  if (!lock?.packages || !map) return;
  const versions = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const at = path.lastIndexOf('node_modules/');
    if (at < 0 || !entry?.version) continue;
    const name = path.slice(at + 'node_modules/'.length);
    if (name in map || name === 'react' || name === 'react-native') versions.set(name, new Set([...(versions.get(name) ?? []), entry.version]));
  }
  const why = repo.mode === 'single' ? 'a dependency resolved its own copy beside the one the app installs' : `a shared package's "*" peer resolved to another release at the root (npm's newest on a first install, the old line after an SDK move)`;
  for (const [name, found] of versions) {
    if (found.size < 2) continue;
    const sorted = [...found].sort(compareVersions);
    const spec = appDeps[name] ?? map[name];
    const want = spec ? appVersion(sorted, spec) : sorted.at(-1);
    add('package-lock.json', 1, 'duplicate-native', `${name} is installed as ${sorted.join(' and ')}; a native build may contain only one version (${repo.mode === 'single' ? 'the app installs' : 'the apps install'} ${want}${spec ? ` for "${spec}"` : ''})`, `Add "${name}": "${want}" to the root overrides, npm install, then npx expo-doctor must report no duplicate native modules. Cause: ${why}; never npm dedupe or delete node_modules for this.`);
  }
}

function checkToolchain(repo, files, context, add, report) {
  const { line, sdk, target, targetLine, readiness, appExpo, xcodeOption } = context;
  const atMove = moveTimeReporter(readiness, add);
  const { active, leftovers } = sceneSupport(repo, files);
  const { sources, eas, easAuto } = xcodeSources(repo, files, xcodeOption);
  for (const source of sources) console.log(`xcode    ${source.version} (${source.label})`);
  if (sources.length === 0) {
    const present = eas.filter((file) => file.exists);
    if (present.length === 0) {
      const file = eas[0].file;
      const reason = notYetCreated(repo.root, { file, owner: 'eas-build-and-submit' });
      if (reason) report.skip({ file, rule: 'xcode', message: reason });
    } else if (easAuto.length > 0) console.log(`xcode    EAS picks the image for SDK ${sdk}${line?.eas?.iosImage ? ` (${line.eas.iosImage} on the verified date)` : ''} (${easAuto.join(', ')}); no local Xcode pin`);
  }
  for (const file of eas) if (file.error) add(file.file, 1, 'eas-image', file.error, 'Fix the JSON (eas-build-and-submit owns eas.json).');
  if (line) {
    const helpers = leftovers.filter((entry) => !/\.test\.[cm]?[jt]sx?$/.test(entry.rel)).map((entry) => entry.rel);
    const notWired = helpers.length ? ` (${helpers.join(', ')} defines it, but nothing calls it)` : '';
    for (const source of sources) {
      const tooNew = typeof line.xcodeMax === 'string' && majorOf(source.version) > Number(line.xcodeMax);
      if (tooNew) add(source.file, source.line, 'xcode', `SDK ${sdk} builds with Xcode ${line.xcodeMax}.x at most, ${source.label} uses ${source.version}: its expo-build-properties has no ios.enableSceneSupport, and apps built with the iOS 27 SDK on the application life cycle do not launch correctly on iOS 27`, `Stay on Xcode ${line.xcodeMax}.x (selected by version: DEVELOPER_DIR locally, an EAS image name or "auto" on EAS), or move the app to an SDK that supports the newer Xcode first (references/toolchain.md).`);
      const needsScene = !tooNew && line.xcodeMaxWithoutSceneSupport !== null && majorOf(source.version) > Number(line.xcodeMaxWithoutSceneSupport);
      if (needsScene && active.length === 0) add(source.file, source.line, 'scene-support', `Xcode ${source.version} (${source.label}) with SDK ${sdk} needs expo-build-properties ios.enableSceneSupport: true${notWired}: apps built with the iOS 27 SDK on the application life cycle do not launch correctly on iOS 27`, `Copy this skill's template ${SCENE_TEMPLATE} (and scene-support.test.ts next to it) into the app as scripts/config/, wrap the plugin list in app.config.ts: plugins: addSceneSupport([...]), then confirm UIApplicationSceneManifest with npx expo config --type introspect (this skill's references/toolchain.md).`);
      if (compareVersions(source.version, line.xcodeMin) < 0) add(source.file, source.line, 'xcode', `SDK ${sdk} needs Xcode ${line.xcodeMin} or newer, ${source.label} uses ${source.version}`, 'Select a newer Xcode by version (DEVELOPER_DIR locally, an EAS image name on EAS), in its own commit; installing Xcode is a human step.');
      if (targetLine && compareVersions(source.version, targetLine.xcodeMin) < 0) add(source.file, source.line, 'xcode', `SDK ${target} needs Xcode ${targetLine.xcodeMin} or newer, ${source.label} uses ${source.version}`, 'Move to a newer Xcode in its own commit before the SDK move (a human installs it).');
    }
    if (line.sceneSupportMinExpo === null) {
      const handled = line.xcodeMaxWithoutSceneSupport === null;
      for (const hit of [...active, ...leftovers]) add(hit.rel, hit.line, 'scene-support', handled ? `ios.enableSceneSupport is set up on SDK ${sdk}, where it is a no-op` : `ios.enableSceneSupport is set up on SDK ${sdk}, whose expo-build-properties has no such option`, handled ? 'Remove the addSceneSupport call or the enableSceneSupport entry, and delete scene-support.ts and its test, in the move commit (SDK 58 and later handle the scene life cycle themselves).' : 'Remove the addSceneSupport call or the enableSceneSupport entry and the helper: scene support needs SDK 57 (expo 57.0.23 or newer); stay on Xcode 26 until the app is there.');
    } else {
      for (const hit of active) if (appExpo && compareVersions(bare(appExpo), line.sceneSupportMinExpo) < 0) add(hit.rel, hit.line, 'scene-support', `ios.enableSceneSupport needs expo ${line.sceneSupportMinExpo} or newer, the app declares ${appExpo}`, `${inEveryApp(repo, `npx expo install expo@~${line.sceneSupportMinExpo}`)} first (the plugin throws on older expo).`);
      if (targetLine?.sceneSupportMinExpo === null) for (const hit of [...active, ...leftovers]) atMove(hit.rel, hit.line, 'scene-support', `scene support is a no-op on SDK ${target}`, 'Remove the call, the helper and its test in the move commit.');
    }
  }
  for (const easFile of eas) {
    for (const profile of easFile.profiles) {
      for (const platform of ['ios', 'android']) {
        const entry = profile[platform];
        if (!entry) continue;
        const where = `build.${profile.name}.${platform}.image`;
        const exactName = line?.eas?.[`${platform}Image`];
        if (EAS_FLOATING.has(entry.image)) add(easFile.file, entry.line, 'eas-image', `${where} is "${entry.image}", which EAS moves with every new image release: a new Xcode or JDK would arrive without a commit`, `Use "auto" (EAS picks the image for the app's SDK), "sdk-${sdk}"${exactName ? `, or an exact name such as "${exactName}"` : ''}; change an image in its own commit.`);
        const alias = /^sdk-(\d+)$/.exec(entry.image) ?? (platform === 'android' ? /-sdk-(\d+)$/.exec(entry.image) : null);
        if (!alias) continue;
        const imageSdk = Number(alias[1]);
        if (imageSdk !== sdk) add(easFile.file, entry.line, 'eas-image', `${where} is "${entry.image}", built for SDK ${imageSdk}, but the app is on SDK ${sdk}`, `Use "auto" or "sdk-${sdk}"${exactName ? ` (or "${exactName}")` : ''}; images follow the SDK in the move commit.`);
        else if (target !== null) atMove(easFile.file, entry.line, 'eas-image', `${where} is "${entry.image}"; SDK ${target} builds on its own image`, `Change it to "auto" or "sdk-${target}" in the move commit.`);
      }
    }
  }
}

function checkAndroid(repo, files, context, add) {
  const { line, sdk, target, targetLine, readiness } = context;
  const atMove = moveTimeReporter(readiness, add);
  const names = { compileSdkVersion: 'compileSdk', targetSdkVersion: 'targetSdk', minSdkVersion: 'minSdk' };
  for (const pin of androidPins(repo, files)) {
    const level = names[pin.key];
    if (line?.android) {
      const want = line.android[level];
      if (pin.value < want) {
        const why = level === 'minSdk' ? `React Native ${line.reactNative} builds for ${want} and up; Gradle fails below it` : level === 'targetSdk' ? `a pin left from an older SDK keeps the app on old platform behaviour, and Google Play requires a recent target (check-sdk-trigger store-deadline)` : 'a pin left from an older SDK holds the native build back';
        add(pin.file, pin.line, 'android-sdk', `${pin.key} ${pin.value} is below SDK ${sdk}'s ${level} ${want}: ${why}`, `Delete the pin (expo-build-properties then uses the SDK default ${want}) or raise it to ${want}, and rebuild Android (npx expo prebuild --platform android --clean).`);
      }
    }
    if (targetLine?.android && target !== null && pin.value < targetLine.android[level] && !(line?.android && pin.value < line.android[level])) {
      atMove(pin.file, pin.line, 'android-sdk', `${pin.key} ${pin.value} is below SDK ${target}'s ${level} ${targetLine.android[level]}`, `Delete the pin or raise it to ${targetLine.android[level]} in the move commit.`);
    }
  }
}

/** expo-build-properties ios.deploymentTarget below the SDK's lowest iOS: pod install refuses the pods. */
function checkIos(repo, files, context, add) {
  const { line, sdk, target, targetLine, readiness } = context;
  const atMove = moveTimeReporter(readiness, add);
  const floor = line?.ios?.deploymentTarget;
  const next = targetLine?.ios?.deploymentTarget;
  for (const pin of iosPins(repo, files)) {
    const below = floor && compareVersions(pin.value, floor) < 0;
    if (below) add(pin.file, pin.line, 'ios-deployment-target', `deploymentTarget ${pin.value} is below SDK ${sdk}'s iOS ${floor}: pod install fails ("required a higher minimum deployment target") because the SDK's pods declare ${floor}`, `Delete the pin (expo-build-properties then uses the SDK default ${floor}) or raise it to ${floor}; dropping older iOS versions is the developer's decision, so say so in the report.`);
    if (next && target !== null && !below && compareVersions(pin.value, next) < 0) atMove(pin.file, pin.line, 'ios-deployment-target', `deploymentTarget ${pin.value} is below SDK ${target}'s iOS ${next}`, `Delete the pin or raise it to ${next} in the move commit (the app then no longer installs on iOS below ${next}: tell the developer).`);
  }
}

/** An expo release the SDK's advisory rules out (SDK 57 before 57.0.9: the Hermes V1 memory regression). */
function checkExpoMin(repo, context, add) {
  const { line, sdk } = context;
  if (!line?.minExpo) return;
  const installed = installedExpo(repo);
  if (!installed || compareVersions(installed.version, line.minExpo) >= 0) return;
  add(installed.file, 1, 'expo-min', `expo ${installed.version} (${installed.file === 'package-lock.json' ? 'installed, package-lock.json' : `declared ${installed.declared}`}) is below ${line.minExpo}, the oldest SDK ${sdk} release to use${line.advisory ? `: ${line.advisory}` : ''}`, `${inEveryApp(repo, `npx expo install expo@~${line.expo} && npx expo install --fix`)} (the newest SDK ${sdk} release this skill knows is ${line.expo}).`);
}

function checkSkiaApproval(repo, context, add) {
  const { skia, line } = context;
  const approvals = Object.entries(repo.rootManifest?.allowScripts ?? {}).filter(([key, value]) => key.startsWith('@shopify/react-native-skia') && value === true).map(([key]) => key);
  if (!skia || !line || approvals.length === 0) return;
  if (compareVersions(bare(skia), line.skiaPostinstallUntil) >= 0) add('package.json', 1, 'skia-approval', `allowScripts still approves ${approvals.join(', ')}, but Skia ${bare(skia)} has no install script (removed in ${line.skiaPostinstallUntil})`, 'Delete the Skia approval from allowScripts; npm approve-scripts --allow-scripts-pending must still print "No packages with unreviewed install scripts."');
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const rootArg = positionals[0] ?? '.';
  const root = requireDir(rootArg, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${rootArg} has no package.json`, 'Run it from the app repo root, or pass the root folder: check-sdk-alignment.mjs <repo-root>.');
  const repo = readRepo(root);
  if (!repo.rootManifest) fail(`package.json in ${rootArg} is not valid JSON`, 'Fix the JSON, then rerun.');
  const report = createReporter({ name: 'check-sdk-alignment', json: options.json });
  const sdk = appsSdk(repo);
  if (sdk === null) return report.notApplicable(repo.mode === 'single' ? 'expo is not a dependency in package.json' : 'no workspace in package.json "workspaces" depends on expo');
  const target = options['target-sdk'] === undefined ? null : Number(options['target-sdk']);
  if (target !== null && !(Number.isInteger(target) && target > sdk)) fail(`--target-sdk ${options['target-sdk']} must be a later SDK than the app's ${sdk}`, `Pass --target-sdk ${sdk + 1}.`);
  const add = (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix });
  const { lines, fromRepo, contract, problems: contractProblems } = loadSdkLines(root, repo.layout, options['sdk-lines']);
  for (const problem of contractProblems) add(problem.file, problem.line, 'sdk-lines-contract', problem.message, 'Give the entry the shape of assets/sdk-lines.schema.json (references/sdk-lines.md explains every key), or delete the file when this skill already knows the SDK.');
  for (const error of repo.errors) add(error.file, 1, 'sdk-lockstep', error.message, 'Fix the JSON.');
  const appsFile = repo.apps[0].file;
  const line = lines[String(sdk)] ?? null;
  if (!line) add(appsFile, 1, 'sdk-unknown', `no expectations for Expo SDK ${sdk} in this skill or in ${contract}`, `Add an "${sdk}" entry to ${contract} with the shape of assets/sdk-lines.schema.json, read from the new SDK's bundledNativeModules.json, the Expo versions API and React Native's gradle/libs.versions.toml (references/sdk-lines.md), in the move commit.`);
  const targetLine = target === null ? null : lines[String(target)] ?? null;
  if (target !== null && !targetLine) add(appsFile, 1, 'sdk-unknown', `no expectations for Expo SDK ${target} in this skill or in ${contract}`, `Add a "${target}" entry to ${contract} before the readiness scan (references/sdk-lines.md).`);
  const { map, source, note: mapNote } = moduleMapFor(repo, sdk);
  const who = repo.mode === 'single' ? 'app' : `${repo.apps.length} apps`;
  console.log(`sdk      ${who} on Expo SDK ${sdk}; module map: ${source ?? 'none (run npm ci so node_modules/expo/bundledNativeModules.json exists)'}${target === null ? '' : `; readiness scan for SDK ${target}`}`);
  if (mapNote) console.log(`note     ${mapNote}`);
  const otherLock = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'].find((file) => existsSync(join(root, file)));
  if (otherLock && !existsSync(join(root, 'package-lock.json'))) console.log(`note     ${otherLock} without package-lock.json: duplicate-native and the installed-expo half of expo-min read package-lock.json only, so they check the declared ranges alone (references/runbook.md "Other package managers")`);
  for (const known of [...fromRepo].sort()) console.log(`sdk-lines SDK ${known} from ${contract} (replaces this skill's entry)`);
  const appDeps = repo.apps[0].manifest.dependencies ?? {};
  const readiness = target !== null;
  const gestureMajor = targetLine ? targetLine.gestureHandlerMajor : appDeps['react-native-gesture-handler'] ? majorOf(appDeps['react-native-gesture-handler']) : null;
  const context = { sdk, line, map, target, targetLine, readiness, appDeps, appExpo: appDeps.expo, skia: appDeps['@shopify/react-native-skia'], xcodeOption: options.xcode };
  const files = repoFiles(repo);
  checkLockstep(repo, add);
  checkModuleMap(repo, map, source, add);
  checkRoot(repo, context, add);
  scanSources(repo, files, { gestureMajor, apiLine: targetLine ?? line, apiSdk: target ?? sdk, readiness }, add);
  checkJestConfig(repo, { apiLine: targetLine ?? line, apiSdk: target ?? sdk, readiness, option: options['jest-config'] }, add, report);
  checkDuplicates(repo, map, appDeps, add);
  checkToolchain(repo, files, context, add, report);
  checkAndroid(repo, files, context, add);
  checkIos(repo, files, context, add);
  checkExpoMin(repo, context, add);
  checkSkiaApproval(repo, context, add);
  const manifests = repo.apps.length + repo.shared.length + (repo.mode === 'single' ? 0 : 1);
  return report.finish({ checked: manifests + files.app.length + files.node.length, unit: 'manifests and source files' });
});
