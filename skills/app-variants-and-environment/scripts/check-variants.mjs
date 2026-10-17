// check-variants.mjs: proves that the app config builds three distinct, safe variants.
// It evaluates app.config.ts the way Expo does (Node with type stripping, the default export called
// with a config context) once per variant and once per broken environment that must fail, then
// checks ids, names, icons, schemes, the eas.json build profiles, secrets reaching the embedded
// config, and the Metro cache key. Zero dependencies (node: built-ins and check-lib only).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createReporter, makeTempDir, maskComments, notYetCreated, parseArgs, removeTempDir, requireDir, run, sha256, toPosix, UsageError } from './check-lib.mjs';
import {
  committedDotenv, CONFIG_FILES, envFilesIn, envNamesIn, findFirst, findSecretValues, isFile, isSecretName, lineAt,
  localImportClosure, METRO_FILES, parseDotenv, PUBLIC_PREFIX, readEasJson, resolveAppDir, resolveProfile, VARIANT_ENV, VARIANTS,
} from './lib/env-scan.mjs';

const SPEC = {
  name: 'check-variants',
  summary: 'Evaluates the app config for development, preview and production (and for the broken environments that must fail) and checks the ids, names, icons and URL schemes of each variant, the eas.json build profiles, secrets reaching the embedded config, and the Metro cache key.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'Folder that holds app.config.ts, eas.json and metro.config.js, relative to the repo root (default: the root, or the one workspace with an app config)' },
    config: { type: 'string', value: 'file', help: 'The app config, relative to the app folder (default: the first of app.config.ts, .mts, .js, .mjs, .cjs)' },
    eas: { type: 'string', value: 'file', help: 'The EAS config, relative to the app folder (default: eas.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  variant-config   one dynamic app config (no app.json beside it) that evaluates for every variant; every',
    '                   plugin package it names is a dependency (else expo config and prebuild cannot resolve it)',
    '  variant-resolve  an unknown APP_VARIANT, APP_VARIANT without EXPO_PUBLIC_APP_VARIANT, and an unset',
    '                   variant in a production bundle or on EAS all fail; unset locally means development',
    '                   (with the committed env files loaded the way Expo CLI loads them)',
    '  variant-id       each variant has its own valid iOS bundle id and Android package; development and',
    '                   preview extend the production id by one segment',
    '  variant-name     three distinct names; the production name carries no (Dev)/(Preview) marker',
    '  variant-icon     every icon file the config names exists (else prebuild and EAS Build stop with ENOENT);',
    '                   development and preview icons differ from production on iOS and Android',
    '  variant-scheme   URL schemes never shared between variants; the dev client scheme only in development',
    '  eas-profile      every build profile sets APP_VARIANT = EXPO_PUBLIC_APP_VARIANT = environment; a shared',
    '                   base profile (extended by others, not a variant name) sets none that a child contradicts;',
    '                   no profile pins a Node older than 22.18 (Metro and the config load .ts files)',
    '  secret-config    no secret-named variable, extra key or secret value in the embedded config',
    '  metro-cache-key  metro.config.js keys cacheVersion on the EXPO_PUBLIC_* values: loaded with',
    '                   expo/metro-config stubbed, cacheVersion must change with an EXPO_PUBLIC_ probe value',
    '                   and differ per variant (a static check when the file cannot be loaded)',
    'SKIP line: a missing eas.json (eas-build-and-submit creates it; this skill merges its variant profiles into it).',
    'A note (not a problem) when submit.production pins no ios.ascAppId/bundleIdentifier or android.applicationId.',
    'NOT APPLICABLE when package.json has no expo.',
    'Bad input (exit 2) includes: no app config, an imported package not installed, Node older than 22.18.',
  ].join('\n'),
};

