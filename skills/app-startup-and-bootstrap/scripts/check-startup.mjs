#!/usr/bin/env node
// check-startup.mjs: proves the app-startup-and-bootstrap rules over an Expo app: the entry loads
// expo-router/entry last, the root layout imports the error net and then the splash hold, the splash
// is held at module scope once and released once below the direction gate, nothing awaits on the
// startup path except through a deadline-bound gate, fonts are embedded, the data layer opens and the
// error sink connects once in the startup initializer, providers nest in dependency order and are
// mounted once, and buffered writes flush from one root hook when the app leaves the foreground.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-startup.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, matchGlob, parseArgs, parseJsonc, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { findJsxTags, importsOf, isTestFile, makeLineOf, maskCode, resolveImport, scanSource } from './lib/source-scan.mjs';
import { constNumber, functionRanges, innermostFunction, isComponentName, isHookName, isModuleScope, jsxSpans } from './lib/startup-scan.mjs';

const RULES = [
  ['entry-router-last', 'the app entry (package.json "main", when it is a file) imports expo-router/entry last'],
  ['root-import-order', 'the root layout imports the splash hold as a side effect, after the error net installer and before any import with bindings'],
  ['splash-hold', 'expo-splash-screen is held (preventAutoHideAsync) exactly once, at module scope, in the root layout, the entry or a module one of them imports for its side effect'],
  ['splash-release', 'a held splash is released (hide/hideAsync) from exactly one file, inside an effect or callback (never at module scope or in a render body), and never in the component that renders DirectionGate'],
  ['blank-frame', 'a startup component (root layout, app root) returns null only while the splash is held'],
  ['startup-await', 'the root layout and app root await nothing (no await, .then, .catch, .finally): async work the first screen needs goes through createStartupGate'],
  ['startup-deadline', 'every createStartupGate call passes a numeric deadlineMs at or under maxBlockingMs (default 3000)'],
  ['runtime-font-load', 'no app file loads fonts at runtime (useFonts, loadAsync from expo-font or an @expo-google-fonts package): embed them with the expo-font config plugin'],
  ['sink-before-providers', 'the error net\'s connect(...) in a startup component runs in the first render\'s state initializer, never in an effect, a promise callback or the render body'],
  ['provider-order', 'the app root, the provider components it renders and the root stack nest their providers in dependency order (appRootOrder, rootStackOrder)'],
  ['provider-once', 'each provider of appRootOrder and rootStackOrder is mounted once on the root path (root layout, app root, the local components the app root renders, root stack)'],
  ['storage-open-once', 'the data layer opens once per JS run: each openCalls function (default openDeviceData) is called once in app code, in the app root\'s startup initializer'],
  ['interaction-manager', 'no app file uses InteractionManager (a deprecated stub in React Native 0.86 that runs on the next tick)'],
  ['lifecycle-write', 'no AppState listener outside lifecycleFiles writes (flush*, save*, persist*, write*, commit*): hand a Flusher to the app root'],
  ['flush-root', 'useFlushOnBackground is called once, only in the app root, before useCheckpointOnBackground; a defined hook is mounted'],
  ['root-kits', 'optional kits join through the registry: prepareRootKits (when the registry has it) runs first in the app root\'s startup initializer, before the data layer opens; createRootKits is called once, after the data layer opens and the sink connects; its kits reach every slot (attach, kitBlocking, kitFlushers, <RootKits kits>); no root file imports a kit itself'],
];

const DEFAULT_APP_ROOT_ORDER = ['ServicesProvider|AppProviders', 'AppDataProvider', 'QueryProvider', 'SettingsStoreProvider', 'StoresProvider', 'PreferencesRoot', 'I18nProvider', 'AppThemeProvider', 'TextLocaleProvider', 'RootStack'];
const DEFAULT_ROOT_STACK_ORDER = ['GestureHandlerRootView', 'KeyboardProvider', 'MotionConfig|RootMotion', 'NavigationThemeProvider', 'SessionProvider', 'AppFeedback|FeedbackProvider', 'AdsRoot', 'GamesRoot', 'AppStack|Stack'];
const DEFAULT_MAX_BLOCKING_MS = 3000;
const FONT_MODULE = /^(expo-font|@expo-google-fonts\/[\w-]+)$/;
const DEFAULT_OPEN_CALLS = ['openDeviceData'];
/** The slot helpers named create...Kit... that are not kit factories. */
const KIT_SLOT_NAMES = new Set(['createRootKits']);
const CONTRACT_KEYS = new Set(['$schema', '$comment', 'rootLayout', 'appRoot', 'rootStack', 'appRootOrder', 'rootStackOrder', 'maxBlockingMs', 'lifecycleFiles', 'openCalls']);

const SPEC = {
  name: 'check-startup',
  summary: 'Checks the app-startup-and-bootstrap rules: entry and root layout import order, the splash held once and released once below the direction gate, no await on the startup path, a bounded startup gate, embedded fonts, the data layer opened and the error sink connected once in the startup initializer, providers in order and mounted once, and one root flush when the app leaves the foreground.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The startup contract, repo-relative (default: <contractsDir>/startup.json; missing = the defaults)' },
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app folder, repo-relative (default: the repo root)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id.padEnd(22)}${text}`),
    '',
    'Files (contracts/startup.json keys, all optional): rootLayout (default <routesDir>/_layout.tsx), appRoot',
    `(default <featuresDir>/root-navigator/app-root.tsx; without it the root layout plays both parts), rootStack`,
    `(default <featuresDir>/root-navigator/root-stack.tsx), appRootOrder (default ${DEFAULT_APP_ROOT_ORDER.join(', ')}),`,
    `rootStackOrder (default ${DEFAULT_ROOT_STACK_ORDER.join(', ')}), maxBlockingMs (default ${DEFAULT_MAX_BLOCKING_MS}),`,
    'lifecycleFiles (default <featuresDir>/root-navigator/use-flush-on-background.ts), openCalls (default',
    `${DEFAULT_OPEN_CALLS.join(', ')}). A|B in an order list accepts either name.`,
    'Scans .ts/.tsx files under the source and routes folders, minus tests. Installed skills (.agents/, .claude/,',
    'skills/, any folder holding a SKILL.md) are never scanned.',
    'The splash rules apply when expo-splash-screen is a dependency or any app file calls preventAutoHideAsync.',
    'Slots: a kit (crash reporting, analytics, notifications, ...) is one entry of src/services/create-root-kits.ts',
    '(createRootKits); the root files never import it (root-kits).',
    'NOT APPLICABLE when package.json does not depend on expo.',
    'When multi-package: pass --app-dir apps/<app>; every path is then relative to that folder.',
    '',
    'Example: node check-startup.mjs .            (from the app repo root)',
  ].join('\n'),
};

function readJson(path, what) {
  try {
    return parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`, `Repair ${what}.`);
  }
}

