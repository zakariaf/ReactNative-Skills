// app-skeleton.mjs: the files of one white-label app (when multi-package: one game = one Expo app in
// apps/<game-id>/), rendered from the declaration's apps block. The generator writes them and the
// checker's app rules hold every app to the same shape, so both read this one renderer. Not an
// entry point.

import { bundleIdFor } from './games-contract.mjs';
import { jsonText } from './json-text.mjs';

/** The SDK 57 runtime set of the first app (stack table, verified on 2026-10-03; re-verify: npm view expo version). */
export const FIRST_APP_DEPENDENCIES = Object.freeze({ expo: '~57.0.26', react: '19.2.3', 'react-native': '0.86.3' });

/**
 * Google's documented sample AdMob ids: they serve test ads only, so a fresh app runs on day one,
 * and every ship gate refuses them by name (ship-placeholders.mjs) until the developer's own ids
 * replace them. Keys are the unit names the declaration may list in apps.adUnits.
 */
export const SAMPLE_AD_IDS = Object.freeze({
  ios: {
    appId: 'ca-app-pub-3940256099942544~1458002511',
    units: { banner: 'ca-app-pub-3940256099942544/2934735716', interstitial: 'ca-app-pub-3940256099942544/4411468910', rewarded: 'ca-app-pub-3940256099942544/1712485313', appOpen: 'ca-app-pub-3940256099942544/5575463023', native: 'ca-app-pub-3940256099942544/3986624511', rewardedInterstitial: 'ca-app-pub-3940256099942544/6978759866' },
  },
  android: {
    appId: 'ca-app-pub-3940256099942544~3347511713',
    units: { banner: 'ca-app-pub-3940256099942544/6300978111', interstitial: 'ca-app-pub-3940256099942544/1033173712', rewarded: 'ca-app-pub-3940256099942544/5224354917', appOpen: 'ca-app-pub-3940256099942544/9257395921', native: 'ca-app-pub-3940256099942544/2247696110', rewardedInterstitial: 'ca-app-pub-3940256099942544/5354046379' },
  },
});
export const AD_UNIT_NAMES = Object.freeze(Object.keys(SAMPLE_AD_IDS.ios.units));

/** The files every app holds (repo-relative to the app folder); fonts and catalogs come on top. */
export const APP_FILES = Object.freeze(['package.json', 'tsconfig.json', 'metro.config.js', 'app.config.ts', 'app-settings.ts', 'index.ts', '.gitignore']);
/** The placeholder entry of a fresh app: replaced by expo-router/entry once the app has its root. */
export const PLACEHOLDER_ENTRY = 'index.ts';

const PRINT_WIDTH = 100;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const quote = (text) => `'${String(text).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** A TypeScript literal formatted as Prettier prints it (objects expanded, short arrays on one line). */
function tsLiteral(value, depth, prefixLength) {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (typeof value === 'string') return quote(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const flat = `[${value.map((item) => tsLiteral(item, depth + 1, 0)).join(', ')}]`;
    if (value.every((item) => item === null || typeof item !== 'object') && prefixLength + flat.length + 1 <= PRINT_WIDTH) return flat;
    return `[\n${value.map((item) => `${inner}${tsLiteral(item, depth + 1, inner.length)},`).join('\n')}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const needsQuotes = entries.some(([key]) => !IDENTIFIER.test(key));
  return `{\n${entries
    .map(([key, item]) => {
      const head = `${inner}${needsQuotes && !IDENTIFIER.test(key) ? quote(key) : key}: `;
      return `${head}${tsLiteral(item, depth + 1, head.length)},`;
    })
    .join('\n')}\n${pad}}`;
}

/** The per-app values the composer turns into the Expo config (app-settings.ts). */
export function appSettingsValue({ entry, apps, names }) {
  const bundleId = bundleIdFor(entry.id, apps.bundlePrefix);
  const value = {
    id: entry.id,
    appName: names,
    bundleId,
    version: '1.0.0',
    buildNumber: 1,
    products: Object.fromEntries(apps.products.map((product) => [product, `${bundleId}.${product}`])),
    links: { privacyPolicy: { host: 'example.com', path: `/${entry.id}/privacy` }, supportEmail: 'support@example.com' },
  };
  if (Array.isArray(apps.adUnits)) {
    const pick = (platform) => ({ appId: SAMPLE_AD_IDS[platform].appId, units: Object.fromEntries(apps.adUnits.map((unit) => [unit, SAMPLE_AD_IDS[platform].units[unit]])) });
    value.ads = { isEnabled: true, ios: pick('ios'), android: pick('android') };
  }
  return value;
}