// The keys Expo leaves out of the public config; everything else is embedded in the app.
const PRIVATE_PATHS = [['_internal'], ['hooks'], ['ios', 'config'], ['android', 'config'], ['updates', 'codeSigningCertificate'], ['updates', 'codeSigningMetadata']];
const STRIPPED_ENV = new Set(['APP_VARIANT', 'EXPO_PUBLIC_APP_VARIANT', 'NODE_ENV', 'CI', 'EAS_BUILD', 'EAS_BUILD_PROFILE']);
const IOS_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// Expo's own validators (@expo/cli 57.0.27 src/utils/validateApplicationId.js): segments start with a
// letter, at least two segments, and no segment may be a Java keyword or literal.
const ANDROID_ID = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const JAVA_RESERVED = new Set([
  '_', 'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
  'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'strictfp',
]);
const PROBES = [
  { env: { APP_VARIANT: 'staging', EXPO_PUBLIC_APP_VARIANT: 'staging' }, what: 'APP_VARIANT=staging (an unknown name)', why: 'an unknown variant must fail instead of building something', fix: 'Resolve the variant with resolveAppVariant() from src/config/app-variant.ts (parseAppVariant throws on any other name).' },
  { env: { APP_VARIANT: 'production' }, what: 'APP_VARIANT=production without EXPO_PUBLIC_APP_VARIANT', why: 'the JS bundle would believe it is a development build and keep test-only code', fix: 'Throw when APP_VARIANT and EXPO_PUBLIC_APP_VARIANT differ (resolveAppVariant does).' },
  { env: { NODE_ENV: 'production' }, what: 'no variant in a production bundle (NODE_ENV=production: expo export, eas update)', why: 'an update or export without a variant would ship a development build to users', fix: 'Throw when both variables are unset and NODE_ENV is production (resolveAppVariant does).' },
  { env: { EAS_BUILD: 'true' }, what: 'no variant on an EAS Build worker (EAS_BUILD=true)', why: 'a profile that forgot its env would build a development app', fix: 'Throw when both variables are unset and EAS_BUILD is true (resolveAppVariant does).' },
];
const EVAL_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  'const [file, root] = process.argv.slice(1);',
  'const out = (value) => process.stdout.write(JSON.stringify(value));',
  'try {',
  '  const mod = await import(pathToFileURL(file).href);',
  '  let exported = mod.default ?? mod;',
  "  if (exported && typeof exported === 'object' && typeof exported.default === 'function') exported = exported.default;",
  "  const context = { projectRoot: root, staticConfigPath: null, packageJsonPath: root + '/package.json', config: {} };",
  "  let result = typeof exported === 'function' ? await exported(context) : exported;",
  "  if (result && typeof result === 'object' && result.expo && typeof result.expo === 'object') result = result.expo;",
  '  out({ ok: true, config: result ?? null });',
  '} catch (error) {',
  '  out({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) });',
  '}',
].join('\n');
// Loads metro.config.* the way Metro does (require/import) with expo/metro-config replaced by a stub, so
// the check needs no install and runs no bundler code; prints the resulting cacheVersion.
const METRO_EVAL_SOURCE = [
  "import { registerHooks } from 'node:module';",
  "import { pathToFileURL } from 'node:url';",
  'const [file, stub] = process.argv.slice(1);',
  "const STUBBED = new Set(['expo/metro-config', '@expo/metro-config']);",
  "registerHooks({ resolve: (specifier, context, next) => (STUBBED.has(specifier) ? { url: pathToFileURL(stub).href, format: 'commonjs', shortCircuit: true } : next(specifier, context)) });",
  'const out = (value) => process.stdout.write(JSON.stringify(value));',
  'try {',
  '  const mod = await import(pathToFileURL(file).href);',
  '  let config = mod.default ?? mod;',
  "  if (typeof config === 'function') config = await config({});",
  '  config = await config;',
  "  const value = config && typeof config === 'object' ? config.cacheVersion : undefined;",
  '  out({ ok: true, set: value !== undefined, type: typeof value, cacheVersion: value === undefined ? null : value });',
  '} catch (error) {',
  '  out({ ok: false, message: String(error?.message ?? error) });',
  '}',
].join('\n');
// Expo's getDefaultConfig sets no cacheVersion (@expo/metro-config 57.0.12), and neither does the stub.
const METRO_STUB = [
  "'use strict';",
  "const getDefaultConfig = (projectRoot) => ({ projectRoot, watchFolders: [], resolver: { sourceExts: ['ts', 'tsx', 'js', 'jsx', 'json', 'cjs', 'mjs'], assetExts: ['png', 'jpg', 'ttf'] }, transformer: {}, serializer: {}, server: {} });",
  'module.exports = { getDefaultConfig };',
  '',
].join('\n');
const METRO_PROBE = 'EXPO_PUBLIC_RNSKILLS_PROBE';
// Node loads .ts files with type stripping by default from 22.18 (the house floor).
const NODE_FLOOR = Object.freeze({ major: 22, minor: 18 });
/** Where a config names icon files: the fallback, iOS, and Android (legacy and adaptive layers). */
const ICON_KEYS = Object.freeze([
  ['icon'], ['ios', 'icon'], ['android', 'icon'],
  ['android', 'adaptiveIcon', 'foregroundImage'], ['android', 'adaptiveIcon', 'backgroundImage'], ['android', 'adaptiveIcon', 'monochromeImage'],
]);

// How Expo finds a local plugin file named in the config.
const LOCAL_PLUGIN_PROBES = ['', '.js', '.cjs', '.mjs', '.ts', '/index.js', '/app.plugin.js'];

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const appDir = requireDir(resolve(root, resolveAppDir(root, options['app-dir'])), 'app folder');
  const appRel = (name) => toPosix(relative(root, join(appDir, name)));
  const report = createReporter({ name: 'check-variants', json: options.json });

  const notApplicable = expoMissing(appDir, root);
  if (notApplicable) return report.notApplicable(notApplicable);

  const configName = options.config ?? findFirst(appDir, CONFIG_FILES);
  const hasAppJson = isFile(join(appDir, 'app.json'));
  if (configName === null || !isFile(join(appDir, configName))) {
    if (options.config) throw new UsageError(`nothing to check: ${appRel(options.config)} does not exist`, 'Pass the app config with --config <file> (relative to the app folder).');
    if (!hasAppJson) throw new UsageError(`nothing to check: no app config (${CONFIG_FILES.join(', ')} or app.json) in ${appRel('.') || '.'}`, 'Run from the app root, or pass the repo root and --app-dir <dir>.');
    report.problem({ file: appRel('app.json'), line: 1, rule: 'variant-config', message: 'a static app.json cannot vary by APP_VARIANT: every variant would share one id, name and icon', fix: 'Replace app.json with app.config.ts (copy templates/app.config.ts) and delete app.json.' });
    return report.finish({ checked: 1, unit: 'app configs' });
  }
  const configRel = appRel(configName);
  const configPath = join(appDir, configName);
  // Line lookups run on the source with comments blanked (same line numbers).
  const configText = maskComments(readFileSync(configPath, 'utf8'));
  if (/\.m?ts$/.test(configName) && !process.features?.typescript) {
    throw new UsageError(`Node ${process.versions.node} cannot load ${configRel}: TypeScript type stripping needs Node 22.18 or newer`, 'Run the checker with Node 22.18+ (the app pins Node 26).');
  }
  if (hasAppJson) {
    report.problem({ file: appRel('app.json'), line: 1, rule: 'variant-config', message: `app.json sits beside ${configName}: Expo passes it in as the config context, so its values leak into every variant`, fix: `Move its values into ${configName} and delete app.json (one app config).` });
  }

  const evaluate = (env) => evaluateConfig(configPath, appDir, env);
  const configs = {};
  for (const variant of VARIANTS) {
    const result = evaluate({ APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant });
    if (result.ok && isObject(result.config)) {
      configs[variant] = result.config;
    } else if (result.ok) {
      report.problem({ file: configRel, line: 1, rule: 'variant-config', message: `${configName} returned no config object for APP_VARIANT=${variant}`, fix: 'Return the ExpoConfig object from the default export.' });
    } else {
      report.problem({ file: configRel, line: 1, rule: 'variant-config', message: `${configName} fails for APP_VARIANT=${variant}: ${firstLine(result.message)}`, fix: 'Make the config evaluate for development, preview and production (run: APP_VARIANT=<v> EXPO_PUBLIC_APP_VARIANT=<v> npx expo config).' });
    }
  }

  checkResolve({ report, evaluate, configs, configRel, configText, root, appDir });
  checkPlugins({ report, configs, configRel, configText, root, appDir });
  if (VARIANTS.every((variant) => configs[variant])) {
    checkIds({ report, configs, configRel, configText });
    checkNames({ report, configs, configRel, configText });
    checkIcons({ report, configs, configRel, configText, root, appDir });
    checkSchemes({ report, configs, configRel, configText });
  }
  const easRel = appRel(options.eas ?? 'eas.json');
  const eas = readEasJson(join(appDir, options.eas ?? 'eas.json'), easRel);
  if (eas === null) {
    report.skip({ file: easRel, rule: 'eas-profile', message: notYetCreated(root, { file: easRel, owner: 'eas-build-and-submit' }) ?? 'not yet created (eas-build-and-submit creates it)' });
  } else {
    checkEasProfiles({ report, eas, easRel });
    noteSubmitPins({ report, eas, easRel });
  }
  if (configs.production) checkSecrets({ report, evaluate, production: configs.production, configName, configRel, configText, appDir, eas });
  checkMetro({ report, appDir, appRel });
  return report.finish({ checked: VARIANTS.length + PROBES.length + 1, unit: 'config evaluations' });
});

