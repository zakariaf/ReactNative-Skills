// app-checks.mjs: the checks of a game's own white-label app (when multi-package: one game = one
// Expo app in <apps.dir>/<id>/): the skeleton files, the manifest, dependencies in lockstep, the
// tsconfig, the Metro cache key, the one-statement app config, anchored native ignores, the per-app
// settings, derived store ids, byte-identical fonts and, at the complete stage, every outward-facing
// placeholder by name. One function per area. Not an entry point.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, maskComments, readText, sha256 } from '../check-lib.mjs';
import { errorText } from './app-modules.mjs';
import { APP_FILES, PLACEHOLDER_ENTRY, upToRoot } from './app-skeleton.mjs';
import { bundleIdFor, readJsonFile } from './games-contract.mjs';
import { existingApps, sharedFonts } from './scaffold-plan.mjs';
import { bundleIdProblem, placeholderProblem, placeholdersIn } from './ship-placeholders.mjs';

const addMissingFix = (gameId) => `Run node <this skill>/scripts/scaffold-game.mjs . --game ${gameId} --add-missing: it writes only the absent files and keeps every existing one.`;

const textAt = (root, rel) => (existsSync(join(root, rel)) ? readText(join(root, rel)) ?? '' : null);

/** The skeleton files, the app's catalogs and the shared fonts exist (the placeholder index.ts only until complete). */
export function checkAppFiles(ctx, apps, report) {
  const { root, gameId, where, stage } = ctx;
  const wanted = [...APP_FILES.filter((rel) => stage !== 'complete' || rel !== PLACEHOLDER_ENTRY).map((rel) => `${where.appDir}/${rel}`), ...apps.locales.map((locale) => `${where.catalogsDir}/${locale}.json`), ...sharedFonts(root, apps).map((font) => `${where.appDir}/assets/fonts/${font.name}`)];
  for (const rel of wanted) if (!existsSync(join(root, rel))) report.problem({ file: rel, rule: 'app-file-missing', message: 'is missing from the app skeleton', fix: addMissingFix(gameId) });
}

/** package.json: the scoped name, private, the entry, no "type"; dependencies equal every other app's. */
export function checkPackage(ctx, apps, report) {
  const { root, gameId, where } = ctx;
  const rel = `${where.appDir}/package.json`;
  if (!existsSync(join(root, rel))) return;
  const { value: manifest, error } = readJsonFile(join(root, rel));
  if (error) return report.problem({ file: rel, line: 1, rule: 'package-json', message: `is not valid JSON: ${error}`, fix: addMissingFix(gameId) });
  const fix = 'Keep the skeleton values: the scoped workspace name, private, and the index.ts entry (app-startup-and-bootstrap later replaces its placeholder content with the real entry).';
  if (manifest.name !== `${apps.scope}/${gameId}`) report.problem({ file: rel, line: 1, rule: 'package-json', message: `"name" is ${JSON.stringify(manifest.name)}, expected "${apps.scope}/${gameId}"`, fix });
  if (manifest.private !== true) report.problem({ file: rel, line: 1, rule: 'package-json', message: '"private" is not true (an app is never published to npm)', fix });
  if (!['index.ts', 'expo-router/entry'].includes(manifest.main)) report.problem({ file: rel, line: 1, rule: 'package-json', message: `"main" is ${JSON.stringify(manifest.main)}, not index.ts or expo-router/entry`, fix });
  if ('type' in manifest) report.problem({ file: rel, line: 1, rule: 'package-json', message: 'has a "type" field, but metro.config.js is CommonJS and app code is not Node code', fix: 'Remove "type" from the app\'s package.json.' });
  const mine = JSON.stringify(Object.fromEntries(Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))));
  const other = existingApps(root, apps.dir, where.appDir.split('/').at(-1)).find((item) => JSON.stringify(item.dependencies) !== mine);
  if (other) report.problem({ file: rel, line: 1, rule: 'deps-lockstep', message: `dependencies differ from ${other.dir}/package.json`, fix: 'Every app lists the same packages at the same versions: native modules autolink per app and `npx expo install --check` sees only the app\'s own list. Install or upgrade in every app together (dependency-management).' });
}

