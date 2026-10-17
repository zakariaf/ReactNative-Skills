// link-facts.mjs: the facts check-deep-links.mjs and write-well-known.mjs share (a helper of this
// skill, not synced): where the link files live, the app config evaluated per variant the way Expo
// evaluates it, contracts/deep-links.json, the origins a build accepts, the route files' URL patterns
// and the expected apple-app-site-association and assetlinks.json of every verified host.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, walk } from '../check-lib.mjs';

/** The build variants (app-variants-and-environment): every one is evaluated. */
export const VARIANTS = Object.freeze(['development', 'preview', 'production']);

/** The relation every assetlinks.json statement grants. */
export const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

const WEB_SCHEMES = new Set(['http', 'https']);
const CONFIG_FILES = ['app.config.ts', 'app.config.mts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];
const ROUTE_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;
const PLATFORM_SUFFIX = /\.(ios|android|native|web)$/;
const NOT_A_SCREEN = /^(_layout|\+not-found|\+html|\+native-intent|\+middleware|_sitemap)$/;

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/**
 * Where the link files live: the defaults follow resolveLayout; rn-skills.config.json may move them
 * with "deepLinks": { "routesModule", "gateModule", "contract" } (repo-relative paths).
 */
export function linkPaths(layout) {
  const configured = layout.config?.deepLinks ?? {};
  return {
    routesModule: configured.routesModule ?? `${layout.featuresDir}/deep-links/link-routes.ts`,
    gateModule: configured.gateModule ?? `${layout.coreDir}/links/route-incoming-link.ts`,
    contract: configured.contract ?? `${layout.contractsDir}/deep-links.json`,
    intentCandidates: ['tsx', 'ts', 'jsx', 'js'].map((ext) => `${layout.routesDir}/+native-intent.${ext}`),
  };
}

/** The app config file Expo reads (dynamic first), or null. */
export function findAppConfig(root) {
  const rel = CONFIG_FILES.find((name) => isFile(join(root, name)));
  return rel ?? null;
}

// Evaluates a dynamic config in a child Node process (type stripping, the default export called
// with Expo's context) and prints { ok, config } or { ok: false, message }.
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
  '  out({ ok: false, message: String(error?.message ?? error) });',
  '}',
].join('\n');

/** The app config for `variant` ({ ok, config } or { ok: false, message }). */
export function evaluateAppConfig(root, rel, variant) {
  if (rel.endsWith('.json')) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, rel), 'utf8'));
      return { ok: true, config: parsed?.expo ?? parsed };
    } catch (error) {
      return { ok: false, message: `${rel} is not valid JSON: ${error.message}` };
    }
  }
  const env = { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant };
  delete env.NODE_OPTIONS;
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', EVAL_SOURCE, '--', join(root, rel), root], {
    cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  try {
    const parsed = JSON.parse(child.stdout || 'null');
    if (parsed !== null) return parsed;
  } catch {
    // falls through to the process error below
  }
  const reason = child.error ? child.error.message : (child.stderr || '').trim().split('\n').slice(0, 2).join(' ');
  return { ok: false, message: `the config process ended without a result: ${reason || `exit ${child.status}`}` };
}

/** The config of every variant: { variant: config }; a variant that fails to evaluate throws (exit 2). */
export function evaluateAllVariants(root, rel, variants = VARIANTS) {
  const configs = {};
  for (const variant of variants) {
    const result = evaluateAppConfig(root, rel, variant);
    if (!result.ok) {
      throw new UsageError(`${rel} does not evaluate for APP_VARIANT=${variant}: ${result.message}`, 'Make the app config evaluate (APP_VARIANT=<variant> npx expo config), or install the dependencies it imports (npm ci).');
    }
    configs[variant] = result.config ?? {};
  }
  return configs;
}

/** The custom schemes a config registers, lowercase (scheme, ios.scheme, android.scheme). */
export function schemesOf(config) {
  const raw = [config?.scheme, config?.ios?.scheme, config?.android?.scheme].flat();
  return [...new Set(raw.filter((value) => typeof value === 'string' && value !== '').map((value) => value.toLowerCase()))].filter((scheme) => !WEB_SCHEMES.has(scheme));
}

/** 'applinks:tasks.example.com?mode=developer' -> { host, mode }; other services -> null. */
export function parseAppLink(entry) {
  const match = /^applinks:([^?]*)(?:\?mode=(.*))?$/.exec(String(entry));
  return match ? { host: match[1], mode: match[2] ?? null } : null;
}

/** The data elements of an intent filter as a list. */
export function filterData(filter) {
  return filter?.data === undefined ? [] : [filter.data].flat().filter((item) => item && typeof item === 'object');
}

/** Hosts of the verified (autoVerify) http/https intent filters. */
export function appLinkFilterHosts(config) {
  const hosts = [];
  for (const filter of config?.android?.intentFilters ?? []) {
    if (filter?.autoVerify !== true) continue;
    const data = filterData(filter);
    const isWeb = data.some((item) => WEB_SCHEMES.has(String(item.scheme ?? '').toLowerCase()));
    if (!isWeb) continue;
    for (const item of data) if (typeof item.host === 'string') hosts.push(item.host.toLowerCase());
  }
  return hosts;
}