/** NOT APPLICABLE when a package.json exists and lists no expo dependency. */
function expoMissing(appDir, root) {
  for (const dir of [appDir, root]) {
    const path = join(dir, 'package.json');
    if (!isFile(path)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new UsageError(`${toPosix(relative(root, path)) || 'package.json'} is not valid JSON: ${error.message}`, 'Fix package.json.');
    }
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    if (deps.expo) return null;
    if (dir === appDir) return `expo is not in ${toPosix(relative(root, path)) || 'package.json'} dependencies (not an Expo app)`;
  }
  return null;
}

/** Evaluates the config in a child Node process with a clean variant environment plus `extra`. */
function evaluateConfig(configPath, appDir, extra) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!STRIPPED_ENV.has(name) && value !== undefined) env[name] = value;
  Object.assign(env, extra);
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', EVAL_SOURCE, '--', configPath, appDir], {
    cwd: appDir, env, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(child.stdout || 'null');
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    const reason = child.error ? child.error.message : (child.stderr || '').trim().split('\n').slice(0, 3).join(' ');
    return { ok: false, code: null, message: `the config process ended without a result: ${reason || `exit ${child.status}`}` };
  }
  if (!parsed.ok && parsed.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package/.test(parsed.message)) {
    throw new UsageError(`the app config imports a package that is not installed: ${firstLine(parsed.message)}`, 'Install the dependencies (npm ci), then rerun.');
  }
  return parsed;
}

