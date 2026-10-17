// check-native-generation.mjs: proves an Expo app keeps Continuous Native Generation honest.
// app.config.ts is the one config and evaluates the same way twice; every native change reaches the
// generated ios/ and android/ folders through the config's plugin list (built-in keys first, every
// auto-applied plugin listed, local plugins in plugins/ by path, typed, idempotent and tested); the
// native folders stay git-ignored and untouched by scripts; or, when the app deliberately commits
// them, contracts/native-generation.json records that decision. Zero dependencies (node: built-ins
// and check-lib only).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, maskComments, notYetCreated, parseArgs, parseJsonc, readWorkspaces, requireDir, resolveLayout, run, UsageError, walk, walkRepo } from './check-lib.mjs';
import {
  evaluateConfig, firstDifference, ignoredBy, ignoreRules, isDir, isFile, isFilePath, jestRuns, lineOfText, loadJestSelection,
  nullPaths, packageOf, pluginEntries, probeFile, readJsonFile, relPath,
} from './lib/cng-scan.mjs';
import { findCalls, findClosing, importsOf, scanSource, valueImports } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-native-generation',
  summary: 'Checks Continuous Native Generation: one app.config.ts that evaluates the same way twice, native changes only through its plugin list (built-in keys first, auto-applied plugins listed, local plugins in plugins/ by path, typed, idempotent, tested), and git-ignored native folders that no script edits; or a recorded decision to commit them.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'Folder that holds app.config.ts, relative to the repo root (default: the root, or the one workspace with an app config)' },
    'plugins-dir': { type: 'string', value: 'dir', help: 'Local config plugins, relative to the app folder (default: rn-skills.config.json "pluginsDir", else plugins)' },
    variant: { type: 'string', multiple: true, value: 'name', help: 'Evaluate the config with APP_VARIANT=EXPO_PUBLIC_APP_VARIANT=<name> (default: development, preview and production when the config reads APP_VARIANT, else one evaluation)' },
    env: { type: 'string', multiple: true, value: 'KEY=VALUE', help: 'Extra environment for every evaluation' },
    'no-git': { type: 'boolean', help: 'Skip the git ls-files check of the native folders' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  single-config         app.config.ts is the only app config: no app.json or app.config.json, no second app.config.* (Expo reads .ts first and ignores the rest)',
    '  config-evaluates      the default export returns a config object synchronously for every evaluated variant (Expo refuses a Promise)',
    '  config-deterministic  two evaluations with the same environment give the same config (the fingerprint and runtime version hash it)',
    '  config-null           no null in the config: Expo serializes null as {} (an empty object reaches the app and the native files)',
    '  config-mods           app.config.ts and the files it imports apply no config-plugin helper and import no local plugin: native changes go in plugins/ and the plugin list',
    '  plugin-entry          every plugin entry resolves: a package that is a dependency and ships app.plugin.*, or a ./plugins/ file with a default export; no imported functions',
    '  plugin-duplicate      no plugin listed twice (a run-once plugin silently ignores the second entry and its options)',
    '  auto-plugin-listed    every dependency whose plugin prebuild applies on its own (assets/auto-plugins.json) is listed in plugins, for every variant (a note for one installed only through another package)',
    '  plugin-import         local plugins import Expo helpers as expo/config-plugins.js on SDK 57 (expo/config-plugins from SDK 58), never @expo/config-plugins or @expo/config-types',
    '  plugin-test           every local plugin has a sibling *.test.ts that imports it and that the repo\'s Jest config runs',
    '  dangerous-mod         withDangerousMod/withFinalizedMod carry a "// dangerous-mod: <reason>" comment; file writes happen only inside them',
    '  text-mod-idempotent   a plugin that edits native source as text (AppDelegate, Podfile, Gradle files, MainActivity/MainApplication) guards its edit inside the mod call or a helper it calls, in the file or a local module it imports (CodeGenerator.mergeContents, or an includes/test check on the contents); a check elsewhere in the file does not count; a dangerous mod needs the guard only when it appends or reads and rewrites a file (writing a whole file is idempotent)',
    '  builtin-first         a local plugin does not set what a config key or expo-build-properties owns (deployment target, SDK versions, permissions, queries, schemes, purpose strings, entitlements, extra Maven repositories, ...)',
    '  native-ignored        generated mode: .gitignore ignores the root ios/ and android/ folders',
    '  native-tracked        generated mode: git tracks no file under ios/ or android/ (skipped outside a git work tree or with --no-git)',
    '  native-ignore-scope   the native-folder ignore lines do not hide a nested ios/ or android/ folder that exists (a local Expo module, assets)',
    '  easignore-native      generated mode: an .easignore (which replaces .gitignore for EAS uploads) ignores ios/ and android/ too',
    '  native-edit           generated mode: no npm script, scripts/ file (shell, or child_process and fs calls in Node) or CI workflow writes into ios/ or android/',
    '  prebuild-clean        no script, workflow or eas.json prebuildCommand runs prebuild --no-clean (only a clean prebuild is reproducible)',
    '  native-mode           contracts/native-generation.json is valid; "committed" mode needs a reason, a date, both folders committed, no prebuild in scripts and no eas.json prebuildCommand',
    'SKIP line: the Jest reach of plugin tests while jest.config.js does not exist (unit-and-component-tests creates it).',
    'NOT APPLICABLE when package.json has no expo dependency.',
    'rn-skills.config.json key read: "pluginsDir" (default "plugins", relative to the app folder).',
    'Bad input (exit 2): no app config, Node older than 22.18, a config import that is not installed, malformed JSON.',
  ].join('\n'),
};

const DYNAMIC_CONFIGS = ['app.config.ts', 'app.config.mts', 'app.config.cts', 'app.config.mjs', 'app.config.cjs', 'app.config.js'];
const STATIC_CONFIGS = ['app.config.json', 'app.json'];
const CANONICAL_VARIANTS = ['development', 'preview', 'production'];
const SOURCE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const NATIVE = ['ios', 'android'];
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const AUTO_PLUGINS = JSON.parse(readFileSync(join(SKILL_DIR, 'assets', 'auto-plugins.json'), 'utf8'));
const CONTRACT_FILE = 'native-generation.json';

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const layout = resolveLayout(root);
  const appDir = requireDir(resolve(root, options['app-dir'] ?? findAppDir(root)), 'app folder');
  const appRel = (name) => relPath(root, join(appDir, name)) || '.';
  const report = createReporter({ name: 'check-native-generation', json: options.json });
  const manifestPath = join(appDir, 'package.json');
  if (!isFile(manifestPath)) throw new UsageError(`nothing to check: no package.json in ${appRel('.')}`, 'Run it from the app root, or pass the repo root and --app-dir <dir>.');
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = readJsonFile(manifestPath, appRel('package.json'));
  const deps = { ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.dependencies };
  if (!('expo' in deps)) return report.notApplicable(`expo is not a dependency in ${appRel('package.json')}`);

  const dynamicFound = DYNAMIC_CONFIGS.filter((name) => isFile(join(appDir, name)));
  const staticFound = STATIC_CONFIGS.filter((name) => isFile(join(appDir, name)));
  if (dynamicFound.length === 0 && staticFound.length === 0) {
    throw new UsageError(`nothing to check: no app config (app.config.ts or app.json) in ${appRel('.')}`, 'Run it from the app root, or pass the repo root and --app-dir <dir>.');
  }
  const pluginsDirRel = (options['plugins-dir'] ?? layout.config.pluginsDir ?? 'plugins').replace(/\/+$/, '');
  const ctx = { root, appDir, appRel, report, manifest, manifestText, deps, layout, pluginsDirRel, options, read: 0 };
  ctx.sdkMajor = sdkMajorOf(appDir, deps);

  checkSingleConfig(ctx, dynamicFound, staticFound);
  const contract = readContract(ctx);
  const configName = dynamicFound[0] ?? null;
  const evaluations = configName ? evaluateAll(ctx, configName) : [];
  if (configName) checkConfigMods(ctx, join(appDir, configName));
  const plugins = listPluginFiles(ctx);
  if (evaluations.length > 0) checkPluginEntries(ctx, evaluations, configName);
  checkPluginSources(ctx, plugins);
  checkPluginTests(ctx, plugins);
  const commands = collectCommands(ctx);
  if (contract.mode === 'committed') {
    checkCommitted(ctx, contract, commands, evaluations);
  } else {
    checkNativeIgnored(ctx);
    if (!options['no-git']) checkNativeTracked(ctx);
    checkEasignore(ctx);
    checkNativeEdit(ctx, commands);
  }
  checkIgnoreScope(ctx);
  checkPrebuildClean(ctx, commands);
  return report.finish({ checked: ctx.read, unit: 'files' });
}