/**
 * Stage complete: the app starts its real root, not the scaffold's placeholder. The placeholder
 * index.ts registers a component that renders nothing, so an app still on it ships a blank screen.
 * app-startup-and-bootstrap creates <srcDir>/app/_layout.tsx and the real entry: "main": "index.ts"
 * whose index.ts imports the forced Intl polyfills first and 'expo-router/entry' last (the default,
 * i18n-strings-and-catalogs needs the polyfills before any route module), or, in an app without
 * forced polyfills, "main": "expo-router/entry" with index.ts deleted.
 */
export function checkAppEntry(ctx, report) {
  const { root, where } = ctx;
  const entryRel = `${where.appDir}/${PLACEHOLDER_ENTRY}`;
  const fix = `Build the app's root with app-startup-and-bootstrap (${where.srcDir}/app/_layout.tsx) and replace the placeholder ${entryRel} with its entry: the forced Intl polyfills first, import 'expo-router/entry' last ("main": "index.ts"). Only an app without forced polyfills sets "main": "expo-router/entry" and deletes index.ts.`;
  const manifestRel = `${where.appDir}/package.json`;
  const { value: manifest } = existsSync(join(root, manifestRel)) ? readJsonFile(join(root, manifestRel)) : { value: null };
  const entryText = textAt(root, entryRel);
  const masked = entryText === null ? null : maskComments(entryText);
  const placeholderAt = masked === null ? -1 : masked.search(/\bPlaceholderApp\b/);
  const importsRouter = masked !== null && /\bimport\s+['"]expo-router\/entry['"]/.test(masked);
  if (manifest !== null && manifest !== undefined) {
    if (manifest.main === PLACEHOLDER_ENTRY) {
      if (placeholderAt < 0 && !importsRouter) report.problem({ file: entryRel, line: 1, rule: 'entry', message: entryText === null ? `is missing, but "main" names it` : `is the app's entry ("main": "index.ts") but never imports 'expo-router/entry', so no route registers`, fix });
    } else if (manifest.main !== 'expo-router/entry') {
      report.problem({ file: manifestRel, line: 1, rule: 'entry', message: `"main" is ${JSON.stringify(manifest.main)}, neither index.ts (the real entry) nor expo-router/entry`, fix });
    }
  }
  if (placeholderAt >= 0) report.problem({ file: entryRel, line: lineOf(entryText, placeholderAt), rule: 'entry', message: `still registers the scaffold's PlaceholderApp (renders nothing${manifest?.main === PLACEHOLDER_ENTRY ? ': "main" is index.ts, so the app would ship a blank screen' : ''})`, fix });
  const layoutRel = `${where.srcDir}/app/_layout.tsx`;
  if (!existsSync(join(root, layoutRel))) report.problem({ file: layoutRel, rule: 'entry', message: 'is missing, so the app has no root to start (app-startup-and-bootstrap creates it)', fix });
}

/** tsconfig.json extends the root base config and maps @/* to the app's src/. */
export function checkTsconfig(ctx, report) {
  const { root, gameId, where } = ctx;
  const rel = `${where.appDir}/tsconfig.json`;
  if (!existsSync(join(root, rel))) return;
  const { value, error } = readJsonFile(join(root, rel));
  const base = `${upToRoot(where.appDir)}/tsconfig.base.json`;
  const paths = value?.compilerOptions?.paths?.['@/*'];
  if (error || value.extends !== base || !Array.isArray(paths) || paths[0] !== './src/*') report.problem({ file: rel, line: 1, rule: 'tsconfig', message: error ? `is not valid JSON: ${error}` : `does not extend ${base} with "@/*": ["./src/*"]`, fix: `Every app shares the strict root settings and its own @/ alias; restore the skeleton file (${addMissingFix(gameId)})` });
}

/** metro.config.js keys Metro's cache on the EXPO_PUBLIC_* values. */
export function checkMetro(ctx, report) {
  const rel = `${ctx.where.appDir}/metro.config.js`;
  const text = textAt(ctx.root, rel);
  if (text === null) return;
  const code = maskComments(text);
  if (!/config\.cacheVersion\s*=/.test(code) || !/EXPO_PUBLIC_|publicEnvCacheVersion\(/.test(code)) report.problem({ file: rel, line: 1, rule: 'metro-cache', message: 'Metro\'s cache is not keyed on the EXPO_PUBLIC_* values', fix: 'Metro inlines EXPO_PUBLIC_* at transform time but leaves them out of its cache key: a production export after a development one reused the development transforms. Set config.cacheVersion from the public values (the skeleton file; app-variants-and-environment owns the rule).' });
}

/** app.config.ts is the one composer statement. */
export function checkAppConfig(ctx, apps, report) {
  const rel = `${ctx.where.appDir}/app.config.ts`;
  const text = textAt(ctx.root, rel);
  if (text === null) return;
  const { name } = apps.composer;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const one = new RegExp(`^\\s*import\\s*\\{\\s*${escape(name)}\\s*\\}\\s*from\\s*'${escape(apps.composer.import)}';\\s*import\\s*\\{\\s*appSettings\\s*\\}\\s*from\\s*'\\./app-settings\\.ts';\\s*export\\s+default\\s+${escape(name)}\\(appSettings,\\s*process\\.env\\);\\s*$`);
  if (!one.test(maskComments(text))) report.problem({ file: rel, line: 1, rule: 'app-config', message: `is not the one statement export default ${name}(appSettings, process.env) with the composer and ./app-settings.ts imported`, fix: 'Every native setting comes from the shared composer and its config plugins (Continuous Native Generation); per-app values go into app-settings.ts. Restore the skeleton file.' });
}

/** .gitignore ignores the generated /ios and /android, anchored to the app folder. */
export function checkGitignore(ctx, report) {
  const rel = `${ctx.where.appDir}/.gitignore`;
  const text = textAt(ctx.root, rel);
  if (text === null) return;
  const lines = text.split('\n').map((line) => line.trim());
  for (const folder of ['ios', 'android']) {
    const anchored = lines.includes(`/${folder}`) || lines.includes(`/${folder}/`);
    const loose = lines.findIndex((line) => line === folder || line === `${folder}/`);
    if (!anchored) report.problem({ file: rel, line: loose < 0 ? 1 : loose + 1, rule: 'gitignore', message: loose < 0 ? `does not ignore the generated /${folder}` : `ignores "${lines[loose]}" unanchored, which also hides a local module's modules/<name>/${folder}/ source`, fix: `Write /${folder} (anchored): prebuild regenerates the app's native project; never edit or commit it.` });
  }
}

/** Every null inside a value, as dotted paths. */
function nullPaths(value, path = []) {
  if (value === null) return [path.join('.') || '(the value)'];
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => nullPaths(item, [...path, key]));
}

/** The line of the first occurrence of `needle` in a text (1 when absent). */
const lineOfText = (text, needle) => (text.indexOf(needle) < 0 ? 1 : lineOf(text, text.indexOf(needle)));

/** app-settings.ts: loads headless and holds the app's identity; returns the settings or null. */
export async function checkAppSettings(ctx, apps, report) {
  const { root, gameId, where, modules } = ctx;
  const rel = `${where.appDir}/app-settings.ts`;
  const text = textAt(root, rel);
  if (text === null) return null;
  let settings;
  try {
    settings = (await modules.load(rel.slice(where.moduleRootPrefix.length))).appSettings;
    if (settings === null || typeof settings !== 'object') throw new Error('it exports no appSettings object');
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'app-settings', message: `cannot be loaded: ${errorText(error)}`, fix: 'app-settings.ts imports only the composer\'s settings type and exports const appSettings.' });
    return null;
  }
  const problem = (rule, field, message, fix) => report.problem({ file: rel, line: lineOfText(text, `${field}:`), rule, message, fix });
  if (settings.id !== gameId) problem('app-settings', 'id', `id is ${JSON.stringify(settings.id)}, the game is ${gameId}`, 'The app id equals the game id, the folder and every saved run\'s key.');
  const missing = apps.locales.filter((locale) => typeof settings.appName?.[locale] !== 'string' || settings.appName[locale].trim() === '');
  if (missing.length > 0) problem('app-settings', 'appName', `appName has no name for ${missing.join(', ')}`, 'Give the display name in every app locale (the source name until a translation is approved).');
  if (!/^\d+\.\d+\.\d+$/.test(String(settings.version)) || !Number.isInteger(settings.buildNumber) || settings.buildNumber < 1) problem('app-settings', 'version', 'version must be MAJOR.MINOR.PATCH and buildNumber a whole number >= 1', 'Start at 1.0.0 and build 1; only the release pipeline raises buildNumber.');
  const privacy = settings.links?.privacyPolicy;
  if (typeof privacy?.host !== 'string' || privacy.host.includes('://') || privacy.host.includes('/') || typeof privacy?.path !== 'string' || !privacy.path.startsWith('/')) problem('app-settings', 'privacyPolicy', 'links.privacyPolicy must be { host, path } without a scheme', 'App code holds no URL literals; the composer builds https://<host><path>.');
  if (typeof settings.links?.supportEmail !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(settings.links.supportEmail)) problem('app-settings', 'supportEmail', 'links.supportEmail is not an email address', 'Use the support address the developer reads.');
  for (const path of nullPaths(settings)) problem('settings-null', path.split('.').at(-1), `${path} is null`, 'Leave the key out instead: null reached the device as {} through expo.extra and broke a strict parser. The composer omits absent keys.');
  const expected = bundleIdFor(gameId, apps.bundlePrefix);
  if (settings.bundleId !== expected) problem('bundle-id', 'bundleId', `bundleId ${JSON.stringify(settings.bundleId)} is not ${expected}`, `Every app's iOS bundle id and Android package is <apps.bundlePrefix>.<game id without hyphens>, lowercase: write bundleId: '${expected}'. It can never change after the first upload (App Store Connect and Google Play key the app on it).`);
  else {
    const format = bundleIdProblem(expected, { platform: 'android' }) ?? bundleIdProblem(expected, { platform: 'ios' });
    if (format && !format.includes('com.example')) problem('bundle-id', 'bundleId', `bundleId ${format}`, 'Choose an apps.bundlePrefix whose parts start with a letter (Java package rules) and hold only letters and digits.');
  }
  const products = settings.products ?? {};
  const keys = Object.keys(products).sort();
  if (keys.join(',') !== [...apps.products].sort().join(',')) problem('product-id', 'products', `products are [${keys.join(', ')}], the declaration lists [${apps.products.join(', ')}]`, 'Every app sells the same products (apps.products in contracts/games.json).');
  for (const key of keys.filter((item) => products[item] !== `${expected}.${item}`)) problem('product-id', key, `products.${key} is ${JSON.stringify(products[key])}, not ${expected}.${key}`, `In-app products are <bundle id>.<suffix>: write '${expected}.${key}'.`);
  return settings;
}