function checkResolve({ report, evaluate, configs, configRel, configText, root, appDir }) {
  const line = lineAt(configText, /resolveAppVariant\(|process\.env/);
  for (const probe of PROBES) {
    const result = evaluate(probe.env);
    if (result.ok) report.problem({ file: configRel, line, rule: 'variant-resolve', message: `the config evaluates with ${probe.what}: ${probe.why}`, fix: probe.fix });
  }
  // Locally nothing is exported, but Expo CLI loads the env files (start, export, prebuild, config):
  // a committed .env that names a variant decides it for every developer.
  const dotenv = committedDotenv(root, appDir, 'development');
  const loaded = Object.fromEntries(Object.entries(dotenv.values).filter(([name]) => !STRIPPED_ENV.has(name) || VARIANT_ENV.includes(name)));
  const local = evaluate(loaded);
  const development = configs.development;
  if (local.ok && isObject(local.config) && development && identityOf(local.config) !== identityOf(development)) {
    const files = [...new Set(VARIANT_ENV.map((name) => dotenv.from[name]).filter(Boolean))];
    if (files.length > 0) {
      report.problem({ file: configRel, line, rule: 'variant-resolve', message: `with no variant exported locally the config builds ${identityOf(local.config)}, not the development variant: ${files.join(', ')} sets the variant, and Expo CLI loads it for start, export and prebuild`, fix: `Remove APP_VARIANT and EXPO_PUBLIC_APP_VARIANT from ${files.join(', ')}: the variant comes from the command, the eas.json profile or the EAS environment, never from a committed file.` });
    } else {
      report.problem({ file: configRel, line, rule: 'variant-resolve', message: `with no variant set locally the config builds ${identityOf(local.config)}, not the development variant`, fix: 'An unset variant means development on a developer machine (or throws); it never builds preview or production.' });
    }
  }
}

function identityOf(config) {
  return `${config?.ios?.bundleIdentifier ?? '?'} / ${config?.android?.package ?? '?'} / ${config?.name ?? '?'}`;
}

function checkIds({ report, configs, configRel, configText }) {
  const platforms = [
    { key: ['ios', 'bundleIdentifier'], label: 'iOS bundle identifier', re: IOS_ID, rule: 'letters, digits, hyphens and dots' },
    { key: ['android', 'package'], label: 'Android package', re: ANDROID_ID, rule: 'at least two dot-separated segments of letters, digits and underscores, each starting with a letter', reserved: true },
  ];
  for (const platform of platforms) {
    const line = lineAt(configText, platform.key[1]);
    const ids = Object.fromEntries(VARIANTS.map((variant) => [variant, configs[variant]?.[platform.key[0]]?.[platform.key[1]]]));
    const where = `${platform.key.join('.')}`;
    let valid = true;
    for (const variant of VARIANTS) {
      const id = ids[variant];
      if (typeof id !== 'string' || id === '') {
        valid = false;
        report.problem({ file: configRel, line, rule: 'variant-id', message: `${where} is missing for ${variant}`, fix: `Set ${where} for every variant (variantIdentity(BASE, variant).appId).` });
      } else if (!platform.re.test(id)) {
        valid = false;
        report.problem({ file: configRel, line, rule: 'variant-id', message: `${where} "${id}" (${variant}) is not a valid ${platform.label}`, fix: `Use ${platform.rule}; one id valid on both platforms avoids this (com.example.tasks).` });
      } else if (platform.reserved && id.split('.').some((segment) => JAVA_RESERVED.has(segment))) {
        valid = false;
        const segment = id.split('.').find((part) => JAVA_RESERVED.has(part));
        report.problem({ file: configRel, line, rule: 'variant-id', message: `${where} "${id}" (${variant}) is not a valid ${platform.label}: "${segment}" is a reserved Java keyword (Expo and Gradle reject it)`, fix: 'Rename that segment (com.example.tasks, not com.example.new); the package is a Java package name.' });
      }
    }
    if (!valid) continue;
    const production = ids.production;
    for (const variant of ['development', 'preview']) {
      const id = ids[variant];
      if (id === production) {
        report.problem({ file: configRel, line, rule: 'variant-id', message: `${variant} uses the production ${platform.label} "${id}": installing it replaces the store app and shares its data`, fix: `Give ${variant} its own id: ${production}.${variant === 'development' ? 'dev' : 'preview'} (variantIdentity does).` });
      } else if (!id.startsWith(`${production}.`) || id.slice(production.length + 1).includes('.')) {
        report.problem({ file: configRel, line, rule: 'variant-id', message: `${variant} ${platform.label} "${id}" does not extend the production id "${production}" by one segment`, fix: `Use ${production}.${variant === 'development' ? 'dev' : 'preview'}, so every variant is recognisably the same app.` });
      }
    }
    if (ids.development === ids.preview && ids.development !== production) {
      report.problem({ file: configRel, line, rule: 'variant-id', message: `development and preview share the ${platform.label} "${ids.development}"`, fix: 'Give each variant its own suffix (.dev, .preview).' });
    }
  }
}

function checkNames({ report, configs, configRel, configText }) {
  const line = lineAt(configText, /\bname\b/);
  const names = VARIANTS.map((variant) => configs[variant]?.name);
  VARIANTS.forEach((variant, index) => {
    if (typeof names[index] !== 'string' || names[index].trim() === '') {
      report.problem({ file: configRel, line, rule: 'variant-name', message: `name is missing for ${variant}`, fix: 'Set name for every variant (variantIdentity(BASE, variant).name).' });
    }
  });
  if (names.some((name) => typeof name !== 'string')) return;
  for (const [first, second] of [['development', 'production'], ['preview', 'production'], ['development', 'preview']]) {
    if (configs[first].name === configs[second].name) {
      report.problem({ file: configRel, line, rule: 'variant-name', message: `${first} and ${second} are both named "${configs[first].name}": on a tester's home screen nobody can tell them apart`, fix: 'Mark the testing variants: "Tasks (Dev)", "Tasks (Preview)" (variantIdentity does).' });
    }
  }
  if (/\((?:dev|development|preview|staging|test)\)/i.test(configs.production.name)) {
    report.problem({ file: configRel, line, rule: 'variant-name', message: `the production name "${configs.production.name}" carries a testing marker`, fix: 'The production name is the store name; only development and preview carry (Dev)/(Preview).' });
  }
}

function iconOf(config, platform) {
  if (platform === 'ios') return config?.ios?.icon ?? config?.icon ?? null;
  const adaptive = config?.android?.adaptiveIcon;
  if (isObject(adaptive) && (adaptive.foregroundImage || adaptive.backgroundImage || adaptive.monochromeImage)) {
    const { foregroundImage, backgroundImage, monochromeImage, backgroundColor } = adaptive;
    return { foregroundImage, backgroundImage, monochromeImage, backgroundColor };
  }
  return config?.android?.icon ?? config?.icon ?? null;
}

function localPaths(value) {
  const out = [];
  const visit = (node) => {
    if (typeof node === 'string') {
      if (!node.includes('://') && /\.(png|jpe?g|webp|icon|svg)$/i.test(node)) out.push(node);
    } else if (isObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return out;
}

function contentDigest(value, appDir) {
  const swap = (node) => {
    if (typeof node === 'string' && localPaths(node).length === 1) return `sha256:${hashPath(join(appDir, node))}`;
    if (isObject(node)) return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined).map(([k, v]) => [k, swap(v)]));
    return node;
  };
  return JSON.stringify(swap(value));
}

function hashPath(path) {
  const stat = statSync(path);
  if (stat.isFile()) return sha256(readFileSync(path));
  const parts = readdirSync(path).sort().map((name) => `${name}:${hashPath(join(path, name))}`);
  return sha256(parts.join('\n'));
}

/**
 * Every icon file each variant names must exist: Expo's icon plugins read them during prebuild (and
 * so during every EAS Build), and a missing one stops it with ENOENT. Returns the missing paths.
 */
function checkIconFiles({ report, configs, root, appDir }) {
  const missing = new Set();
  for (const variant of ['production', 'development', 'preview']) {
    for (const key of ICON_KEYS) {
      const value = key.reduce((node, part) => (isObject(node) ? node[part] : undefined), configs[variant]);
      for (const path of localPaths(value)) {
        if (existsPath(join(appDir, path)) || missing.has(path)) continue;
        missing.add(path);
        const rel = toPosix(relative(root, join(appDir, path)));
        const fix = variant === 'production'
          ? 'Move the app\'s store icon files into assets/icons/production/ (the paths templates/app.config.ts names: icon.png, the .icon folder, the three android-*.png layers), or point iconsFor() at where they are.'
          : 'Draw the badged copies: make-variant-icons.mjs in this skill\'s scripts/ folder writes the development and preview icons from assets/icons/production/ (icons-app-icon-and-splash may redraw them at the same paths).';
        report.problem({ file: rel, line: 0, rule: 'variant-icon', message: `${key.join('.')} of the ${variant} variant names ${rel}, which does not exist: npx expo prebuild and EAS Build stop with ENOENT`, fix });
      }
    }
  }
  return missing;
}

function checkIcons({ report, configs, configRel, configText, root, appDir }) {
  const missing = checkIconFiles({ report, configs, root, appDir });
  for (const platform of ['ios', 'android']) {
    const label = platform === 'ios' ? 'iOS' : 'Android';
    const line = lineAt(configText, platform === 'ios' ? /\bicon\b/ : /adaptiveIcon|\bicon\b/);
    const production = iconOf(configs.production, platform);
    for (const variant of ['development', 'preview']) {
      const icon = iconOf(configs[variant], platform);
      if (icon === null) {
        report.problem({ file: configRel, line, rule: 'variant-icon', message: `${variant} has no ${label} icon`, fix: 'Give every variant its own icon (one folder per variant: assets/icons/<variant>/).' });
        continue;
      }
      if (JSON.stringify(icon) === JSON.stringify(production)) {
        report.problem({ file: configRel, line, rule: 'variant-icon', message: `${variant} uses the production ${label} icon: a tester cannot tell the builds apart`, fix: `Point ${variant} at its own icon files with a visible badge (assets/icons/${variant}/).` });
        continue;
      }
      // A missing file is already reported above; the byte comparison needs both sides.
      if ([...localPaths(icon), ...localPaths(production)].some((path) => missing.has(path))) continue;
      if (contentDigest(icon, appDir) === contentDigest(production, appDir)) {
        report.problem({ file: configRel, line, rule: 'variant-icon', message: `the ${variant} ${label} icon files are byte-identical copies of production's`, fix: `Draw a visibly different ${variant} icon (a badge or a colour band) instead of copying the store icon.` });
      }
    }
  }
}

function existsPath(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function schemesOf(config) {
  const raw = [config?.scheme, config?.ios?.scheme, config?.android?.scheme];
  return new Set(raw.flatMap((value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])).filter((value) => typeof value === 'string'));
}

function devClientOptions(config) {
  for (const plugin of config?.plugins ?? []) {
    const [name, options] = Array.isArray(plugin) ? plugin : [plugin, undefined];
    if (name === 'expo-dev-client') return { options: isObject(options) ? options : {} };
  }
  return null;
}

function checkSchemes({ report, configs, configRel, configText }) {
  const line = lineAt(configText, /\bscheme\b/);
  const sets = Object.fromEntries(VARIANTS.map((variant) => [variant, schemesOf(configs[variant])]));
  // The suggestion names the app's own production scheme (the first one when it is a list).
  const raw = Array.isArray(configs.production.scheme) ? configs.production.scheme[0] : configs.production.scheme;
  const base = typeof raw === 'string' && raw !== '' ? raw : '<scheme>';
  const schemeFix = `Give every variant its own scheme: ${base}-dev, ${base}-preview, ${base} (variantIdentity does).`;
  for (const [first, second] of [['development', 'production'], ['preview', 'production'], ['development', 'preview']]) {
    for (const scheme of sets[first]) {
      if (sets[second].has(scheme)) {
        report.problem({ file: configRel, line, rule: 'variant-scheme', message: `the URL scheme "${scheme}" is registered by both ${first} and ${second}: with both installed, iOS opens either one (which is undefined) and Android asks the user to choose`, fix: schemeFix });
      }
    }
  }
  for (const variant of ['preview', 'production']) {
    const devClient = devClientOptions(configs[variant]);
    if (devClient && devClient.options.addGeneratedScheme !== false) {
      report.problem({ file: configRel, line: lineAt(configText, 'expo-dev-client'), rule: 'variant-scheme', message: `${variant} registers the dev client's generated exp+<slug> scheme: QR codes and links may open it instead of the development build`, fix: "Configure ['expo-dev-client', { addGeneratedScheme: variant === 'development' }]." });
    }
  }
}

function checkEasProfiles({ report, eas, easRel }) {
  const build = isObject(eas.data?.build) ? eas.data.build : {};
  const lineOf = (name) => lineAt(eas.text, `"${name}"`);
  for (const variant of VARIANTS) {
    if (!isObject(build[variant])) {
      report.problem({ file: easRel, line: lineAt(eas.text, '"build"'), rule: 'eas-profile', message: `eas.json has no "${variant}" build profile`, fix: `Add build.${variant} with env APP_VARIANT and EXPO_PUBLIC_APP_VARIANT "${variant}" and "environment": "${variant}" (templates/eas.json).` });
    }
  }
  const resolved = {};
  for (const name of Object.keys(build)) {
    const result = resolveProfile(build, name);
    if (result.error) {
      report.problem({ file: easRel, line: lineOf(name), rule: 'eas-profile', message: result.error, fix: 'Point "extends" at an existing profile without a cycle.' });
      continue;
    }
    resolved[name] = result.profile;
  }
  // A profile that others extend and whose name is no variant is a shared base (Expo's eas.json docs
  // show "base" with node, env and ios.image): nobody builds it, so it names no variant itself.
  const parents = new Set(Object.values(build).map((profile) => (isObject(profile) ? profile.extends : undefined)).filter((name) => typeof name === 'string'));
  const isSharedBase = (name) => parents.has(name) && !VARIANTS.includes(name);
  for (const [name, profile] of Object.entries(resolved)) {
    if (isSharedBase(name)) checkSharedBase({ report, easRel, name, profile, build, resolved, isSharedBase, line: lineOf(name) });
    else checkProfile({ report, easRel, name, profile, line: lineOf(name) });
  }
  checkNodePins({ report, build, easRel, text: eas.text });
}

/**
 * metro.config.js requires scripts/metro/public-env-cache-version.ts and app.config.ts imports
 * src/config/app-variant.ts: Node loads both with type stripping, on by default from Node 22.18. A
 * build profile that pins an older Node (SDK 55 images used 20.19.4, often kept in a shared base)
 * fails at Metro config load on EAS. Only an explicit major.minor below the floor counts ("22.x" and
 * "22" take the newest 22).
 */
function checkNodePins({ report, build, easRel, text }) {
  for (const [name, profile] of Object.entries(build)) {
    const pin = isObject(profile) ? profile.node : undefined;
    if (typeof pin !== 'string') continue;
    const match = /^\s*v?(\d+)(?:\.(\d+))?/.exec(pin);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = match[2] === undefined ? null : Number(match[2]);
    const below = major < NODE_FLOOR.major || (major === NODE_FLOOR.major && minor !== null && minor < NODE_FLOOR.minor);
    if (!below) continue;
    report.problem({ file: easRel, line: lineAfterKey(text, `"${name}"`, '"node"'), rule: 'eas-profile', message: `build.${name} pins Node ${pin}: metro.config.js and app.config.ts load .ts files with Node's type stripping, which needs Node ${NODE_FLOOR.major}.${NODE_FLOOR.minor} or newer, so the build fails when Metro loads its config`, fix: `Remove the pin (SDK 57 EAS images ship Node 22.23.1) or set "node" to ${NODE_FLOOR.major}.${NODE_FLOOR.minor} or newer (the app's own pin, for example 26.4.0).` });
  }
}

/** 1-based line of `needle` after the first `anchor`, else of `anchor`. */
function lineAfterKey(text, anchor, needle) {
  const from = text.indexOf(anchor);
  const index = from < 0 ? -1 : text.indexOf(needle, from);
  return index < 0 ? lineAt(text, anchor) : text.slice(0, index).split('\n').length;
}

/** The names `name` extends, nearest first. */
function ancestorsOf(build, name) {
  const out = [];
  for (let parent = build[name]?.extends; typeof parent === 'string' && !out.includes(parent); parent = build[parent]?.extends) out.push(parent);
  return out;
}

/**
 * A shared base may set anything common (node, image, env values every variant shares), but not a
 * variant, an environment or developmentClient that one of the profiles built from it contradicts:
 * the child overrides it today, and the next child that forgets inherits the wrong variant.
 */
function checkSharedBase({ report, easRel, name, profile, build, resolved, isSharedBase, line }) {
  const children = Object.keys(resolved).filter((child) => !isSharedBase(child) && ancestorsOf(build, child).includes(name));
  const variantOf = (child) => (VARIANTS.includes(child) ? child : resolved[child].env?.APP_VARIANT);
  const problem = (message, fix) => report.problem({ file: easRel, line, rule: 'eas-profile', message: `build.${name} (a shared base extended by ${children.join(', ')}): ${message}`, fix });
  const envBlocks = [['env', profile.env], ['ios.env', profile.ios?.env], ['android.env', profile.android?.env]];
  for (const [where, env] of envBlocks) {
    for (const key of VARIANT_ENV) {
      const value = isObject(env) ? env[key] : undefined;
      if (value === undefined) continue;
      const other = children.find((child) => variantOf(child) !== value);
      if (other) problem(`sets ${where}.${key} "${value}", but ${other} builds ${variantOf(other) ?? 'no variant'}`, `Remove ${where}.${key} from the shared base: each variant profile names its own variant.`);
    }
  }
  if (profile.environment !== undefined) {
    const other = children.find((child) => variantOf(child) !== profile.environment);
    if (other) problem(`sets "environment": ${JSON.stringify(profile.environment)}, but ${other} builds ${variantOf(other) ?? 'no variant'}`, 'Remove "environment" from the shared base: each variant profile names its own EAS environment.');
  }
  if (profile.developmentClient === true) {
    const other = children.find((child) => variantOf(child) !== 'development');
    if (other) problem(`sets developmentClient: true, but ${other} builds ${variantOf(other) ?? 'no variant'}`, 'Set developmentClient only in the development profile; preview and production are release builds.');
  }
}

function checkProfile({ report, easRel, name, profile, line }) {
  const env = isObject(profile.env) ? profile.env : {};
  const variant = VARIANTS.includes(name) ? name : env.APP_VARIANT;
  const problem = (message, fix) => report.problem({ file: easRel, line, rule: 'eas-profile', message: `build.${name}: ${message}`, fix });
  if (typeof variant !== 'string' || variant === '') {
    problem('sets no APP_VARIANT (directly or through extends)', 'Every build profile names its variant: env APP_VARIANT and EXPO_PUBLIC_APP_VARIANT, and "environment" (or extend a variant profile).');
    return;
  }
  if (!VARIANTS.includes(variant)) {
    problem(`APP_VARIANT "${variant}" is not one of ${VARIANTS.join('|')}`, 'Use development, preview or production.');
    return;
  }
  for (const key of ['APP_VARIANT', 'EXPO_PUBLIC_APP_VARIANT']) {
    if (env[key] !== variant) problem(`env.${key} is ${JSON.stringify(env[key] ?? null)}, expected "${variant}"`, `Set env.${key} to "${variant}": the config and the JS bundle read different variables in different processes.`);
  }
  if (profile.environment !== variant) {
    problem(`"environment" is ${JSON.stringify(profile.environment ?? null)}, expected "${variant}"`, `Set "environment": "${variant}" so the build gets the EAS ${variant} variables and no others.`);
  }
  for (const platform of ['ios', 'android']) {
    const platformEnv = profile[platform]?.env ?? {};
    for (const key of ['APP_VARIANT', 'EXPO_PUBLIC_APP_VARIANT']) {
      if (platformEnv[key] !== undefined && platformEnv[key] !== variant) problem(`${platform}.env.${key} is "${platformEnv[key]}", the profile is ${variant}`, `Remove ${platform}.env.${key}; one profile builds one variant on both platforms.`);
    }
  }
  if (profile.developmentClient === true && variant !== 'development') {
    problem(`developmentClient is true in a ${variant} profile`, 'Only the development profile builds the dev client; preview and production are release builds.');
  }
}

function secretCanaries(appDir, configName, eas) {
  const names = new Set();
  for (const rel of localImportClosure(appDir, configName)) {
    for (const name of envNamesIn(readFileSync(join(appDir, rel), 'utf8'))) names.add(name);
  }
  for (const profile of Object.values(isObject(eas?.data?.build) ? eas.data.build : {})) {
    for (const name of Object.keys(isObject(profile?.env) ? profile.env : {})) names.add(name);
  }
  for (const file of envFilesIn(appDir)) {
    for (const entry of parseDotenv(readFileSync(join(appDir, file), 'utf8'))) names.add(entry.name);
  }
  return [...names].filter((name) => !name.startsWith(PUBLIC_PREFIX) && isSecretName(name)).sort();
}

function publicConfig(config) {
  const copy = structuredClone(config);
  for (const path of PRIVATE_PATHS) {
    const parent = path.slice(0, -1).reduce((node, key) => (isObject(node) ? node[key] : undefined), copy);
    if (isObject(parent)) delete parent[path.at(-1)];
  }
  return copy;
}

function stringsWithPaths(node, path = '', out = []) {
  if (typeof node === 'string') out.push({ path: path || '(root)', value: node });
  else if (Array.isArray(node)) node.forEach((item, index) => stringsWithPaths(item, `${path}[${index}]`, out));
  else if (isObject(node)) for (const [key, value] of Object.entries(node)) stringsWithPaths(value, path ? `${path}.${key}` : key, out);
  return out;
}

function checkSecrets({ report, evaluate, production, configName, configRel, configText, appDir, eas }) {
  const embedded = publicConfig(production);
  for (const [key, value] of Object.entries(isObject(embedded.extra) ? embedded.extra : {})) {
    if (isSecretName(key) && typeof value === 'string' && value !== '') {
      report.problem({ file: configRel, line: lineAt(configText, key), rule: 'secret-config', message: `extra.${key} looks like a secret, and extra is embedded in the app (Constants.expoConfig.extra)`, fix: 'Keep secrets out of the app config: use them only in build steps (EAS secret variables) or on a server.' });
    }
  }
  for (const { path, value } of stringsWithPaths(embedded)) {
    for (const { entry } of findSecretValues(value)) {
      report.problem({ file: configRel, line: 1, rule: 'secret-config', message: `${path} holds ${entry.what}; the public config is embedded in every build`, fix: 'Remove it from the config and rotate it (it shipped or was committed); keep secrets in EAS secret variables or CI secrets.' });
    }
  }
  const canaries = secretCanaries(appDir, configName, eas);
  if (canaries.length === 0) return;
  const values = Object.fromEntries(canaries.map((name) => [name, `rnskills-canary-${name.toLowerCase()}`]));
  const result = evaluate({ APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'production', ...values });
  if (!result.ok || !isObject(result.config)) {
    report.note(`note: the secret canary run failed (${firstLine(result.message ?? 'no config')}); secret-config checked the static values only`);
    return;
  }
  const found = stringsWithPaths(publicConfig(result.config));
  for (const name of canaries) {
    const hit = found.find(({ value }) => value.includes(values[name]));
    if (hit) {
      report.problem({ file: configRel, line: lineAt(configText, name), rule: 'secret-config', message: `the value of ${name} reaches ${hit.path} in the public config, which is embedded in the app`, fix: `Do not pass ${name} into the config (extra, plugin options, ...): tools read it from the build environment (an EAS secret variable).` });
    }
  }
}

function checkMetro({ report, appDir, appRel }) {
  const name = findFirst(appDir, METRO_FILES);
  if (name === null) {
    report.problem({ file: appRel('metro.config.js'), line: 0, rule: 'metro-cache-key', message: 'no metro.config.js: Metro keeps one transform cache for every variant, so a production bundle can reuse development transforms (test-only code included)', fix: 'Copy templates/metro.config.js and templates/scripts/metro/public-env-cache-version.ts (cacheVersion keyed on the EXPO_PUBLIC_* values).' });
    return;
  }
  const rel = appRel(name);
  const text = maskComments(readFileSync(join(appDir, name), 'utf8'));
  const line = /\bcacheVersion\b/.test(text) ? lineAt(text, 'cacheVersion') : 1;
  const runs = loadMetroCacheVersions(join(appDir, name), appDir);
  const failed = Object.values(runs).find((result) => !result.ok);
  if (failed) {
    report.note(`note: ${name} could not be loaded (${firstLine(failed.message)}); metro-cache-key checked statically`);
    checkMetroStatically({ report, appDir, name, rel, text });
    return;
  }
  const { base, probe } = runs;
  if (!base.set) {
    report.problem({ file: rel, line: 1, rule: 'metro-cache-key', message: `${name} does not set cacheVersion: EXPO_PUBLIC_* values are inlined into cached transforms without being part of the cache key`, fix: 'Set config.cacheVersion = publicEnvCacheVersion(process.env) (templates/metro.config.js).' });
    return;
  }
  if (base.type !== 'string') {
    report.problem({ file: rel, line, rule: 'metro-cache-key', message: `cacheVersion is a ${base.type}; Metro expects a string`, fix: 'Return the string from publicEnvCacheVersion(process.env).' });
    return;
  }
  if (base.cacheVersion === probe.cacheVersion) {
    report.problem({ file: rel, line, rule: 'metro-cache-key', message: `cacheVersion is not derived from the EXPO_PUBLIC_* values: it stays ${JSON.stringify(base.cacheVersion)} when only ${METRO_PROBE} changes, so a changed public value (a variant, an API URL) reuses the old transforms`, fix: 'Derive it from every EXPO_PUBLIC_* name and value (publicEnvCacheVersion in templates/scripts/metro/).' });
    return;
  }
  const fix = 'Include EXPO_PUBLIC_APP_VARIANT in the key (publicEnvCacheVersion hashes every EXPO_PUBLIC_* name and value).';
  if (new Set(VARIANTS.map((variant) => runs[variant].cacheVersion)).size === 1) {
    report.problem({ file: rel, line, rule: 'metro-cache-key', message: `cacheVersion is ${JSON.stringify(runs.production.cacheVersion)} for every variant: a production export reuses the development transforms`, fix });
    return;
  }
  for (const [first, second] of [['development', 'production'], ['preview', 'production'], ['development', 'preview']]) {
    if (runs[first].cacheVersion === runs[second].cacheVersion) {
      report.problem({ file: rel, line, rule: 'metro-cache-key', message: `cacheVersion is ${JSON.stringify(runs[first].cacheVersion)} for both ${first} and ${second}: one variant would reuse the other's transforms`, fix });
    }
  }
}

/** cacheVersion of the Metro config for the production pair, the same plus a probe, and each variant. */
function loadMetroCacheVersions(metroPath, appDir) {
  const stubDir = makeTempDir('rnskills-metro-');
  const stub = join(stubDir, 'metro-config-stub.cjs');
  writeFileSync(stub, METRO_STUB);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith(PUBLIC_PREFIX) && !STRIPPED_ENV.has(key) && value !== undefined) env[key] = value;
  const load = (extra) => {
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', METRO_EVAL_SOURCE, '--', metroPath, stub], {
      cwd: appDir, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    });
    try {
      return JSON.parse(child.stdout || 'null') ?? { ok: false, message: (child.stderr || `exit ${child.status}`).trim() };
    } catch {
      return { ok: false, message: (child.stderr || child.stdout || `exit ${child.status}`).trim() };
    }
  };
  try {
    const pair = (variant) => ({ APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant });
    return {
      base: load(pair('production')),
      probe: load({ ...pair('production'), [METRO_PROBE]: 'probe' }),
      development: load(pair('development')),
      preview: load(pair('preview')),
      production: load(pair('production')),
    };
  } finally {
    removeTempDir(stubDir);
  }
}