function stringList(value, key, file) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new UsageError(`${file} "${key}" must be a list of non-empty strings`, `Fix "${key}" in ${file} (see check-startup --help).`);
  }
  return value;
}

function readContract(root, layout, option) {
  const file = option ?? posix.join(layout.contractsDir, 'startup.json');
  const path = join(root, file);
  if (!existsSync(path)) {
    if (option) throw new UsageError(`contract ${file} does not exist`, 'Pass an existing file, or leave --contract out to use the defaults.');
    return { file: null };
  }
  const data = readJson(path, file);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new UsageError(`${file} must hold a JSON object`, 'Start from the skill\'s templates/contracts/startup.json.');
  for (const key of Object.keys(data)) {
    if (!CONTRACT_KEYS.has(key)) throw new UsageError(`${file} has an unknown key "${key}"`, `Use only ${[...CONTRACT_KEYS].filter((name) => !name.startsWith('$')).join(', ')}.`);
  }
  for (const key of ['rootLayout', 'appRoot', 'rootStack']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key] === '' || data[key].startsWith('/') || data[key].includes('..'))) {
      throw new UsageError(`${file} "${key}" must be a repo-relative file path`, `Fix "${key}" in ${file}.`);
    }
  }
  if (data.maxBlockingMs !== undefined && (!Number.isInteger(data.maxBlockingMs) || data.maxBlockingMs < 1 || data.maxBlockingMs > 10000)) {
    throw new UsageError(`${file} "maxBlockingMs" must be an integer from 1 to 10000`, `Fix "maxBlockingMs" in ${file}.`);
  }
  return {
    file,
    rootLayout: data.rootLayout,
    appRoot: data.appRoot,
    rootStack: data.rootStack,
    appRootOrder: stringList(data.appRootOrder, 'appRootOrder', file),
    rootStackOrder: stringList(data.rootStackOrder, 'rootStackOrder', file),
    maxBlockingMs: data.maxBlockingMs,
    lifecycleFiles: stringList(data.lifecycleFiles, 'lifecycleFiles', file),
    openCalls: stringList(data.openCalls, 'openCalls', file),
  };
}

const dependsOn = (manifest, name) => ['dependencies', 'devDependencies'].some((key) => manifest?.[key]?.[name] !== undefined);

/** One parsed file: source, masked code, line lookup, imports, function ranges (computed on demand). */
function loadFile(root, rel) {
  const source = readFileSync(join(root, rel), 'utf8');
  const masked = maskCode(source);
  const lineOf = makeLineOf(source);
  let ranges = null;
  let imports = null;
  let scan = null;
  const scanned = () => {
    scan ??= scanSource(source);
    return scan;
  };
  return {
    rel,
    source,
    masked,
    lineOf,
    get ranges() {
      ranges ??= functionRanges(masked);
      return ranges;
    },
    /** The source with comments blanked and strings kept. */
    get keep() {
      return scanned().codeKeep;
    },
    get imports() {
      imports ??= importsOf(scanned()).filter((entry) => entry.form !== 'dynamic' && entry.form !== 'require');
      return imports;
    },
  };
}

/** Local names bound to an import from `module`: { named: Map<imported, local>, namespaces: Set<local> }. */
function bindingsFrom(file, module) {
  const named = new Map();
  const namespaces = new Set();
  const re = new RegExp(String.raw`import\s+(?!type\b)([^;]*?)\s+from\s*['"]${module.replace(/[/.-]/g, '\\$&')}['"]`, 'g');
  for (const match of file.keep.matchAll(re)) {
    const clause = match[1];
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) namespaces.add(namespace[1]);
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(',') : []) {
      const item = part.trim().replace(/^type\s+/, '');
      if (item === '' || part.trim().startsWith('type ')) continue;
      const [imported, local] = item.split(/\s+as\s+/).map((word) => word.trim());
      named.set(imported, local ?? imported);
    }
  }
  return { named, namespaces };
}

const escape = (text) => text.replace(/[.$]/g, '\\$&');

/** Indexes in masked code where one of `names` (plain identifiers or a.b members) is called. */
function callIndexes(file, names) {
  const found = [];
  for (const name of names) {
    const re = new RegExp(String.raw`(?<![\w$.])${escape(name)}\s*\(`, 'g');
    for (const match of file.masked.matchAll(re)) found.push(match.index);
  }
  return found.sort((a, b) => a - b);
}

/** Indexes where one of `names` is used without being called (passed as a value). */
function referenceIndexes(file, names) {
  const found = [];
  for (const name of names) {
    const re = new RegExp(String.raw`(?<![\w$.])${escape(name)}(?![\w$])(?!\s*\()`, 'g');
    for (const match of file.masked.matchAll(re)) {
      const before = file.masked.slice(Math.max(0, match.index - 40), match.index);
      if (/\bimport\s*\{[^}]*$|\bas\s+$/.test(before) || /^\s*as\b/.test(file.masked.slice(match.index + name.length))) continue;
      const lineStart = file.masked.lastIndexOf('\n', match.index) + 1;
      if (/^\s*import\b/.test(file.masked.slice(lineStart, match.index))) continue;
      found.push(match.index);
    }
  }
  return found.sort((a, b) => a - b);
}

