#!/usr/bin/env node
// check-rnfb.mjs: checks how an Expo app uses React Native Firebase (RNFB): the modular API only, the
// SDK imported only by adapters, no client transactions, no write the UI waits for, emulators only in
// the development variant, no Firebase config file in git, and every listener's unsubscribe kept.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-rnfb.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, matchGlob, parseArgs, readWorkspaces, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { importsOf, isTestFile, resolveSpecifier, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-rnfb',
  summary: 'Checks the React Native Firebase code of an Expo app: modular API, adapters, offline-safe writes, emulators, config files and listeners.',
  usage: '[repo-root] [options]',
  positionals: { min: 0, max: 1 },
  options: {
    'firestore-dir': { type: 'string', value: 'dir', help: 'The Firestore adapter folder (default: <dataDir>/firestore, src/data/firestore)' },
    'emulator-config': { type: 'string', value: 'file', help: 'The emulator config module (default: <configDir>/firebase-emulators.ts)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  details: [
    'Rules:',
    '  namespaced-api          a default import, `firebase` import or `firebase.<module>()` call from @react-native-firebase/*',
    '                          (the namespaced API, removed in v26): import the modular functions by name',
    '  client-transaction      runTransaction imported from @react-native-firebase/firestore or called in app code',
    '                          (it needs the server and fails offline): one writeBatch per action, or a Cloud Function',
    '  awaited-commit-in-ui    UI code (routes, features, ui, hooks, stores) awaits a commit, setDoc, updateDoc, addDoc or',
    '                          deleteDoc, or awaits a port method whose adapter returns or awaits one (offline it stays',
    '                          pending until the server answers)',
    '  sdk-outside-adapter     @react-native-firebase/* imported (types too) outside *-adapter.ts files in the Firestore',
    '                          folder and in <servicesDir>/<concern>/ (tests, root mocks and scripts excepted)',
    '  emulator-in-production  a connect*Emulator / useEmulator call with a literal host, or in a file that does not take',
    '                          its settings from the emulator config; or that config not returning null for every variant',
    '                          but development (no comparison with \'development\', or a __DEV__ guard)',
    '  config-file-committed   a GoogleService-Info*.plist or google-services*.json in the repo that .gitignore does not',
    '                          ignore, or app.config.ts / app.json pointing googleServicesFile at a literal path',
    '  listener-leak           onSnapshot, onAuthStateChanged, onIdTokenChanged, onTokenChanged or onSnapshotsInSync',
    '                          called as a statement (its unsubscribe dropped), or a watch*/subscribe* port call made as',
    '                          a statement in UI code (the effect returns nothing to clean up)',
    'Paths come from resolveLayout (src/app, src/features, src/ui, src/hooks, src/stores, src/data, src/services, src/config).',
    'NOT APPLICABLE when package.json (root or a workspace) lists no @react-native-firebase package.',
    'The repo scan prunes installed skills (.agents/, .claude/, skills/, any folder with a SKILL.md) and generated folders.',
    'Limits (heuristic, by design): source text is read, not types; a port method is linked to its adapter by name.',
  ].join('\n'),
};

const RNFB = /^@react-native-firebase\/[a-z-]+(\/.*)?$/;
const LISTENERS = ['onSnapshot', 'onAuthStateChanged', 'onIdTokenChanged', 'onTokenChanged', 'onSnapshotsInSync'];
const SERVER_WRITES = ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc'];
const CONFIG_FILE = /^(GoogleService-Info.*\.plist|google-services.*\.json)$/;
const PLATFORM = '(\\.(ios|android|native|web))?';

const under = (rel, dir) => dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} ${path} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

/** Every dependency name of the root package.json and of each workspace. */
function dependencies(root) {
  const manifests = [readJson(join(root, 'package.json'), 'package.json'), ...readWorkspaces(root).map((entry) => entry.manifest ?? {})];
  return manifests.flatMap((manifest) => ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => Object.keys(manifest?.[key] ?? {})));
}