/** The fallback when the Metro config cannot be loaded (a wrapper package not installed): read the source. */
function checkMetroStatically({ report, appDir, name, rel, text }) {
  if (!/\bcacheVersion\b\s*[=:]/.test(text)) {
    report.problem({ file: rel, line: 1, rule: 'metro-cache-key', message: `${name} does not set cacheVersion: EXPO_PUBLIC_* values are inlined into cached transforms without being part of the cache key`, fix: 'Set config.cacheVersion = publicEnvCacheVersion(process.env) (templates/metro.config.js).' });
    return;
  }
  // The assigned value must come from the environment (process.env or an EXPO_PUBLIC_ name), and
  // some file the config reaches must look at the EXPO_PUBLIC_* names.
  const assigned = /\bcacheVersion\b\s*[=:]\s*([^;\n]+)/.exec(text)?.[1] ?? '';
  const reached = localImportClosure(appDir, name).map((file) => maskComments(readFileSync(join(appDir, file), 'utf8')));
  const fromEnv = assigned.includes(PUBLIC_PREFIX) || /\bprocess\s*\.\s*env\b/.test(assigned);
  if (!fromEnv || !reached.some((source) => source.includes(PUBLIC_PREFIX))) {
    report.problem({ file: rel, line: lineAt(text, 'cacheVersion'), rule: 'metro-cache-key', message: 'cacheVersion is not derived from the EXPO_PUBLIC_* values, so a change of variant reuses the old transforms', fix: 'Derive it from every EXPO_PUBLIC_* name and value (publicEnvCacheVersion in templates/scripts/metro/).' });
  }
}

