#!/usr/bin/env node
// check-background-tasks.mjs: proves the background-work rules of an Expo app that tsc, ESLint and
// Jest cannot see: the supported package and its config plugin, task definitions that exist in a
// background launch (module scope, reachable from the app entry), executors that cannot throw, task
// names that are never literals at call sites, vendor calls confined to the adapter and the registry,
// one explicit interval of at least 15 minutes, job budgets, jobs that are tested twice and cut short,
// that run without React and never migrate, that also run on a foreground path, and a test trigger
// that only debug builds reach.
// Usage: node check-background-tasks.mjs [repo-root] [options]   (see --help)

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import {
  createReporter,
  fail,
  maskComments,
  notYetCreated,
  parseArgs,
  parseJsonc,
  resolveLayout,
  run,
  walkRepo,
} from './check-lib.mjs';
import { importsOf, isTestFile, resolveImport, scanSource } from './lib/source-scan.mjs';
import {
  callsOf,
  evaluateNumber,
  functionRanges,
  innermostRange,
  objectEntries,
  splitArguments,
} from './lib/background-scan.mjs';

const SPEC = {
  name: 'check-background-tasks',
  summary:
    'Checks the background-work rules of an Expo app: package and config plugin, task definitions, executors, task names, vendor confinement, interval, job budgets, job tests, React-free and migration-free jobs, the foreground path and the debug trigger.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (test files, __mocks__ and test/ are skipped):',
    '  no-background-fetch      expo-background-fetch in package.json or imported (deprecated; use expo-background-task)',
    '  background-plugin        expo-background-task is installed but the app config does not list its config plugin',
    '                           (prebuild does not apply it on its own; without it iOS rejects every registration)',
    '  background-plist         contracts/native-config.json (when present) lacks UIBackgroundModes "processing" or',
    '                           BGTaskSchedulerPermittedIdentifiers "com.expo.modules.backgroundtask.processing"',
    '  define-task-top-level    a defineTask() call inside a function, component, hook or callback',
    '  define-task-entry        a file with defineTask() that the app entry (package.json "main") does not import',
    '                           (directly or through static imports), or "main" is expo-router/entry itself',
    '  executor-through-runner  the executor of defineTask() is not toTaskExecutor(job, createEnvironment)',
    '  task-name-literal        a string literal as the task name of defineTask, registerTaskAsync,',
    '                           unregisterTaskAsync, isTaskRegisteredAsync or getTaskOptionsAsync',
    '  vendor-import-confined   a value import of expo-background-task or expo-task-manager outside *-adapter.ts',
    '                           and define-*-tasks.ts',
    '  minimum-interval         expo-background-task registerTaskAsync() without { minimumInterval }, or a',
    '                           minimumInterval literal below 15, or BACKGROUND_INTERVAL_MINUTES (any *_INTERVAL_MINUTES',
    '                           in the background folder or a file importing expo-background-task) below 15',
    '  job-name                 defineBackgroundJob({ name }) is not a literal <area>.<job> in kebab-case, or repeats',
    '  job-budget               defineBackgroundJob({ budgetMs }) is missing, not a number literal, or above the cap',
    '  job-tested               a job file has no sibling <file>.test.ts calling both runJobTwice( and runJobUntilAborted(',
    '  job-no-react             a job file imports react, react-native, expo-router, @react-navigation/*, zustand,',
    '                           a feature, route, ui or store file, or a *-context file',
    '  job-no-migrate           a job file or a file in the background folder imports or calls migrateDatabase,',
    '                           openAppDatabase, openDeviceDatabase or openDeviceData; a file they import directly',
    '                           (src/data/open-background-data.ts) calls one (migrations/ and the open path aside)',
    '  job-foreground-path      no file outside the background folder (tests aside) imports the job, or a background',
    '                           file that imports it (the job list), and calls runBackgroundJob(',
    '  trigger-dev-only         triggerTaskWorkerForTestingAsync() outside a function that tests __DEV__',
    'rn-skills.config.json "backgroundTasks": { "backgroundDir": "src/services/background-tasks", "maxBudgetMs": 25000 }',
    '(maxBudgetMs may only lower the 25000 cap). NOT APPLICABLE when package.json lists none of',
    'expo-background-task, expo-task-manager and expo-background-fetch. SKIP for background-plugin while the app has',
    'no app config yet. Exit 2 when package.json or the source folder is missing.',
  ].join('\n'),
};