/** The root, or the one workspace that holds an app config (when multi-package). */
function findAppDir(root) {
  if ([...DYNAMIC_CONFIGS, ...STATIC_CONFIGS].some((name) => isFile(join(root, name)))) return '.';
  const apps = readWorkspaces(root).filter((ws) => [...DYNAMIC_CONFIGS, ...STATIC_CONFIGS].some((name) => isFile(join(root, ws.dir, name))));
  if (apps.length === 1) return apps[0].dir;
  if (apps.length > 1) throw new UsageError(`${apps.length} workspaces hold an app config (${apps.map((ws) => ws.dir).join(', ')})`, 'Pass the app with --app-dir <dir>, once per app.');
  return '.';
}

function sdkMajorOf(appDir, deps) {
  for (const dir of [appDir, resolve(appDir, '..'), resolve(appDir, '../..')]) {
    const path = join(dir, 'node_modules', 'expo', 'package.json');
    if (isFile(path)) {
      const version = JSON.parse(readFileSync(path, 'utf8')).version;
      return Number.parseInt(String(version), 10);
    }
  }
  const match = /(\d+)/.exec(String(deps.expo ?? ''));
  return match ? Number.parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------------------------
// The app config
// ---------------------------------------------------------------------------------------------

function checkSingleConfig(ctx, dynamicFound, staticFound) {
  const { report, appRel } = ctx;
  ctx.read += dynamicFound.length + staticFound.length;
  for (const name of staticFound) {
    const message = dynamicFound.length > 0
      ? `${name} sits beside ${dynamicFound[0]}: Expo passes it in as the config context, so values live in two files`
      : `${name} is a static config: the app config is app.config.ts (typed, evaluated, one place for every value)`;
    report.problem({ file: appRel(name), line: 1, rule: 'single-config', message, fix: `Move every value into app.config.ts and delete ${name}.` });
  }
  if (dynamicFound.length > 0 && dynamicFound[0] !== 'app.config.ts') {
    report.problem({ file: appRel(dynamicFound[0]), line: 1, rule: 'single-config', message: `the app config is ${dynamicFound[0]}, not app.config.ts`, fix: `Rename it to app.config.ts and type it with ExpoConfig from 'expo/config' (Node loads it with type stripping).` });
  }
  for (const name of dynamicFound.slice(1)) {
    report.problem({ file: appRel(name), line: 1, rule: 'single-config', message: `${name} is never read: Expo takes ${dynamicFound[0]} first and ignores every other app.config.*`, fix: `Move what it holds into ${dynamicFound[0]} and delete ${name}.` });
  }
}

function variantsFor(ctx, configText) {
  if (ctx.options.variant.length > 0) return ctx.options.variant;
  return /\bAPP_VARIANT\b/.test(configText) ? CANONICAL_VARIANTS : [null];
}

function extraEnv(ctx) {
  const env = {};
  for (const pair of ctx.options.env) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new UsageError(`--env ${pair} is not KEY=VALUE`, 'Pass --env NAME=value, once per variable.');
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return env;
}

function failureIsEnvironment(ctx, result) {
  const missingPackage = /Cannot find (package|module) '([^.'/][^']*)'/.exec(result.message ?? '');
  return Boolean(missingPackage) && !isDir(join(ctx.appDir, 'node_modules')) && !isDir(join(ctx.root, 'node_modules'));
}

/** Evaluates the config per variant: [{ variant, env, config }] for every evaluation that returned an object. */
function evaluateAll(ctx, configName) {
  const { report, appDir, appRel } = ctx;
  const configPath = join(appDir, configName);
  const configText = readFileSync(configPath, 'utf8');
  ctx.configText = configText;
  ctx.configRel = appRel(configName);
  if (/\.[cm]?ts$/.test(configName) && !process.features?.typescript) {
    throw new UsageError(`Node ${process.versions.node} cannot load ${configName}: type stripping needs Node 22.18 or newer`, 'Run the checker with Node 22.18+ (the app pins Node 26).');
  }
  const base = extraEnv(ctx);
  const evaluations = [];
  for (const variant of variantsFor(ctx, configText)) {
    const env = variant === null ? { ...base } : { APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant, ...base };
    const label = variant === null ? '' : ` for APP_VARIANT=${variant}`;
    const result = evaluateConfig({ configPath, appDir, manifest: ctx.manifest, env });
    if (!result.ok) {
      if (failureIsEnvironment(ctx, result)) throw new UsageError(`${configName} imports a package that is not installed: ${result.message.split('\n')[0]}`, 'Install the dependencies first (npm ci), then rerun.');
      report.problem({ file: ctx.configRel, line: 1, rule: 'config-evaluates', message: `${configName} fails${label}: ${result.message.split('\n')[0]}`, fix: `Make it evaluate (try: ${variant === null ? '' : `APP_VARIANT=${variant} EXPO_PUBLIC_APP_VARIANT=${variant} `}npx expo config --type public).` });
    } else if (result.promise) {
      report.problem({ file: ctx.configRel, line: lineOfText(configText, 'export default'), rule: 'config-evaluates', message: `${configName} returns a Promise${label}; Expo refuses it ("cannot return a Promise")`, fix: 'Return the ExpoConfig object synchronously; read files with readFileSync, never fetch in the config.' });
    } else if (result.config === null || typeof result.config !== 'object' || Array.isArray(result.config)) {
      report.problem({ file: ctx.configRel, line: lineOfText(configText, 'export default'), rule: 'config-evaluates', message: `${configName} returns no config object${label}`, fix: 'Default-export a function of ConfigContext that returns the ExpoConfig object.' });
    } else {
      evaluations.push({ variant, env, config: result.config });
    }
  }
  if (evaluations.length > 0) {
    const [first] = evaluations;
    const again = evaluateConfig({ configPath, appDir, manifest: ctx.manifest, env: first.env });
    if (again.ok && !again.promise) {
      const path = firstDifference(first.config, again.config);
      if (path !== null) {
        report.problem({ file: ctx.configRel, line: lineOfText(configText, path.split(/[.[]/)[0]), rule: 'config-deterministic', message: `two evaluations with the same environment differ at ${path}`, fix: 'Derive every value from the environment and committed files only: no Date.now(), new Date(), Math.random() or machine-specific paths (the fingerprint and runtime version hash the config).' });
      }
    }
  }
  const nulls = [...new Set(evaluations.flatMap((entry) => nullPaths(entry.config)))];
  if (nulls.length > 0) {
    const last = nulls[0].split(/[.[]/).filter(Boolean).at(-1)?.replace(/]$/, '') ?? 'null';
    report.problem({ file: ctx.configRel, line: lineOfText(configText, last), rule: 'config-null', message: `null in the config at ${nulls.slice(0, 3).join(', ')}${nulls.length > 3 ? ` and ${nulls.length - 3} more` : ''}: Expo serializes null as {}, so the app and the native files get an empty object`, fix: 'Leave the key out when there is no value (spread it in only when set: ...(id ? { id } : {})).' });
  }
  return evaluations;
}

const CONFIG_PLUGIN_SPEC = /^(expo\/config-plugins(\.js)?|@expo\/config-plugins)(\/|$)/;

/** app.config.ts and the local files it imports never apply config-plugin helpers or import a local plugin. */
function checkConfigMods(ctx, configPath) {
  const { appDir, report, pluginsDirRel } = ctx;
  const pluginsAbs = join(appDir, pluginsDirRel);
  const seen = new Set();
  const queue = [configPath];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    const rel = relPath(ctx.root, file);
    for (const entry of valueImports(text)) {
      const line = text.slice(0, entry.index).split('\n').length;
      if (CONFIG_PLUGIN_SPEC.test(entry.spec)) {
        report.problem({ file: rel, line, rule: 'config-mods', message: `applies config-plugin helpers from ${entry.spec} in the config itself: the native change is invisible in the plugin list and in npx expo config`, fix: `Move it into ${pluginsDirRel}/with-<capability>.ts (default export) and list that file by path in plugins.` });
        continue;
      }
      if (!entry.spec.startsWith('.')) continue;
      const target = probeFile(dirname(file), entry.spec);
      if (target === null || target.includes(`${join('', 'node_modules')}`)) continue;
      if (target.startsWith(`${pluginsAbs}/`)) {
        report.problem({ file: rel, line, rule: 'config-mods', message: `imports the local plugin ${entry.spec} and applies it in code`, fix: `List it by path instead: plugins: [['./${relPath(appDir, target)}', { ...options }]], and drop the import.` });
      } else if (target.startsWith(`${appDir}/`) && SOURCE.test(target)) {
        queue.push(target);
      }
    }
  }
  ctx.read += seen.size - 1;
}

// ---------------------------------------------------------------------------------------------
// The plugin list
// ---------------------------------------------------------------------------------------------

function pluginLine(ctx, reference) {
  for (const needle of [`'${reference}'`, `"${reference}"`, '`' + reference + '`', 'plugins']) {
    if (ctx.configText.includes(needle)) return lineOfText(ctx.configText, needle);
  }
  return 1;
}

function variantText(variants) {
  return variants.length === 0 || variants.every((variant) => variant === null) ? '' : ` (APP_VARIANT=${variants.join(', ')})`;
}

function checkPluginEntries(ctx, evaluations, configName) {
  const { report, appDir, deps, pluginsDirRel } = ctx;
  const seen = new Set();
  const once = (key, problem) => {
    if (seen.has(key)) return;
    seen.add(key);
    report.problem(problem);
  };
  for (const { variant, config } of evaluations) {
    const entries = pluginEntries(config);
    const counts = new Map();
    for (const entry of entries) {
      if (entry.functionName !== null) {
        once(`fn:${entry.functionName}`, { file: ctx.configRel, line: pluginLine(ctx, entry.functionName), rule: 'plugin-entry', message: `plugins holds the imported function ${entry.functionName}: the list should name the file`, fix: `List the plugin by path ('./${pluginsDirRel}/with-<capability>.ts'), drop the import, so npx expo config shows where it lives.` });
        continue;
      }
      if (entry.reference === null) {
        once(`bad:${entry.index}`, { file: ctx.configRel, line: pluginLine(ctx, 'plugins'), rule: 'plugin-entry', message: `plugins entry ${entry.index} is neither a name nor [name, options]`, fix: "Write 'package-name', ['package-name', { ... }] or ['./plugins/with-x.ts', { ... }]." });
        continue;
      }
      const ref = entry.reference;
      const key = isFilePath(ref) ? relPath(appDir, probeFile(appDir, ref) ?? resolve(appDir, ref)) : ref;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (isFilePath(ref)) checkLocalEntry(ctx, ref, once);
      else checkPackageEntry(ctx, ref, deps, once);
    }
    for (const [key, count] of counts) {
      if (count > 1) once(`dup:${key}`, { file: ctx.configRel, line: pluginLine(ctx, key.replace(/\.[cm]?[jt]s$/, '')), rule: 'plugin-duplicate', message: `${key} is listed ${count} times${variantText([variant])}: a run-once plugin applies only the first entry and silently drops the other options`, fix: 'Keep one entry and merge the options into it (one plugin list, one line per plugin).' });
    }
  }
  checkAutoPlugins(ctx, evaluations, configName);
}

function checkLocalEntry(ctx, ref, once) {
  const { appDir, pluginsDirRel } = ctx;
  const target = probeFile(appDir, ref);
  const rel = target ? relPath(appDir, target) : ref.replace(/^\.\//, '');
  if (!rel.startsWith(`${pluginsDirRel}/`)) {
    once(`where:${ref}`, { file: ctx.configRel, line: pluginLine(ctx, ref), rule: 'plugin-entry', message: `the local plugin ${ref} lives outside ${pluginsDirRel}/`, fix: `Move it to ${pluginsDirRel}/with-<capability>.ts (with its test beside it) and list './${pluginsDirRel}/with-<capability>.ts'.` });
  }
  if (target === null) {
    once(`missing:${ref}`, { file: ctx.configRel, line: pluginLine(ctx, ref), rule: 'plugin-entry', message: `the plugin file ${ref} does not exist (prebuild fails with PLUGIN_NOT_FOUND)`, fix: `Create ${ref} or correct the path in the plugin list.` });
    return;
  }
  const text = maskComments(readFileSync(target, 'utf8'));
  if (!/\bexport\s+default\b|\bmodule\.exports\s*=/.test(text)) {
    once(`export:${ref}`, { file: relPath(ctx.root, target), line: 1, rule: 'plugin-entry', message: `${ref} has no default export: Expo loads the default export as the plugin ("must export a function")`, fix: 'Default-export the ConfigPlugin (export default withX;), tagged /** @public */ for knip.' });
  }
}

const APP_PLUGIN_FILES = ['app.plugin.js', 'app.plugin.cjs', 'app.plugin.mjs', 'app.plugin.ts', 'app.plugin.cts', 'app.plugin.mts'];

function checkPackageEntry(ctx, ref, deps, once) {
  const pkg = packageOf(ref);
  const pkgDir = [ctx.appDir, ctx.root].map((dir) => join(dir, 'node_modules', pkg)).find((dir) => isFile(join(dir, 'package.json')));
  if (!(pkg in deps)) {
    const message = pkgDir === undefined
      ? `plugins names ${ref}, but ${pkg} is not a dependency in package.json (prebuild and EAS Build fail with PLUGIN_NOT_FOUND)`
      : `plugins names ${ref}, but ${pkg} is not a dependency in package.json: it resolves only because another package installs it (hoisting), so a dependency change or a strict installer (pnpm) can remove it and prebuild then fails with PLUGIN_NOT_FOUND`;
    const fix = pkgDir === undefined ? `npx expo install ${pkg}, or drop the entry.` : `npx expo install ${pkg} to make it a direct dependency, then keep the entry.`;
    once(`dep:${pkg}`, { file: ctx.configRel, line: pluginLine(ctx, ref), rule: 'plugin-entry', message, fix });
    return;
  }
  if (pkgDir === undefined || ref !== pkg) return;
  const pkgManifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const hasPluginFile = APP_PLUGIN_FILES.some((name) => isFile(join(pkgDir, name)));
  if (!hasPluginFile && !pkgManifest.main && !pkgManifest.exports) {
    once(`noplugin:${pkg}`, { file: ctx.configRel, line: pluginLine(ctx, ref), rule: 'plugin-entry', message: `${pkg} ships no config plugin (no app.plugin.* and no main entry), so prebuild fails with "does not contain a valid config plugin"`, fix: 'Drop the entry: autolinking links native code without a plugin; list a package only when it ships app.plugin.js.' });
  }
}

const DEV_CLIENT_PARTS = ['expo-dev-launcher', 'expo-dev-menu'];

function checkAutoPlugins(ctx, evaluations, configName) {
  const { report, deps } = ctx;
  for (const pkg of AUTO_PLUGINS.list) {
    if (pkg in AUTO_PLUGINS.exempt) continue;
    if (!(pkg in deps)) {
      noteTransitive(ctx, evaluations, pkg);
      continue;
    }
    const missing = evaluations.filter(({ config }) => !pluginEntries(config).some((entry) => entry.reference !== null && !isFilePath(entry.reference) && packageOf(entry.reference) === pkg));
    if (missing.length === 0) continue;
    const effect = AUTO_PLUGINS.defaults[pkg] ? ` (it adds ${AUTO_PLUGINS.defaults[pkg]})` : '';
    const blockable = AUTO_PLUGINS.blockable?.[pkg]?.permissions ?? [];
    const block = blockable.length > 0 ? ` Listing does not remove ${blockable.join(', ')}: block them in android.blockedPermissions if the app does not need them.` : '';
    report.problem({ file: ctx.configRel, line: pluginLine(ctx, 'plugins'), rule: 'auto-plugin-listed', message: `${pkg} is installed, so prebuild applies its config plugin with default options${effect}, but ${configName} does not list it${variantText(missing.map((entry) => entry.variant))}`, fix: `List '${pkg}' in plugins with the options the app needs (or bare to accept the defaults on purpose), so the config shows every native change; remove the package if the app does not use it.${block}` });
  }
}

/**
 * Since SDK 54 autolinking also links Expo modules that another package depends on, and prebuild
 * applies their plugin defaults the same way. The rule reads direct dependencies only (the native
 * snapshot is the net); an installed auto-plugin package that is not a dependency gets a note.
 */
function noteTransitive(ctx, evaluations, pkg) {
  if (DEV_CLIENT_PARTS.includes(pkg) && 'expo-dev-client' in ctx.deps) return;
  const installed = [ctx.appDir, ctx.root].some((dir) => isFile(join(dir, 'node_modules', pkg, 'package.json')));
  if (!installed) return;
  // Listed without being a dependency: plugin-entry already reports it.
  const listed = evaluations.length > 0 && evaluations.every(({ config }) => pluginEntries(config).some((entry) => entry.reference !== null && !isFilePath(entry.reference) && packageOf(entry.reference) === pkg));
  if (listed) return;
  const blockable = AUTO_PLUGINS.blockable?.[pkg]?.permissions ?? [];
  if (blockable.length > 0 && evaluations.length > 0 && evaluations.every(({ config }) => blocksAll(config, blockable))) return;
  const effect = AUTO_PLUGINS.defaults[pkg] ? ` (it adds ${AUTO_PLUGINS.defaults[pkg]})` : '';
  const block = blockable.length > 0 ? `block ${blockable.join(', ')} in android.blockedPermissions (that silences this note; listing the package does not remove them)` : 'block what it adds (android.blockedPermissions removes a permission; listing the package does not)';
  ctx.report.note(`note: ${pkg} is installed through another package, not as a dependency; autolinking links it, so prebuild applies its plugin defaults${effect}. To keep out what the app does not need, ${block}. To set its options, make it a direct dependency first (npx expo install ${pkg}), then list it; check-native-snapshot shows the effect`);
}

/**
 * True when the config's android.blockedPermissions names every permission. Names are normalized
 * the way @expo/config-plugins 57 treats blockedPermissions (prefixAndroidPermissionsIfNecessary): a
 * name without a dot gets the android.permission. prefix, nothing is upper-cased, and
 * ensureBlockedPermission matches case-sensitively, so 'android.permission.write_external_storage'
 * blocks nothing.
 */
function blocksAll(config, permissions) {
  const blocked = Array.isArray(config?.android?.blockedPermissions) ? config.android.blockedPermissions : [];
  const normalize = (name) => (name.includes('.') ? name : `android.permission.${name}`);
  const full = new Set(blocked.filter((name) => typeof name === 'string' && name !== '').map(normalize));
  return permissions.every((name) => full.has(name));
}

// ---------------------------------------------------------------------------------------------
// Local plugin sources
// ---------------------------------------------------------------------------------------------

function listPluginFiles(ctx) {
  const dir = join(ctx.appDir, ctx.pluginsDirRel);
  if (!isDir(dir)) return { all: [], plugins: [] };
  const all = walk(dir, { pruneDirsContaining: ['SKILL.md'] }).filter((rel) => SOURCE.test(rel) && !rel.endsWith('.d.ts')).map((rel) => join(dir, rel));
  ctx.read += all.length;
  const plugins = all.filter((file) => dirname(file) === dir && !TEST.test(file));
  return { all, plugins };
}

const TEXT_MODS = '(?:withAppDelegate|withPodfile|withAppBuildGradle|withProjectBuildGradle|withSettingsGradle|withMainActivity|withMainApplication|withDangerousMod)';
const EDIT_GUARDS = /(mergeContents|removeContents)\s*\(|\.(includes|test|indexOf|match|search|startsWith|endsWith)\s*\(/;
const DANGEROUS_CALLS = '(?:withDangerousMod|withFinalizedMod)';
const FILE_WRITES = /(?<![\w$])(writeFileSync|appendFileSync|copyFileSync|cpSync|renameSync|rmSync|unlinkSync|mkdirSync|writeFile|appendFile)\s*\(/g;

/** What a config key or expo-build-properties already owns, and where it goes instead. */
const BUILTIN_OWNERS = [
  { re: /IPHONEOS_DEPLOYMENT_TARGET|platform\s*:ios/, what: 'the iOS deployment target', owner: 'the built-in ios.deploymentTarget key (SDK 56 and later)' },
  { re: /\b(minSdkVersion|compileSdkVersion|targetSdkVersion|buildToolsVersion|kotlinVersion)\b/, what: 'an Android SDK or toolchain version', owner: "expo-build-properties' android.minSdkVersion / compileSdkVersion / targetSdkVersion / buildToolsVersion / kotlinVersion" },
  { re: /use_frameworks!/, what: 'use_frameworks!', owner: "expo-build-properties' ios.useFrameworks" },
  { re: /usesCleartextTraffic/, what: 'cleartext traffic', owner: "expo-build-properties' android.usesCleartextTraffic" },
  { re: /LSApplicationQueriesSchemes/, what: 'the iOS URL query schemes', owner: 'ios.infoPlist.LSApplicationQueriesSchemes' },
  { re: /\.queries\b|['"]queries['"]/, what: 'Android <queries>', owner: "expo-build-properties' android.manifestQueries" },
  { re: /['"]uses-permission['"]/, what: 'Android permissions', owner: 'android.permissions (and android.blockedPermissions to remove one a library adds)' },
  { re: /android:allowBackup/, what: 'android:allowBackup', owner: 'android.allowBackup' },
  { re: /CFBundleURLSchemes/, what: 'URL schemes', owner: 'scheme / ios.scheme (and android.intentFilters)' },
  { re: /\bNS[A-Za-z]+UsageDescription\b/, what: 'an iOS purpose string', owner: "ios.infoPlist (per language: locales), or the module's own plugin option" },
  { re: /aps-environment|com\.apple\.developer\.[a-z-]+/, what: 'an iOS entitlement', owner: "ios.entitlements, or the module's own plugin" },
  { re: /android:windowSoftInputMode/, what: 'the soft keyboard mode', owner: 'android.softwareKeyboardLayoutMode' },
  { re: /reactNativeArchitectures/, what: 'the Android ABIs', owner: "expo-build-properties' android.buildArchs" },
  { re: /android:enableOnBackInvokedCallback/, what: 'predictive back', owner: 'android.predictiveBackGestureEnabled' },
  { re: /\bmaven\s*\{[^}]*\burl\b/, when: '(?:withProjectBuildGradle|withSettingsGradle)', what: 'an extra Maven repository', owner: "expo-build-properties' android.extraMavenRepos" },
];

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkPluginSources(ctx, { all }) {
  const { report, root, sdkMajor } = ctx;
  const modules = new Map();
  // Code reached from a dangerous mod (its callback, and the helpers it calls here or imports from a
  // local module) runs at prebuild, so a file write there is in the right place.
  const prebuildTime = [];
  for (const file of all) {
    if (TEST.test(file)) continue;
    const mod = loadModule(modules, file);
    for (const call of findCalls(mod.code, DANGEROUS_CALLS)) prebuildTime.push(...guardReached(modules, file, call).ranges);
  }
  const reachedFromDangerous = (file, at) => prebuildTime.some((range) => range.mod.file === file && at > range.from && at < range.to);
  for (const file of all) {
    const raw = readFileSync(file, 'utf8');
    const rel = relPath(root, file);
    checkPluginImports(report, rel, raw, sdkMajor);
    if (TEST.test(file)) continue;
    const kept = maskComments(raw);
    const code = scanSource(raw).code;
    checkDangerous(report, rel, raw, code, kept, (at) => reachedFromDangerous(file, at));
    for (const call of findCalls(code, TEXT_MODS)) {
      const name = code.slice(call.start, call.open).trim();
      const { guarded, ranges } = guardReached(modules, file, call);
      if (guarded) continue;
      // A dangerous mod that writes whole files (mkdirSync + writeFileSync/copyFileSync of fixed
      // contents) is idempotent by construction; only an append or a read-modify-write needs a guard.
      const how = name === 'withDangerousMod' ? unguardedFileEdit(ranges) : '';
      if (how === null) continue;
      report.problem({ file: rel, line: lineAt(code, call.start), rule: 'text-mod-idempotent', message: `${name} edits native source as text without a guard${how ? ` (${how})` : ''}: prebuild --no-clean (and every local run onto existing folders) adds the edit again`, fix: 'Insert through CodeGenerator.mergeContents (from expo/config-plugins.js) with a tag, or check contents.includes(<marker>) inside the mod (or a helper it calls, in this file or one it imports) before changing anything; a dangerous mod may instead write the whole file; test that a second run changes nothing.' });
    }
    for (const owner of BUILTIN_OWNERS) {
      if (owner.when && findCalls(code, owner.when).length === 0) continue;
      const match = owner.re.exec(kept);
      if (match) report.problem({ file: rel, line: lineAt(kept, match.index), rule: 'builtin-first', message: `sets ${owner.what} (${match[0].replace(/\s+/g, ' ')}) in a local plugin`, fix: `Use ${owner.owner} in app.config.ts: built-in keys are validated, introspectable and kept working across SDK upgrades.` });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The guard search: the mod call, the functions it names or calls in this file, and the functions it
// imports from local modules (./lib/gradle-blocks.ts, siblings), followed transitively.
// ---------------------------------------------------------------------------------------------

/** A source file prepared for the guard search (cached), or null when it does not exist. */
function loadModule(modules, file) {
  if (modules.has(file)) return modules.get(file);
  let mod = null;
  if (file !== null && isFile(file)) {
    const raw = readFileSync(file, 'utf8');
    mod = { file, code: scanSource(raw).code, kept: maskComments(raw), bindings: null };
  }
  modules.set(file, mod);
  return mod;
}

const IMPORT_FROM = /(?:^|[;\n])[ \t]*(import|export)\s+(?!type\b)([^'"`;]*?)\bfrom\s*(['"])(\.{1,2}\/[^'"]+)\3/g;

/**
 * Names a module takes from local modules: Map(local name -> { file, name }), where name is the
 * exported name, 'default', or '*' (a namespace import or export * from). Re-exports count too, so
 * a lib/index.ts that re-exports a helper resolves to the helper.
 */
function bindingsOf(mod) {
  if (mod.bindings !== null) return mod.bindings;
  const bindings = new Map();
  const stars = [];
  for (const match of mod.kept.matchAll(IMPORT_FROM)) {
    const target = probeFile(dirname(mod.file), match[4]);
    if (target === null) continue;
    const clause = match[2].trim();
    const isExport = match[1] === 'export';
    if (isExport && /^\*\s*$/.test(clause)) {
      stars.push(target);
      continue;
    }
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) bindings.set(namespace[1], { file: target, name: '*' });
    const fallback = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (fallback && !isExport) bindings.set(fallback[1], { file: target, name: 'default' });
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(',') : []) {
      const names = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (!names || /^\s*type\s/.test(part)) continue;
      bindings.set(names[2] ?? names[1], { file: target, name: names[1] });
    }
  }
  mod.bindings = bindings;
  mod.stars = stars;
  return bindings;
}

/** The body of the function a local module exports under `name` (following re-exports), or null. */
function exportedBody(modules, file, name, depth = 0) {
  const mod = loadModule(modules, file);
  if (mod === null || depth > 8) return null;
  let local = name;
  if (name === 'default') {
    const decl = /\bexport\s+default\s+(?:async\s+)?(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)/.exec(mod.code);
    if (!decl || decl[1] === 'function') return null;
    local = decl[1];
  }
  const body = functionBody(mod.code, local);
  if (body !== null) return { mod, ...body };
  const binding = bindingsOf(mod).get(local);
  if (binding && binding.name !== '*') return exportedBody(modules, binding.file, binding.name, depth + 1);
  for (const star of mod.stars) {
    const found = exportedBody(modules, star, name, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Whether a text mod call guards its edit: a guard inside the call's own arguments, or inside a
 * function that the call names or calls: declared in this file, or imported from a local module
 * (named, default or namespace import), followed transitively. A guard elsewhere in the file
 * (options validation such as FEATURE_NAME.test(feature)) does not count.
 * Returns { guarded, ranges } (the code regions read, for the dangerous-mod edit analysis).
 */
function guardReached(modules, file, call) {
  const start = loadModule(modules, file);
  const ranges = [{ mod: start, from: call.open, to: call.close }];
  const seen = new Set();
  let guarded = false;
  const add = (found) => {
    if (found === null) return;
    const key = `${found.mod.file}:${found.from}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push(found);
  };
  for (let index = 0; index < ranges.length; index += 1) {
    const { mod, from, to } = ranges[index];
    const text = mod.code.slice(from, to + 1);
    if (EDIT_GUARDS.test(text)) guarded = true;
    for (const [, word] of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)) {
      const body = functionBody(mod.code, word);
      if (body !== null) {
        if (mod !== start || body.to < call.open || body.from > call.close) add({ mod, ...body });
        continue;
      }
      const binding = bindingsOf(mod).get(word);
      if (!binding) continue;
      if (binding.name !== '*') {
        add(exportedBody(modules, binding.file, binding.name));
        continue;
      }
      for (const [, member] of text.matchAll(new RegExp(`(?<![\\w$.])${word.replace(/\$/g, '\\$')}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))) {
        add(exportedBody(modules, binding.file, member));
      }
    }
  }
  return { guarded, ranges };
}

const APPEND_WRITES = /(?<![\w$])(appendFileSync|appendFile)\s*\(|\bflags?\s*:\s*['"]a\+?['"]/;
const READ_CALLS = /(?<![\w$])(readFileSync|readFile)\s*\(/g;
const WRITE_CALLS = /(?<![\w$])(writeFileSync|writeFile)\s*\(/g;

/**
 * How an unguarded dangerous mod edits a file in place, or null when it only writes whole files:
 * an append (appendFileSync, flag 'a'), or a read of a file followed by a write to the same path
 * expression (readFileSync(file) ... writeFileSync(file, ...)).
 */
function unguardedFileEdit(ranges) {
  const reads = new Set();
  const writes = new Set();
  for (const { mod, from, to } of ranges) {
    const text = mod.kept.slice(from, to + 1);
    const append = APPEND_WRITES.exec(text);
    if (append) return append[1] ? `${append[1]} appends` : "a write with flag 'a' appends";
    const firstArg = (match) => (splitArgs(text.slice(match.index + match[0].length))[0] ?? '').replace(/\s+/g, '');
    for (const match of text.matchAll(READ_CALLS)) reads.add(firstArg(match));
    for (const match of text.matchAll(WRITE_CALLS)) writes.add(firstArg(match));
  }
  const same = [...writes].find((path) => path !== '' && reads.has(path));
  return same === undefined ? null : `reads ${same} and writes it back`;
}

/** The index after a type parameter list (<T>, <T,>, <T extends X<Y>>) that starts at `at`, else `at`. */
function skipTypeParams(code, at) {
  if (code[at] !== '<') return at;
  let depth = 0;
  for (let index = at; index < code.length; index += 1) {
    if (code[index] === '<') depth += 1;
    else if (code[index] === '>' && code[index - 1] !== '=') depth -= 1;
    if (depth === 0) return index + 1 + /^\s*/.exec(code.slice(index + 1))[0].length;
  }
  return at;
}

/**
 * Index range [from, to] of the body of a function declared in this file under `name`
 * (function name(...) { }, const name = (...) => ..., const name = function (...) { }), or null.
 */
function functionBody(code, name) {
  const id = name.replace(/\$/g, '\\$');
  const decl = new RegExp(`(?<![\\w$.])(?:function\\s*\\*?\\s*${id}\\s*(?=[(<])|(?:const|let|var)\\s+${id}\\b[^=;]*=(?![=>]))`).exec(code);
  if (!decl) return null;
  let at = skipTypeParams(code, decl.index + decl[0].length);
  const braceBody = (paramsOpen) => {
    const paramsClose = findClosing(code, paramsOpen);
    if (paramsClose === -1) return null;
    const open = code.indexOf('{', paramsClose);
    const close = open === -1 ? -1 : findClosing(code, open);
    return close === -1 ? null : { from: open, to: close };
  };
  if (decl[0].startsWith('function')) return braceBody(at);
  at += /^\s*(?:async\s+)?/.exec(code.slice(at))[0].length;
  const fn = /^function\b\s*\*?\s*[\w$]*\s*(?=[(<])/.exec(code.slice(at));
  if (fn) return braceBody(skipTypeParams(code, at + fn[0].length));
  at = skipTypeParams(code, at);
  let afterParams;
  if (code[at] === '(') {
    const close = findClosing(code, at);
    if (close === -1) return null;
    afterParams = close + 1;
  } else {
    const param = /^[A-Za-z_$][\w$]*/.exec(code.slice(at));
    if (!param) return null;
    afterParams = at + param[0].length;
  }
  const arrow = /^\s*(?::[^;{}=]*)?=>\s*/.exec(code.slice(afterParams));
  if (!arrow) return null;
  const body = afterParams + arrow[0].length;
  if (code[body] === '{' || code[body] === '(') {
    const close = findClosing(code, body);
    return close === -1 ? null : { from: body, to: close };
  }
  let depth = 0;
  for (let index = body; index < code.length; index += 1) {
    const ch = code[index];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (depth < 0 || (depth === 0 && (ch === ';' || ch === '\n'))) return { from: body, to: index };
  }
  return { from: body, to: code.length - 1 };
}

function checkPluginImports(report, rel, raw, sdkMajor) {
  for (const entry of importsOf(scanSource(raw))) {
    if (/^@expo\/(config-plugins|config-types|config|prebuild-config)(\/|$)/.test(entry.spec)) {
      report.problem({ file: rel, line: entry.line, rule: 'plugin-import', message: `imports ${entry.spec}, a package the app does not depend on (it comes through expo and can differ from the copy expo uses)`, fix: `Import from '${sdkMajor !== null && sdkMajor >= 58 ? 'expo/config-plugins' : 'expo/config-plugins.js'}' (types too; mergeContents is CodeGenerator.mergeContents) and ExpoConfig from 'expo/config'.` });
    } else if (entry.spec === 'expo/config-plugins' && sdkMajor !== null && sdkMajor <= 57) {
      report.problem({ file: rel, line: entry.line, rule: 'plugin-import', message: `imports 'expo/config-plugins' on SDK ${sdkMajor}: expo has no exports map there, so Node fails with ERR_MODULE_NOT_FOUND as soon as the file is imported by another module`, fix: "Import from 'expo/config-plugins.js' (type imports too) until the SDK 58 move." });
    } else if (entry.spec === 'expo/config-plugins.js' && sdkMajor !== null && sdkMajor >= 58) {
      report.problem({ file: rel, line: entry.line, rule: 'plugin-import', message: `imports 'expo/config-plugins.js' on SDK ${sdkMajor}: expo's exports map turns it into config-plugins.js.js`, fix: "Import from 'expo/config-plugins' (type imports too)." });
    }
  }
}

function checkDangerous(report, rel, raw, code, kept, atPrebuild) {
  const lines = raw.split('\n');
  const calls = findCalls(code, DANGEROUS_CALLS);
  for (const call of calls) {
    const line = lineAt(code, call.start);
    const window = lines.slice(Math.max(0, line - 4), line).join('\n');
    const reason = /\/\/\s*dangerous-mod:\s*(\S.{7,})/.exec(window);
    if (!reason) {
      report.problem({ file: rel, line, rule: 'dangerous-mod', message: `${code.slice(call.start, call.open).trim()} without a "// dangerous-mod: <reason>" comment above it: dangerous mods run before every typed mod, are skipped by introspection and break silently on template changes`, fix: 'Prefer a typed mod or a config key; if none exists, write // dangerous-mod: <why no typed mod or key works> on the line above, and test the edit against the SDK template.' });
    }
  }
  for (const match of kept.matchAll(FILE_WRITES)) {
    const at = match.index;
    if (atPrebuild(at)) continue;
    report.problem({ file: rel, line: lineAt(kept, at), rule: 'dangerous-mod', message: `${match[1]} outside a dangerous mod: it runs at config evaluation (expo start, expo config, EAS, knip), not at prebuild`, fix: 'Write files only inside withDangerousMod (or a typed mod), which runs during prebuild with modRequest.platformProjectRoot.' });
  }
}

// ---------------------------------------------------------------------------------------------
// Plugin tests and Jest reach
// ---------------------------------------------------------------------------------------------

function checkPluginTests(ctx, { plugins }) {
  const { report, root, appDir } = ctx;
  if (plugins.length === 0) return;
  let selection = null;
  for (const file of plugins) {
    const stem = basename(file, extname(file));
    const test = ['ts', 'tsx', 'mts', 'js', 'mjs'].map((ext) => join(dirname(file), `${stem}.test.${ext}`)).find(isFile);
    if (!test) {
      report.problem({ file: relPath(root, file), line: 1, rule: 'plugin-test', message: `${basename(file)} has no test beside it`, fix: `Add ${stem}.test.ts: run its mods with runMod (test/config-plugins/run-mod.ts) on fixture native files, assert the result, that a second run changes nothing, and that bad options throw.` });
      continue;
    }
    const imported = importsOf(scanSource(readFileSync(test, 'utf8'))).some((entry) => entry.spec.startsWith('.') && probeFile(dirname(test), entry.spec) === file);
    if (!imported) {
      report.problem({ file: relPath(root, test), line: 1, rule: 'plugin-test', message: `the test never imports the plugin ${basename(file)}, so it cannot prove the plugin's edits`, fix: `Import the plugin and its helpers in ${basename(test)} (import withX, { helper } from './${basename(file)}'), run its mods with runMod on fixture native files, and assert the result, a second run that changes nothing, and that bad options throw.` });
    }
    if (selection === null) selection = loadJestSelection(appDir, ctx.manifest);
    if (selection.missing) {
      if (!selection.reported) report.skip({ file: ctx.appRel('jest.config.js'), rule: 'plugin-test', message: notYetCreated(root, { file: ctx.appRel('jest.config.js'), owner: 'unit-and-component-tests' }) ?? 'not yet created (unit-and-component-tests creates it)' });
      selection.reported = true;
      continue;
    }
    if (!selection.ok) {
      if (!selection.reported) report.note(`note: ${selection.file} did not load (${selection.message}); the Jest reach of plugin tests is not checked`);
      selection.reported = true;
      continue;
    }
    const runs = jestRuns(selection, appDir, test);
    if (runs === false) {
      report.problem({ file: relPath(root, test), line: 1, rule: 'plugin-test', message: `Jest never runs ${relPath(root, test)}: no project in ${selection.file} matches ${ctx.pluginsDirRel}/`, fix: `Add '<rootDir>/${ctx.pluginsDirRel}/**/' to the test roots of ${selection.file} (the unit project), then check: npx jest --listTests | grep ${ctx.pluginsDirRel}/` });
    } else if (runs === null && !selection.unknownReported) {
      report.note(`note: ${selection.file} selects tests with patterns this checker cannot read; confirm with npx jest --listTests that ${ctx.pluginsDirRel}/ tests run`);
      selection.unknownReported = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Native folders
// ---------------------------------------------------------------------------------------------

function readIgnore(ctx, name) {
  const path = join(ctx.appDir, name);
  if (!isFile(path)) return null;
  ctx.read += 1;
  return ignoreRules(readFileSync(path, 'utf8'));
}

function checkNativeIgnored(ctx) {
  const rules = readIgnore(ctx, '.gitignore');
  for (const folder of NATIVE) {
    if (rules === null || ignoredBy(rules, folder) === null) {
      ctx.report.problem({ file: ctx.appRel('.gitignore'), line: 1, rule: 'native-ignored', message: `${folder}/ is not git-ignored: prebuild writes it from app.config.ts, so a committed copy goes stale and hides config changes`, fix: `Add the line /${folder} (anchored, as the SDK 57 template writes it) to .gitignore, then git rm -r --cached ${folder} if it was committed.` });
    }
  }
}

function checkNativeTracked(ctx) {
  const result = spawnSync('git', ['ls-files', '-z', '--', ...NATIVE], { cwd: ctx.appDir, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) return;
  const files = result.stdout.split('\0').filter(Boolean);
  if (files.length === 0) return;
  ctx.report.problem({ file: ctx.appRel(files[0]), line: 1, rule: 'native-tracked', message: `git tracks ${files.length} file(s) under ios/ or android/ (first: ${files[0]}): the next prebuild regenerates them and every hand edit there is lost`, fix: 'Move each edit into app.config.ts or a local config plugin, then git rm -r --cached ios android (or record the decision to commit them in contracts/native-generation.json).' });
}

function checkEasignore(ctx) {
  const rules = readIgnore(ctx, '.easignore');
  if (rules === null) return;
  for (const folder of NATIVE) {
    if (ignoredBy(rules, folder) === null) {
      ctx.report.problem({ file: ctx.appRel('.easignore'), line: 1, rule: 'easignore-native', message: `.easignore replaces .gitignore for EAS uploads but does not ignore ${folder}/: a local, stale ${folder}/ is uploaded and EAS Build then skips prebuild`, fix: `Add /${folder} to .easignore (it must repeat every .gitignore line it still needs).` });
    }
  }
}

function checkIgnoreScope(ctx) {
  const rules = readIgnore(ctx, '.gitignore');
  if (rules === null) return;
  const nested = new Set();
  for (const rel of walkRepo(ctx.appDir)) {
    const parts = rel.split('/');
    for (let index = 1; index < parts.length - 1; index += 1) {
      if (NATIVE.includes(parts[index])) nested.add(parts.slice(0, index + 1).join('/'));
    }
  }
  for (const dir of [...nested].sort()) {
    // Inside a folder that is ignored anyway (build output such as dist-audit/_expo/static/js/ios/):
    // nothing there is source, whichever line hides it.
    if (ignoredBy(rules, dir.slice(0, dir.lastIndexOf('/'))) !== null) continue;
    const rule = ignoredBy(rules, dir);
    if (rule) {
      ctx.report.problem({ file: ctx.appRel('.gitignore'), line: rule.line, rule: 'native-ignore-scope', message: `"${rule.text}" also ignores ${dir}/, which is source (a local Expo module's native code, or assets): git never commits it`, fix: `Anchor the native lines at the app root (/ios, /android) so only the generated folders are ignored, then git add ${dir}.` });
    }
  }
  const loose = rules.filter((rule) => !rule.negate && !rule.anchored && NATIVE.some((folder) => rule.re.test(folder)));
  if (loose.length > 0 && nested.size === 0) ctx.report.note(`note: .gitignore line ${loose[0].line} "${loose[0].text}" is not anchored; a future modules/<name>/${NATIVE.find((folder) => loose[0].re.test(folder))}/ would be ignored too (write /ios and /android)`);
}

// ---------------------------------------------------------------------------------------------
// Commands: npm scripts, scripts/ files, CI workflows
// ---------------------------------------------------------------------------------------------

const SCRIPT_FILE = /\.(sh|bash|zsh|ts|mts|cts|js|mjs|cjs|rb|py)$/;
const WORKFLOW_FILE = /\.ya?ml$/;

/** Every command-bearing line: [{ file, line, text, kind: 'shell' | 'code' | 'write' | 'exec' }]. */
function collectCommands(ctx) {
  const { appDir, root, layout, manifest, manifestText } = ctx;
  const out = [];
  for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
    out.push({ file: ctx.appRel('package.json'), line: lineOfText(manifestText, `"${name}"`), text: String(value), kind: 'shell' });
  }
  out.push(...easPrebuildCommands(ctx));
  const folders = [
    { dir: join(root, layout.scriptsDir), include: SCRIPT_FILE },
    ...(appDir === root ? [] : [{ dir: join(appDir, 'scripts'), include: SCRIPT_FILE }]),
    { dir: join(root, '.github', 'workflows'), include: WORKFLOW_FILE },
    { dir: join(root, '.eas'), include: WORKFLOW_FILE },
  ];
  for (const { dir, include } of folders) {
    if (!isDir(dir)) continue;
    for (const rel of walk(dir, { pruneDirsContaining: ['SKILL.md'] })) {
      if (!include.test(rel) || TEST.test(rel)) continue;
      const abs = join(dir, rel);
      const fileRel = relPath(root, abs);
      ctx.read += 1;
      const raw = readFileSync(abs, 'utf8');
      const code = /\.(ts|mts|cts|js|mjs|cjs)$/.test(rel);
      const text = code ? maskComments(raw) : raw.split('\n').map((line) => line.replace(/(^|\s)#.*$/, '')).join('\n');
      text.split('\n').forEach((lineText, index) => {
        if (lineText.trim() !== '') out.push({ file: fileRel, line: index + 1, text: lineText, kind: code ? 'code' : 'shell' });
      });
      if (code) out.push(...codeWrites(fileRel, text), ...execCommands(fileRel, raw));
    }
  }
  return out;
}

/**
 * eas.json build profiles that override the prebuild EAS Build runs (build.<profile>.prebuildCommand,
 * for example "prebuild --template ./template.tgz"; EAS adds --platform and --non-interactive).
 */
function easPrebuildCommands(ctx) {
  const path = join(ctx.appDir, 'eas.json');
  if (!isFile(path)) return [];
  ctx.read += 1;
  const text = readFileSync(path, 'utf8');
  let eas;
  try {
    eas = parseJsonc(text);
  } catch (error) {
    ctx.report.note(`note: ${ctx.appRel('eas.json')} did not parse (${String(error.message).split('\n')[0]}); its prebuildCommand overrides are not checked`);
    return [];
  }
  const out = [];
  for (const [profile, settings] of Object.entries(eas?.build ?? {})) {
    if (settings === null || typeof settings !== 'object' || typeof settings.prebuildCommand !== 'string') continue;
    const at = text.indexOf(`"${profile}"`);
    const key = text.indexOf('"prebuildCommand"', Math.max(0, at));
    out.push({ file: ctx.appRel('eas.json'), line: key === -1 ? 1 : lineAt(text, key), text: settings.prebuildCommand, kind: 'eas-prebuild', profile });
  }
  return out;
}

const NATIVE_PATH = /(?:^|[\s'"`=(:,;&|])(?:\.\/)?(ios|android)\/[^\s'"`;|&)]*/;
// Commands that edit a file named anywhere on the line: in-place editors, plist writers, the
// xcodeproj gem. Each counts only when the line also names a path under ios/ or android/.
const IN_PLACE = /\bsed\b[^|;&]*\s-(?:[a-zA-Z]*i\b|-in-place)|\bperl\b[^|;&]*\s-[a-zA-Z]*i|PlistBuddy\b[^|;&]*?\s-c\s*['"]?\s*(?:[sS]et|[aA]dd|[dD]elete|[mM]erge|[iI]mport|[cC]lear|[cC]opy)\b|\bplutil\s+-(?:replace|insert|remove|convert)\b|Xcodeproj::(?:Project|Workspace)\b/;
// Commands that write only to their own arguments: they count when one of those is a native path
// (tee build/x.log, patch from patches/ and git apply stay reads of the native folders).
const TARGETED = /\b(tee|patch|git\s+apply)\b([^|;&<>]*)/g;
const NATIVE_ARG = /^['"]?(?:--directory=|-d)?['"]?(?:\.\/)?(ios|android)(\/|['"]?$)/;
const COPY_COMMAND = /\b(cp|mv|rsync|install|ln)\s+[^;&|]*/g;
const REDIRECT_INTO = /(?:^|[^<>&0-9])>>?\s*['"]?(?:\.\/)?(?:ios|android)\//;

/** A shell line that writes into a generated native folder, or null. */
function shellWrite(text) {
  if (IN_PLACE.test(text) && NATIVE_PATH.test(text)) return text.match(IN_PLACE)[0].replace(/\s.*$/s, '');
  if (REDIRECT_INTO.test(text)) return 'a redirect';
  for (const match of text.matchAll(TARGETED)) {
    const words = match[2].trim().split(/\s+/).filter(Boolean);
    const native = words.some((word, index) => NATIVE_ARG.test(word) || (/^(-d|--directory)$/.test(words[index - 1] ?? '') && /^['"]?(?:\.\/)?(ios|android)\b/.test(word)));
    if (native) return match[1].replace(/\s+/g, ' ');
  }
  for (const match of text.matchAll(COPY_COMMAND)) {
    const words = match[0].trim().split(/\s+/).filter((word) => !word.startsWith('-'));
    const target = words.at(-1)?.replace(/^['"]|['"]$/g, '') ?? '';
    if (words.length >= 3 && /^(?:\.\/)?(ios|android)(\/|$)/.test(target)) return match[1];
  }
  return null;
}

const CODE_WRITES = /(?<![\w$])(writeFileSync|appendFileSync|writeFile|appendFile|outputFile|copyFileSync|copyFile|cpSync|renameSync|rename|symlinkSync|linkSync)\s*\(/g;
const DESTINATION_SECOND = new Set(['copyFileSync', 'copyFile', 'cpSync', 'renameSync', 'rename', 'symlinkSync', 'linkSync']);

function splitArgs(text) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if ('([{'.includes(ch)) {
      depth += 1;
    } else if (')]}'.includes(ch)) {
      if (depth === 0) {
        args.push(text.slice(start, i));
        return args;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  args.push(text.slice(start));
  return args;
}

/** fs writes in scripts whose destination is inside ios/ or android/. */
function codeWrites(fileRel, text) {
  const out = [];
  for (const match of text.matchAll(CODE_WRITES)) {
    const args = splitArgs(text.slice(match.index + match[0].length));
    const destination = args[DESTINATION_SECOND.has(match[1]) ? 1 : 0] ?? '';
    if (/['"`](?:\.\/)?(ios|android)(\/|['"`])/.test(destination)) {
      out.push({ file: fileRel, line: lineAt(text, match.index), text: `${match[1]}(${destination.trim()})`, kind: 'write' });
    }
  }
  return out;
}

const EXEC_CALLS = '(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)';
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** The literal text of one call argument: a string, or the strings of an array literal, joined. */
function literalWords(arg) {
  const trimmed = arg.trim();
  if (!/^[[`'"]/.test(trimmed)) return null;
  return [...trimmed.matchAll(LITERAL)].map((match) => match[2]).join(' ');
}

/**
 * child_process calls in a Node script, as the shell line they run:
 * execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set ...', 'ios/App/Info.plist']) reads as
 * "/usr/libexec/PlistBuddy -c Set ... ios/App/Info.plist". Only literal parts are seen.
 */
function execCommands(fileRel, raw) {
  const masked = scanSource(raw).code;
  const out = [];
  for (const call of findCalls(masked, EXEC_CALLS)) {
    const args = splitArgs(raw.slice(call.open + 1, call.close + 1));
    const parts = args.slice(0, 2).map(literalWords).filter((part) => part !== null);
    if (parts.length === 0) continue;
    out.push({ file: fileRel, line: lineAt(raw, call.start), text: parts.join(' '), kind: 'exec' });
  }
  return out;
}

function checkNativeEdit(ctx, commands) {
  for (const command of commands) {
    const how = command.kind === 'write' ? command.text : command.kind === 'shell' || command.kind === 'exec' ? shellWrite(command.text) : null;
    if (how === null) continue;
    ctx.report.problem({ file: command.file, line: command.line, rule: 'native-edit', message: `writes into a generated native folder (${how}): the next prebuild throws the edit away, and builds differ by machine`, fix: 'Make the change in app.config.ts or a local config plugin (plugins/with-<capability>.ts); scripts may read ios/ and android/, never write them.' });
  }
}

const PREBUILD = /\bexpo\b['"`]?\s*,?\s*['"`]?prebuild\b/;

/** A command that runs prebuild: a shell or code line naming expo prebuild, or an eas.json prebuildCommand. */
function runsPrebuild(command) {
  if (command.kind === 'eas-prebuild') return true;
  return (command.kind === 'shell' || command.kind === 'code') && PREBUILD.test(command.text);
}

function checkPrebuildClean(ctx, commands) {
  for (const command of commands) {
    if (!runsPrebuild(command) || !/--no-clean\b/.test(command.text)) continue;
    const where = command.kind === 'eas-prebuild' ? `build.${command.profile}.prebuildCommand runs "${command.text}" on EAS Build` : 'runs npx expo prebuild --no-clean';
    ctx.report.problem({ file: command.file, line: command.line, rule: 'prebuild-clean', message: `${where}: it layers today's config onto yesterday's folders, so the result depends on what ran before`, fix: command.kind === 'eas-prebuild' ? 'Drop --no-clean from the prebuildCommand (or the whole override when it only repeats the default).' : 'Run npx expo prebuild --clean (the SDK 57 default) in scripts and CI; keep --no-clean for a quick local look only.' });
  }
}

// ---------------------------------------------------------------------------------------------
// The contract and committed mode
// ---------------------------------------------------------------------------------------------

function readContract(ctx) {
  const rel = relPath(ctx.root, join(ctx.root, ctx.layout.contractsDir, CONTRACT_FILE));
  const path = join(ctx.root, rel);
  if (!isFile(path)) return { mode: 'generated', rel, exists: false };
  ctx.read += 1;
  const data = readJsonFile(path, rel);
  const text = readFileSync(path, 'utf8');
  const problem = (message, needle) => ctx.report.problem({ file: rel, line: lineOfText(text, needle), rule: 'native-mode', message, fix: 'Set "mode" to "generated" (the default), or to "committed" with a "reason" and the "decidedOn" date (YYYY-MM-DD).' });
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    problem('the contract is not a JSON object', '{');
    return { mode: 'generated', rel, exists: true };
  }
  if (data.mode !== 'generated' && data.mode !== 'committed') {
    problem(`"mode" is ${JSON.stringify(data.mode)}; it is "generated" or "committed"`, '"mode"');
    return { mode: 'generated', rel, exists: true };
  }
  if (data.mode === 'committed') {
    if (typeof data.reason !== 'string' || data.reason.trim().length < 20) problem('"committed" mode without a "reason" (one sentence: what no config plugin can do)', '"mode"');
    if (typeof data.decidedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.decidedOn)) problem('"committed" mode without "decidedOn" (YYYY-MM-DD)', '"mode"');
  }
  return { mode: data.mode, rel, exists: true, text };
}

const PREBUILD_ONLY_KEYS = [['plugins'], ['ios', 'infoPlist'], ['ios', 'entitlements'], ['ios', 'privacyManifests'], ['android', 'permissions'], ['android', 'blockedPermissions'], ['android', 'intentFilters'], ['locales']];

function checkCommitted(ctx, contract, commands, evaluations) {
  const { report, appDir } = ctx;
  const rules = readIgnore(ctx, '.gitignore');
  for (const folder of NATIVE) {
    if (!isDir(join(appDir, folder))) {
      report.problem({ file: contract.rel, line: lineOfText(contract.text, '"mode"'), rule: 'native-mode', message: `"committed" mode, but ${folder}/ does not exist`, fix: `Generate it once (npx expo prebuild --clean --platform ${folder}) and commit it, or set "mode": "generated".` });
    } else if (rules !== null && ignoredBy(rules, folder) !== null) {
      report.problem({ file: ctx.appRel('.gitignore'), line: ignoredBy(rules, folder).line, rule: 'native-mode', message: `"committed" mode, but .gitignore ignores ${folder}/`, fix: `Remove the ${folder} line from .gitignore and commit the folder.` });
    }
  }
  for (const command of commands) {
    if (!runsPrebuild(command)) continue;
    if (command.kind === 'eas-prebuild') {
      report.problem({ file: command.file, line: command.line, rule: 'native-mode', message: `build.${command.profile}.prebuildCommand is set, but EAS Build skips prebuild when ios/ and android/ are committed: the override never runs and misleads the reader`, fix: `Remove prebuildCommand from the ${command.profile} profile; in committed mode native changes are made in ios/ and android/ by hand.` });
      continue;
    }
    report.problem({ file: command.file, line: command.line, rule: 'native-mode', message: 'runs npx expo prebuild although the native folders are committed: it overwrites every hand edit (the SDK 57 default deletes the folders first)', fix: 'Remove the prebuild step; in committed mode native changes are made in ios/ and android/ by hand and reviewed as code.' });
  }
  const present = PREBUILD_ONLY_KEYS.filter((path) => evaluations.some(({ config }) => {
    const value = path.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), config);
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  }));
  if (present.length > 0) report.note(`note: committed mode: ${present.map((path) => path.join('.')).join(', ')} reach ios/ and android/ only through prebuild; mirror each change by hand (npx expo-doctor warns about the same)`);
}

// Started last, so every module-level constant above is initialized before main reads it.
run(main);