/** The package a plugin specifier names: '@sentry/react-native/expo' -> '@sentry/react-native'. */
function packageOf(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

function declaredDependencies(dirs) {
  const names = new Set();
  for (const dir of dirs) {
    const path = join(dir, 'package.json');
    if (!isFile(path)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) Object.keys(manifest[key] ?? {}).forEach((name) => names.add(name));
    } catch {
      // expoMissing() already reported a malformed package.json.
    }
  }
  return names;
}

/** True when node_modules/<pkg> exists in the app folder or any folder above it (Node's lookup). */
function installedPackage(appDir, pkg) {
  for (let dir = appDir; ; dir = dirname(dir)) {
    if (isFile(join(dir, 'node_modules', pkg, 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** Every string plugin resolves: a package the app depends on (or that is installed), or a local file. */
function checkPlugins({ report, configs, configRel, configText, root, appDir }) {
  const byName = new Map();
  for (const variant of VARIANTS) {
    for (const entry of configs[variant]?.plugins ?? []) {
      const name = Array.isArray(entry) ? entry[0] : entry;
      if (typeof name !== 'string' || name === '') continue;
      byName.set(name, [...(byName.get(name) ?? []), variant]);
    }
  }
  const declared = declaredDependencies([appDir, root]);
  for (const [name, variants] of byName) {
    const where = variants.length === VARIANTS.length ? 'every variant' : variants.join(', ');
    const line = lineAt(configText, name);
    if (/^(?:\.{1,2}\/|\/)/.test(name)) {
      const base = resolve(appDir, name);
      if (!LOCAL_PLUGIN_PROBES.some((ext) => isFile(`${base}${ext}`))) {
        report.problem({ file: configRel, line, rule: 'variant-config', message: `plugin "${name}" (${where}) does not exist: npx expo config and prebuild fail with "Failed to resolve plugin for module"`, fix: 'Point the plugin entry at an existing file relative to the app folder.' });
      }
      continue;
    }
    const pkg = packageOf(name);
    if (declared.has(pkg) || installedPackage(appDir, pkg)) continue;
    report.problem({ file: configRel, line, rule: 'variant-config', message: `plugin "${name}" (${where}) comes from ${pkg}, which is neither in package.json nor installed: npx expo config and prebuild fail with "Failed to resolve plugin for module"`, fix: `Install it: npx expo install ${pkg}${pkg === 'expo-dev-client' ? ' (the development profile builds the dev client)' : ''}.` });
  }
}

/** A note when submit.production would resolve the store ids from a config evaluated without the variant. */
function noteSubmitPins({ report, eas, easRel }) {
  const production = eas.data?.submit?.production;
  if (!isObject(production)) return;
  const missing = [];
  // A missing ios or android block pins nothing either ("submit": { "production": {} } is what eas init writes).
  if (!production.ios?.ascAppId && !production.ios?.bundleIdentifier) missing.push('ios.ascAppId or ios.bundleIdentifier');
  if (!production.android?.applicationId) missing.push('android.applicationId');
  if (missing.length > 0) {
    report.note(`note: ${easRel} submit.production pins no ${missing.join(' and ')}: a standalone eas submit evaluates the app config without the build profile env, so with no variant exported it resolves the development id (export APP_VARIANT and EXPO_PUBLIC_APP_VARIANT=production for it, or pin the ids; eas-build-and-submit owns submit profiles)`);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstLine(text) {
  return String(text ?? '').split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}