/** The relative path from an app folder back to the repo root (two ".." segments for apps/<id>). */
export function upToRoot(appDir) {
  return appDir.split('/').map(() => '..').join('/');
}

/** Every skeleton file of one app: [{ rel (repo-relative), content }]. */
export function renderAppSkeleton({ entry, apps, appDir, names, dependencies }) {
  const { composer } = apps;
  const settings = appSettingsValue({ entry, apps, names });
  const manifest = { name: `${apps.scope}/${entry.id}`, version: '1.0.0', private: true, main: 'index.ts', dependencies: dependencies ?? { ...FIRST_APP_DEPENDENCIES } };
  const tsconfig = {
    $schema: 'https://json.schemastore.org/tsconfig',
    extends: `${upToRoot(appDir)}/tsconfig.base.json`,
    compilerOptions: { types: ['jest'], paths: { '@/*': ['./src/*'] } },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'ios', 'android', 'build', 'dist'],
  };
  return [
    { rel: `${appDir}/package.json`, content: jsonText(manifest) },
    { rel: `${appDir}/tsconfig.json`, content: jsonText(tsconfig) },
    {
      rel: `${appDir}/metro.config.js`,
      content: [
        `// ${appDir}/metro.config.js`,
        '// Plain JavaScript: Metro loads this file directly. Metro inlines every EXPO_PUBLIC_* value at',
        '// transform time, but those values are not part of its cache key, and the cache is shared by every',
        '// build on the machine: without the key below a production export made after a development export',
        '// reused the development transforms. Keying the cache on the public values makes every variant, and',
        '// every change of a public value, transform afresh (app-variants-and-environment owns the rule).',
        "const { createHash } = require('node:crypto');",
        '',
        // Split so the skill validator does not read the generated require as an import of this script.
        "const { getDefaultConfig } = require(" + "'expo/metro-config');",
        '',
        'const config = getDefaultConfig(__dirname);',
        'const publicEnv = Object.keys(process.env)',
        "  .filter((key) => key.startsWith('EXPO_PUBLIC_'))",
        '  .sort()',
        '  .map((key) => `${key}=${process.env[key]}`)',
        "  .join('\\n');",
        "config.cacheVersion = `public-env-${createHash('sha256').update(publicEnv).digest('hex').slice(0, 16)}`;",
        '',
        'module.exports = config;',
        '',
      ].join('\n'),
    },
    {
      rel: `${appDir}/app.config.ts`,
      content: [
        `// ${appDir}/app.config.ts`,
        '// One statement: the shared composer turns this app\'s settings into the Expo config. Every native',
        '// setting comes from the composer and its config plugins (Continuous Native Generation).',
        `import { ${composer.name} } from '${composer.import}';`,
        '',
        "import { appSettings } from './app-settings.ts';",
        '',
        `export default ${composer.name}(appSettings, process.env);`,
        '',
      ].join('\n'),
    },
    {
      rel: `${appDir}/app-settings.ts`,
      content: [
        `// ${appDir}/app-settings.ts`,
        `// Every per-app value of ${entry.name}. Only app.config.ts reads this file; app code reads the`,
        '// runtime subset from expo.extra through one typed reader. No value is null: null reached the',
        '// device as {} through expo.extra. The links and, when the app shows ads, the ad ids are',
        '// placeholders until the developer supplies the real ones; the complete check refuses each by name.',
        `import type { ${composer.type} } from '${composer.import}';`,
        '',
        `export const appSettings: ${composer.type} = ${tsLiteral(settings, 0, 0)};`,
        '',
      ].join('\n'),
    },
    {
      rel: `${appDir}/index.ts`,
      content: [
        `// ${appDir}/index.ts`,
        '// Placeholder entry: an empty app, so the skeleton type-checks, lints and prebuilds while the game',
        '// is built. When the app\'s root exists (src/app/_layout.tsx, app-startup-and-bootstrap), replace',
        '// this file with that skill\'s entry: the forced Intl polyfills first, expo-router/entry last.',
        "import { registerRootComponent } from 'expo';",
        '',
        'function PlaceholderApp(): null {',
        '  return null;',
        '}',
        '',
        'registerRootComponent(PlaceholderApp);',
        '',
      ].join('\n'),
    },
    {
      rel: `${appDir}/.gitignore`,
      content: '# Continuous Native Generation: prebuild writes these; never edit or commit them. Anchored, so a\n# local module\'s modules/<name>/ios/ source stays committed.\n/ios\n/android\n/build\n/dist\n/.expo\n',
    },
  ];
}