/** The callee names of the splash API a file imports: { hold: [...], release: [...] }. */
function splashNames(file) {
  const fromSplash = bindingsFrom(file, 'expo-splash-screen');
  const fromRouter = bindingsFrom(file, 'expo-router');
  const hold = [];
  const release = [];
  if (fromSplash.named.has('preventAutoHideAsync')) hold.push(fromSplash.named.get('preventAutoHideAsync'));
  for (const name of ['hide', 'hideAsync']) if (fromSplash.named.has(name)) release.push(fromSplash.named.get(name));
  const namespaces = [...fromSplash.namespaces, ...fromSplash.named.has('default') ? [fromSplash.named.get('default')] : []];
  if (fromRouter.named.has('SplashScreen')) namespaces.push(fromRouter.named.get('SplashScreen'));
  for (const ns of namespaces) {
    hold.push(`${ns}.preventAutoHideAsync`);
    release.push(`${ns}.hide`, `${ns}.hideAsync`);
  }
  return { hold, release };
}

/** Repo-relative path of a local import of `file`, or null. */
function localTarget(root, layout, file, spec) {
  const resolved = resolveImport(file.rel, spec, { root, aliases: layout.aliases });
  return resolved?.kind === 'local' && resolved.exists ? resolved.path : null;
}

function rendersGate(file) {
  return /<DirectionGate\b/.test(file.masked);
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

function checkEntry(ctx) {
  const { root, manifest, report } = ctx;
  const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//, '') : null;
  if (main === null || /^(expo-router\/entry|expo\/AppEntry)(\.js)?$/.test(main)) return;
  const candidates = [main, `${main}.ts`, `${main}.tsx`, `${main}.js`];
  const rel = candidates.find((path) => existsSync(join(root, path)) && !path.endsWith('/'));
  if (rel === undefined) return;
  const file = ctx.file(rel);
  ctx.entry = file;
  const values = file.imports.filter((entry) => !entry.typeOnly);
  const routerAt = values.findIndex((entry) => /^expo-router\/entry(\.js)?$/.test(entry.spec));
  if (routerAt === -1) return;
  for (const later of values.slice(routerAt + 1)) {
    report.problem({ file: rel, line: later.line, rule: 'entry-router-last', message: `"${later.spec}" is imported after expo-router/entry`, fix: 'Move it above import \'expo-router/entry\'; the entry loads the polyfills (and anything else that must run first) and ends with the router.' });
  }
}

/** Files that call preventAutoHideAsync, and every hold call. */
function findHolds(ctx) {
  const holds = [];
  for (const file of ctx.runtime) {
    const names = splashNames(file).hold;
    for (const index of callIndexes(file, names)) holds.push({ file, index });
  }
  return holds;
}

function sideEffectTargets(ctx, file) {
  if (file === null) return [];
  return file.imports.filter((entry) => entry.form === 'side-effect').map((entry) => ({ entry, target: localTarget(ctx.root, ctx.layout, file, entry.spec) }));
}

function checkSplash(ctx) {
  const { report, rootLayout } = ctx;
  const holds = findHolds(ctx);
  ctx.isHeld = holds.length > 0;
  const applies = ctx.isHeld || dependsOn(ctx.manifest, 'expo-splash-screen');
  if (!applies) {
    report.note('expo-splash-screen is not a dependency and nothing holds the splash: splash rules not checked');
    return;
  }
  const releaseUses = [];
  for (const file of ctx.runtime) {
    const names = splashNames(file).release;
    const calls = callIndexes(file, names);
    const refs = referenceIndexes(file, names);
    if (calls.length + refs.length > 0) releaseUses.push({ file, calls, refs });
  }
  // The app root is the one right place, so it counts as the first release; any other file is the extra one.
  releaseUses.sort((a, b) => Number(b.file === ctx.appRootFile) - Number(a.file === ctx.appRootFile));
  if (!ctx.isHeld) {
    report.problem({ file: rootLayout.rel, line: 1, rule: 'splash-hold', message: 'the native splash is never held: Expo Router hides it at navigation ready, so a blocking task or a direction restart shows an empty frame', fix: 'Copy templates/src/features/root-navigator/hold-splash.ts and import it right after the error net: import \'@/features/root-navigator/hold-splash\';' });
  }
  const loaders = new Set([rootLayout.rel, ctx.entry?.rel].filter(Boolean));
  const sideEffectFiles = new Set([...sideEffectTargets(ctx, rootLayout), ...sideEffectTargets(ctx, ctx.entry)].map((item) => item.target).filter(Boolean));
  holds.forEach(({ file, index }, position) => {
    const line = file.lineOf(index);
    if (position > 0) {
      report.problem({ file: file.rel, line, rule: 'splash-hold', message: `the splash is held a second time (first in ${holds[0].file.rel}:${holds[0].file.lineOf(holds[0].index)})`, fix: 'Hold it once, in hold-splash.ts; delete this call.' });
      return;
    }
    if (!isModuleScope(file.masked, index)) {
      report.problem({ file: file.rel, line, rule: 'splash-hold', message: 'preventAutoHideAsync() runs inside a function: by then native content may have appeared and the splash may already be gone', fix: 'Call it at module scope (Expo\'s documented form) in hold-splash.ts, imported by the root layout for its side effect.' });
    } else if (!loaders.has(file.rel) && !sideEffectFiles.has(file.rel)) {
      report.problem({ file: file.rel, line, rule: 'splash-hold', message: 'the splash hold lives in a module the root layout and the entry do not import for its side effect, so it may load after the splash hid', fix: `Import it as a side effect from ${rootLayout.rel}, right after the error net installer.` });
    }
  });
  if (ctx.isHeld && releaseUses.length === 0) {
    const first = holds[0];
    report.problem({ file: first.file.rel, line: first.file.lineOf(first.index), rule: 'splash-release', message: 'the splash is held but nothing releases it: Expo Router leaves a held splash alone, so release builds stay on the splash forever', fix: 'Release it from the app root: const isReady = useStartupReady(gate, hideSplash) (templates/src/features/root-navigator/use-startup-ready.ts).' });
  }
  releaseUses.forEach(({ file, calls, refs }, position) => {
    const at = [...calls, ...refs].sort((a, b) => a - b)[0];
    if (file.rel === rootLayout.rel && rendersGate(file)) {
      report.problem({ file: file.rel, line: file.lineOf(at), rule: 'splash-release', message: 'the splash is released in the component that renders DirectionGate, so a direction restart shows its empty frame', fix: 'Release it below the gate, in the app root (useStartupReady).' });
      if (position > 0) return;
    } else if (position > 0) {
      report.problem({ file: file.rel, line: file.lineOf(at), rule: 'splash-release', message: `the splash is released in a second file (first: ${releaseUses[0].file.rel})`, fix: 'Release it in one place, the app root through useStartupReady; a crash already hides it (Expo Router\'s error boundary and global handler).' });
      return;
    }
    for (const index of calls) {
      const fn = innermostFunction(file.ranges, index);
      if (fn === null) {
        report.problem({ file: file.rel, line: file.lineOf(index), rule: 'splash-release', message: 'the splash is released at module scope, before anything is on screen', fix: 'Release it from an effect once the startup gate is ready (useStartupReady).' });
      } else if (fn.argumentOf === null && (isComponentName(fn.name) || isHookName(fn.name))) {
        report.problem({ file: file.rel, line: file.lineOf(index), rule: 'splash-release', message: `the splash is released during render of ${fn.name} (React may render without committing)`, fix: 'Release it in an effect after the commit: useEffect(() => { if (isReady) releaseSplash(); }, [isReady, releaseSplash]).' });
      }
    }
  });
}

function checkRootImports(ctx) {
  const { rootLayout, report } = ctx;
  const values = rootLayout.imports.filter((entry) => !entry.typeOnly);
  const firstBinding = values.find((entry) => entry.form !== 'side-effect');
  let netAt = -1;
  let holdEntry = null;
  for (const { entry, target } of sideEffectTargets(ctx, rootLayout)) {
    if (target === null) continue;
    const file = ctx.file(target);
    if (/\.install\s*\(\s*\)/.test(file.masked) || /install[A-Z]?\w*ErrorNet\w*\s*\(/.test(file.masked)) netAt = Math.max(netAt, entry.index);
    if (callIndexes(file, splashNames(file).hold).some((index) => isModuleScope(file.masked, index))) holdEntry ??= entry;
  }
  if (holdEntry === null) return;
  if (firstBinding !== undefined && firstBinding.index < holdEntry.index) {
    report.problem({ file: rootLayout.rel, line: holdEntry.line, rule: 'root-import-order', message: `the splash hold is imported after "${firstBinding.spec}", so that module (and what it imports) loads before the hold`, fix: 'Put the side-effect imports first: the error net installer, then the splash hold, then everything with bindings.' });
  }
  if (netAt !== -1 && netAt > holdEntry.index) {
    report.problem({ file: rootLayout.rel, line: holdEntry.line, rule: 'root-import-order', message: 'the splash hold is imported before the error net installer, so a failure while it loads is not caught', fix: 'Import the error net installer first, then the splash hold.' });
  }
}

function checkStartFiles(ctx) {
  const { report } = ctx;
  for (const file of ctx.startFiles) {
    if (!ctx.isHeld) {
      for (const match of file.masked.matchAll(/\breturn\s+null\b/g)) {
        report.problem({ file: file.rel, line: file.lineOf(match.index), rule: 'blank-frame', message: 'a startup component renders nothing while the splash is not held: the person sees an empty frame', fix: 'Hold the splash (hold-splash.ts) so the frame stays covered until useStartupReady releases it.' });
      }
    }
    for (const match of file.masked.matchAll(/(?<![\w$])await\b|\.(then|catch|finally)\s*\(/g)) {
      report.problem({ file: file.rel, line: file.lineOf(match.index), rule: 'startup-await', message: `async work on the startup path (${match[0].trim()})`, fix: 'Startup before the first frame is synchronous; give async work the first screen needs to createStartupGate({ blocking }) and start the rest after the splash is released, in the component that owns it.' });
    }
    checkSink(ctx, file);
  }
}

/**
 * Why the call at `index` does not run in the first render's state initializer (a function passed to
 * useState, or a named function a useState initializer calls), or null when it does.
 */
function initializerProblem(file, index, what) {
  const fn = innermostFunction(file.ranges, index);
  if (fn === null) return `${what} runs at module scope, at import time`;
  if (fn.argumentOf !== null) {
    return /^(React\.)?useState$/.test(fn.argumentOf) ? null : `${what} runs inside ${fn.argumentOf}(...), after the providers below rendered`;
  }
  if (isComponentName(fn.name) || isHookName(fn.name)) return `${what} runs in the render body of ${fn.name}, on every render`;
  const viaState = new RegExp(String.raw`useState\s*\(\s*(?:${escape(fn.name)}\s*[,)]|\(\s*\)\s*(?::[^=]*)?=>\s*${escape(fn.name)}\s*\()`).test(file.masked);
  return viaState ? null : `${what} is in ${fn.name}(), which no useState initializer calls`;
}

function checkSink(ctx, file) {
  const nets = new Set();
  for (const entry of file.imports) {
    if (!/error-net/.test(entry.spec) || entry.typeOnly) continue;
    for (const local of bindingsFrom(file, entry.spec).named.values()) nets.add(local);
  }
  for (const net of nets) {
    for (const index of callIndexes(file, [`${net}.connect`])) {
      const message = initializerProblem(file, index, `${net}.connect(...)`);
      if (message === null) continue;
      ctx.report.problem({ file: file.rel, line: file.lineOf(index), rule: 'sink-before-providers', message: `${message}: errors of the first render wait in the buffer or are lost`, fix: 'Connect once, in the startup initializer: function startApp(services) { const data = openDeviceData(services); appErrorNet.connect(...); ... } and useState(() => startApp(services)).' });
    }
  }
}

/** Call indexes of `name`, minus its own declaration (function name( / const name = (). */
function callsOf(file, names) {
  return callIndexes(file, names).filter((index) => !/(?:function\s+|\bconst\s+|\blet\s+)$/.test(file.masked.slice(Math.max(0, index - 12), index)));
}

function checkOpen(ctx) {
  const { report, appRootFile } = ctx;
  for (const name of ctx.openCalls) {
    const calls = [];
    for (const file of ctx.runtime) for (const index of callsOf(file, [name])) calls.push({ file, index });
    calls.forEach(({ file, index }, position) => {
      const line = file.lineOf(index);
      if (file.rel !== appRootFile.rel) {
        report.problem({ file: file.rel, line, rule: 'storage-open-once', message: `${name}() is called outside the app root (${appRootFile.rel}): a second open runs migrations again and holds a second connection`, fix: `Open once in the app root\'s startup initializer and hand the result down (AppDataProvider, or a store factory argument).` });
        return;
      }
      if (calls.slice(0, position).some((earlier) => earlier.file.rel === file.rel)) {
        report.problem({ file: file.rel, line, rule: 'storage-open-once', message: `${name}() is called a second time in the app root`, fix: 'Call it once, in startApp, and reuse its result.' });
        return;
      }
      const message = initializerProblem(file, index, `${name}()`);
      if (message !== null) report.problem({ file: file.rel, line, rule: 'storage-open-once', message: `${message}: the database must be open before the first frame and only once per JS run`, fix: 'Open it in startApp, which the app root runs as useState(() => startApp(services)).' });
    });
  }
}

function checkDeadlines(ctx) {
  for (const file of ctx.runtime) {
    for (const index of callIndexes(file, ['createStartupGate'])) {
      if (/function\s+$/.test(file.masked.slice(Math.max(0, index - 12), index))) continue;
      const open = file.masked.indexOf('(', index);
      let depth = 0;
      let close = open;
      for (; close < file.masked.length; close += 1) {
        if ('({['.includes(file.masked[close])) depth += 1;
        else if (')}]'.includes(file.masked[close])) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const args = file.source.slice(open, close);
      const line = file.lineOf(index);
      const fix = `Pass deadlineMs as a number or a module constant (const STARTUP_DEADLINE_MS = 2000;) at or under ${ctx.maxBlockingMs} ms.`;
      const value = /\bdeadlineMs\s*:\s*([^,}\n]+)/.exec(args) ?? (/[{,]\s*deadlineMs\s*[,}]/.test(args) ? [null, 'deadlineMs'] : null);
      if (value === null) {
        ctx.report.problem({ file: file.rel, line, rule: 'startup-deadline', message: 'createStartupGate is called without deadlineMs', fix });
        continue;
      }
      const text = value[1].trim();
      const ms = /^[0-9][0-9_]*$/.test(text) ? Number(text.replaceAll('_', '')) : constNumber(file.source, text);
      if (ms === null) ctx.report.problem({ file: file.rel, line, rule: 'startup-deadline', message: `deadlineMs (${text}) is not a number the checker can read`, fix });
      else if (ms > ctx.maxBlockingMs) ctx.report.problem({ file: file.rel, line, rule: 'startup-deadline', message: `deadlineMs is ${ms} ms, over the ${ctx.maxBlockingMs} ms the splash may wait`, fix });
    }
  }
}

function checkAppWide(ctx) {
  const { report } = ctx;
  for (const file of ctx.runtime) {
    // expo-font itself, and every @expo-google-fonts/<family> package (each re-exports expo-font's useFonts).
    const fontModules = [...new Set(file.imports.map((entry) => entry.spec).filter((spec) => FONT_MODULE.test(spec)))];
    const loaders = fontModules.flatMap((module) => {
      const fonts = bindingsFrom(file, module);
      return [...['useFonts', 'loadAsync'].filter((name) => fonts.named.has(name)).map((name) => fonts.named.get(name)), ...[...fonts.namespaces].flatMap((ns) => [`${ns}.loadAsync`, `${ns}.useFonts`])];
    });
    for (const index of callIndexes(file, loaders)) {
      report.problem({ file: file.rel, line: file.lineOf(index), rule: 'runtime-font-load', message: 'fonts are loaded at runtime: the first frame waits for them or shows the fallback font first', fix: 'Embed the font files with the expo-font config plugin (design-system-structure) and delete the runtime load.' });
    }
    for (const match of file.masked.matchAll(/(?<![\w$.])InteractionManager\b/g)) {
      const lineStart = file.masked.lastIndexOf('\n', match.index) + 1;
      if (/^\s*import\b/.test(file.masked.slice(lineStart, match.index)) || /\bimport\s*\{[^}]*$/.test(file.masked.slice(Math.max(0, match.index - 200), match.index))) continue;
      report.problem({ file: file.rel, line: file.lineOf(match.index), rule: 'interaction-manager', message: 'InteractionManager is a deprecated stub in React Native 0.86 (runAfterInteractions runs on the next tick, not after animations)', fix: 'Start deferred work from an effect after the splash is released (useStartupReady returned true), or after the animation\'s own completion.' });
    }
    if (!ctx.lifecycleFiles.some((glob) => matchGlob(file.rel, glob))) checkLifecycleWrites(ctx, file);
  }
}

function checkLifecycleWrites(ctx, file) {
  for (const index of callIndexes(file, ['AppState.addEventListener'])) {
    const open = file.masked.indexOf('(', index);
    let depth = 0;
    let close = open;
    for (; close < file.masked.length; close += 1) {
      if (file.masked[close] === '(') depth += 1;
      else if (file.masked[close] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = file.masked.slice(open, close);
    // The inline form scans the arguments; the named form (`AppState.addEventListener('change', onChange)`,
    // the house style of the shared AppState hooks) scans the handler's body in the same file.
    let start = open;
    let write = WRITE_CALL.exec(body);
    const handler = /,\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(body);
    if (!write && handler) {
      const declared = handlerBody(file, handler[1], index);
      if (declared) {
        start = declared.start;
        write = WRITE_CALL.exec(file.masked.slice(declared.start, declared.end));
      }
    }
    if (write) {
      const how = start === open ? '' : ` through its handler ${handler[1]}`;
      ctx.report.problem({ file: file.rel, line: file.lineOf(start + write.index), rule: 'lifecycle-write', message: `an AppState listener writes (${write[1]}) on its own${how}`, fix: 'Give the writer a Flusher ({ name, flush }) and add it to the app root\'s flushers; useFlushOnBackground flushes every writer on leaving the foreground, before the checkpoint.' });
    }
  }
}

const WRITE_CALL = /(?<![\w$])(?:[\w$]+\.)*((?:flush|save|persist|write|commit)\w*)\s*\(/i;

/**
 * The body of the function a listener names: `const name = (...) => ...` or `function name(...)` in the
 * same file. With several declarations of the name, the last one before the call wins (the closest
 * scope in hook-shaped code), else the first after it (a hoisted function declaration).
 */
function handlerBody(file, name, callIndex) {
  const named = file.ranges.filter((range) => range.name === name && range.argumentOf === null);
  return named.filter((range) => range.start < callIndex).at(-1) ?? named[0] ?? null;
}

function checkFlush(ctx) {
  const { report, appRootFile } = ctx;
  const calls = [];
  let definedIn = null;
  for (const file of ctx.runtime) {
    if (/export\s+function\s+useFlushOnBackground\b/.test(file.masked)) definedIn = file;
    for (const index of callIndexes(file, ['useFlushOnBackground'])) {
      if (/function\s+$/.test(file.masked.slice(Math.max(0, index - 12), index))) continue;
      calls.push({ file, index });
    }
  }
  if (definedIn !== null && calls.length === 0) {
    report.problem({ file: definedIn.rel, line: 1, rule: 'flush-root', message: 'useFlushOnBackground is defined but never called: buffered writes are lost when the app is killed in the background', fix: `Call useFlushOnBackground(flushers, errorLog) once in ${appRootFile.rel}, before useCheckpointOnBackground.` });
  }
  calls.forEach(({ file, index }, position) => {
    if (file.rel !== appRootFile.rel) {
      report.problem({ file: file.rel, line: file.lineOf(index), rule: 'flush-root', message: `useFlushOnBackground is called outside the app root (${appRootFile.rel})`, fix: 'Call it once in the app root and hand this feature\'s Flusher to it.' });
    } else if (calls.slice(0, position).some((earlier) => earlier.file.rel === file.rel)) {
      report.problem({ file: file.rel, line: file.lineOf(index), rule: 'flush-root', message: 'useFlushOnBackground is called twice: every writer would flush twice', fix: 'Call it once with every Flusher in one list.' });
    }
  });
  const inRoot = calls.filter(({ file }) => file.rel === appRootFile.rel);
  const checkpoint = callIndexes(appRootFile, ['useCheckpointOnBackground']).filter((index) => !/function\s+$/.test(appRootFile.masked.slice(Math.max(0, index - 12), index)));
  if (inRoot.length > 0 && checkpoint.length > 0 && checkpoint[0] < inRoot[0].index) {
    report.problem({ file: appRootFile.rel, line: appRootFile.lineOf(inRoot[0].index), rule: 'flush-root', message: 'useFlushOnBackground is called after useCheckpointOnBackground: on Android\'s single background event the WAL is folded before the buffered writes land', fix: 'Call useFlushOnBackground first; AppState calls listeners in the order they subscribed.' });
  }
}

/** Import bindings of `file` that name a kit factory (createCrashReportingKit, ...), with their lines. */
function kitFactoryImports(file) {
  const found = [];
  for (const entry of file.imports) {
    if (entry.typeOnly) continue;
    for (const [imported] of bindingsFrom(file, entry.spec).named) {
      if (/^create[A-Z]\w*Kit$/.test(imported) && !KIT_SLOT_NAMES.has(imported)) found.push({ name: imported, line: entry.line });
    }
  }
  return found;
}

/**
 * root-kits: the registry's kits are created once in startApp, after the open and the sink, and every
 * slot receives them; a root file never imports a kit (it registers in src/services/create-root-kits.ts).
 */
function checkRootKits(ctx, rootFiles) {
  const { report, appRootFile } = ctx;
  const registryFix = 'Register the kit in src/services/create-root-kits.ts (one entry in the list createRootKits returns); the root skeleton hands its parts to the slots and stays unchanged.';
  for (const file of rootFiles) {
    for (const { name, line } of kitFactoryImports(file)) {
      report.problem({ file: file.rel, line, rule: 'root-kits', message: `the root file imports the kit factory ${name}: a kit wired into a root file bypasses the slots and forks the canonical skeleton`, fix: registryFix });
    }
  }
  const calls = [];
  for (const file of ctx.runtime) for (const index of callsOf(file, ['createRootKits'])) calls.push({ file, index });
  const registry = ctx.runtime.find((file) => /export\s+function\s+createRootKits\b/.test(file.masked));
  if (calls.length === 0) {
    if (registry) report.problem({ file: registry.rel, line: 1, rule: 'root-kits', message: 'createRootKits is defined but the app root never calls it: no kit starts, and its error forwarding, tasks, flushers, providers and effects are lost', fix: 'In startApp, after the stores: const kits = createRootKits({ services, data, language, prepared }); errors.attach(kits); then kitBlocking(kits), kitFlushers(kits) and <RootStack kits={kits} /> (templates/src/features/root-navigator/app-root.tsx).' });
    return;
  }
  calls.forEach(({ file, index }, position) => {
    const line = file.lineOf(index);
    if (file.rel !== appRootFile.rel) {
      report.problem({ file: file.rel, line, rule: 'root-kits', message: `createRootKits() is called outside the app root (${appRootFile.rel}): kits created twice create their adapters twice`, fix: 'Call it once, in startApp, and hand the kits down (RootStack and AppStack take them as a prop).' });
      return;
    }
    if (calls.slice(0, position).some((earlier) => earlier.file.rel === file.rel)) {
      report.problem({ file: file.rel, line, rule: 'root-kits', message: 'createRootKits() is called a second time in the app root', fix: 'Call it once, in startApp, and reuse its result.' });
      return;
    }
    const message = initializerProblem(file, index, 'createRootKits()');
    if (message !== null) report.problem({ file: file.rel, line, rule: 'root-kits', message: `${message}: the kits must exist once per JS run, before the first frame`, fix: 'Create them in startApp, which the app root runs as useState(() => startApp(services, language)).' });
    const opens = callsOf(file, ctx.openCalls);
    if (opens.length > 0 && opens[0] > index) report.problem({ file: file.rel, line, rule: 'root-kits', message: 'createRootKits() runs before the data layer opens: a kit may read the repositories and the error log', fix: 'Create the kits after openDeviceData, the settings and the stores (startup step E6).' });
    const connects = callIndexes(file, ['appErrorNet.connect']);
    if (connects.length > 0 && connects[0] > index) report.problem({ file: file.rel, line, rule: 'root-kits', message: 'createRootKits() runs before the error net\'s sink connects: an error a kit factory throws would wait in the buffer', fix: 'Connect the sink right after the open (appErrorNet.connect(errors.sink)), create the kits later, then errors.attach(kits).' });
  });
  const home = calls.find(({ file }) => file.rel === appRootFile.rel);
  if (home === undefined) return;
  checkPrepareKits(ctx, home);
  const slots = [
    [/\.\s*attach\s*\(/, 'errors.attach(kits)', 'the kits never receive error reports (crash reporting forwards nothing)'],
    [/(?<![\w$.])kitBlocking\s*\(/, 'blocking: kitBlocking(kits)', 'the kits\' blocking tasks never join the startup gate'],
    [/(?<![\w$.])kitFlushers\s*\(/, 'flushers: kitFlushers(kits)', 'the kits\' buffered writers never flush on leaving the foreground'],
  ];
  for (const [pattern, want, harm] of slots) {
    if (!pattern.test(appRootFile.masked)) report.problem({ file: appRootFile.rel, line: appRootFile.lineOf(home.index), rule: 'root-kits', message: `the app root creates kits but never hands them to a slot: ${harm}`, fix: `Add ${want} in startApp, as templates/src/features/root-navigator/app-root.tsx does.` });
  }
  const mounts = ctx.runtime.filter((file) => /<RootKits\b[^>]*\bkits\s*=/.test(file.masked));
  if (mounts.length === 0) report.problem({ file: appRootFile.rel, line: appRootFile.lineOf(home.index), rule: 'root-kits', message: 'the app root creates kits but nothing renders <RootKits kits={...}>: their providers and effects (consent, tap routers, screen views) never mount', fix: 'Pass the kits down: <RootStack kits={app.kits} />, <AppStack kits={kits} />, and AppStack renders <RootKits kits={kits}> around the Stack (templates/src/features/root-navigator/).' });
  for (const extra of mounts.slice(1)) report.problem({ file: extra.rel, line: 1, rule: 'root-kits', message: `<RootKits> is rendered a second time (first in ${mounts[0].rel}): every kit's effects would run twice`, fix: 'Keep the one in app-stack.tsx.' });
}

/**
 * root-kits, the prepared ports: when the registry exports prepareRootKits (a test build swaps its
 * simulated clock and network into the services there), startApp calls it once, before the data
 * layer opens, and every reader gets its services.
 */
function checkPrepareKits(ctx, home) {
  const { report, appRootFile } = ctx;
  const registry = ctx.runtime.find((file) => /export\s+function\s+prepareRootKits\b/.test(file.masked));
  if (registry === undefined) return;
  const prepares = callsOf(appRootFile, ['prepareRootKits']);
  const fix = 'In startApp, first: const prepared = prepareRootKits(device); const { services } = prepared; then openDeviceData(services), createRootKits({ ..., prepared }) and <ServicesProvider services={app.services}> (templates/src/features/root-navigator/app-root.tsx).';
  if (prepares.length === 0) {
    report.problem({ file: appRootFile.rel, line: appRootFile.lineOf(home.index), rule: 'root-kits', message: `${registry.rel} exports prepareRootKits but startApp never calls it: a test build's simulated clock and network never reach a reader`, fix });
    return;
  }
  const opens = callsOf(appRootFile, ctx.openCalls);
  if (opens.length > 0 && opens[0] < prepares[0]) report.problem({ file: appRootFile.rel, line: appRootFile.lineOf(prepares[0]), rule: 'root-kits', message: 'prepareRootKits() runs after the data layer opens: the repositories and the error log already hold the device ports, so a simulated day never reaches them', fix });
}

function spansOf(file) {
  return jsxSpans(file.masked, findJsxTags(file.source, file.masked));
}

function checkOrder(ctx, file, order, key) {
  const spans = spansOf(file);
  const present = [];
  for (const entry of order) {
    const names = entry.split('|');
    const span = spans.find((candidate) => names.includes(candidate.name));
    if (span) present.push({ entry, span });
  }
  for (let j = 1; j < present.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const outer = present[i].span;
      const inner = present[j].span;
      if (!(outer.start < inner.start && inner.start < outer.end)) {
        ctx.report.problem({ file: file.rel, line: file.lineOf(inner.start), rule: 'provider-order', message: `<${inner.name}> is not inside <${outer.name}> (${key}: ${order.join(' > ')})`, fix: `Nest <${inner.name}> inside <${outer.name}>: each provider reads the ones outside it, and a missing one throws only when that path renders on a device.` });
        break;
      }
    }
  }
}

/** Local component files the app root renders (one level: AppProviders, PreferencesRoot, ...). */
function renderedComponentFiles(ctx, file, exclude) {
  const found = [];
  const names = new Set(spansOf(file).map((span) => span.name.split('.')[0]));
  for (const entry of file.imports) {
    if (entry.typeOnly || entry.form === 'side-effect') continue;
    const target = localTarget(ctx.root, ctx.layout, file, entry.spec);
    if (target === null || !/\.tsx$/.test(target) || exclude.has(target) || isTestFile(target)) continue;
    const bound = bindingsFrom(file, entry.spec);
    if ([...bound.named.values()].some((local) => names.has(local))) found.push(ctx.file(target));
  }
  return found;
}

function checkProviders(ctx, rootStackFile) {
  const appRootOrder = ctx.appRootOrder;
  const base = [...new Set([ctx.rootLayout, ctx.appRootFile, rootStackFile].filter(Boolean))];
  const children = renderedComponentFiles(ctx, ctx.appRootFile, new Set(base.map((file) => file.rel)));
  checkOrder(ctx, ctx.appRootFile, appRootOrder, 'appRootOrder');
  for (const child of children) checkOrder(ctx, child, appRootOrder, 'appRootOrder');
  if (rootStackFile) checkOrder(ctx, rootStackFile, ctx.rootStackOrder, 'rootStackOrder');
  // Alternatives of one entry ('MotionConfig|RootMotion') are the same provider: two of them nest two.
  const entryOf = new Map();
  for (const entry of [...appRootOrder, ...ctx.rootStackOrder]) for (const name of entry.split('|')) entryOf.set(name, entry);
  const seen = new Map();
  // Outermost first: the root layout, the app root, the provider components it renders, the root stack.
  const path = [...new Set([ctx.rootLayout, ctx.appRootFile, ...children, rootStackFile].filter(Boolean))];
  for (const file of path) {
    for (const span of spansOf(file)) {
      const entry = entryOf.get(span.name);
      if (entry === undefined) continue;
      const first = seen.get(entry);
      if (first === undefined) {
        seen.set(entry, { file, span });
        continue;
      }
      const firstName = first.span.name === span.name ? '' : `<${first.span.name}> `;
      ctx.report.problem({ file: file.rel, line: file.lineOf(span.start), rule: 'provider-once', message: `<${span.name}> is mounted a second time on the root path (first ${firstName}in ${first.file.rel}:${first.file.lineOf(first.span.start)}): the inner one silently overrides the outer`, fix: `Keep one <${span.name}>: when a provider component (PreferencesRoot, AppProviders) takes it over, delete the fixed one; PreferencesRoot hands the saved reduce-motion choice to the root stack's RootMotion as ReduceMotionPreferenceContext instead of a MotionConfig of its own.` });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repo = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const root = options['app-dir'] ? requireDir(join(repo, options['app-dir']), 'app folder') : repo;
  const report = createReporter({ name: 'check-startup', json: options.json });
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) throw new UsageError(`nothing to check: ${manifestPath} does not exist`, 'Run from the app repo root (the folder with package.json), or pass --app-dir.');
  const manifest = readJson(manifestPath, 'package.json');
  if (!dependsOn(manifest, 'expo')) return report.notApplicable('expo is not in package.json');
  const layout = resolveLayout(root);
  const contract = readContract(root, layout, options.contract);
  const rootLayoutRel = contract.rootLayout ?? posix.join(layout.routesDir, '_layout.tsx');
  if (!existsSync(join(root, rootLayoutRel))) {
    throw new UsageError(`nothing to check: the root layout ${rootLayoutRel} does not exist`, 'Copy the skill\'s templates/src/app/_layout.tsx (or set "rootLayout" in contracts/startup.json, e.g. App.tsx with React Navigation).');
  }
  const cache = new Map();
  const file = (rel) => {
    if (!cache.has(rel)) cache.set(rel, loadFile(root, rel));
    return cache.get(rel);
  };
  const scanDirs = [layout.srcDir, layout.routesDir];
  const inScan = (rel) => scanDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`)) || rel === rootLayoutRel;
  const runtime = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] })
    .filter((rel) => inScan(rel) && !isTestFile(rel))
    .map(file);
  const appRootRel = contract.appRoot ?? posix.join(layout.featuresDir, 'root-navigator', 'app-root.tsx');
  const rootStackRel = contract.rootStack ?? posix.join(layout.featuresDir, 'root-navigator', 'root-stack.tsx');
  const rootLayout = file(rootLayoutRel);
  const appRootFile = existsSync(join(root, appRootRel)) ? file(appRootRel) : rootLayout;
  const ctx = {
    root,
    layout,
    manifest,
    report,
    file,
    runtime,
    rootLayout,
    appRootFile,
    entry: null,
    isHeld: false,
    startFiles: [...new Set([rootLayout, appRootFile])],
    maxBlockingMs: contract.maxBlockingMs ?? DEFAULT_MAX_BLOCKING_MS,
    lifecycleFiles: contract.lifecycleFiles ?? [posix.join(layout.featuresDir, 'root-navigator', 'use-flush-on-background.ts')],
    openCalls: contract.openCalls ?? DEFAULT_OPEN_CALLS,
    appRootOrder: contract.appRootOrder ?? DEFAULT_APP_ROOT_ORDER,
    rootStackOrder: contract.rootStackOrder ?? DEFAULT_ROOT_STACK_ORDER,
  };
  checkEntry(ctx);
  checkRootImports(ctx);
  checkSplash(ctx);
  checkStartFiles(ctx);
  checkDeadlines(ctx);
  checkAppWide(ctx);
  checkFlush(ctx);
  checkOpen(ctx);
  const hasStack = existsSync(join(root, rootStackRel));
  if (!hasStack) {
    report.problem({ file: rootStackRel, line: 1, rule: 'provider-order', message: 'the root stack does not exist, so the gesture root, MotionConfig and the navigation theme have no checked place above the Stack', fix: 'Copy templates/src/features/root-navigator/root-stack.tsx and app-stack.tsx, or set "rootStack" in contracts/startup.json to the file that renders GestureHandlerRootView (React Navigation: the file with NavigationContainer).' });
  }
  checkProviders(ctx, hasStack ? file(rootStackRel) : null);
  const appStackRel = posix.join(posix.dirname(rootStackRel), 'app-stack.tsx');
  const rootFiles = [rootLayout, appRootFile, hasStack ? file(rootStackRel) : null, existsSync(join(root, appStackRel)) ? file(appStackRel) : null];
  checkRootKits(ctx, [...new Set(rootFiles.filter(Boolean))]);
  return report.finish({ checked: runtime.length, unit: 'files' });
}

run(main);