/** Every shared font file and licence text, byte for byte. */
export function checkFonts(ctx, apps, report) {
  const { root, gameId, where } = ctx;
  for (const font of sharedFonts(root, apps)) {
    const rel = `${where.appDir}/assets/fonts/${font.name}`;
    if (!existsSync(join(root, rel))) continue;
    if (sha256(readFileSync(join(root, rel))) !== sha256(font.content)) report.problem({ file: rel, rule: 'fonts', message: `differs from ${apps.fontsDir}/${font.name} (sha256)`, fix: `Copy it byte for byte from ${apps.fontsDir}/ (${addMissingFix(gameId)} after deleting the copy): a different file changes the look, the text metrics in the goldens and the licence list.` });
  }
}

/** The outward-facing values of app-settings.ts a human replaces: [field, value]. */
function outwardFields(settings) {
  const ads = settings.ads;
  const adFields = ads && ads.isEnabled !== false ? ['ios', 'android'].flatMap((platform) => [[`ads.${platform}.appId`, ads[platform]?.appId], ...Object.entries(ads[platform]?.units ?? {}).map(([unit, value]) => [`ads.${platform}.units.${unit}`, value])]) : [];
  return [
    ['bundleId', settings.bundleId],
    ...Object.entries(settings.products ?? {}).map(([key, value]) => [`products.${key}`, value]),
    ...adFields,
    ['links.privacyPolicy.host', settings.links?.privacyPolicy?.host],
    ['links.supportEmail', settings.links?.supportEmail],
  ];
}

/** Stage complete: every placeholder still in app-settings.ts, one ship-placeholder line each. */
export function checkShipPlaceholders(ctx, settings, report) {
  const rel = `${ctx.where.appDir}/app-settings.ts`;
  const text = textAt(ctx.root, rel) ?? '';
  for (const [field, value] of outwardFields(settings)) {
    for (const entry of placeholdersIn(value)) report.problem(placeholderProblem({ entry, value, where: field, file: rel, line: lineOfText(text, `'${value}'`) }));
  }
}