const SDKS = ['expo-background-task', 'expo-task-manager'];
const LEGACY = 'expo-background-fetch';
const TASK_IDENTIFIER = 'com.expo.modules.backgroundtask.processing';
const MAX_BUDGET_MS = 25_000;
const MIN_INTERVAL_MINUTES = 15;
const NAME_CALLS = ['defineTask', 'registerTaskAsync', 'unregisterTaskAsync', 'isTaskRegisteredAsync', 'getTaskOptionsAsync'];
const JOB_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const VENDOR_FILE = /(?:^|\/)(?:[^/]+-adapter(?:\.(?:ios|android|native|web))?|define-[^/]+-tasks)\.(?:ts|tsx|js|jsx)$/;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx)$/;
const MIGRATING = /(?<![\w$.])(migrateDatabase|openAppDatabase|openDeviceDatabase|openDeviceData)\b/g;
// The same names as call sites only, for files one import away from background code.
const MIGRATING_CALL = /(?<![\w$.]|function\s+)(migrateDatabase|openAppDatabase|openDeviceDatabase|openDeviceData)\s*\(/g;
const DEFINES_OPEN_PATH = /\bfunction\s+(?:migrateDatabase|openAppDatabase|openDeviceDatabase|openDeviceData)\b/;
const REACT_PACKAGES = /^(?:react|react-native|expo-router|zustand|@react-navigation\/.+)$/;
const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readPackage(root);
  const deps = { ...pkg.data.dependencies, ...pkg.data.devDependencies };
  if (![...SDKS, LEGACY].some((name) => name in deps)) {
    return report.notApplicable('package.json lists none of expo-background-task, expo-task-manager and expo-background-fetch');
  }
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  if (!existsSync(join(root, layout.srcDir))) {
    fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  }
  const config = readConfig(layout);
  const context = { root, layout, config, report, deps, pkg };
  checkPackage(context);
  checkAppConfig(context);
  checkNativeSnapshot(context);
  const entry = entryOf(context);
  const files = readSources(context, entry);
  const index = buildIndex(files, context);
  for (const file of files.filter((f) => !f.isTest)) checkFile(file, context, index);
  checkEntryReachability(context, entry, index);
  checkJobs(context, index);
  return report.finish({ checked: files.length + 1, unit: 'files' });
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

function readPackage(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  const text = readFileSync(file, 'utf8');
  try {
    return { text, data: JSON.parse(text) };
  } catch {
    return fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  }
}

function readConfig(layout) {
  const raw = layout.config?.backgroundTasks ?? {};
  const fix = 'rn-skills.config.json "backgroundTasks" is { "backgroundDir": "<repo-relative folder>", "maxBudgetMs": <1..25000> }.';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('"backgroundTasks" in rn-skills.config.json is not an object', fix);
  for (const key of Object.keys(raw)) if (!['backgroundDir', 'maxBudgetMs'].includes(key)) fail(`unknown key "backgroundTasks.${key}" in rn-skills.config.json`, fix);
  if (raw.backgroundDir !== undefined && (typeof raw.backgroundDir !== 'string' || raw.backgroundDir.startsWith('/') || raw.backgroundDir.includes('..'))) {
    fail('"backgroundTasks.backgroundDir" is not a repo-relative folder', fix);
  }
  if (raw.maxBudgetMs !== undefined && !(Number.isInteger(raw.maxBudgetMs) && raw.maxBudgetMs > 0 && raw.maxBudgetMs <= MAX_BUDGET_MS)) {
    fail(`"backgroundTasks.maxBudgetMs" must be a whole number 1..${MAX_BUDGET_MS} (it may only lower the cap)`, fix);
  }
  return {
    backgroundDir: (raw.backgroundDir ?? `${layout.servicesDir}/background-tasks`).replace(/\/+$/, ''),
    maxBudgetMs: raw.maxBudgetMs ?? MAX_BUDGET_MS,
  };
}

function lineIn(text, needle) {
  const at = text.indexOf(needle);
  return at === -1 ? 1 : text.slice(0, at).split('\n').length;
}

function readSources(context, entry) {
  const { root, layout } = context;
  const inSrc = (rel) => rel.startsWith(`${layout.srcDir}/`);
  return walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'] })
    .filter((rel) => SOURCE_FILE.test(rel) && !rel.endsWith('.d.ts') && (inSrc(rel) || rel === entry.rel))
    .map((rel) => {
      const text = readFileSync(join(root, rel), 'utf8');
      const scan = scanSource(text);
      return { rel, text, scan, code: scan.code, isTest: isTestFile(rel), imports: null };
    });
}

// ---------------------------------------------------------------------------------------------
// Package, app config and the native snapshot
// ---------------------------------------------------------------------------------------------

function checkPackage({ pkg, deps, report }) {
  if (!(LEGACY in deps)) return;
  report.problem({
    file: 'package.json',
    line: lineIn(pkg.text, `"${LEGACY}"`),
    rule: 'no-background-fetch',
    message: 'expo-background-fetch is deprecated (no patches; replaced by expo-background-task, which runs on WorkManager and BGTaskScheduler)',
    fix: "npm uninstall expo-background-fetch (and drop 'expo-background-fetch' from the app config plugins if listed), npx expo install expo-background-task expo-task-manager, list 'expo-background-task' in the plugins, rebuild, then move each task to a BackgroundJob (background-tasks skill, references/api-and-config.md section 8).",
  });
}

function checkAppConfig({ root, deps, report }) {
  if (!('expo-background-task' in deps)) return;
  const file = APP_CONFIGS.find((name) => existsSync(join(root, name)));
  if (file === undefined) {
    report.skip({ file: 'app.config.ts', rule: 'background-plugin', message: notYetCreated(root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' }) });
    return;
  }
  const text = readFileSync(join(root, file), 'utf8');
  if (listsPlugin(file, text)) return;
  const anchor = ['expo-task-manager', 'plugins'].find((needle) => text.includes(needle)) ?? '';
  report.problem({
    file,
    line: anchor ? lineIn(text, anchor) : 1,
    rule: 'background-plugin',
    message: 'expo-background-task is installed but its config plugin is not listed: prebuild does not apply it on its own, so Info.plist lacks UIBackgroundModes "processing" and the task identifier, and every registration rejects on an iOS device',
    fix: "Add 'expo-background-task' to plugins in the app config, then regenerate the native snapshot (expo-prebuild-and-config-plugins) and run a new native build.",
  });
}

function listsPlugin(file, text) {
  if (file === 'app.json') {
    let plugins = [];
    try {
      plugins = JSON.parse(text)?.expo?.plugins ?? [];
    } catch {
      return false;
    }
    return Array.isArray(plugins) && plugins.some((entry) => entry === 'expo-background-task' || (Array.isArray(entry) && entry[0] === 'expo-background-task'));
  }
  return /['"`]expo-background-task['"`]/.test(maskComments(text));
}

function checkNativeSnapshot({ root, layout, deps, report }) {
  if (!('expo-background-task' in deps)) return;
  const file = posix.join(layout.contractsDir, 'native-config.json');
  if (!existsSync(join(root, file))) {
    report.note(`background-plist not applied: no ${file} (expo-prebuild-and-config-plugins writes the native snapshot)`);
    return;
  }
  const text = readFileSync(join(root, file), 'utf8');
  let plist = {};
  try {
    plist = parseJsonc(text)?.ios?.infoPlist ?? {};
  } catch {
    report.problem({ file, line: 1, rule: 'background-plist', message: 'the native snapshot is not valid JSON', fix: 'Regenerate it with the native-snapshot checker of expo-prebuild-and-config-plugins (--write).' });
    return;
  }
  const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
  const ids = Array.isArray(plist.BGTaskSchedulerPermittedIdentifiers) ? plist.BGTaskSchedulerPermittedIdentifiers : [];
  const missing = [
    ...(modes.includes('processing') ? [] : ['UIBackgroundModes "processing"']),
    ...(ids.includes(TASK_IDENTIFIER) ? [] : [`BGTaskSchedulerPermittedIdentifiers "${TASK_IDENTIFIER}"`]),
  ];
  if (missing.length === 0) return;
  report.problem({
    file,
    line: lineIn(text, '"UIBackgroundModes"'),
    rule: 'background-plist',
    message: `the iOS Info.plist the app config generates lacks ${missing.join(' and ')}: iOS rejects every background-task registration`,
    fix: "List 'expo-background-task' in the app config plugins, then regenerate the snapshot (--write) and review its diff.",
  });
}

// ---------------------------------------------------------------------------------------------
// The entry and the import graph
// ---------------------------------------------------------------------------------------------

function entryOf({ root, pkg, report }) {
  const main = typeof pkg.data.main === 'string' ? pkg.data.main : null;
  if (main === null || main.startsWith('expo-router')) return { rel: null, main };
  const resolved = resolveImport('package.json', `./${main.replace(/^\.\//, '')}`, { root });
  if (resolved.exists) return { rel: resolved.path, main };
  report.note(`package.json "main" (${main}) names no file; define-task-entry treats the app as having no entry`);
  return { rel: null, main };
}

function staticImports(file) {
  if (file.imports === null) {
    file.imports = importsOf(file.scan).filter((entry) => entry.form !== 'dynamic' && !entry.typeOnly);
  }
  return file.imports;
}

function buildIndex(files, { root, layout }) {
  const byRel = new Map(files.map((file) => [file.rel, file]));
  const importers = new Map();
  const resolveLocal = (fromRel, spec) => {
    const resolved = resolveImport(fromRel, spec, { root, aliases: layout.aliases });
    return resolved.kind === 'local' && resolved.exists ? resolved.path : null;
  };
  for (const file of files) {
    for (const entry of staticImports(file)) {
      const target = resolveLocal(file.rel, entry.spec);
      if (target === null) continue;
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push(file);
    }
  }
  return { byRel, importers, resolveLocal, defineFiles: new Map(), jobs: [] };
}

function loadFile(root, rel, index) {
  const known = index.byRel.get(rel);
  if (known) return known;
  if (!SOURCE_FILE.test(rel) || !existsSync(join(root, rel))) return null;
  const text = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(text);
  const file = { rel, text, scan, code: scan.code, isTest: isTestFile(rel), imports: null };
  index.byRel.set(rel, file);
  return file;
}

function reachableFromEntry(root, entryRel, index) {
  const seen = new Set([entryRel]);
  const queue = [entryRel];
  while (queue.length > 0) {
    const file = loadFile(root, queue.shift(), index);
    if (file === null) continue;
    for (const entry of staticImports(file)) {
      const target = index.resolveLocal(file.rel, entry.spec);
      if (target !== null && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** The specifier the entry imports `rel` with: through a tsconfig alias (src/x.ts → @/x) when one maps it, else relative. */
function importSpecifierFor(entryRel, rel, layout) {
  const bare = rel.replace(SOURCE_FILE, '');
  let best = null;
  for (const alias of layout.aliases ?? []) {
    if (!alias.pattern.endsWith('*')) continue;
    for (const target of alias.targets ?? []) {
      if (!target.endsWith('*')) continue;
      const prefix = target.slice(0, -1).replace(/^\.\//, '');
      if (!bare.startsWith(prefix) || (best !== null && prefix.length <= best.prefix.length)) continue;
      best = { prefix, spec: `${alias.pattern.slice(0, -1)}${bare.slice(prefix.length)}` };
    }
  }
  if (best !== null) return best.spec;
  const relative = posix.relative(posix.dirname(entryRel), bare);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function checkEntryReachability({ root, report, pkg, layout }, entry, index) {
  if (index.defineFiles.size === 0) return;
  if (entry.rel === null) {
    report.problem({
      file: 'package.json',
      line: lineIn(pkg.text, '"main"'),
      rule: 'define-task-entry',
      message: `package.json "main" is ${entry.main === null ? 'missing' : `"${entry.main}"`}: no app module runs before the routes, so a headless run (which renders no route) never defines the tasks`,
      fix: 'Create index.ts that imports the task registry (define-background-tasks.ts) and then \'expo-router/entry\', and set "main": "index.ts".',
    });
    return;
  }
  const reachable = reachableFromEntry(root, entry.rel, index);
  for (const [rel, line] of index.defineFiles) {
    if (reachable.has(rel)) continue;
    report.problem({
      file: rel,
      line,
      rule: 'define-task-entry',
      message: `defineTask() runs only if ${entry.rel} imports this file: a headless run evaluates the entry's imports but renders no route, and a task that fires undefined is unregistered for good`,
      fix: `Import it from ${entry.rel}: import '${importSpecifierFor(entry.rel, rel, layout)}'; before 'expo-router/entry' (after the Intl polyfills).`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Per-file rules
// ---------------------------------------------------------------------------------------------

function checkFile(file, context, index) {
  const ranges = functionRanges(file.code);
  checkImports(file, context);
  checkDefineTask(file, context, index, ranges);
  checkTaskNames(file, context);
  checkIntervals(file, context);
  checkTrigger(file, context, ranges);
  collectJobs(file, context, index);
}

function checkImports(file, { report }) {
  for (const entry of staticImports(file)) {
    const pkgName = entry.spec.split('/').slice(0, entry.spec.startsWith('@') ? 2 : 1).join('/');
    if (pkgName === LEGACY) {
      report.problem({ file: file.rel, line: entry.line, rule: 'no-background-fetch', message: 'imports expo-background-fetch (deprecated, no patches)', fix: 'Use expo-background-task through the BackgroundTasksPort (background-tasks skill).' });
    } else if (SDKS.includes(pkgName) && !VENDOR_FILE.test(file.rel)) {
      report.problem({
        file: file.rel,
        line: entry.line,
        rule: 'vendor-import-confined',
        message: `imports ${pkgName} outside the adapter and the task registry`,
        fix: 'Schedule through BackgroundTasksPort (expo-background-tasks-adapter.ts) and define tasks only in define-background-tasks.ts; an import type of the SDK is fine.',
      });
    }
  }
}

function firstArgIsLiteral(file, args) {
  const first = args[0];
  if (first === undefined) return false;
  const quote = file.text[first.start];
  return (quote === "'" || quote === '"' || quote === '`') && file.scan.stringAt.has(first.start);
}

function checkDefineTask(file, { report }, index, ranges) {
  for (const call of callsOf(file.code, 'defineTask')) {
    const line = file.scan.lineOf(call.start);
    const args = splitArguments(file.code, call.open, call.close);
    if (!index.defineFiles.has(file.rel)) index.defineFiles.set(file.rel, line);
    if (innermostRange(ranges, call.start) !== null) {
      report.problem({
        file: file.rel,
        line,
        rule: 'define-task-top-level',
        message: 'defineTask() runs inside a function: an Android run in a stopped process renders nothing (headless loader), so the task is undefined when it fires and the task manager unregisters it',
        fix: 'Call TaskManager.defineTask at module scope of define-background-tasks.ts (a loop over BACKGROUND_JOBS is fine).',
      });
    }
    const executor = args[1];
    if (executor === undefined || !/(?<![\w$.])toTaskExecutor\s*\(/.test(executor.text)) {
      report.problem({
        file: file.rel,
        line,
        rule: 'executor-through-runner',
        message: 'the task executor is not toTaskExecutor(job, createEnvironment): a throw is only console.error()ed, no budget applies and no run is recorded',
        fix: 'TaskManager.defineTask(job.name, toTaskExecutor(job, createBackgroundEnvironment)) with the job declared by defineBackgroundJob.',
      });
    }
  }
}

function checkTaskNames(file, { report }) {
  for (const callee of NAME_CALLS) {
    for (const call of callsOf(file.code, callee)) {
      const args = splitArguments(file.code, call.open, call.close);
      if (!firstArgIsLiteral(file, args)) continue;
      report.problem({
        file: file.rel,
        line: file.scan.lineOf(call.start),
        rule: 'task-name-literal',
        message: `${callee}() takes a string literal as the task name: a typo or a rename silently splits the definition from its registration`,
        fix: 'Pass job.name (declared once in defineBackgroundJob) or the constant that holds it.',
      });
    }
  }
}

/** Local names that call expo-background-task's registerTaskAsync: ns.registerTaskAsync or a named import. */
function backgroundTaskBindings(file) {
  const namespaces = [];
  const named = [];
  for (const match of file.text.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]expo-background-task['"]/g)) namespaces.push(match[1]);
  for (const match of file.text.matchAll(/import\s*\{([^}]*)\}\s*from\s+['"]expo-background-task['"]/g)) {
    for (const part of match[1].split(',')) {
      const m = /^\s*registerTaskAsync(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (m) named.push(m[1] ?? 'registerTaskAsync');
    }
  }
  return { namespaces, named };
}

/**
 * Whether `NAME_INTERVAL_MINUTES = n` in this file is a background interval: BACKGROUND_INTERVAL_MINUTES
 * anywhere, or any *_INTERVAL_MINUTES in the background folder or a file that imports
 * expo-background-task. A refetch or reminder interval elsewhere is the app's own business.
 */
function isBackgroundIntervalScope(file, config, bindings) {
  return file.rel.startsWith(`${config.backgroundDir}/`) || bindings.namespaces.length + bindings.named.length > 0
    || staticImports(file).some((entry) => entry.spec === 'expo-background-task');
}

function checkIntervals(file, { report, config }) {
  const bindings = backgroundTaskBindings(file);
  const { namespaces, named } = bindings;
  const callees = [...namespaces.map((ns) => `${ns}\\s*\\.\\s*registerTaskAsync`), ...named.map((name) => `(?<![\\w$.])${name}`)];
  for (const callee of callees) {
    for (const call of callsOf(file.code, callee, { raw: true })) {
      const args = splitArguments(file.code, call.open, call.close);
      const options = args[1]?.text.trim() ?? '';
      if (args.length >= 2 && !(options.startsWith('{') && !/\bminimumInterval\b/.test(options))) continue;
      report.problem({
        file: file.rel,
        line: file.scan.lineOf(call.start),
        rule: 'minimum-interval',
        message: 'registerTaskAsync() without { minimumInterval }: the defaults differ per platform (12 h on iOS, 24 h on Android in the 57 native code)',
        fix: 'Pass { minimumInterval: BACKGROUND_INTERVAL_MINUTES } (one interval for every job, at least 15).',
      });
    }
  }
  const inScope = isBackgroundIntervalScope(file, config, bindings);
  const literals = [
    ...[...file.code.matchAll(/\bminimumInterval\s*:\s*([^,}\n]+)/g)].map((m) => ({ index: m.index, expr: m[1], what: 'minimumInterval' })),
    ...[...file.code.matchAll(/\b([A-Z][A-Z0-9_]*INTERVAL_MINUTES)\s*(?::[^=\n]+)?=\s*([^;\n]+)/g)]
      .filter((m) => inScope || m[1] === 'BACKGROUND_INTERVAL_MINUTES')
      .map((m) => ({ index: m.index, expr: m[2], what: m[1] })),
  ];
  for (const { index, expr, what } of literals) {
    const value = evaluateNumber(expr);
    if (value === null || value >= MIN_INTERVAL_MINUTES) continue;
    report.problem({
      file: file.rel,
      line: file.scan.lineOf(index),
      rule: 'minimum-interval',
      message: `${what} is ${value} minutes: below the documented 15-minute minimum (the library does not clamp it on Android 8+, so runs would be scheduled more often than the docs allow; iOS treats any value as a minimum and often runs much later)`,
      fix: 'Use one interval of at least 15 minutes for every job (the template uses 12 * 60).',
    });
  }
}

function checkTrigger(file, { report }, ranges) {
  for (const call of callsOf(file.code, 'triggerTaskWorkerForTestingAsync')) {
    const range = innermostRange(ranges, call.start);
    if (range !== null && file.code.slice(range[0], range[1]).includes('__DEV__')) continue;
    report.problem({
      file: file.rel,
      line: file.scan.lineOf(call.start),
      rule: 'trigger-dev-only',
      message: 'triggerTaskWorkerForTestingAsync() is reachable outside a __DEV__ check: a release build does nothing (the SDK resolves false outside __DEV__), so the control silently fails; the iOS native helper is debug-only',
      fix: 'Call it only through triggerBackgroundRunForTesting() (which returns false unless __DEV__), from the debug menu.',
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

function collectJobs(file, { report, config }, index) {
  for (const call of callsOf(file.code, 'defineBackgroundJob', { generic: true })) {
    if (/\bfunction\s+$/.test(file.code.slice(Math.max(0, call.start - 30), call.start))) continue;
    const line = file.scan.lineOf(call.start);
    const args = splitArguments(file.code, call.open, call.close);
    const object = args[0];
    if (object === undefined || file.code[object.start] !== '{') {
      report.problem({ file: file.rel, line, rule: 'job-name', message: 'defineBackgroundJob() does not take an object literal, so its name and budget cannot be reviewed', fix: "defineBackgroundJob({ name: '<area>.<job>', budgetMs: 20_000, run })" });
      continue;
    }
    const entries = objectEntries(file.code, object.start);
    const job = { file, line, name: null };
    index.jobs.push(job);
    checkJobName(file, entries.name, { report, index, job, line });
    checkJobBudget(file, entries.budgetMs, { report, config, line });
  }
}

function checkJobName(file, entry, { report, index, job, line }) {
  const valueAt = entry?.valueStart ?? -1;
  const literal = valueAt >= 0 && file.scan.stringAt.get(valueAt);
  const name = literal && literal.quote !== '`' ? literal.value : null;
  if (name === null || !JOB_NAME.test(name)) {
    report.problem({
      file: file.rel,
      line: entry ? file.scan.lineOf(valueAt) : line,
      rule: 'job-name',
      message: name === null ? 'the job name is not a string literal' : `the job name "${name}" is not <area>.<job> in kebab-case`,
      fix: "name: 'tasks.sync-outbox': one literal, declared once, the task name everywhere else comes from job.name.",
    });
    return;
  }
  const twin = index.jobs.find((other) => other !== job && other.name === name);
  job.name = name;
  if (twin) {
    report.problem({ file: file.rel, line: file.scan.lineOf(valueAt), rule: 'job-name', message: `the job name "${name}" is also declared in ${twin.file.rel}:${twin.line}`, fix: 'Give every job its own name: two definitions of one task name overwrite each other.' });
  }
}

function checkJobBudget(file, entry, { report, config, line }) {
  const value = entry ? evaluateNumber(entry.text) : null;
  if (value !== null && Number.isInteger(value) && value > 0 && value <= config.maxBudgetMs) return;
  const detail = entry === undefined ? 'has no budgetMs' : value === null ? 'has a budgetMs that is not a number literal' : `asks for budgetMs ${value}`;
  report.problem({
    file: file.rel,
    line: entry ? file.scan.lineOf(entry.valueStart) : line,
    rule: 'job-budget',
    message: `the job ${detail}: the budget must be a literal from 1 to ${config.maxBudgetMs} ms, because the system may end a run at any moment (iOS expiry, Android stopping the worker) and 25 s is this library's design default`,
    fix: 'budgetMs: 20_000, and a job that needs longer does a bounded batch per run and returns partial.',
  });
}

function checkJobs(context, index) {
  const { root, config, report } = context;
  const inBackground = (rel) => rel.startsWith(`${config.backgroundDir}/`);
  const jobFiles = [...new Set(index.jobs.map((job) => job.file))];
  for (const file of jobFiles) {
    const line = index.jobs.find((job) => job.file === file).line;
    checkJobTest(root, file, line, report);
    checkJobImports(file, context, index);
    if (foregroundCallers(file, index, inBackground).length === 0) {
      report.problem({
        file: file.rel,
        line,
        rule: 'job-foreground-path',
        message: `no file outside ${config.backgroundDir}/ imports this job (or a background file that holds it, such as the job list) and calls runBackgroundJob: when the system never grants a background run (restricted device, Low Power Mode, a force-quit on iOS) the work never happens`,
        fix: "Run the same job through runBackgroundJob(job, environment, { trigger: 'foreground' }) on a foreground path too (app becomes active, after a write, pull to refresh).",
      });
    }
  }
  const migrationScope = [...index.byRel.values()].filter((file) => !file.isTest && (inBackground(file.rel) || jobFiles.includes(file)));
  for (const file of migrationScope) checkNoMigrate(file, report, MIGRATING);
  for (const file of oneHopFromBackground(migrationScope, context, index)) checkNoMigrate(file, report, MIGRATING_CALL);
}

/**
 * Non-test files that background code imports directly (the background open path,
 * src/data/open-background-data.ts, is the one that matters). The data layer's migrations folder
 * and any file that defines an open function (persistence-and-migrations' foreground open path,
 * imported only for a constant such as APP_DB_FILE) are left out.
 */
function oneHopFromBackground(scope, { layout }, index) {
  const inScope = new Set(scope.map((file) => file.rel));
  const found = new Map();
  for (const file of scope) {
    for (const entry of staticImports(file)) {
      const target = index.resolveLocal(file.rel, entry.spec);
      if (target === null || inScope.has(target) || found.has(target)) continue;
      if (target.startsWith(`${layout.dataDir}/migrations/`)) continue;
      const imported = index.byRel.get(target);
      if (imported === undefined || imported.isTest || DEFINES_OPEN_PATH.test(imported.code)) continue;
      found.set(target, imported);
    }
  }
  return [...found.values()];
}

/**
 * Non-test files outside the background folder that run the job through the runner: a direct importer
 * that calls runBackgroundJob( (a foreground hook calling job.run( directly skips single flight, the
 * budget and the run log; a screen reading job.name runs nothing), or a file that imports a background
 * file holding the job (the job list) and calls runBackgroundJob( itself. The second form is `for (const job of BACKGROUND_JOBS) runBackgroundJob(job, ...)` in a foreground hook;
 * the call is required there so the startup registration hook (which imports the job list only for
 * the names) and the entry do not count.
 */
function foregroundCallers(file, index, inBackground) {
  const outside = (importer) => !importer.isTest && !inBackground(importer.rel) && importer.rel !== file.rel;
  const runsJobs = (importer) => /(?<![\w$.])runBackgroundJob\s*\(/.test(importer.code);
  const direct = (index.importers.get(file.rel) ?? []).filter((importer) => outside(importer) && runsJobs(importer));
  const holders = (index.importers.get(file.rel) ?? []).filter((importer) => !importer.isTest && inBackground(importer.rel));
  const throughHolder = holders.flatMap((holder) => (index.importers.get(holder.rel) ?? []).filter((importer) => outside(importer) && runsJobs(importer)));
  return [...direct, ...throughHolder];
}

function checkJobTest(root, file, line, report) {
  const base = file.rel.replace(SOURCE_FILE, '');
  const testRel = ['.test.ts', '.test.tsx'].map((ext) => `${base}${ext}`).find((rel) => existsSync(join(root, rel)));
  const text = testRel === undefined ? '' : readFileSync(join(root, testRel), 'utf8');
  const missing = ['runJobTwice(', 'runJobUntilAborted('].filter((call) => !text.includes(call));
  if (missing.length === 0) return;
  report.problem({
    file: file.rel,
    line,
    rule: 'job-tested',
    message: testRel === undefined ? 'the job has no sibling test' : `${testRel} never calls ${missing.join(' or ')}`,
    fix: `Test the job with test/background/job-test-kit.ts: runJobTwice (the second run changes nothing) and runJobUntilAborted (a cut run leaves consistent state) in ${base}.test.ts.`,
  });
}

function checkJobImports(file, { layout, report }, index) {
  const uiDirs = [layout.featuresDir, layout.routesDir, layout.uiDir, layout.storesDir];
  for (const entry of staticImports(file)) {
    const target = index.resolveLocal(file.rel, entry.spec);
    const why = REACT_PACKAGES.test(entry.spec)
      ? `${entry.spec} (React, navigation and stores exist only while the UI runs)`
      : target !== null && uiDirs.some((dir) => target.startsWith(`${dir}/`))
        ? `${target} (UI code: no screen renders in a background launch)`
        : target !== null && /-context\.tsx?$/.test(target)
          ? `${target} (React context: no provider is mounted in a background launch)`
          : null;
    if (why === null) continue;
    report.problem({
      file: file.rel,
      line: entry.line,
      rule: 'job-no-react',
      message: `the job imports ${why}; on Android a background run evaluates the bundle with no React tree at all`,
      fix: 'Give the job what it needs through BackgroundDeps (ports and repositories created in background-environment.ts).',
    });
  }
}

function checkNoMigrate(file, report, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(file.code);
  if (match === null) return;
  report.problem({
    file: file.rel,
    line: file.scan.lineOf(match.index),
    rule: 'job-no-migrate',
    message: `${match[1]} in background code: a background launch can be cut mid-migration, races the foreground start on iOS, and nobody sees its failure`,
    fix: 'Open the database only when readUserVersion equals the latest version and return { kind: "deferred", reason: "schema-behind" } otherwise; the foreground start migrates.',
  });
}

run(main);