/** The origins a build accepts, as the app's link-origins.ts computes them. */
export function originsOf(config) {
  const iosHosts = (config?.ios?.associatedDomains ?? []).map(parseAppLink).filter(Boolean).map((link) => link.host.toLowerCase());
  return { schemes: schemesOf(config), hosts: [...new Set([...iosHosts, ...appLinkFilterHosts(config)])] };
}

/** Reads the contract: { exists, data, text, error }. */
export function readContract(root, rel) {
  const path = join(root, rel);
  if (!isFile(path)) return { exists: false, data: null, text: '', error: null };
  const text = readFileSync(path, 'utf8');
  try {
    return { exists: true, data: JSON.parse(text), text, error: null };
  } catch (error) {
    return { exists: true, data: null, text, error: error.message };
  }
}

/** The folder a host's well-known files live in: a wildcard host is served from its parent. */
export function hostFolder(host) {
  return String(host).replace(/^\*\./, '');
}

/** The expected well-known files: Map('<dir>/<host>/<file>' -> JSON value). Needs a valid contract. */
export function expectedWellKnown(contract, configs) {
  const dir = contract.wellKnownDir ?? 'well-known';
  const byFolder = new Map();
  for (const variant of VARIANTS) {
    for (const host of contract.hosts?.[variant] ?? []) {
      const folder = hostFolder(host);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      if (!byFolder.get(folder).includes(variant)) byFolder.get(folder).push(variant);
    }
  }
  const files = new Map();
  for (const [folder, variants] of byFolder) {
    const appIDs = [...new Set(variants.map((variant) => `${contract.appleTeamId}.${configs[variant]?.ios?.bundleIdentifier}`))];
    const components = (contract.webPaths ?? []).map((path) => ({ '/': path }));
    files.set(`${dir}/${folder}/apple-app-site-association`, { applinks: { details: [{ appIDs, components }] } });
    files.set(`${dir}/${folder}/assetlinks.json`, variants.map((variant) => ({
      relation: [HANDLE_ALL_URLS],
      target: { namespace: 'android_app', package_name: configs[variant]?.android?.package, sha256_cert_fingerprints: contract.androidCertFingerprints?.[variant] ?? [] },
    })));
  }
  return files;
}

/** The app's Prettier printWidth (.prettierrc.json), else Prettier's default 80. */
export function printWidthOf(root) {
  try {
    const width = JSON.parse(readFileSync(join(root, '.prettierrc.json'), 'utf8')).printWidth;
    return Number.isInteger(width) ? width : 80;
  } catch {
    return 80;
  }
}

function formatJson(value, indent, used, width) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const isFlat = value.every((item) => item === null || typeof item !== 'object');
    const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    if (isFlat && used + inline.length + 1 <= width) return inline;
    return `[\n${value.map((item) => `${pad}  ${formatJson(item, indent + 2, indent + 2, width)}`).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, item]) => {
      const head = `${pad}  ${JSON.stringify(key)}: `;
      return `${head}${formatJson(item, indent + 2, head.length, width)}`;
    }).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** JSON text as Prettier prints it (objects expanded, short flat arrays on one line), final newline. */
export function wellKnownText(value, width = 80) {
  return `${formatJson(value, 0, 0, width)}\n`;
}

/** Deep equality of JSON values (key order ignored). */
export function sameJson(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  return a === b;
}

/** Route files of the routes folder with their URL pattern: [{ rel, url }] ('(app)/tasks/[taskId].tsx' -> '/tasks/[taskId]'). */
export function routeUrls(root, routesDir) {
  const abs = join(root, routesDir);
  if (!existsSync(abs)) return [];
  const routes = [];
  for (const rel of walk(abs, { include: ['*.tsx', '*.ts', '*.jsx', '*.js'] })) {
    if (/\.(test|spec)\.[jt]sx?$/.test(rel) || rel.endsWith('.d.ts') || /\+api\.[jt]sx?$/.test(rel)) continue;
    const parts = rel.replace(ROUTE_EXTENSIONS, '').replace(PLATFORM_SUFFIX, '').split('/');
    if (NOT_A_SCREEN.test(parts.at(-1))) continue;
    const segments = parts.filter((part) => !/^\(.*\)$/.test(part));
    if (segments.at(-1) === 'index') segments.pop();
    routes.push({ rel: `${routesDir}/${rel}`, url: `/${segments.join('/')}` });
  }
  return routes;
}

/** A navigation-contract route id ('(debug)/debug/setup') as a URL path ('/debug/setup'). */
export function routeIdUrl(id) {
  const segments = String(id).split('/').filter((part) => part !== '' && !/^\(.*\)$/.test(part));
  if (segments.at(-1) === 'index') segments.pop();
  return `/${segments.join('/')}`;
}