/** One scanned source file: comments and string contents blanked in `code`, imports parsed. */
function load(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(text);
  return { rel, text, scan, code: scan.code, keep: scan.codeKeep, lineOf: scan.lineOf, imports: importsOf(scan) };
}

/** Where the text before `index` ends: the last non-space character, or '' at the start of the file. */
function before(code, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  return i < 0 ? '' : code[i];
}

/** The start of a member chain ending at `index` (`deps.store.watchList` → the `d`). */
function chainStart(code, index) {
  let i = index;
  while (i > 0 && /[\w$.?!]/.test(code[i - 1])) i -= 1;
  return i;
}

/** true when the call starting at `start` is an expression statement (its value is thrown away; `void` too). */
function isStatement(code, start) {
  const head = code.slice(Math.max(0, start - 24), start);
  const voided = /\bvoid\s*$/.exec(head);
  const at = voided === null ? start : start - (head.length - voided.index);
  const prev = before(code, at);
  return prev === '' || prev === ';' || prev === '{' || prev === '}';
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

function checkNamespaced(ctx, src) {
  const fix = 'Import the modular functions by name (getFirestore, collection, doc, writeBatch, onSnapshot, ...): v26 removed the namespaced API.';
  for (const match of src.keep.matchAll(/\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*(['"])(@react-native-firebase\/[^'"]+)\2/g)) {
    ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'namespaced-api', message: `default import ${match[1]} from ${match[3]} (the namespaced API)`, fix });
  }
  for (const match of src.keep.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])(@react-native-firebase\/[^'"]+)\2/g)) {
    if (match[1].split(',').some((name) => name.trim() === 'firebase')) {
      ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'namespaced-api', message: `imports firebase from ${match[3]} (the namespaced API)`, fix });
    }
  }
  for (const match of src.code.matchAll(/\brequire\s*\(\s*(['"])(@react-native-firebase\/[^'"]+)\1\s*\)\s*\.\s*default\b/g)) {
    ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'namespaced-api', message: `${match[2]} loaded through require(...).default (the namespaced API)`, fix });
  }
}

function checkTransaction(ctx, src) {
  if (!under(src.rel, ctx.layout.srcDir) || isTestFile(src.rel)) return;
  const fix = 'Write one writeBatch per user action (it is queued offline); work that must read and write atomically on the server belongs in a Cloud Function.';
  const seen = new Set();
  for (const match of src.code.matchAll(/(?<![\w$])runTransaction\s*\(/g)) {
    seen.add(src.lineOf(match.index));
  }
  for (const entry of src.imports.filter((item) => item.spec.startsWith('@react-native-firebase/firestore'))) {
    if (/\brunTransaction\b/.test(src.keep.slice(src.keep.lastIndexOf('import', entry.index), entry.index))) seen.add(entry.line);
  }
  for (const line of [...seen].sort((a, b) => a - b).slice(0, 1)) {
    ctx.add({ file: src.rel, line, rule: 'client-transaction', message: 'uses runTransaction on the client (a transaction needs the server and fails offline)', fix });
  }
}

/** An allowed SDK home: *-adapter.ts in the Firestore folder (any depth) or in <servicesDir>/<concern>/. */
function isAdapterFile(ctx, rel) {
  const name = new RegExp(`-adapter${PLATFORM}\\.tsx?$`);
  if (!name.test(rel)) return false;
  if (under(rel, ctx.firestoreDir)) return true;
  const rest = under(rel, ctx.layout.servicesDir) ? rel.slice(ctx.layout.servicesDir.length + 1) : null;
  return rest !== null && rest.split('/').length === 2;
}

/** Tests, root mocks and Node scripts may hold the SDK to test it. */
function isTestSide(ctx, rel) {
  return isTestFile(rel) || under(rel, ctx.layout.testDir) || under(rel, ctx.layout.mocksDir) || under(rel, ctx.layout.scriptsDir);
}

function checkSdkImports(ctx, src) {
  if (isTestSide(ctx, src.rel) || isAdapterFile(ctx, src.rel)) return;
  for (const entry of src.imports.filter((item) => RNFB.test(item.spec))) {
    ctx.add({
      file: src.rel,
      line: entry.line,
      rule: 'sdk-outside-adapter',
      message: `imports ${entry.spec}${entry.typeOnly ? ' (types)' : ''} outside an adapter`,
      fix: `Only *-adapter.ts files in ${ctx.firestoreDir}/ and ${ctx.layout.servicesDir}/<concern>/ import RNFB; everything else calls the port (and its types stay SDK-free).`,
    });
  }
}

/** UI code: routes, features, shared UI, shared hooks and stores. */
function isUiFile(ctx, rel) {
  const hooksDir = `${ctx.layout.srcDir}/hooks`;
  return !isTestFile(rel) && [ctx.layout.routesDir, ctx.layout.featuresDir, ctx.layout.uiDir, hooksDir, ctx.layout.storesDir].some((dir) => under(rel, dir));
}

/** Names that hold functions: `name: (...) =>`, `name(...) {`, `function name`, `const name =`. */
function definitionsOf(code) {
  const found = [];
  for (const match of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=;{}]*)?=>/g)) found.push({ name: match[1], index: match.index });
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) found.push({ name: match[1], index: match.index });
  const arrow = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=;{}]*)?=>|[A-Za-z_$][\w$]*\s*=>)/g;
  for (const match of code.matchAll(arrow)) found.push({ name: match[1], index: match.index });
  for (const match of code.matchAll(/(?:^|[,{]\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*(?::[^{;]*)?\{/gm)) found.push({ name: match[1], index: match.index });
  return found.sort((a, b) => a.index - b.index);
}

/** Adapter functions that hand the server's acknowledgement back to the caller. */
function ackReturningMethods(src) {
  const writes = SERVER_WRITES.join('|');
  const patterns = [
    /\breturn\s+(?:await\s+)?[\w$.]+\s*\.\s*commit\s*\(/g,
    /=>\s*(?:await\s+)?[\w$.]+\s*\.\s*commit\s*\(/g,
    /\bawait\s+[\w$.]+\s*\.\s*commit\s*\(/g,
    new RegExp(`\\breturn\\s+(?:await\\s+)?(?:${writes})\\s*\\(`, 'g'),
    new RegExp(`=>\\s*(?:await\\s+)?(?:${writes})\\s*\\(`, 'g'),
    new RegExp(`\\bawait\\s+(?:${writes})\\s*\\(`, 'g'),
  ];
  const defs = definitionsOf(src.code);
  const methods = new Map();
  for (const pattern of patterns) {
    for (const match of src.code.matchAll(pattern)) {
      const owner = defs.filter((def) => def.index < match.index).at(-1);
      if (owner !== undefined && !methods.has(owner.name)) methods.set(owner.name, src.lineOf(match.index));
    }
  }
  // One level of delegation: `addTask: (draft) => saveTask(at, draft)` hands saveTask's promise on.
  for (const match of src.code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?\([^()]*\)\s*(?::[^=;{}]*)?=>\s*(?:\{\s*return\s+)?(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (methods.has(match[2]) && !methods.has(match[1])) methods.set(match[1], methods.get(match[2]));
  }
  return methods;
}

function checkAwaitedCommits(ctx, sources) {
  const acks = new Map();
  for (const src of sources) {
    if (isTestSide(ctx, src.rel) || !src.imports.some((entry) => entry.spec.startsWith('@react-native-firebase/firestore'))) continue;
    for (const [name, line] of ackReturningMethods(src)) if (!acks.has(name)) acks.set(name, `${src.rel}:${line}`);
  }
  const fix = 'Let the write land in the offline cache and move on: call it without await (the adapter sends the commit and reports a later rejection through a callback), and show pending state from the listener.';
  for (const src of sources.filter((item) => isUiFile(ctx, item.rel))) {
    const writes = SERVER_WRITES.join('|');
    for (const match of src.code.matchAll(new RegExp(`\\bawait\\s+(?:[\\w$.]+\\s*\\.\\s*commit|${writes})\\s*\\(|\\.\\s*commit\\s*\\(\\s*\\)\\s*\\.\\s*then\\s*\\(`, 'g'))) {
      ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'awaited-commit-in-ui', message: 'waits for a Firestore write the server must acknowledge (offline it never settles)', fix });
    }
    for (const match of src.code.matchAll(/\bawait\s+(?:[\w$]+\s*(?:\?\.|\.)\s*)*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const at = acks.get(match[1]);
      if (at === undefined || [...SERVER_WRITES, 'commit'].includes(match[1])) continue;
      ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'awaited-commit-in-ui', message: `awaits ${match[1]}(), whose adapter (${at}) returns the server's acknowledgement (offline it never settles)`, fix });
    }
  }
}

/** The emulator config module: null for every variant but development, decided by the variant. */
function checkEmulatorConfig(ctx, configSrc) {
  const fix = `Return null unless the variant is 'development' (compare the AppVariant, as templates/${ctx.emulatorConfig} does); __DEV__ is also true in a debug build of preview or production.`;
  const devFlag = /(?<![\w$.])__DEV__\b/.exec(configSrc.code);
  if (devFlag !== null) {
    ctx.add({ file: configSrc.rel, line: configSrc.lineOf(devFlag.index), rule: 'emulator-in-production', message: 'the emulator config is guarded by __DEV__, not by the development variant', fix });
    return;
  }
  if (!/['"]development['"]/.test(configSrc.keep) || !/[!=]==?\s*['"]development['"]|['"]development['"]\s*[!=]==?/.test(configSrc.keep)) {
    ctx.add({ file: configSrc.rel, line: 1, rule: 'emulator-in-production', message: "the emulator config never compares the variant with 'development'", fix });
  }
}

function checkEmulators(ctx, sources) {
  const calls = /(?<![\w$])(connect(?:Firestore|Auth|Functions|Storage|Database)Emulator)\s*\(|\.\s*(useEmulator)\s*\(/g;
  let used = false;
  for (const src of sources) {
    if (!under(src.rel, ctx.layout.srcDir) || isTestFile(src.rel)) continue;
    const usesConfig = src.imports.some((entry) => resolveSpecifier(src.rel, entry.spec, { root: ctx.root, aliases: ctx.layout.aliases }) === ctx.emulatorConfig);
    for (const match of src.code.matchAll(calls)) {
      used = true;
      const name = match[1] ?? match[2];
      const line = src.lineOf(match.index);
      const close = src.keep.indexOf(')', match.index);
      const args = src.keep.slice(match.index + match[0].length, close === -1 ? undefined : close);
      if (/(['"])[^'"]*\1|`[^`$]*`/.test(args)) {
        ctx.add({ file: src.rel, line, rule: 'emulator-in-production', message: `${name}() with a literal host (it would connect in every build)`, fix: `Take host and port from ${ctx.emulatorConfig} (firebaseEmulators returns null outside development) and connect only when it is not null.` });
      } else if (!usesConfig) {
        ctx.add({ file: src.rel, line, rule: 'emulator-in-production', message: `${name}() in a file that does not take its host from ${ctx.emulatorConfig}`, fix: `Pass the FirebaseEmulators value from ${ctx.emulatorConfig} into this adapter and connect only when it is not null; __DEV__ is also true in debug builds of preview and production.` });
      }
    }
  }
  const configSrc = sources.find((src) => src.rel === ctx.emulatorConfig);
  if (configSrc !== undefined) checkEmulatorConfig(ctx, configSrc);
  else if (used) ctx.add({ file: ctx.emulatorConfig, line: 1, rule: 'emulator-in-production', message: 'emulators are connected but the emulator config module is missing', fix: `Copy templates/${ctx.emulatorConfig} (firebaseEmulators: null for every variant but development).` });
}

/** The root .gitignore's patterns, as check-lib globs (a name without a slash matches at any depth). */
function gitignorePatterns(root) {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!')).map((line) => line.replace(/^\//, '').replace(/^\*\*\//, ''));
}

function isIgnored(rel, patterns) {
  return patterns.some((pattern) => {
    const glob = pattern.endsWith('/') ? `${pattern}**` : pattern;
    return matchGlob(rel, glob) || (!glob.includes('/') && matchGlob(basename(rel), glob));
  });
}

function checkConfigFiles(ctx) {
  const patterns = gitignorePatterns(ctx.root);
  for (const rel of walkRepo(ctx.root, { include: ['*.plist', '*.json'] })) {
    if (!CONFIG_FILE.test(basename(rel)) || isIgnored(rel, patterns)) continue;
    ctx.add({ file: rel, line: 1, rule: 'config-file-committed', message: `${basename(rel)} is in the repo and .gitignore does not ignore it`, fix: 'Delete it from git (git rm --cached), add its name to .gitignore, and give each EAS environment its copy as a file variable (GOOGLE_SERVICES_PLIST, GOOGLE_SERVICES_JSON) that app.config.ts reads from process.env.' });
  }
  for (const rel of ['app.config.ts', 'app.config.js', 'app.json'].filter((name) => existsSync(join(ctx.root, name)))) {
    const src = load(ctx.root, rel);
    for (const match of src.keep.matchAll(/["']?googleServicesFile["']?\s*:\s*(['"`])/g)) {
      ctx.add({ file: rel, line: src.lineOf(match.index), rule: 'config-file-committed', message: 'googleServicesFile points at a literal path (the file must then be committed for EAS to find it)', fix: "Read it from the EAS file variable: googleServicesFile: process.env['GOOGLE_SERVICES_PLIST'] (iOS) and process.env['GOOGLE_SERVICES_JSON'] (Android)." });
    }
  }
}

function checkListeners(ctx, src) {
  if (!under(src.rel, ctx.layout.srcDir) || isTestSide(ctx, src.rel)) return;
  const fix = 'Return the unsubscribe: from the adapter method, and from the effect (useEffect(() => port.watchX(...), [deps])), so React removes the listener on unmount.';
  for (const match of src.code.matchAll(new RegExp(`(?<![\\w$.])(${LISTENERS.join('|')})\\s*\\(`, 'g'))) {
    if (isStatement(src.code, match.index)) ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'listener-leak', message: `${match[1]}() is called as a statement: its unsubscribe is dropped`, fix });
  }
  if (!isUiFile(ctx, src.rel)) return;
  for (const match of src.code.matchAll(/\.\s*((?:watch|subscribe)[A-Za-z0-9_$]*)\s*\(/g)) {
    if (isStatement(src.code, chainStart(src.code, match.index))) ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'listener-leak', message: `${match[1]}() is called as a statement: the effect returns no cleanup`, fix });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root (or pass it as the first argument).');
  const report = createReporter({ name: 'check-rnfb', json: options.json });
  if (!dependencies(root).some((name) => name.startsWith('@react-native-firebase/'))) return report.notApplicable('package.json lists no @react-native-firebase package');
  const layout = resolveLayout(root);
  const configDir = layout.configDir ?? `${layout.srcDir}/config`;
  const ctx = {
    root,
    layout,
    firestoreDir: (options['firestore-dir'] ?? `${layout.dataDir}/firestore`).replace(/\/+$/, ''),
    emulatorConfig: options['emulator-config'] ?? `${configDir}/firebase-emulators.ts`,
    add: (problem) => report.problem(problem),
  };
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'], ignore: ['**/*.d.ts'] });
  const sources = files.map((rel) => load(root, rel));
  for (const src of sources) {
    if (under(src.rel, layout.mocksDir)) continue;
    checkNamespaced(ctx, src);
    checkTransaction(ctx, src);
    checkSdkImports(ctx, src);
    checkListeners(ctx, src);
  }
  checkAwaitedCommits(ctx, sources);
  checkEmulators(ctx, sources);
  checkConfigFiles(ctx);
  return report.finish({ checked: files.length, unit: 'source files' });
});
