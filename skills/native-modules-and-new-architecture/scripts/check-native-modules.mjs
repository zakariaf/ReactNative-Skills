#!/usr/bin/env node
// check-native-modules.mjs: checks the app's own native code on the New Architecture. Local Expo
// modules in modules/<name>/ (config, classes, build files, names, the same API on iOS and Android,
// threads and observers), the one typed, lazy, optional binding of each module in its adapter and the
// cross-language contract between that binding type and the Swift and Kotlin definitions, codegen
// specs of Turbo Modules, legacy bridge APIs on either side, and native source outside modules/.
// Zero dependencies (node: built-ins), Node 22+.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

import { createReporter, parseArgs, readText, resolveLayout, run, walkRepo, fail } from './check-lib.mjs';
import { isTestFile, scanSource } from './lib/source-scan.mjs';
import {
  BINDING_CALLEES,
  bindingCalls,
  classesOf,
  listFiles,
  moduleDefinition,
  parseJson,
  readMaybe,
  resolveBindingType,
} from './lib/native-scan.mjs';

const SPEC = {
  name: 'check-native-modules',
  summary: 'Checks local Expo modules, their bindings and the cross-language contract, codegen specs and legacy native APIs.',
  usage: '[repo-root] [options]',
  options: {
    'modules-dir': { type: 'string', value: 'dir', help: 'Local modules folder (default: package.json expo.autolinking.nativeModulesDir, else modules)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  module-config       modules/<name>/expo-module.config.json exists, parses, declares known platforms and, per',
    '                      native platform, its module classes; a native folder no platform declares is never linked',
    '  module-build-files  apple: ios/*.podspec depending on ExpoModulesCore with source_files; android:',
    '                      android/build.gradle applying expo-module-gradle-plugin',
    '  module-class        every configured class exists and extends Module (public in Swift), every subscriber',
    '                      extends ExpoAppDelegateSubscriber, and every Module class is registered in the config',
    '  module-name         every Module class sets Name("..."), the same on iOS and Android, unique in the app',
    '  platform-parity     a module on iOS and Android exports the same functions, properties and events, unless',
    '                      the binding type marks the member optional',
    '  binding-place       requireNativeModule/requireOptionalNativeModule/requireNativeView/TurboModuleRegistry',
    '                      only in an adapter (src/services/<concern>/*-adapter.ts, src/data/**/*-adapter.ts),',
    '                      a codegen spec or the module folder',
    '  binding-unique      one binding per module (and per view): a second file binding the same name fails',
    '  binding-lazy        no binding at import time (module scope): bind inside the adapter factory',
    '  binding-optional    requireOptionalNativeModule (TurboModuleRegistry.get), never the throwing forms',
    '  binding-type        every module binding names its type (<T>), declared in the same file; a Turbo Module',
    '                      binding may import its type from the module\'s codegen spec (Native<Name>.ts)',
    '  binding-name        a literal name that a local module or codegen spec defines; every local module is bound',
    '  contract-drift      the binding type and the native definitions name the same members and events; a',
    '                      hand-written Turbo Module binding type names the same members as the spec\'s interface Spec',
    '  legacy-js-api       NativeModules, requireNativeComponent, NativeEventEmitter, UIManager, findNodeHandle',
    '  legacy-native-api   RCT_EXPORT_MODULE/METHOD, RCTViewManager, ReactContextBaseJavaModule, @ReactMethod,',
    '                      ReactPackage in a local module (legacy bridge code; Turbo Module code passes)',
    '  main-thread         Swift UIKit calls in a Function/Property/Constant or an AsyncFunction without',
    '                      .runOnQueue(.main); Kotlin view work in an AsyncFunction without Queues.MAIN',
    '  observer-release    a NotificationCenter observer or a registered receiver that is never removed',
    '  observer-stop       a Module with OnStartObserving("e") lacks OnStopObserving("e") (or the unnamed form),',
    '                      or lacks OnDestroy',
    '  codegen-config      codegenConfig (name, type, jsSrcsDir with specs, android.javaPackageName) in a local',
    '                      package; never in the app package.json of a CNG app',
    '  codegen-spec        TurboModuleRegistry/codegenNativeComponent only in Native<Name>.ts /',
    '                      <Name>NativeComponent.ts inside a codegenConfig jsSrcsDir, with interface Spec',
    '  native-placement    Swift, Kotlin, Java, Objective-C or C++ source outside modules/<name>/ (and the',
    '                      rn-skills.config.json nativeSourceDirs); experiments.inlineModules in the app config',
    'Not applicable when expo is not a dependency in package.json.',
  ].join('\n'),
};

const KNOWN_PLATFORMS = new Set(['apple', 'ios', 'macos', 'tvos', 'android', 'web', 'devtools']);
const APPLE = ['apple', 'ios', 'macos', 'tvos'];
const NATIVE_EXT = /\.(swift|kt|kts|java|m|mm|h|hpp|cpp|cc|c)$/;
const JS_EXT = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const SWIFT_UI_MAIN = /\bUIApplication\.shared\b|\bUIScreen\.main\b|\bUIWindow\b|\bUIViewController\b|\bkeyWindow\b|\bUIView\s*\(|\bpresent\s*\(/;
const KOTLIN_UI_MAIN = /\bfindViewById\b|\bsetContentView\b|\.window\.|\bWindowManager\b|\.addView\s*\(/;
const LEGACY_JS = ['NativeModules', 'requireNativeComponent', 'NativeEventEmitter', 'UIManager', 'findNodeHandle'];

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function lineMatching(text, pattern) {
  const match = pattern.exec(text);
  return match ? lineAt(text, match.index) : 1;
}

/** The local modules folder: --modules-dir, package.json expo.autolinking.nativeModulesDir, else modules. */
function modulesDirOf(root, manifest, given) {
  const setting = given ?? manifest?.expo?.autolinking?.nativeModulesDir;
  const dir = typeof setting === 'string' && setting.trim() !== '' ? setting : 'modules';
  return posix.normalize(dir.replace(/^\.\//, '').replace(/\/$/, ''));
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`repo root ${root} does not exist`, 'Pass the app repo root (the folder with package.json).');
  const manifestText = readMaybe(join(root, 'package.json'));
  if (manifestText === null) fail('nothing to check: no package.json in the repo root', 'Run from the app repo root, or pass it as the first argument.');
  const parsedManifest = parseJson(manifestText);
  if (parsedManifest.error) fail(`package.json does not parse: ${parsedManifest.error}`, 'Fix package.json.');
  const manifest = parsedManifest.value;
  const report = createReporter({ name: SPEC.name, json: options.json });
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  if (!deps.expo) return report.notApplicable('expo is not a dependency in package.json');

  const layout = resolveLayout(root);
  const modulesDir = modulesDirOf(root, manifest, options['modules-dir']);
  const extraNativeDirs = Array.isArray(layout.config?.nativeSourceDirs) ? layout.config.nativeSourceDirs.filter((d) => typeof d === 'string') : [];
  const add = (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix });
  let checked = 0;

  // ---- local modules -------------------------------------------------------------------------
  const modules = readModules(root, modulesDir, add);
  checked += modules.reduce((n, mod) => n + mod.files.length, 0);

  // ---- codegen packages (local Turbo Modules) and the app package.json ---------------------------
  const specDirs = checkCodegenConfigs(root, modulesDir, manifest, modules, add);

  // ---- the TypeScript side ----------------------------------------------------------------------
  const jsRoots = [layout.srcDir, modulesDir].filter((dir, i, all) => all.indexOf(dir) === i);
  const jsFiles = walkRepo(root, { include: JS_EXT })
    .filter((rel) => jsRoots.some((dir) => rel === dir || rel.startsWith(`${dir}/`)))
    .filter((rel) => !isTestFile(rel) && !rel.endsWith('.d.ts') && !/\/mocks\//.test(rel));
  checked += jsFiles.length;
  const bindings = [];
  for (const rel of jsFiles) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    const scan = scanSource(text);
    checkLegacyJs(rel, text, scan, add);
    for (const call of bindingCalls(scan)) bindings.push({ rel, scan, call });
  }
  const specNames = checkSpecs(bindings, specDirs, modulesDir, add);
  checkBindings({ bindings, modules, specNames, layout, modulesDir, specDirs, add });

  // ---- native source outside modules/ --------------------------------------------------------
  checked += checkPlacement(root, modulesDir, extraNativeDirs, add);

  return report.finish({ checked, unit: 'files' });
}

// =================================================================================================
// Local modules
// =================================================================================================

/**
 * Reads every folder under the modules dir:
 *   [{ dir, rel, config, platforms, files, classes: { apple: [...], android: [...] }, defs: [...] }]
 */
function readModules(root, modulesDir, add) {
  const abs = join(root, modulesDir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of listTopDirs(abs)) {
    const rel = `${modulesDir}/${name}`;
    const dir = join(root, rel);
    const files = listFiles(dir);
    const pkg = parseJson(readMaybe(join(dir, 'package.json')) ?? 'null').value;
    const isCodegenPackage = Boolean(pkg && typeof pkg === 'object' && pkg.codegenConfig);
    const configText = readMaybe(join(dir, 'expo-module.config.json'));
    const mod = { name, rel, dir, files, pkg, isCodegenPackage, config: null, platforms: [], swift: [], kotlin: [], defs: [] };
    out.push(mod);
    readNativeSources(mod, add);
    if (configText === null) {
      if (!isCodegenPackage) {
        add(`${rel}/expo-module.config.json`, 1, 'module-config', `${rel} has no expo-module.config.json, so autolinking does not link it as an Expo module`, 'Create the module with npx create-expo-module@latest --local (it writes the config), or add {"platforms": [...], "apple": {"modules": [...]}, "android": {"modules": [...]}}.');
      }
      continue;
    }
    const parsed = parseJson(configText);
    if (parsed.error || !parsed.value || typeof parsed.value !== 'object') {
      add(`${rel}/expo-module.config.json`, 1, 'module-config', `expo-module.config.json does not parse${parsed.error ? `: ${parsed.error}` : ''}`, 'Write valid JSON: {"platforms": ["apple", "android"], ...}.');
      continue;
    }
    mod.config = parsed.value;
    checkModuleConfig(mod, configText, add);
    checkModuleClasses(mod, add);
    checkThreadsAndObservers(mod, add);
    checkLegacyNative(mod, add);
  }
  checkModuleNames(out, add);
  return out;
}

function listTopDirs(abs) {
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && listFiles(join(abs, entry.name)).length > 0)
    .map((entry) => entry.name)
    .sort();
}

function readNativeSources(mod, add) {
  void add;
  for (const file of mod.files) {
    const language = file.endsWith('.swift') ? 'swift' : file.endsWith('.kt') ? 'kotlin' : null;
    if (!language) continue;
    const text = readMaybe(join(mod.dir, file));
    if (text === null) continue;
    const { scan, classes } = classesOf(text, language);
    const entry = { file, rel: `${mod.rel}/${file}`, text, scan, classes, language };
    (language === 'swift' ? mod.swift : mod.kotlin).push(entry);
  }
}

function checkModuleConfig(mod, configText, add) {
  const file = `${mod.rel}/expo-module.config.json`;
  const { config } = mod;
  const platforms = config.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    add(file, lineMatching(configText, /"platforms"/), 'module-config', 'expo-module.config.json declares no platforms', 'Add "platforms": ["apple", "android"] (the platforms the module supports).');
    return;
  }
  for (const platform of platforms) {
    if (!KNOWN_PLATFORMS.has(platform)) add(file, lineMatching(configText, new RegExp(`"${String(platform)}"`)), 'module-config', `unknown platform "${String(platform)}"`, 'Use android, apple (or ios, macos, tvos), web or devtools.');
  }
  mod.platforms = platforms;
  const hasApple = platforms.some((p) => APPLE.includes(p));
  const hasAndroid = platforms.includes('android');
  const appleKey = config.apple ? 'apple' : config.ios ? 'ios' : 'apple';
  const appleConfig = config[appleKey] ?? {};
  const appleModules = Array.isArray(appleConfig.modules) ? appleConfig.modules : [];
  const subscribers = Array.isArray(appleConfig.appDelegateSubscribers) ? appleConfig.appDelegateSubscribers : [];
  const androidModules = Array.isArray(config.android?.modules) ? config.android.modules : [];
  mod.appleModules = appleModules;
  mod.subscribers = subscribers;
  mod.androidModules = androidModules;
  const androidPackages = mod.kotlin.some((src) => src.classes.some((cls) => cls.supers.includes('Package')));
  if (hasApple && appleModules.length === 0 && subscribers.length === 0) {
    add(file, lineMatching(configText, /"platforms"/), 'module-config', `declares an Apple platform but lists no ${appleKey}.modules (or appDelegateSubscribers)`, `List the Swift Module classes: "${appleKey}": { "modules": ["<Name>Module"] }.`);
  }
  if (hasAndroid && androidModules.length === 0 && !androidPackages) {
    add(file, lineMatching(configText, /"platforms"/), 'module-config', 'declares android but lists no android.modules', 'List the Kotlin Module classes by full name: "android": { "modules": ["expo.modules.<name>.<Name>Module"] }.');
  }
  const swiftFiles = mod.files.filter((f) => /^(ios|apple)\//.test(f) && /\.(swift|m|mm)$/.test(f));
  const kotlinFiles = mod.files.filter((f) => f.startsWith('android/') && /\.(kt|java)$/.test(f));
  if (!hasApple && swiftFiles.length > 0) {
    add(file, lineMatching(configText, /"platforms"/), 'module-config', `${mod.rel}/${swiftFiles[0]} is never linked: no Apple platform is declared`, 'Add "apple" to "platforms" with its modules, or delete the iOS folder.');
  }
  if (!hasAndroid && kotlinFiles.length > 0) {
    add(file, lineMatching(configText, /"platforms"/), 'module-config', `${mod.rel}/${kotlinFiles[0]} is never linked: android is not declared`, 'Add "android" to "platforms" with its modules, or delete the Android folder.');
  }
  // module-build-files
  if (hasApple) {
    const podspecs = mod.files.filter((f) => /^(ios|apple)\/[^/]+\.podspec$/.test(f) || /^[^/]+\.podspec$/.test(f));
    if (podspecs.length === 0) {
      add(`${mod.rel}/ios`, 1, 'module-build-files', 'declares an Apple platform but has no ios/*.podspec, so CocoaPods never builds it', 'Add ios/<Name>.podspec (create-expo-module writes it): s.dependency \'ExpoModulesCore\', s.source_files = \'**/*.swift\'.');
    }
    for (const spec of podspecs) {
      const text = readMaybe(join(mod.dir, spec)) ?? '';
      const needsCore = appleModules.length > 0 || subscribers.length > 0;
      if (needsCore && !/dependency\s*\(?\s*['"]ExpoModulesCore['"]/.test(text)) add(`${mod.rel}/${spec}`, 1, 'module-build-files', 'the podspec does not depend on ExpoModulesCore, so the Swift Module classes do not compile', 'Add s.dependency \'ExpoModulesCore\'.');
      if (!/source_files/.test(text)) add(`${mod.rel}/${spec}`, 1, 'module-build-files', 'the podspec has no source_files, so no Swift file is compiled', 'Add s.source_files = \'**/*.swift\' (or the template\'s "**/*.{h,m,mm,swift,hpp,cpp}").');
    }
  }
  if (hasAndroid) {
    const gradle = ['android/build.gradle', 'android/build.gradle.kts'].find((f) => mod.files.includes(f));
    if (!gradle) {
      add(`${mod.rel}/android`, 1, 'module-build-files', 'declares android but has no android/build.gradle, so Gradle never builds it', 'Add android/build.gradle with plugins { id \'com.android.library\'; id \'expo-module-gradle-plugin\' } and its namespace.');
    } else if (androidModules.length > 0) {
      const text = readMaybe(join(mod.dir, gradle)) ?? '';
      if (!/expo-module-gradle-plugin/.test(text)) add(`${mod.rel}/${gradle}`, 1, 'module-build-files', 'build.gradle does not apply expo-module-gradle-plugin, so expo-modules-core and Kotlin are missing', 'Use the sdk-57 template block: plugins { id \'com.android.library\'; id \'expo-module-gradle-plugin\' }.');
    }
  }
}

function checkModuleClasses(mod, add) {
  const file = `${mod.rel}/expo-module.config.json`;
  const configText = readMaybe(join(mod.dir, 'expo-module.config.json')) ?? '';
  const swiftClasses = mod.swift.flatMap((src) => src.classes.map((cls) => ({ src, cls })));
  const kotlinClasses = mod.kotlin.flatMap((src) => src.classes.map((cls) => ({ src, cls })));
  const used = new Set();
  for (const name of mod.appleModules ?? []) {
    const hit = swiftClasses.find(({ cls }) => cls.name === name);
    const line = lineMatching(configText, new RegExp(`"${name}"`));
    if (!hit) {
      add(file, line, 'module-class', `lists the Swift module class ${name}, which no file in ${mod.rel}/ios declares`, `Declare public class ${name}: Module in ios/${name}.swift, or fix the name in the config.`);
      continue;
    }
    used.add(hit.cls);
    if (!hit.cls.supers.includes('Module')) add(hit.src.rel, hit.cls.line, 'module-class', `${name} is listed as a module but does not extend Module`, `Write public class ${name}: Module { public func definition() -> ModuleDefinition { ... } }.`);
    else if (!hit.cls.isPublic) add(hit.src.rel, hit.cls.line, 'module-class', `${name} is not public, so the generated ExpoModulesProvider cannot reach it`, `Declare it public class ${name}: Module.`);
    mod.defs.push(defOf(mod, 'apple', hit));
  }
  for (const name of mod.subscribers ?? []) {
    const hit = swiftClasses.find(({ cls }) => cls.name === name);
    const line = lineMatching(configText, new RegExp(`"${name}"`));
    if (!hit) add(file, line, 'module-class', `lists the AppDelegate subscriber ${name}, which no Swift file declares`, `Declare public class ${name}: ExpoAppDelegateSubscriber, or fix the name.`);
    else if (!hit.cls.supers.includes('ExpoAppDelegateSubscriber') || !hit.cls.isPublic) add(hit.src.rel, hit.cls.line, 'module-class', `${name} must be a public class extending ExpoAppDelegateSubscriber`, `public class ${name}: ExpoAppDelegateSubscriber { ... }`);
    if (hit) used.add(hit.cls);
  }
  for (const full of mod.androidModules ?? []) {
    const dot = String(full).lastIndexOf('.');
    const pkg = dot === -1 ? '' : String(full).slice(0, dot);
    const name = String(full).slice(dot + 1);
    const line = lineMatching(configText, new RegExp(`"${String(full).replace(/\./g, '\\.')}"`));
    const hit = kotlinClasses.find(({ cls }) => cls.name === name && cls.package === pkg);
    if (!hit) {
      const near = kotlinClasses.find(({ cls }) => cls.name === name);
      add(file, line, 'module-class', near ? `lists ${full}, but ${near.src.rel} declares ${name} in package ${near.cls.package || '(none)'}` : `lists the Kotlin module class ${full}, which no file in ${mod.rel}/android declares`, dot === -1 ? 'Android entries are full names: "expo.modules.<name>.<Name>Module".' : `Declare class ${name} : Module() in package ${pkg}, or fix the entry.`);
      continue;
    }
    used.add(hit.cls);
    if (!hit.cls.supers.includes('Module')) add(hit.src.rel, hit.cls.line, 'module-class', `${name} is listed as a module but does not extend Module()`, `class ${name} : Module() { override fun definition() = ModuleDefinition { ... } }`);
    mod.defs.push(defOf(mod, 'android', hit));
  }
  const unregistered = (list, platform) => {
    for (const { src, cls } of list) {
      if (!cls.supers.includes('Module') || used.has(cls)) continue;
      const entry = platform === 'android' ? `${cls.package}.${cls.name}` : cls.name;
      add(src.rel, cls.line, 'module-class', `${cls.name} extends Module but expo-module.config.json does not list it, so autolinking never registers it`, `Add "${entry}" to ${platform === 'android' ? 'android' : 'apple'}.modules.`);
    }
  };
  unregistered(swiftClasses, 'apple');
  unregistered(kotlinClasses, 'android');
}

function defOf(mod, platform, { src, cls }) {
  const def = moduleDefinition(src.text, src.scan, cls, src.language);
  return { platform, module: mod, src, cls, def };
}

function checkModuleNames(mods, add) {
  const byName = new Map();
  for (const mod of mods) {
    for (const entry of mod.defs) {
      const { def, src, cls } = entry;
      if (!def) continue;
      if (def.name === null) {
        add(src.rel, cls.line, 'module-name', `${cls.name} sets no Name("..."): the JavaScript name then follows the class name and can differ per platform`, `Add Name("${cls.name.replace(/Module$/, '')}") as the first line of the definition, the same on iOS and Android.`);
        continue;
      }
      const key = def.name;
      const list = byName.get(key) ?? [];
      list.push(entry);
      byName.set(key, list);
    }
    // Same class on both platforms must use the same JavaScript name.
    const apple = mod.defs.filter((e) => e.platform === 'apple' && e.def?.name);
    const android = mod.defs.filter((e) => e.platform === 'android' && e.def?.name);
    for (const a of apple) {
      const twin = android.find((k) => k.cls.name === a.cls.name);
      if (twin && twin.def.name !== a.def.name) {
        add(twin.src.rel, twin.def.nameLine, 'module-name', `${a.cls.name} is Name("${a.def.name}") on iOS but Name("${twin.def.name}") on Android: one JavaScript lookup finds only one of them`, `Use one name on both platforms: Name("${a.def.name}").`);
      }
    }
  }
  for (const [name, entries] of byName) {
    const owners = new Set(entries.map((e) => `${e.module.rel}:${e.cls.name}`));
    if (owners.size > 1) {
      const [first, ...rest] = [...new Map(entries.map((e) => [`${e.module.rel}:${e.cls.name}`, e])).values()];
      for (const other of rest) add(other.src.rel, other.def.nameLine, 'module-name', `Name("${name}") is also used by ${first.src.rel} (${first.cls.name}): two modules cannot share a JavaScript name`, 'Give each module its own name (one name per module, unique in the app).');
    }
  }
}

function checkThreadsAndObservers(mod, add) {
  for (const src of [...mod.swift, ...mod.kotlin]) {
    const { code } = src.scan;
    for (const cls of src.classes) {
      if (!cls.supers.includes('Module')) continue;
      const def = moduleDefinition(src.text, src.scan, cls, src.language);
      if (!def) continue;
      for (const component of def.components) {
        if (!['Function', 'AsyncFunction', 'Property', 'Constant'].includes(component.component) || component.closureStart === -1) continue;
        const body = code.slice(component.closureStart, component.closureEnd);
        const pattern = new RegExp((src.language === 'swift' ? SWIFT_UI_MAIN : KOTLIN_UI_MAIN).source, 'g');
        const guarded = mainBlocks(body, src.language);
        const hit = [...body.matchAll(pattern)].find((m) => !guarded.some(([from, to]) => m.index > from && m.index < to));
        if (!hit) continue;
        const isAsync = component.component === 'AsyncFunction';
        if (isAsync && component.runsOnMain) continue;
        const line = src.scan.lineOf(component.closureStart + hit.index);
        const name = component.args[0] ?? component.component;
        const queue = src.language === 'swift' ? '.runOnQueue(.main)' : '.runOnQueue(Queues.MAIN)';
        add(src.rel, line, 'main-thread', isAsync ? `AsyncFunction("${name}") touches UI (${hit[0].trim()}) on its default background queue` : `${component.component}("${name}") touches UI (${hit[0].trim()}) on the JavaScript thread`, `Make it AsyncFunction("${name}") { ... }${queue}: UI work belongs on the main thread, and a synchronous function runs on the JavaScript thread.`);
      }
      checkObservingStops(src, cls, def, add);
    }
    const pairs = src.language === 'swift'
      ? [[/\baddObserver\s*\(/, /\bremoveObserver\s*\(/, 'NotificationCenter observer', 'NotificationCenter.default.removeObserver(token) in stop()/OnStopObserving/OnDestroy']]
      : [[/\bregisterReceiver\s*\(/, /\bunregisterReceiver\s*\(/, 'broadcast receiver', 'context.unregisterReceiver(receiver) in OnStopObserving/OnDestroy'],
        [/\bregisterActivityLifecycleCallbacks\s*\(/, /\bunregisterActivityLifecycleCallbacks\s*\(/, 'lifecycle callback', 'unregisterActivityLifecycleCallbacks(...) when observation stops']];
    for (const [addRe, removeRe, what, fix] of pairs) {
      const added = addRe.exec(code);
      if (added && !removeRe.test(code)) add(src.rel, src.scan.lineOf(added.index), 'observer-release', `adds a ${what} that this file never removes: it outlives the listener and keeps the module alive`, `Remove it where observation stops: ${fix}.`);
    }
  }
}

const SWIFT_MAIN_BLOCK = /\bDispatchQueue\.main\.(?:async|sync)(?:\s*\([^)]*\))?\s*\{|\bMainActor\.run\s*\{|\bTask\s*\{\s*@MainActor\b/g;
const KOTLIN_MAIN_BLOCK = /\brunOnUiThread\s*\{|\bHandler\s*\(\s*Looper\.getMainLooper\s*\(\s*\)\s*\)\s*\.post\s*\{|\bwithContext\s*\(\s*Dispatchers\.Main\s*\)\s*\{/g;

/** [start, end] ranges of blocks the code itself dispatches to the main thread (explicit dispatch). */
function mainBlocks(body, language) {
  const ranges = [];
  for (const match of body.matchAll(language === 'swift' ? SWIFT_MAIN_BLOCK : KOTLIN_MAIN_BLOCK)) {
    const open = body.indexOf('{', match.index);
    let depth = 0;
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}' && (depth -= 1) === 0) {
        ranges.push([open, i]);
        break;
      }
    }
  }
  return ranges;
}

/**
 * observer-stop: observation a Module starts must stop in the Module itself. The add/remove pair of
 * observer-release usually sits in a plain helper (start()/stop()), so it holds even when the Module
 * never calls stop(); this checks the definition: every OnStartObserving("e") has an
 * OnStopObserving("e") (or the unnamed form), and any OnStartObserving comes with an OnDestroy.
 */
function checkObservingStops(src, cls, def, add) {
  const starts = def.components.filter((c) => c.component === 'OnStartObserving');
  if (starts.length === 0) return;
  const stops = def.components.filter((c) => c.component === 'OnStopObserving');
  const stopAll = stops.some((c) => c.args[0] === undefined);
  const stopped = new Set(stops.map((c) => c.args[0]).filter((name) => name !== undefined));
  for (const start of starts) {
    const event = start.args[0];
    const ok = event === undefined ? stops.length > 0 : stopAll || stopped.has(event);
    if (ok) continue;
    const label = event === undefined ? 'OnStartObserving' : `OnStartObserving("${event}")`;
    const stop = event === undefined ? 'OnStopObserving { ... }' : `OnStopObserving("${event}") { ... }`;
    add(src.rel, start.line, 'observer-stop', `${cls.name} starts observing in ${label} but never stops: the OS observer keeps firing after the last listener is removed`, `Add ${stop} that calls the helper's stop(), beside the start.`);
  }
  if (!def.components.some((c) => c.component === 'OnDestroy')) {
    add(src.rel, starts[0].line, 'observer-stop', `${cls.name} uses OnStartObserving but has no OnDestroy: a reload or a destroyed React context leaves the observer registered`, 'Add OnDestroy { ... } that calls the same stop() as OnStopObserving (stop() must be safe to call twice).');
  }
}

function checkLegacyNative(mod, add) {
  for (const file of mod.files) {
    if (!/\.(m|mm|h|java|kt|swift)$/.test(file)) continue;
    const text = readMaybe(join(mod.dir, file));
    if (text === null) continue;
    const code = scanSource(text).code;
    const rel = `${mod.rel}/${file}`;
    const isTurbo = /getTurboModule\s*:|RCTTurboModule\b|\bNative\w*Spec\b|ManagerInterface\s*</.test(code);
    const flag = (re, what) => {
      const hit = re.exec(code);
      if (hit && !isTurbo) add(rel, lineAt(text, hit.index), 'legacy-native-api', `${what} is legacy bridge code: on React Native 0.86 it runs only through the interop layer, which is slated for removal`, 'Write the module with the Expo Modules API (Name/Function/AsyncFunction/Events in Swift and Kotlin), or as a Turbo Module whose class implements the codegen spec.');
    };
    if (/\.(m|mm|h)$/.test(file)) {
      flag(/\bRCT_(?:EXPORT|EXTERN)_(?:MODULE|METHOD)\b|\bRCT_REMAP_METHOD\b/, 'RCT_EXPORT_MODULE/RCT_EXPORT_METHOD');
      flag(/:\s*RCTViewManager\b|\bRCT_EXPORT_VIEW_PROPERTY\b/, 'An RCTViewManager');
      flag(/:\s*RCTEventEmitter\b/, 'An RCTEventEmitter subclass');
    } else if (/\.(java|kt)$/.test(file)) {
      flag(/\bReactContextBaseJavaModule\b/, 'A ReactContextBaseJavaModule');
      flag(/@ReactMethod\b/, '@ReactMethod');
      flag(/(?::|implements)\s*ReactPackage\b/, 'A ReactPackage');
      flag(/:\s*(?:SimpleViewManager|ViewGroupManager)\s*</, 'A view manager without a codegen ManagerInterface');
    }
  }
}

// =================================================================================================
// Codegen (Turbo Modules and Fabric components)
// =================================================================================================

function checkCodegenConfigs(root, modulesDir, manifest, modules, add) {
  const specDirs = [];
  if (manifest.codegenConfig) {
    add('package.json', lineMatching(readMaybe(join(root, 'package.json')) ?? '', /"codegenConfig"/), 'codegen-config', 'the app package.json declares codegenConfig: with Continuous Native Generation its native half would live in the generated ios/ and android/ folders', `Move the specs and their native code into a local package ${modulesDir}/<name>/ with its own package.json codegenConfig, podspec and build.gradle (autolinking scans ${modulesDir}/).`);
  }
  for (const mod of modules) {
    if (!mod.isCodegenPackage) continue;
    const file = `${mod.rel}/package.json`;
    const text = readMaybe(join(mod.dir, 'package.json')) ?? '';
    const cfg = mod.pkg.codegenConfig;
    const line = lineMatching(text, /"codegenConfig"/);
    if (typeof cfg.name !== 'string' || cfg.name.trim() === '') add(file, line, 'codegen-config', 'codegenConfig has no name', 'Set "name": "<Name>Spec" (the generated library name).');
    if (!['modules', 'components', 'all'].includes(cfg.type)) add(file, line, 'codegen-config', `codegenConfig.type is ${JSON.stringify(cfg.type)}`, 'Set "type": "modules" (Turbo Modules), "components" (Fabric) or "all".');
    if (typeof cfg.jsSrcsDir !== 'string' || !existsSync(join(mod.dir, cfg.jsSrcsDir))) {
      add(file, line, 'codegen-config', `codegenConfig.jsSrcsDir ${JSON.stringify(cfg.jsSrcsDir)} is not a folder of ${mod.rel}`, 'Set "jsSrcsDir" to the folder holding the Native<Name>.ts specs (for example "src").');
    } else {
      const dir = posix.join(mod.rel, cfg.jsSrcsDir.replace(/^\.\//, '').replace(/\/$/, ''));
      specDirs.push({ dir, module: mod, type: cfg.type });
      const specs = listFiles(join(root, dir)).filter((f) => /(^|\/)(Native\w+|\w+NativeComponent)\.(ts|tsx|js)$/.test(f));
      if (specs.length === 0) add(file, line, 'codegen-config', `codegenConfig.jsSrcsDir ${cfg.jsSrcsDir} holds no Native<Name>.ts or <Name>NativeComponent.ts spec, so codegen generates nothing`, 'Put the spec files there (codegen reads only files named Native* and *NativeComponent).');
    }
    if (mod.files.some((f) => /^(ios|apple)\//.test(f)) && !mod.files.some((f) => /^[^/]+\.podspec$/.test(f))) {
      const nested = mod.files.find((f) => f.endsWith('.podspec'));
      add(nested ? `${mod.rel}/${nested}` : file, 1, 'codegen-config', `${mod.rel} has iOS code but no podspec at its root: Expo autolinking looks for a React Native module's podspec only there, so the module is never linked on iOS`, `Put <Name>.podspec in ${mod.rel}/ (source_files 'ios/*.{h,mm}', install_modules_dependencies(s)); an Expo module keeps its podspec in ios/, a Turbo Module package does not.`);
    }
    if (mod.files.some((f) => f.startsWith('android/')) && typeof cfg.android?.javaPackageName !== 'string') {
      add(file, line, 'codegen-config', 'codegenConfig has no android.javaPackageName, so the generated Java spec lands in a default package the Kotlin module does not import', 'Set "android": { "javaPackageName": "<the module\'s package>" }.');
    }
  }
  return specDirs;
}

function checkSpecs(bindings, specDirs, modulesDir, add) {
  const names = new Set();
  const inSpecDir = (rel) => specDirs.find((s) => rel.startsWith(`${s.dir}/`));
  for (const { rel, scan, call } of bindings) {
    if (BINDING_CALLEES[call.callee]?.kind !== 'turbo') continue;
    if (call.name) names.add(call.name);
    const base = basename(rel);
    const spec = inSpecDir(rel);
    if (!/^Native\w+\.(ts|tsx|js)$/.test(base)) {
      add(rel, call.line, 'codegen-spec', `${call.callee} in ${base}: codegen reads module specs only from files named Native<Name>.ts`, 'Move the spec to Native<Name>.ts inside the package\'s codegenConfig.jsSrcsDir; adapters bind it through requireOptionalNativeModule or import the spec.');
    } else if (!spec) {
      add(rel, call.line, 'codegen-spec', `${base} is outside every codegenConfig.jsSrcsDir, so codegen never sees it and the native protocol is never generated`, `Keep specs in ${modulesDir}/<name>/<jsSrcsDir>/ of a package with codegenConfig.`);
    }
    if (!/\binterface\s+Spec\s+extends\s+TurboModule\b/.test(scan.code)) {
      add(rel, call.line, 'codegen-spec', `${base} declares no "export interface Spec extends TurboModule"`, 'Declare the module\'s methods in export interface Spec extends TurboModule { ... } (codegen reads that interface).');
    }
  }
  return names;
}

// =================================================================================================
// Bindings and the cross-language contract
// =================================================================================================

function checkBindings({ bindings, modules, specNames, layout, modulesDir, specDirs, add }) {
  const moduleNames = new Map();
  for (const mod of modules) for (const entry of mod.defs) if (entry.def?.name) {
    const list = moduleNames.get(entry.def.name) ?? [];
    list.push(entry);
    moduleNames.set(entry.def.name, list);
  }
  const adapterDirs = [layout.servicesDir, layout.dataDir];
  const isAdapter = (rel) => /-adapter(\.(ios|android|native))?\.(ts|tsx|js|jsx)$/.test(rel) && adapterDirs.some((dir) => rel.startsWith(`${dir}/`));
  const isSpec = (rel) => specDirs.some((s) => rel.startsWith(`${s.dir}/`)) && /^(Native\w+|\w+NativeComponent)\.(ts|tsx|js)$/.test(basename(rel));
  const inModule = (rel) => rel.startsWith(`${modulesDir}/`);
  const bound = new Set();
  // The codegen spec file of each Turbo Module name (Native<Name>.ts calling TurboModuleRegistry).
  const specFiles = new Map();
  for (const { rel, scan, call } of bindings) {
    if (BINDING_CALLEES[call.callee]?.kind === 'turbo' && call.name && /^Native\w+\.(ts|tsx|js)$/.test(basename(rel)) && !specFiles.has(call.name)) specFiles.set(call.name, { rel, scan });
  }
  // binding-unique: the first file (adapters first, then path order) owns each module's binding of each
  // kind; platform variants of one adapter (-adapter.ios.ts / -adapter.android.ts) count as one file.
  const owners = new Map();
  const ordered = [...bindings].sort((a, b) => Number(isAdapter(b.rel)) - Number(isAdapter(a.rel)) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const sameFile = (rel) => rel.replace(/\.(ios|android|native|web)(?=\.[jt]sx?$)/, '');
  for (const { rel, call } of ordered) {
    const meta = BINDING_CALLEES[call.callee];
    const spec = isSpec(rel) || (meta.kind === 'turbo' && /^Native\w+\.(ts|tsx|js)$/.test(basename(rel)));
    // A binding outside every adapter is binding-place's finding already; one report is enough.
    if (spec || call.name === null || (!isAdapter(rel) && !inModule(rel))) continue;
    const key = `${meta.kind === 'view' ? 'view' : 'module'}:${call.name}`;
    const owner = owners.get(key);
    if (!owner) {
      owners.set(key, { rel, line: call.line });
    } else if (sameFile(owner.rel) !== sameFile(rel)) {
      add(rel, call.line, 'binding-unique', `${call.name} is already bound in ${owner.rel}:${owner.line}: two bindings mean two places to guard, type and keep in step with the native definitions`, `One binding per module: delete this one and take the port that ${owner.rel} implements (from useServices(), or the composition root).`);
    }
  }
  for (const { rel, scan, call } of bindings) {
    const meta = BINDING_CALLEES[call.callee];
    // A spec-shaped file (Native<Name>.ts calling TurboModuleRegistry) is codegen-spec's business
    // wherever it lies: its top-level default export is what codegen requires.
    const spec = isSpec(rel) || (meta.kind === 'turbo' && /^Native\w+\.(ts|tsx|js)$/.test(basename(rel)));
    if (!isAdapter(rel) && !spec && !inModule(rel)) {
      add(rel, call.line, 'binding-place', `${call.callee}(${call.name ? `'${call.name}'` : '...'}) outside an adapter: native code reaches this file directly, and Jest, web and older binaries meet it unguarded`, `Bind the module once, in its adapter (${layout.servicesDir}/<concern>/<module>-<concern>-adapter.ts), behind a port; everything else takes the port from useServices().`);
    }
    if (call.atTopLevel && !spec) {
      add(rel, call.line, 'binding-lazy', `${call.callee} runs at import time: the lookup happens when any file imports this one (the composition root's test, a web bundle) and before the app can decide`, `Bind inside the factory: export function create...Adapter(native = ${call.callee === 'requireNativeModule' ? 'requireOptionalNativeModule' : call.callee}<T>('${call.name ?? 'Name'}')) { ... }.`);
    }
    if (meta.throws) {
      const better = call.callee === 'requireNativeModule' ? 'requireOptionalNativeModule' : 'TurboModuleRegistry.get';
      add(rel, call.line, 'binding-optional', `${call.callee} throws when the running binary lacks the module (Jest, web, a dev client or store build older than the module, an update sent to an older binary)`, `Use ${better}<T>('${call.name ?? 'Name'}') and map null to an "unavailable" failure in the port.`);
    }
    if (meta.kind !== 'view') {
      if (call.typeArg === null || /^(any|unknown|object)$/.test(call.typeArg)) {
        add(rel, call.line, 'binding-type', `${call.callee}('${call.name ?? '...'}') is untyped, so nothing ties the JavaScript calls to the native definitions`, `Pass the binding type: ${call.callee}<${call.name ?? 'Name'}Binding>('${call.name ?? 'Name'}'), declared in this file with every native member.`);
      } else if (meta.kind === 'module' && !spec) {
        const typeName = call.typeArg.replace(/\s*\|\s*null$/, '');
        const resolved = resolveBindingType(scan, typeName);
        const turboSpec = call.name && !moduleNames.has(call.name) ? specFiles.get(call.name) : undefined;
        // A Turbo Module's codegen spec is its contract: a type imported from that spec file satisfies
        // binding-type, and a hand-written type is compared with the spec's interface Spec.
        const fromSpec = !resolved && turboSpec && importsTypeFrom(scan, typeName, turboSpec.rel);
        if (fromSpec) {
          // typed by the spec itself: codegen and the compiler keep both sides in step.
        } else if (!resolved) {
          add(rel, call.line, 'binding-type', `the binding type ${typeName} is not declared in ${basename(rel)}`, turboSpec ? `Import the codegen interface: import type { Spec } from '<path to ${basename(turboSpec.rel)}>' and bind requireOptionalNativeModule<Spec>('${call.name}').` : `Declare type ${typeName} = { ... } beside the binding, so the contract with the native side sits in one file.`);
        } else if (turboSpec) {
          // A binding outside an adapter is binding-place's finding; one report is enough.
          if (isAdapter(rel) || inModule(rel)) checkSpecContract({ rel, call, resolved, spec: turboSpec, add });
        } else if (call.name && moduleNames.has(call.name) && (isAdapter(rel) || inModule(rel))) {
          checkContract({ rel, call, resolved, entries: moduleNames.get(call.name), add });
        }
      }
    }
    if (call.name === null) {
      add(rel, call.line, 'binding-name', `${call.callee} is called with a computed name`, 'Name the module with a string literal so the lookup can be checked against the native definitions.');
    } else if (!spec) {
      bound.add(call.name);
      if (!moduleNames.has(call.name) && !specNames.has(call.name)) {
        add(rel, call.line, 'binding-name', `binds the native module '${call.name}', which no local module (${modulesDir}/*) or codegen spec of this app defines`, `Use the Name("...") the Swift and Kotlin definitions set; for a library's module, call the library's own JavaScript API instead of its native object.`);
      }
    }
  }
  for (const [name, entries] of moduleNames) {
    if (bound.has(name)) continue;
    const first = entries[0];
    const hasJsSurface = entries.some((e) => e.def && (e.def.members.size > 0 || e.def.events.size > 0 || e.def.hasView));
    if (!hasJsSurface) continue;
    add(first.src.rel, first.def.nameLine ?? first.cls.line, 'binding-name', `the native module '${name}' is never bound: no adapter calls requireOptionalNativeModule('${name}') (or requireNativeView for a view)`, `Bind it in its adapter (${layout.servicesDir}/<concern>/<module>-<concern>-adapter.ts), or delete the unused native code.`);
  }
  checkParity(moduleNames, bindings, (rel) => isAdapter(rel) || inModule(rel), add);
}

/** contract-drift: the binding type versus the union of the native definitions. */
function checkContract({ rel, call, resolved, entries, add }) {
  const nativeMembers = new Map();
  const nativeEvents = new Map();
  for (const entry of entries) {
    for (const [name, info] of entry.def.members) if (!nativeMembers.has(name)) nativeMembers.set(name, { ...info, entry });
    for (const [name, line] of entry.def.events) if (!nativeEvents.has(name)) nativeEvents.set(name, { line, entry });
  }
  const typeMembers = new Map(resolved.members.map((m) => [m.name, m]));
  for (const member of resolved.members) {
    if (!nativeMembers.has(member.name)) add(rel, member.line, 'contract-drift', `the binding type names ${member.name}, which neither the Swift nor the Kotlin definition of '${call.name}' exports: the call fails at runtime with "is not a function"`, `Rename it to the native member, or add Function("${member.name}") / AsyncFunction("${member.name}") on both platforms in the same change.`);
  }
  for (const [name, info] of nativeMembers) {
    if (!typeMembers.has(name)) add(info.entry.src.rel, info.line, 'contract-drift', `${info.kind}("${name}") of '${call.name}' is missing from the binding type in ${rel}`, `Add ${name} to the binding type (optional with ? when one platform lacks it), or delete the native member.`);
  }
  for (const [name, line] of resolved.events) {
    if (!nativeEvents.has(name)) add(rel, line, 'contract-drift', `the binding type listens for "${name}", which no native Events(...) of '${call.name}' declares`, `Declare Events("${name}") on both platforms, or rename the event in the binding type.`);
  }
  for (const [name, info] of nativeEvents) {
    if (!resolved.events.has(name)) add(info.entry.src.rel, info.line, 'contract-drift', `Events("${name}") of '${call.name}' is missing from the binding type in ${rel}`, `Type it: addListener(eventName: '${name}', listener: (payload: ...) => void): { remove(): void }, or extend NativeModule<{ ${name}: ... }>.`);
  }
}

/** True when typeName is imported (import type { Spec as X } or import { type Spec }) from the spec file. */
function importsTypeFrom(scan, typeName, specRel) {
  const stem = basename(specRel).replace(/\.(ts|tsx|js)$/, '');
  const importRe = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of scan.codeKeep.matchAll(importRe)) {
    if (scan.code.slice(match.index, match.index + 6) !== 'import') continue;
    const source = match[3].replace(/\.(ts|tsx|js)$/, '');
    if (source.split('/').pop() !== stem) continue;
    for (const raw of match[2].split(',')) {
      const parts = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const local = (parts[1] ?? parts[0]).trim();
      if (local === typeName) return true;
    }
  }
  return false;
}

/** contract-drift for a Turbo Module: a hand-written binding type versus the codegen interface Spec. */
function checkSpecContract({ rel, call, resolved, spec, add }) {
  const specType = resolveBindingType(spec.scan, 'Spec');
  if (!specType) return; // codegen-spec reports the missing interface Spec.
  const specMembers = new Map(specType.members.map((m) => [m.name, m]));
  const typeMembers = new Map(resolved.members.map((m) => [m.name, m]));
  for (const member of resolved.members) {
    if (!specMembers.has(member.name)) add(rel, member.line, 'contract-drift', `the binding type names ${member.name}, which the codegen interface Spec of '${call.name}' (${spec.rel}) does not declare: the call fails at runtime with "is not a function"`, `Type the binding with the spec itself (import type { Spec } from the spec file), or rename the member to the spec's.`);
  }
  for (const [name, member] of specMembers) {
    if (!typeMembers.has(name)) add(rel, call.line, 'contract-drift', `${name} of the codegen interface Spec (${spec.rel}:${member.line}) is missing from the binding type ${call.typeArg}`, `Type the binding with the spec itself (import type { Spec } from the spec file), so the two can never drift.`);
  }
}

/** platform-parity: a module on iOS and Android exports the same surface, or the binding marks the gap. */
function checkParity(moduleNames, bindings, isBindingHome, add) {
  const optionalByName = new Map();
  for (const { rel, scan, call } of bindings) {
    if (!call.name || !call.typeArg || BINDING_CALLEES[call.callee]?.kind !== 'module' || !isBindingHome(rel)) continue;
    const resolved = resolveBindingType(scan, call.typeArg.replace(/\s*\|\s*null$/, ''));
    if (!resolved) continue;
    const set = optionalByName.get(call.name) ?? new Set();
    for (const member of resolved.members) if (member.optional) set.add(member.name);
    optionalByName.set(call.name, set);
  }
  for (const [name, entries] of moduleNames) {
    const apple = entries.find((e) => e.platform === 'apple' && e.def);
    const android = entries.find((e) => e.platform === 'android' && e.def);
    if (!apple || !android) continue;
    const optional = optionalByName.get(name) ?? new Set();
    const compare = (from, to, label, otherLabel, kind) => {
      const fromMap = kind === 'member' ? from.def.members : from.def.events;
      const toMap = kind === 'member' ? to.def.members : to.def.events;
      for (const [member, info] of fromMap) {
        if (toMap.has(member) || (kind === 'member' && optional.has(member))) continue;
        const line = typeof info === 'number' ? info : info.line;
        add(from.src.rel, line, 'platform-parity', `'${name}' exports ${kind === 'member' ? member : `the event ${member}`} on ${label} but not on ${otherLabel}: JavaScript that calls it works on one platform and fails on the other`, kind === 'member' ? `Implement ${member} on ${otherLabel} too, or mark it optional in the binding type (${member}?(): ...) and handle its absence in the adapter.` : `Declare Events("${member}") on ${otherLabel} too.`);
      }
    };
    compare(apple, android, 'iOS', 'Android', 'member');
    compare(android, apple, 'Android', 'iOS', 'member');
    compare(apple, android, 'iOS', 'Android', 'event');
    compare(android, apple, 'Android', 'iOS', 'event');
  }
}

// =================================================================================================
// Legacy JavaScript APIs and native placement
// =================================================================================================

function checkLegacyJs(rel, text, scan, add) {
  const importRe = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;
  for (const match of scan.codeKeep.matchAll(importRe)) {
    if (scan.code.slice(match.index, match.index + 6) !== 'import' || match[1]) continue;
    for (const raw of match[2].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (raw.trim().startsWith('type ')) continue;
      if (LEGACY_JS.includes(name)) add(rel, lineAt(text, match.index), 'legacy-js-api', `imports ${name} from react-native, a legacy-architecture API (bridge modules and view managers)`, name === 'NativeModules' || name === 'NativeEventEmitter' ? 'Bind a local module through its adapter with requireOptionalNativeModule<T>(\'Name\') and listen with its addListener; a library exposes its own JavaScript API.' : name === 'requireNativeComponent' ? 'Render a native view through requireNativeView (an Expo module View) or a codegen <Name>NativeComponent.ts.' : 'Use the New Architecture APIs: refs with measure/focus on host components, Expo module views and functions.');
    }
  }
  const req = /require\(\s*['"]react-native['"]\s*\)\s*\.\s*(NativeModules|UIManager|requireNativeComponent)\b/.exec(scan.codeKeep);
  if (req) add(rel, lineAt(text, req.index), 'legacy-js-api', `reaches react-native's ${req[1]}, a legacy-architecture API`, 'Bind native code through its adapter (requireOptionalNativeModule) instead.');
  // import * as RN from 'react-native'; RN.NativeModules.X
  for (const ns of scan.codeKeep.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]react-native['"]/g)) {
    if (scan.code.slice(ns.index, ns.index + 6) !== 'import') continue;
    const use = new RegExp(`(?<![\\w$.])${ns[1].replace(/\$/g, '\\$')}\\s*\\.\\s*(${LEGACY_JS.join('|')})\\b`).exec(scan.code);
    if (use) add(rel, lineAt(text, use.index), 'legacy-js-api', `reaches react-native's ${use[1]} through the namespace import ${ns[1]}, a legacy-architecture API`, 'Bind native code through its adapter (requireOptionalNativeModule) instead.');
  }
}

function checkPlacement(root, modulesDir, extraDirs, add) {
  let count = 0;
  const allowed = [modulesDir, ...extraDirs.map((d) => d.replace(/^\.\//, '').replace(/\/$/, ''))];
  for (const rel of walkRepo(root)) {
    if (!NATIVE_EXT.test(rel)) continue;
    count += 1;
    if (allowed.some((dir) => rel.startsWith(`${dir}/`))) continue;
    if (rel.endsWith('.gradle.kts')) continue;
    add(rel, 1, 'native-placement', `native source outside ${modulesDir}/: autolinking never builds it, and no checker or reviewer looks for native code here`, `Move it into a local Expo module (${modulesDir}/<name>/ios or android); an app extension folder (widgets) goes in rn-skills.config.json "nativeSourceDirs".`);
  }
  for (const config of ['app.config.ts', 'app.config.js', 'app.json']) {
    const text = readMaybe(join(root, config));
    if (text === null) continue;
    let hit = null;
    if (config === 'app.json') {
      // app.json: parse it (the key is a quoted string there, which the code scan blanks).
      const parsed = parseJson(text).value;
      const experiments = parsed?.expo?.experiments ?? parsed?.experiments;
      if (experiments && typeof experiments === 'object' && experiments.inlineModules !== undefined) hit = /"inlineModules"/.exec(text) ?? { index: 0 };
    } else {
      // bare (inlineModules:) or quoted ('inlineModules':) key; comments are blanked in codeKeep.
      hit = /(?:\binlineModules\b|(['"])inlineModules\1)\s*:/.exec(scanSource(text).codeKeep);
    }
    if (hit) add(config, lineAt(text, hit.index), 'native-placement', 'enables experiments.inlineModules: Swift and Kotlin files then live beside routes and screens, under an API Expo marks experimental (SDK 56 and later)', `Put native code in a local Expo module (${modulesDir}/<name>/, npx create-expo-module@latest --local) and remove experiments.inlineModules.`);
  }
  return count;
}

run(main);
