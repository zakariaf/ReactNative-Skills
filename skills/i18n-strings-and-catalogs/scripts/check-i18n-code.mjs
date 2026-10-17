#!/usr/bin/env node
// check-i18n-code.mjs: checks that app code shows text only through t()/<T> with literal keys that
// exist, never casts a key, keeps react-intl, Intl date formatting and the Intl APIs Hermes lacks
// inside src/i18n/ (each on its forced polyfill), builds number
// formatters from the locale tag, never isolates a text twice, and that the i18n wiring holds: the
// runtime files exist, the forced Intl polyfills carry exactly the app's languages and run first
// (the app entry, Jest setupFiles), npm run i18n:verify exists, the languages are declared to the
// system, and permission texts reach the native projects from the catalogs, never as literals.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-i18n-code.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, run, walkRepo } from './check-lib.mjs';
import { configCatalogKeys, defaultPurposeTexts, literalPurposeTexts, missingVariantName, supportedLocalesProblem, uncoveredPurposeKeys } from './lib/app-config-rules.mjs';
import { appFile, readCatalogKeys, readContract, readLanguages, resolveAppLayout } from './lib/i18n-config.mjs';
import { builtText, jsxChildren, literalBranch, quotedTextProperties, quotedTextsInArray, textLiteral } from './lib/jsx-text.mjs';
import { findCalls, findClosing, findImports, findJsxTags, isTestFile, jsxAttributes, literalOf, maskCode, resolveImport } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-i18n-code',
  summary: 'Checks app source (src/, plus package sources from contracts/i18n.json) for hard-coded UI text, built, cast or unknown message keys, react-intl, Intl date formatting and Intl APIs Hermes lacks outside src/i18n/, nested bidi isolates, and the i18n wiring: runtime files, polyfill data per language (and per optional Intl API), polyfills first in the app entry and in Jest, and permission texts built from the catalogs.',
  usage: '[repo-root] [options]',
  options: {
    'i18n-dir': { type: 'string', value: 'dir', help: 'The i18n folder (default: src/i18n from resolveLayout / rn-skills.config.json "i18nDir")' },
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app\'s folder (e.g. apps/mobile), which holds its package.json, app.config.ts, jest.config.js and src/' },
    src: { type: 'string', multiple: true, value: 'dir', help: 'Source folders to scan (default: srcDir, plus each contract catalog\'s sourceDir)' },
    entry: { type: 'string', value: 'file', help: 'The app entry, repo-relative (default: "main" of the app\'s package.json)' },
    contract: { type: 'string', value: 'file', help: 'The i18n contract (default: contracts/i18n.json; optional)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  jsx-literal-text     text a JSX element renders that is not from t(): words between tags (also after an',
    '                       {expression} child: {count} tasks left), a string literal child {\'Welcome\'}, a built',
    '                       template child, and a literal branch of a child {c ? t(...) : \'Many\'}',
    '  literal-prop-text    a literal or built string in a text prop (also a literal branch of ?: ?? || &&): text,',
    '                       label, title, hint, message, placeholder, subtitle, description, caption, summary, alt,',
    '                       accessibilityLabel/Hint, aria-label, aria-description, aria-valuetext, any custom prop',
    '                       named *Label/*Text/*Title/*Message/*Hint/*Placeholder (emptyText), accessibilityValue={{ text }},',
    '                       accessibilityActions labels, defaultValue; navigation options={{ title, headerTitle,',
    '                       tabBarLabel, tabBarBadge, ... }} and navigation.setOptions({ title }); Alert.alert/prompt',
    '                       title, message and button texts; screen-reader announcements (AccessibilityInfo.',
    '                       announceForAccessibility[WithOptions], announce() from useAnnounce); ToastAndroid.show*;',
    '                       ActionSheetIOS options, title, message, cancelButtonTitle; scheduleNotificationAsync',
    '                       content title/subtitle/body, notification channel name and description, category',
    '                       buttonTitle; Share.share title/message, shareAsync dialogTitle',
    '  count-branch         a ternary that picks a text by comparing a count to 1 (count === 1 ? t(a) : t(b),',
    '                       n > 1 ? \'tasks\' : \'task\'): the plural form belongs in the catalog (ICU plural)',
    '  dynamic-key          a key built with a template or +',
    '  unknown-key          t(\'k\'), t(c ? \'k1\' : \'k2\'), <T id="k"> with a key the source catalog lacks; a',
    '                       \'<keyPrefix>.…\' literal in a package sourceDir that its catalog lacks; and a catalog key',
    '                       app.config names (NATIVE_TEXT_KEYS values, sourceText(projectRoot, \'<key>\'))',
    '  key-cast             `as MessageKey`, <MessageKey> or asMessageKey(...) outside src/i18n/messages.ts:',
    '                       a cast hides a misspelt key from the type check; use a typed table instead',
    '  react-intl-import    react-intl imported outside src/i18n/',
    '  date-format-api      Intl.DateTimeFormat or toLocale*String outside src/i18n/',
    '  intl-api             Intl.RelativeTimeFormat, ListFormat, DisplayNames, Segmenter or PluralRules outside src/i18n/',
    '                       (Intl.X, Intl[\'X\'] or const { X } = Intl)',
    '                       (Hermes has none of the first four: "not a constructor" on the phone; plurals live in the',
    '                       catalogs); inside src/i18n/, an Intl.DateTimeFormat, RelativeTimeFormat, ListFormat,',
    '                       DisplayNames or Segmenter whose forced polyfill block intl-polyfills.ts lacks',
    '  number-format-api    Intl.NumberFormat outside src/i18n/ with a literal or missing locale (CLDR default digits);',
    '                       build it from localeTagFor(language, digits)',
    '  nested-isolates      a text that already carries bidi isolates passed straight into another t() value',
    '                       (contract isolatedFormatters, or a t() call given a *Name/*Text value): strip it first',
    '  i18n-runtime         the i18n runtime files exist (intl-polyfills.ts, languages.ts, messages.ts, create-t.ts,',
    '                       t-context.ts, i18n-provider.tsx, t.tsx and the source catalog)',
    '  polyfill-locales     intl-polyfills.ts forces Locale/PluralRules/NumberFormat with locale data for exactly',
    '                       LANGUAGES, each optional block (DateTimeFormat + one time-zone file, RelativeTimeFormat,',
    '                       ListFormat, DisplayNames, Segmenter) complete or absent. A language\'s data file is the',
    '                       first of its tag and its truncations the installed package ships (pt-BR -> pluralrules',
    '                       pt.js); an imported @formatjs package missing from node_modules fails; only a repo',
    '                       with no node_modules at all accepts the tag or a truncation',
    '  polyfill-first       the app entry (package.json "main", not expo-router/entry) imports the polyfills first',
    '  jest-polyfills       every setupFiles of the Jest config loads intl-polyfills.ts, and a literal path to it',
    '                       names the i18n folder the checkers read (a moved folder)',
    '  verify-script        package.json has an "i18n:verify" script that runs scripts/i18n/verify-catalogs.ts (exists)',
    '  tooling-dir          scripts/i18n/app-languages.ts I18N_DIR is the i18n folder the checkers read',
    '  supported-locales    the expo-localization plugin entry passes supportedLocales whose value comes from',
    '                       readAppLanguages() (followed through same-file consts), or literal lists equal to LANGUAGES',
    '  system-text-literal  a literal NS…UsageDescription value or plugin *Permission / *UsageDescription option in',
    '                       app.config, or a permission plugin that runs (listed, or an installed package prebuild',
    '                       applies on its own: expo-image-picker, expo-camera, expo-location, …) and writes its',
    '                       English default for a purpose key the config never sets: read it from the catalogs',
    '                       (nativeLocales, sourceText) or pass false',
    '  system-text-locales  with *.usage-description keys, app.config builds "locales" from the catalogs, holds no',
    '                       second copy of a text, lists every purpose key it sets in',
    '                       NATIVE_TEXT_KEYS.usageDescriptions, and passes nativeLocales a variantName when the',
    '                       config builds variants',
    '',
    'Test files (*.test.ts[x], test/, __mocks__/, testing/ folders) may use literal strings and casts.',
    'package.json, app.config.* and jest.config.* are read at the repo root, or in --app-dir.',
    'Folders holding a SKILL.md (installed skills) are never scanned.',
  ].join('\n'),
};

/** Text keys inside navigation options (Expo Router / React Navigation): options={{ title: ... }}. */
const NAV_OPTION_TEXT = /\b(title|headerTitle|headerBackTitle|tabBarLabel|tabBarAccessibilityLabel|tabBarBadge|drawerLabel)\s*:\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/gu;
const NAV_OPTION_PROPS = new Set(['options', 'screenOptions']);
const TEXT_PROPS = new Set(['text', 'label', 'title', 'hint', 'message', 'placeholder', 'subtitle', 'description', 'caption', 'summary', 'alt', 'defaultValue', 'accessibilityLabel', 'accessibilityHint', 'aria-label', 'aria-description', 'aria-valuetext']);
/** Custom component props that carry text by their name: emptyText, buttonLabel, errorMessage, sheetTitle. */
const TEXT_PROP_SUFFIX = /[a-z](?:Label|Text|Title|Message|Hint|Placeholder)$/;
/** Props with a text suffix whose value is an enum, not text (TextInput enterKeyHint="done"). */
const NON_TEXT_PROPS = new Set(['enterKeyHint']);
/**
 * Calls whose object argument shows text outside the app's own views: notification content (and
 * Android channel and action names in system Settings and on the notification), share sheets.
 */
const SYSTEM_TEXT_CALLS = [
  { callee: '(?:[A-Za-z_$][\\w$]*\\.)?scheduleNotificationAsync', label: 'scheduleNotificationAsync() content', names: ['title', 'subtitle', 'body'] },
  { callee: '(?:[A-Za-z_$][\\w$]*\\.)?setNotificationChannelAsync', label: 'setNotificationChannelAsync() (Android Settings shows it)', names: ['name', 'description'] },
  { callee: '(?:[A-Za-z_$][\\w$]*\\.)?setNotificationCategoryAsync', label: 'setNotificationCategoryAsync() action', names: ['buttonTitle'] },
  { callee: 'Share\\.share', label: 'Share.share()', names: ['title', 'message', 'dialogTitle', 'subject'] },
  { callee: '(?:[A-Za-z_$][\\w$]*\\.)?shareAsync', label: 'shareAsync() options', names: ['dialogTitle'] },
  { callee: 'ActionSheetIOS\\.showActionSheetWithOptions', label: 'ActionSheetIOS.showActionSheetWithOptions()', names: ['title', 'message', 'cancelButtonTitle'], arrays: ['options'] },
  { callee: 'ActionSheetIOS\\.showShareActionSheetWithOptions', label: 'ActionSheetIOS.showShareActionSheetWithOptions()', names: ['message', 'subject'] },
];
/**
 * Calls whose leading arguments are text the system shows or speaks: screen-reader announcements
 * (VoiceOver, TalkBack; announce() is accessibility-as-code's useAnnounce) and Android toasts.
 */
const TEXT_ARGUMENT_CALLS = [
  { callee: 'AccessibilityInfo\\.announceForAccessibility(?:WithOptions)?', label: 'AccessibilityInfo.announceForAccessibility()', what: 'the screen reader speaks it' },
  { callee: '(?:[A-Za-z_$][\\w$]*\\.)?announce', label: 'announce()', what: 'the screen reader speaks it' },
  { callee: 'ToastAndroid\\.show(?:WithGravity(?:AndOffset)?)?', label: 'ToastAndroid.show()', what: 'Android shows it as a toast' },
];
/**
 * A value that holds a count: a name like openCount, count, countOpen, total, taskTotal, n, numTasks
 * (also a call of one, countOpen(tasks)), or any .length / .size. Compared to 1, it picks a plural form.
 */
const COUNT_NAME = String.raw`(?:[a-z_$][\w$]*Count|count[\w$]*|[a-z_$][\w$]*Total|total|n|num[A-Z][\w$]*)`;
const COUNT_LEFT = String.raw`(?:(?<![\w$.])(?:[A-Za-z_$][\w$]*\s*\.\s*)*${COUNT_NAME}(?:\s*\([^()]*\))?|(?<![\w$.])(?:[A-Za-z_$][\w$]*\s*\.\s*)+(?:length|size)|\.\s*(?:length|size))`;
const COUNT_RIGHT = String.raw`(?:[A-Za-z_$][\w$]*\s*\.\s*)*(?:${COUNT_NAME}(?:\s*\([^()]*\))?|length|size)`;
const COUNT_TEST = new RegExp(
  String.raw`(${COUNT_LEFT}\s*(?:===?\s*1|!==?\s*1|>\s*1|<=\s*1|>=\s*2|<\s*2)|(?<![\w$.])(?:1\s*(?:===?|!==?|<|>=)|2\s*(?:<=|>))\s*${COUNT_RIGHT})(?![\w$.(])\s*\)?\s*\?`,
  'g',
);
/** Object props whose entries hold screen-reader text: accessibilityValue={{ text }}, accessibilityActions labels. */
const OBJECT_TEXT_PROPS = { accessibilityValue: ['text'], accessibilityActions: ['label'] };
const LETTER = /\p{L}/u;
const T_CALL = '(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?t';
const RUNTIME_FILES = ['intl-polyfills.ts', 'languages.ts', 'messages.ts', 'create-t.ts', 't-context.ts', 'i18n-provider.tsx', 't.tsx'];
const POLYFILL_STEPS = ['@formatjs/intl-getcanonicallocales/polyfill.js', '@formatjs/intl-locale/polyfill-force.js'];
/** The always-forced blocks: polyfill-force.js, then one locale-data file per language. */
const REQUIRED_BLOCKS = ['@formatjs/intl-pluralrules', '@formatjs/intl-numberformat'];
const DATE_TIME = '@formatjs/intl-datetimeformat';
/**
 * Optional forced blocks, in the order they follow the required ones. Each is required once a file
 * under the i18n folder uses its constructor (rule intl-api) and is never partial (polyfill-locales).
 * Hermes implements Intl.Collator, NumberFormat and DateTimeFormat only; DateTimeFormat is forced
 * anyway because native Hermes follows the device calendar and ignores -u-nu-.
 */
const OPTIONAL_BLOCKS = [
  { pkg: DATE_TIME, api: 'DateTimeFormat', data: true, timeZones: true },
  { pkg: '@formatjs/intl-relativetimeformat', api: 'RelativeTimeFormat', data: true },
  { pkg: '@formatjs/intl-listformat', api: 'ListFormat', data: true },
  { pkg: '@formatjs/intl-displaynames', api: 'DisplayNames', data: true },
  { pkg: '@formatjs/intl-segmenter', api: 'Segmenter', data: false },
];
const TIME_ZONE_FILES = ['add-golden-tz.js', 'add-all-tz.js'];
/** The exact versions the skill's runtime reference names ("Packages and versions", verified 2026-10-03). */
const PINNED = {
  '@formatjs/intl-getcanonicallocales': '3.2.12',
  '@formatjs/intl-locale': '5.3.12',
  '@formatjs/intl-pluralrules': '6.3.15',
  '@formatjs/intl-numberformat': '9.4.3',
  '@formatjs/intl-datetimeformat': '7.8.0',
  '@formatjs/intl-relativetimeformat': '12.3.15',
  '@formatjs/intl-listformat': '8.3.15',
  '@formatjs/intl-displaynames': '7.3.15',
  '@formatjs/intl-segmenter': '12.2.15',
};
/** Intl constructors Hermes does not implement: outside the i18n folder they are intl-api problems. */
const OUTSIDE_I18N_INTL = {
  RelativeTimeFormat: 'Write a relative time as a catalog plural ({daysCount, plural, =1 {yesterday} one {# day ago} other {# days ago}}), or format it in src/i18n/ on the forced @formatjs/intl-relativetimeformat polyfill.',
  ListFormat: 'Format the list in src/i18n/ (a formatList(items, language, digits) helper) on the forced @formatjs/intl-listformat polyfill, or write the sentence as one catalog message.',
  DisplayNames: 'Language names are autonyms in code (LANGUAGE_AUTONYMS); put other names in the catalogs, or format them in src/i18n/ on the forced @formatjs/intl-displaynames polyfill.',
  Segmenter: 'Segment text in src/i18n/ on the forced @formatjs/intl-segmenter polyfill.',
  PluralRules: 'Put the choice in the catalog as an ICU plural with every CLDR category of each language; code never picks a plural form (rule 5).',
};
const NON_FILE_ENTRIES = /^(expo-router\/entry|expo\/AppEntry)(\.js)?$/;
const JEST_CONFIGS = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts'];
const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'];
const CONFIG_OWNER = 'expo-project-bootstrap';
const TOOLING_LANGUAGES = 'scripts/i18n/app-languages.ts';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The tag, then the tag minus its last subtag, down to the language (truncation fallback, how the
 * FormatJS polyfills and Node's ICU find plural data; not CLDR's parentLocales): zh-Hant-TW, zh-Hant, zh.
 */
function fallbackChain(tag) {
  const parts = tag.split('-');
  return parts.map((_, index) => parts.slice(0, parts.length - index).join('-'));
}

/** The folders that may hold node_modules: the app's, then the repo root's. */
function moduleHomes(ctx) {
  return [...new Set([ctx.layout.appDir, ''])].map((home) => join(ctx.root, home, 'node_modules'));
}

/** The installed locale-data folder of a FormatJS package (the app's node_modules, then the repo root's), or null. */
function localeDataDir(ctx, pkg) {
  ctx.localeDataDirs ??= new Map();
  if (!ctx.localeDataDirs.has(pkg)) {
    const found = moduleHomes(ctx).map((home) => join(home, pkg, 'locale-data')).find((dir) => existsSync(dir));
    ctx.localeDataDirs.set(pkg, found ?? null);
  }
  return ctx.localeDataDirs.get(pkg);
}

/**
 * The locale-data import one language needs from one package. Installed: the first file of the
 * truncation chain the package ships (pt-BR -> pt.js in intl-pluralrules, which has no pt-BR.js).
 * Not installed: the tag or a truncation the polyfill file already imports, else the tag itself
 * (checkPolyfillPackages fails the missing package when the repo is installed at all).
 * `exists` is false when an installed package ships no file for the tag or any truncation.
 */
function localeDataImport(ctx, pkg, language, got) {
  const spec = (tag) => `${pkg}/locale-data/${tag}.js`;
  const chain = fallbackChain(language);
  const dir = localeDataDir(ctx, pkg);
  if (dir !== null) {
    const tag = chain.find((candidate) => existsSync(join(dir, `${candidate}.js`)));
    return { language, spec: spec(tag ?? language), tag: tag ?? language, installed: true, exists: tag !== undefined, chain };
  }
  const tag = chain.find((candidate) => got.includes(spec(candidate))) ?? language;
  return { language, spec: spec(tag), tag, installed: false, exists: true, chain };
}

/** The locale-data imports of one block for every language, without repeats (zh-Hans and zh-Hant share pluralrules zh.js). */
function dataImports(ctx, pkg, got) {
  const entries = ctx.languages.languages.map((language) => localeDataImport(ctx, pkg, language, got));
  return { entries, specs: [...new Set(entries.filter((entry) => entry.exists).map((entry) => entry.spec))] };
}

/** One block's imports: polyfill-force.js, its locale data, and (DateTimeFormat) the time-zone file. */
function blockImports(ctx, block, got) {
  const data = block.data ? dataImports(ctx, block.pkg, got) : { entries: [], specs: [] };
  const zone = block.timeZones ? [`${block.pkg}/${TIME_ZONE_FILES.find((name) => got.includes(`${block.pkg}/${name}`)) ?? TIME_ZONE_FILES[0]}`] : [];
  return { specs: [`${block.pkg}/polyfill-force.js`, ...data.specs, ...zone], entries: data.entries };
}

/**
 * The exact polyfill import list for the app's languages, in the order that works: the required
 * blocks, then each optional block the file already starts. `entries` holds every locale-data choice.
 */
function expectedPolyfills(ctx, got) {
  const present = OPTIONAL_BLOCKS.filter((block) => got.some((from) => from.startsWith(`${block.pkg}/`)));
  const blocks = [...REQUIRED_BLOCKS.map((pkg) => ({ pkg, data: true })), ...present].map((block) => blockImports(ctx, block, got));
  return { specs: [...POLYFILL_STEPS, ...blocks.flatMap((block) => block.specs)], entries: blocks.flatMap((block) => block.entries) };
}

/** The import specifiers of the polyfill module, or null when it does not exist. */
function polyfillImports(ctx) {
  const file = join(ctx.root, ctx.layout.i18nDir, 'intl-polyfills.ts');
  if (!existsSync(file)) return null;
  ctx.polyfillImports ??= findImports(readFileSync(file, 'utf8')).map((imp) => imp.from);
  return ctx.polyfillImports;
}

function isTest(rel) {
  return isTestFile(rel) || rel.includes('/testing/');
}

function scanFiles(root, scanDirs) {
  const inScope = (rel) => scanDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['*.d.ts'] }).filter(inScope);
}

function loadKeys(root, layout, languages, contract) {
  const source = languages?.sourceLanguage;
  const main = source ? readCatalogKeys(root, `${layout.i18nDir}/catalogs`, source) : null;
  const packages = contract.catalogs.map((entry) => ({ ...entry, keys: source ? readCatalogKeys(root, entry.dir, source) : null }));
  return { main, packages };
}

/** null when the key exists (or its catalog is unreadable, reported elsewhere), else the catalog it should be in. */
function missingFrom(key, catalogs, layout) {
  const pkg = catalogs.packages.find((entry) => key.startsWith(`${entry.keyPrefix}.`));
  if (pkg) return pkg.keys === null || pkg.keys.has(key) ? null : `${pkg.dir}`;
  return catalogs.main === null || catalogs.main.has(key) ? null : `${layout.i18nDir}/catalogs`;
}

/** Index of the first comma at bracket depth 0 between from and to in masked source, or -1. */
function topLevelComma(masked, from, to) {
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

/** The arguments of a call as [{ from, to }] spans (top-level commas), trimmed by the caller. */
function callArguments(masked, call) {
  const spans = [];
  let from = call.open + 1;
  while (from < call.close) {
    const comma = topLevelComma(masked, from, call.close);
    const to = comma === -1 ? call.close : comma;
    spans.push({ from, to });
    from = to + 1;
  }
  return spans;
}

/** True when a t() call is given a *Name or *Text value, the only values t() isolates. */
function hasTextValue(masked, call) {
  const comma = topLevelComma(masked, call.open + 1, call.close);
  return comma !== -1 && /\b[A-Za-z_$][\w$]*(?:Name|Text)\s*[:,}]/.test(masked.slice(comma, call.close));
}

function checkNestedIsolates(masked, formatters, problem) {
  const calls = findCalls(masked, T_CALL);
  const values = calls.map((call) => ({ from: topLevelComma(masked, call.open + 1, call.close), to: call.close })).filter((span) => span.from !== -1);
  const strips = findCalls(masked, 'stripIsolates');
  const isStripped = (index) => strips.some((strip) => index > strip.open && index < strip.close);
  const inner = [
    ...formatters.flatMap((name) => findCalls(masked, escapeRegExp(name)).map((call) => ({ call, name: `${name}(…)` }))),
    ...calls.filter((call) => hasTextValue(masked, call)).map((call) => ({ call, name: 't(…, values)' })),
  ];
  for (const { call, name } of inner) {
    if (!values.some((span) => call.start > span.from && call.start < span.to) || isStripped(call.start)) continue;
    problem(call.start, 'nested-isolates', `${name} is passed into t() as a value, but its text already carries bidi isolates (FSI…PDI), which t() isolates again`, `Wrap it: stripIsolates(${name.replace('(…, values)', '(…)')}) from src/i18n/bidi.ts, so the sentence holds one isolate per value (a date is one run of its language).`);
  }
}

function checkKeys(source, masked, checkKey, problem) {
  for (const call of findCalls(masked, 't')) {
    const arg = source.slice(call.open + 1, call.close).trim();
    const literal = /^(['"])([^'"]+)\1\s*(,|$)/.exec(arg);
    const choice = /^[^,'"`]+\?\s*(['"])([^'"]+)\1\s*:\s*(['"])([^'"]+)\3\s*(,|$)/.exec(arg);
    if (literal) checkKey(call.start, literal[2], 't()');
    else if (choice) {
      checkKey(call.start, choice[2], 't()');
      checkKey(call.start, choice[4], 't()');
    } else if (/^`[^`]*\$\{/.test(arg) || /^(['"`])[^'"`]*\1\s*\+/.test(arg) || /^[\w.]+\s*\+\s*['"`]/.test(arg)) {
      problem(call.start, 'dynamic-key', `t(${arg.split(',')[0]}) builds its key at runtime`, 'Write the key as a literal, or pick it from a typed table of literal keys (MONTH_SHORT_KEYS[month - 1]).');
    }
  }
}

function checkKeyCasts(masked, problem) {
  const casts = /\bas\s+(?:readonly\s+)?MessageKey\b(?:\s*\[\])?|<MessageKey>(?=\s*[\w('"`[])|\basMessageKey\s*\(/g;
  for (const match of masked.matchAll(casts)) {
    problem(match.index, 'key-cast', `"${match[0].replace(/\s*\($/, '(…)')}" turns an unchecked string into a message key`, 'Keep keys literal: a typed table (const KEYS = [...] as const satisfies readonly MessageKey[]) or a switch that returns literal keys; only src/i18n/messages.ts may brand package ids (when multi-package).');
  }
}

function checkPackageLiterals(source, masked, pkg, checkKey) {
  const literal = new RegExp(`(['"])(${escapeRegExp(pkg.keyPrefix)}(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*){1,4})\\1`, 'g');
  for (const m of source.matchAll(literal)) {
    if (masked[m.index] !== m[1]) continue; // inside a comment
    checkKey(m.index, m[2], 'package message id');
  }
}

/** Alert.alert(title, message, buttons) and Alert.prompt(title, message, buttons, type, defaultValue). */
const ALERT_TEXT_ARGS = { alert: [0, 1], prompt: [0, 1, 4] };
const ALERT_ARG_NAMES = ['title', 'message', 'buttons', 'type', 'default value'];

function checkAlert(source, masked, problem) {
  const FIX = "Pass t('<area>.<dialog>.title') / t('<area>.<dialog>.body') and t('common.cancel')-style button texts, or the app's dialog component with translated props.";
  for (const call of findCalls(masked, 'Alert\\.(?:alert|prompt)')) {
    const method = masked.slice(call.start, call.open).includes('prompt') ? 'prompt' : 'alert';
    callArguments(masked, call).forEach((span, position) => {
      const text = source.slice(span.from, span.to);
      const value = text.trim();
      const at = span.from + Math.max(0, text.search(/\S/));
      if (ALERT_TEXT_ARGS[method].includes(position) && isLiteralText(value)) {
        problem(at, 'literal-prop-text', `Alert.${method}() is given literal text as its ${ALERT_ARG_NAMES[position]} (${value.slice(0, 40)})`, FIX);
      }
      if (position === 2 && value.startsWith('[')) {
        for (const entry of quotedTextProperties(text, ['text'])) {
          problem(span.from + entry.index, 'literal-prop-text', `Alert.${method}() is given literal text as a button text ("${entry.value.slice(0, 40)}")`, FIX);
        }
      }
    });
  }
}

/** True when a call argument is literal text: a string with letters, a built template, or a literal branch. */
function isLiteralText(value) {
  return textLiteral(value) !== null || builtText(value) || literalBranch(value) !== null;
}

/** announceForAccessibility('Task deleted'), announce('Saved'), ToastAndroid.show('Saved', …): spoken or shown in one language. */
function checkTextArguments(source, masked, problem) {
  for (const sink of TEXT_ARGUMENT_CALLS) {
    for (const call of findCalls(masked, sink.callee)) {
      const [first] = callArguments(masked, call);
      if (!first) continue;
      const text = source.slice(first.from, first.to);
      const value = text.trim();
      if (!isLiteralText(value)) continue;
      problem(first.from + Math.max(0, text.search(/\S/)), 'literal-prop-text', `${sink.label} is given literal text (${value.slice(0, 40)}): ${sink.what} in one language on every phone`, `Pass t('area.element') (one short sentence, in every catalog) from the code that has t(): the model hook, or a service that receives it.`);
    }
  }
}

/**
 * count === 1 ? t('tasks.one') : t('tasks.many'), or n > 1 ? 'tasks' : 'task': a plural form picked
 * in code. Both branches must be text (a t() call, <T>, formatMessage or a string literal); the
 * compared value must look like a count (see COUNT_OPERAND).
 */
function checkCountBranches(masked, problem) {
  const textBranch = (from) => {
    const at = from + (/^\s*/.exec(masked.slice(from))?.[0].length ?? 0);
    const quote = masked[at];
    if (quote === "'" || quote === '"' || quote === '`') {
      const end = masked.indexOf(quote, at + 1);
      return end === -1 ? -1 : end + 1;
    }
    const call = new RegExp(`^(?:${T_CALL}|(?:[A-Za-z_$][\\w$]*\\.)?formatMessage)\\s*\\(`).exec(masked.slice(at, at + 80));
    if (call) {
      const close = findClosing(masked, at + call[0].length - 1);
      return close === -1 ? -1 : close + 1;
    }
    if (/^<T\b/.test(masked.slice(at, at + 3))) {
      const end = masked.indexOf('/>', at);
      return end === -1 ? -1 : end + 2;
    }
    return -1;
  };
  for (const match of masked.matchAll(COUNT_TEST)) {
    const afterYes = textBranch(match.index + match[0].length);
    if (afterYes === -1) continue;
    const colon = /^\s*:/.exec(masked.slice(afterYes));
    if (!colon || textBranch(afterYes + colon[0].length) === -1) continue;
    const test = `${match[1].startsWith('.') ? '…' : ''}${match[1].replace(/\s+/g, ' ')}`;
    problem(match.index, 'count-branch', `"${test} ? … : …" picks a plural form in code: two forms fit English, but Arabic needs six, Persian puts 0 in "one" and Russian puts 0 in "many"`, "Write one key with an ICU plural in every catalog ({openCount, plural, one {# open task} other {# open tasks}} plus each language's CLDR categories) and call t('area.element', { openCount }) once.");
  }
}

/** new Intl.NumberFormat('ar') or with no locale: CLDR's default digits, which move between releases. */
function checkNumberFormat(source, masked, problem) {
  for (const call of findCalls(masked, 'Intl\\.NumberFormat')) {
    const [first] = callArguments(masked, call);
    const locale = first ? source.slice(first.from, first.to).trim() : '';
    if (locale !== '' && !/^(['"`[]|undefined$)/.test(locale)) continue;
    problem(call.start, 'number-format-api', `Intl.NumberFormat(${locale}) picks its digits from CLDR's default for the language, not from the person's digits setting`, 'Build the formatter from the locale tag: new Intl.NumberFormat(localeTagFor(language, digits), options) (src/i18n/digits.ts), or put the number in a catalog message as {n, number}.');
  }
}

/** options={{ title: 'Tasks' }} on a navigator screen, or navigation.setOptions({ title }): a header or tab label that never translates. */
function checkNavOptions(attr, problem, where = '') {
  for (const match of attr.value.matchAll(NAV_OPTION_TEXT)) {
    if (!LETTER.test(match[3]) || /\$\{/.test(match[3])) continue;
    problem(attr.index, 'literal-prop-text', `navigation option ${match[1]}: ${match[2]}${match[3]}${match[2]}${where} is text that is not from t()`, `Set ${match[1]}: t('area.element') in a layout under the I18nProvider (a group layout such as src/app/(app)/_layout.tsx calls useT()) or in the screen's model hook, so headers, tabs and back buttons follow the language.`);
  }
}

/** navigation.setOptions({ title: 'Edit task' }), notification content, share sheets. */
function checkSystemSinks(source, masked, problem) {
  const plain = maskComments(source);
  for (const call of findCalls(masked, '(?:[A-Za-z_$][\\w$]*\\.)?setOptions')) {
    checkNavOptions({ value: plain.slice(call.open + 1, call.close), index: call.start }, problem, ' in setOptions()');
  }
  for (const sink of SYSTEM_TEXT_CALLS) {
    for (const call of findCalls(masked, sink.callee)) {
      const inside = plain.slice(call.open + 1, call.close);
      for (const entry of quotedTextProperties(inside, sink.names)) {
        problem(call.open + 1 + entry.index, 'literal-prop-text', `${sink.label} gets literal text as ${entry.name} ("${entry.value.slice(0, 40)}"): the system shows it in one language on every phone`, `Pass ${entry.name}: t('area.element') from the code that schedules or shares (a model hook or service that receives t), with the key in every catalog.`);
      }
      for (const entry of quotedTextsInArray(inside, sink.arrays ?? [])) {
        problem(call.open + 1 + entry.index, 'literal-prop-text', `${sink.label} gets literal text in ${entry.name} ("${entry.value.slice(0, 40)}"): the system shows it in one language on every phone`, `Build ${entry.name} from t(): [t('common.cancel'), t('tasks.delete.title')], with the keys in every catalog.`);
      }
    }
  }
}

/** A prop whose value is shown as text: the known names, or a custom prop named like one (emptyText). */
function isTextProp(name) {
  return TEXT_PROPS.has(name) || (TEXT_PROP_SUFFIX.test(name) && !NON_TEXT_PROPS.has(name));
}

function checkTextProps(attrs, problem) {
  for (const [name, attr] of attrs) {
    if (NAV_OPTION_PROPS.has(name) && attr.kind === 'expr') checkNavOptions(attr, problem);
    if (Object.hasOwn(OBJECT_TEXT_PROPS, name) && attr.kind === 'expr') {
      for (const entry of quotedTextProperties(attr.value, OBJECT_TEXT_PROPS[name])) {
        problem(attr.index, 'literal-prop-text', `${name}={{ ${entry.name}: ${JSON.stringify(entry.value)} }} is screen-reader text that is not from t()`, `Pass ${entry.name}: t('area.element') with a catalog key (every language).`);
      }
    }
    if (!isTextProp(name)) continue;
    const literal = literalOf(attr);
    const built = attr.kind === 'expr' && builtText(attr.value);
    const branch = literal === null && !built && attr.kind === 'expr' ? literalBranch(attr.value) : null;
    if ((literal !== null && LETTER.test(literal)) || built || branch !== null) {
      const shown = literal !== null ? JSON.stringify(literal) : branch !== null ? `{…${branch}…}` : attr.value;
      problem(attr.index, 'literal-prop-text', `${name}=${shown} is text that is not from t()`, `Pass ${name}={t('area.element')} with a catalog key (every language); for a choice write {isOn ? t('a.on') : t('a.off')}.`);
    }
  }
}

/** Every text run and {expression} child the element renders (each position reported once per file). */
function checkChildren(source, masked, tag, { problem, reported }) {
  const FIX = "Render text with <T id=\"area.element\" values={{ … }} /> or <AppText>{t('area.element')}</AppText>: one whole sentence per key, its numbers as {n, number} or a plural.";
  const children = jsxChildren(source, masked, tag);
  if (!children.closed) return;
  const once = (index, message) => {
    if (reported.has(index)) return;
    reported.add(index);
    problem(index, 'jsx-literal-text', message, FIX);
  };
  for (const run of children.runs) once(run.index, `text "${run.text.slice(0, 40)}" is written straight into <${run.owner}>`);
  for (const child of children.expressions) {
    const literal = textLiteral(child.value);
    const branch = literal === null ? literalBranch(child.value) : null;
    if (literal !== null) once(child.index, `the string literal {${child.value.slice(0, 40)}} is rendered as text inside <${child.owner}>`);
    else if (builtText(child.value)) once(child.index, `the built text {${child.value.slice(0, 40)}} is rendered inside <${child.owner}>`);
    else if (branch !== null) once(child.index, `{…${branch}…} renders literal text inside <${child.owner}>`);
  }
}

function checkJsx(source, masked, { test, checkKey, problem }) {
  const reported = new Set();
  for (const tag of findJsxTags(source, masked)) {
    const attrs = jsxAttributes(source, tag, masked);
    if (tag.name === 'T') {
      const id = attrs.get('id');
      const literal = literalOf(id);
      if (literal !== null) checkKey(tag.start, literal, '<T id>');
      else if (id && id.kind === 'expr' && /^`[^`]*\$\{/.test(id.value)) problem(tag.start, 'dynamic-key', '<T id={`...${}`}> builds its key at runtime', 'Pass a literal key or one from a typed table.');
    }
    if (test) continue;
    checkTextProps(attrs, problem);
    if (!tag.selfClosing) checkChildren(source, masked, tag, { problem, reported });
  }
}

function checkFile(ctx, rel) {
  const { root, layout, contract, catalogs, report } = ctx;
  const source = readFileSync(join(root, rel), 'utf8');
  const masked = maskCode(source);
  const test = isTest(rel);
  const inI18n = rel.startsWith(`${layout.i18nDir}/`);
  const problem = (index, rule, message, fix) => report.problem({ file: rel, line: lineOf(source, index), rule, message, fix });
  const checkKey = (index, key, how) => {
    const catalog = missingFrom(key, catalogs, layout);
    if (catalog) problem(index, 'unknown-key', `${how} uses "${key}", which is not in ${catalog}`, 'Add the key to every catalog (source language first) or fix the spelling.');
  };
  for (const imp of findImports(source, masked)) {
    if ((imp.from === 'react-intl' || imp.from.startsWith('react-intl/')) && !inI18n) {
      problem(imp.index, 'react-intl-import', `react-intl is imported outside ${layout.i18nDir}/`, `Use useT() / <T> from ${layout.i18nDir}; only the i18n folder talks to react-intl.`);
    }
  }
  const uses = inI18n ? [] : intlUses(source, masked);
  if (!inI18n) {
    const dateUses = [...uses.filter((use) => use.api === 'DateTimeFormat').map((use) => ({ index: use.index, name: 'Intl.DateTimeFormat' })), ...[...masked.matchAll(/\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\s*\(/g)].map((m) => ({ index: m.index, name: `.${m[1]}` }))];
    for (const use of dateUses) {
      problem(use.index, 'date-format-api', `${use.name} formats outside ${layout.i18nDir}/, with the device's calendar and no control of the digits`, `Format dates with ${layout.i18nDir}/format-date.ts (formatDayMonth(dateKey, t)) and numbers with t() or a formatter built from localeTagFor(language, digits).`);
    }
  }
  checkKeys(source, masked, checkKey, problem);
  if (!test && !inI18n) checkNumberFormat(source, masked, problem);
  if (!test && !inI18n) checkIntlOutside(ctx, uses, problem);
  if (!test && inI18n) checkPolyfilledApis(ctx, rel, source, masked, problem);
  if (!test) {
    checkNestedIsolates(masked, contract.isolatedFormatters, problem);
    if (rel !== `${layout.i18nDir}/messages.ts`) checkKeyCasts(masked, problem);
    for (const pkg of catalogs.packages.filter((entry) => entry.sourceDir && rel.startsWith(`${entry.sourceDir}/`))) checkPackageLiterals(source, masked, pkg, checkKey);
    checkAlert(source, masked, problem);
    checkTextArguments(source, masked, problem);
    checkSystemSinks(source, masked, problem);
    checkCountBranches(masked, problem);
  }
  if (rel.endsWith('.tsx')) checkJsx(source, masked, { test, checkKey, problem });
}

function checkRuntimeFiles(ctx) {
  const { root, layout, languages, report } = ctx;
  const files = [...RUNTIME_FILES.map((name) => `${layout.i18nDir}/${name}`), `${layout.i18nDir}/catalogs/${languages?.sourceLanguage ?? 'en'}.json`];
  for (const file of files.filter((rel) => !existsSync(join(root, rel)))) {
    report.problem({ file, line: 1, rule: 'i18n-runtime', message: `${file} is missing: the i18n runtime (polyfills, languages, catalogs, t(), the provider, <T>) is incomplete`, fix: "Copy it from the skill's templates/src/i18n/ (with its test), then rerun." });
  }
}

/** A locale-data import of an installed FormatJS package whose file does not exist (Metro and Jest: "Cannot find module"). */
function missingDataFile(ctx, from) {
  const match = /^(@formatjs\/[^/]+)\/locale-data\/([^/]+)\.js$/.exec(from);
  if (!match) return false;
  const dir = localeDataDir(ctx, match[1]);
  return dir !== null && !existsSync(join(dir, `${match[2]}.js`));
}

/** Notes for languages whose data comes from a parent tag, or from nowhere. */
function fallbackNotes(entries) {
  const notes = [];
  for (const entry of entries) {
    const pkg = entry.spec.split('/locale-data/')[0];
    if (!entry.exists) notes.push(`${pkg} ships no locale data for ${entry.language} (looked for ${entry.chain.map((tag) => `${tag}.js`).join(', ')})`);
    else if (entry.installed && entry.tag !== entry.language) notes.push(`${entry.language} uses ${entry.tag}.js from ${pkg}, which has no ${entry.language}.js (the polyfill falls back to the tag minus its last subtag)`);
  }
  return [...new Set(notes)];
}

/**
 * In an installed repo (some node_modules exists), every @formatjs package the polyfill file imports
 * or needs must be installed: only a repo with no node_modules at all gets the tag-or-truncation
 * fallback of localeDataImport.
 */
function checkPolyfillPackages(ctx, file, specs) {
  const homes = moduleHomes(ctx);
  if (!homes.some((home) => existsSync(home))) return;
  const text = readFileSync(join(ctx.root, file), 'utf8');
  const packages = [...new Set(specs.map((spec) => /^(@formatjs\/[^/]+)\//.exec(spec)?.[1]).filter(Boolean))];
  for (const pkg of packages.filter((name) => !homes.some((home) => existsSync(join(home, name))))) {
    const at = text.indexOf(`'${pkg}/`);
    ctx.report.problem({ file, line: at === -1 ? 1 : lineOf(text, at), rule: 'polyfill-locales', message: `${pkg} is not installed (no node_modules/${pkg}), so Metro and Jest fail with "Cannot find module"`, fix: `npm install -E ${pkg}@${PINNED[pkg] ?? '<the exact version the skill\'s runtime reference names>'} (an exact dependency, the skill's runtime reference, "Packages and versions"), then rerun.` });
  }
}

function checkPolyfillList(ctx) {
  const { layout, languages, report } = ctx;
  const file = `${layout.i18nDir}/intl-polyfills.ts`;
  const got = polyfillImports(ctx);
  if (!languages || got === null) return;
  const { specs: expected, entries } = expectedPolyfills(ctx, got);
  checkPolyfillPackages(ctx, file, [...got, ...expected]);
  const notes = fallbackNotes(entries);
  const absent = entries.filter((entry) => !entry.exists);
  if (got.join('\n') === expected.join('\n') && absent.length === 0) return;
  const extra = got.filter((from) => !expected.includes(from)).map((from) => (missingDataFile(ctx, from) ? `${from} (not in the installed package: Metro and Jest fail with "Cannot find module")` : from));
  const missing = expected.filter((from) => !got.includes(from));
  const order = !missing.length && !extra.length && absent.length === 0 ? 'wrong order' : '';
  const detail = [missing.length ? `missing ${missing.join(', ')}` : '', extra.length ? `unexpected ${extra.join(', ')}` : '', order].filter(Boolean).join('; ');
  const why = notes.length > 0 ? `; ${notes.join('; ')}` : '';
  const installed = entries.some((entry) => entry.installed) ? '' : ` (the @formatjs packages are not installed here, so a language may also use a truncated tag's file: pt-BR -> pt.js; install them and rerun to get the exact files)`;
  report.problem({ file, line: 1, rule: 'polyfill-locales', message: `the polyfill imports are not the list LANGUAGES (${languages.languages.join(', ')}) needs (${detail || 'no locale data'})${why}`, fix: `Import exactly, in this order: ${expected.join(', ')}${installed}. Each language's locale-data file is the first of the tag and its truncations (the tag minus its last subtag) that the package ships; an optional block (DateTimeFormat, RelativeTimeFormat, ListFormat, DisplayNames, Segmenter) is complete or absent.` });
}

/** The exact imports to add for one optional block, for the fix text. */
function blockFix(ctx, block, got) {
  const { specs } = blockImports(ctx, block, got);
  const before = OPTIONAL_BLOCKS.slice(0, OPTIONAL_BLOCKS.indexOf(block)).filter((other) => got.some((from) => from.startsWith(`${other.pkg}/`))).at(-1);
  const after = before ? before.pkg : '@formatjs/intl-numberformat';
  return `Install ${block.pkg} (exact version: the skill's runtime reference, "Packages and versions") and add to ${ctx.layout.i18nDir}/intl-polyfills.ts after the ${after} block: ${specs.map((spec) => `import '${spec}';`).join(' ')}`;
}

/**
 * Every Intl API a file reaches: Intl.X (also globalThis.Intl.X), Intl['X'], and destructuring
 * (const { ListFormat, DateTimeFormat: DTF } = Intl). [{ api, index }], first use per api and form.
 */
function intlUses(source, masked) {
  const uses = [...masked.matchAll(/\bIntl\s*\.\s*([A-Z]\w*)/g)].map((m) => ({ api: m[1], index: m.index }));
  const plain = maskComments(source);
  for (const m of plain.matchAll(/\bIntl\s*\[\s*(['"])([A-Z]\w*)\1\s*\]/g)) uses.push({ api: m[2], index: m.index });
  for (const m of masked.matchAll(/\{([^{}]*)\}\s*=\s*(?:globalThis\s*\.\s*)?Intl\b(?!\s*\.)/g)) {
    for (const name of m[1].matchAll(/(?:^|,)\s*([A-Z]\w*)\s*(?=[:,=]|$)/g)) uses.push({ api: name[1], index: m.index + 1 + name.index });
  }
  return uses.sort((a, b) => a.index - b.index);
}

/**
 * intl-api inside the i18n folder: a file uses an Intl constructor whose forced polyfill block
 * intl-polyfills.ts does not have. Hermes has no RelativeTimeFormat, ListFormat, DisplayNames or
 * Segmenter ("not a constructor" on the phone while Jest on Node passes), and its DateTimeFormat
 * follows the device calendar. A present but incomplete block is polyfill-locales' job.
 */
function checkPolyfilledApis(ctx, rel, source, masked, problem) {
  if (rel === `${ctx.layout.i18nDir}/intl-polyfills.ts`) return;
  const got = polyfillImports(ctx);
  if (got === null || !ctx.languages) return;
  const uses = intlUses(source, masked);
  for (const block of OPTIONAL_BLOCKS) {
    if (got.some((from) => from.startsWith(`${block.pkg}/`))) continue;
    const match = uses.find((use) => use.api === block.api);
    if (!match) continue;
    const why = block.api === 'DateTimeFormat' ? 'native Hermes formats it with the device calendar and ignores the digits in the locale tag' : `Hermes has no Intl.${block.api}, so it throws "not a constructor" on the phone while Jest on Node passes`;
    problem(match.index, 'intl-api', `Intl.${block.api} runs without its forced polyfill: ${why}`, blockFix(ctx, block, got));
  }
}

/** intl-api outside the i18n folder: Intl constructors Hermes lacks, and PluralRules (plurals live in the catalogs). */
function checkIntlOutside(ctx, uses, problem) {
  for (const match of uses.filter((use) => Object.hasOwn(OUTSIDE_I18N_INTL, use.api))) {
    const { api } = match;
    const why = api === 'PluralRules' ? 'picks a plural form in code, where only the catalogs know each language\'s forms' : `Hermes has no Intl.${api} ("not a constructor" on the phone while Jest on Node passes)`;
    problem(match.index, 'intl-api', `Intl.${api} is used outside ${ctx.layout.i18nDir}/: ${why}`, OUTSIDE_I18N_INTL[api]);
  }
}

/** tooling-dir: scripts/i18n/app-languages.ts reads the same i18n folder as the checkers. */
function checkToolingDir(ctx) {
  const { root, layout, report } = ctx;
  const file = appFile(layout, TOOLING_LANGUAGES);
  if (!existsSync(join(root, file))) return;
  const text = readFileSync(join(root, file), 'utf8');
  const match = /export const I18N_DIR\s*=\s*(['"])([^'"]+)\1/.exec(maskComments(text));
  const expected = layout.appDir ? layout.i18nDir.slice(layout.appDir.length + 1) : layout.i18nDir;
  const fix = `Set export const I18N_DIR = '${expected}'; in ${file} (native-locales, i18n-contract and review-sheet read it), so app.config.ts and npm run i18n:verify read the folder the checkers read (rn-skills.config.json "i18nDir", --i18n-dir).`;
  if (!match) {
    report.problem({ file, line: 1, rule: 'tooling-dir', message: `${file} has no literal I18N_DIR, so the tooling cannot follow a moved i18n folder`, fix });
  } else if (match[2].replace(/\/+$/, '') !== expected) {
    report.problem({ file, line: lineOf(text, match.index), rule: 'tooling-dir', message: `I18N_DIR is '${match[2]}', but the checkers read the i18n folder at ${layout.i18nDir}: app.config.ts and npm run i18n:verify would read other catalogs than the checkers`, fix });
  }
}

function isPolyfillImport(root, layout, entry, spec) {
  const aliases = layout.aliases.length > 0 ? layout.aliases : [{ pattern: '@/*', targets: [`${layout.srcDir}/*`] }];
  const resolved = resolveImport(entry, spec, { root, aliases });
  if (resolved.kind === 'local' && resolved.exists) return resolved.path === `${layout.i18nDir}/intl-polyfills.ts`;
  return /(^|\/)i18n\/intl-polyfills(\.ts)?$/.test(spec);
}

function checkEntry(ctx, entryOption) {
  const { root, layout, report } = ctx;
  const FIX = `Create index.ts with \`import '@/i18n/intl-polyfills';\` as its first import and \`import 'expo-router/entry';\` as its last, and set "main": "index.ts" in package.json (Expo Router's documented custom entry).`;
  let entry = entryOption;
  if (!entry) {
    const manifest = appFile(layout, 'package.json');
    const skip = notYetCreated(root, { file: manifest, owner: 'expo-project-bootstrap' });
    if (skip) return report.skip({ file: manifest, rule: 'polyfill-first', message: skip });
    const text = readFileSync(join(root, manifest), 'utf8');
    const main = JSON.parse(text).main;
    if (typeof main !== 'string' || NON_FILE_ENTRIES.test(main)) {
      const at = text.indexOf('"main"');
      return report.problem({ file: manifest, line: at === -1 ? 1 : lineOf(text, at), rule: 'polyfill-first', message: `the app entry is ${main === undefined ? "Expo's default" : `"${main}"`}, so route modules load before anything can force the Intl polyfills`, fix: FIX });
    }
    entry = appFile(layout, main.replace(/^\.\//, ''));
  }
  if (!existsSync(join(root, entry))) return report.problem({ file: entry, line: 1, rule: 'polyfill-first', message: `the app entry ${entry} does not exist`, fix: FIX });
  const source = readFileSync(join(root, entry), 'utf8');
  const first = findImports(source)[0];
  if (!first || !/^import\s*['"]/.test(first.text) || !isPolyfillImport(root, layout, entry, first.from)) {
    report.problem({ file: entry, line: first ? lineOf(source, first.index) : 1, rule: 'polyfill-first', message: `the first import is ${first ? `"${first.from}"` : 'missing'}, not the Intl polyfills`, fix: FIX });
  }
  return undefined;
}

/** The text of the expression that starts at `from` and ends at a top-level , ; or closing bracket. */
function expressionAt(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return masked.slice(from, i);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return masked.slice(from, i);
  }
  return masked.slice(from);
}

/**
 * The string literals naming intl-polyfills that the expression at `from` reaches, directly or
 * through the constants it names ([{ value, index }]); `found` is true when the name appears at all.
 */
function polyfillReach(masked, from, depth = 0, seen = new Set()) {
  const expression = expressionAt(masked, from);
  const result = { found: expression.includes('intl-polyfills'), literals: [] };
  for (const m of expression.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*intl-polyfills(?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    result.literals.push({ value: m[2], index: from + m.index });
  }
  if (depth > 4) return result;
  for (const [name] of expression.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const declaration = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*`).exec(masked);
    if (!declaration) continue;
    const inner = polyfillReach(masked, declaration.index + declaration[0].length, depth + 1, seen);
    result.found ||= inner.found;
    result.literals.push(...inner.literals);
  }
  return result;
}

/** A setupFiles path as a path from the app folder: '<rootDir>/', './' and a template's ${…} prefix dropped, aliases resolved. */
function setupPath(value, layout) {
  let path = value.replace(/^\$\{[^}]*\}\/?/, '').replace(/^<rootDir>\//, '').replace(/^\.\//, '');
  for (const alias of layout.aliases) {
    const prefix = alias.pattern.replace(/\*$/, '');
    const target = alias.targets[0]?.replace(/\*$/, '');
    if (alias.pattern.endsWith('*') && target !== undefined && path.startsWith(prefix)) path = `${target}${path.slice(prefix.length)}`.replace(/^\.\//, '');
  }
  return path.replace(/\.(ts|js|mjs|cjs)$/, '');
}

function checkJest(ctx) {
  const { root, layout, report } = ctx;
  const configs = JEST_CONFIGS.map((name) => appFile(layout, name)).filter((name) => existsSync(join(root, name)));
  if (configs.length === 0) {
    const file = appFile(layout, 'jest.config.js');
    report.skip({ file, rule: 'jest-polyfills', message: notYetCreated(root, { file, owner: 'unit-and-component-tests' }) });
    return;
  }
  const fromApp = layout.appDir ? layout.i18nDir.slice(layout.appDir.length + 1) : layout.i18nDir;
  const want = `${fromApp}/intl-polyfills`;
  const fix = `List '<rootDir>/${fromApp}/intl-polyfills.ts' in setupFiles of every Jest project, so Jest formats exactly like the phone.`;
  for (const name of configs) {
    const text = readFileSync(join(root, name), 'utf8');
    const masked = maskComments(text);
    const uses = [...masked.matchAll(/\bsetupFiles\s*:\s*/g)];
    if (uses.length === 0) report.problem({ file: name, line: 1, rule: 'jest-polyfills', message: 'the Jest config has no setupFiles, so tests format with Node\'s ICU instead of the polyfills', fix });
    const wrongPaths = new Map();
    for (const use of uses) {
      const reach = polyfillReach(masked, use.index + use[0].length);
      if (!reach.found) report.problem({ file: name, line: lineOf(text, use.index), rule: 'jest-polyfills', message: `setupFiles (${expressionAt(masked, use.index + use[0].length).trim().slice(0, 40)}) does not load intl-polyfills.ts`, fix });
      for (const literal of reach.literals.filter((entry) => setupPath(entry.value, layout) !== want)) wrongPaths.set(literal.index, literal.value);
    }
    for (const [index, value] of wrongPaths) {
      report.problem({ file: name, line: lineOf(text, index), rule: 'jest-polyfills', message: `setupFiles loads '${value}', but the i18n folder is ${fromApp}: Jest runs without the polyfills (the canonical config skips a setup file that does not exist), on Node's ICU instead of what the phone runs`, fix: `Point it at '${fromApp}/intl-polyfills.ts' (the canonical jest.config.js: const INTL_POLYFILLS), the folder rn-skills.config.json "i18nDir" and scripts/i18n/app-languages.ts I18N_DIR name.` });
    }
  }
}

/** The source catalog as an object, or null when it is missing or unreadable (reported elsewhere). */
function readSourceCatalog(ctx) {
  const { root, layout, languages } = ctx;
  if (!languages) return null;
  const catalogFile = join(root, layout.i18nDir, 'catalogs', `${languages.sourceLanguage}.json`);
  if (!existsSync(catalogFile)) return null;
  try {
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    return typeof catalog === 'object' && catalog !== null && !Array.isArray(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

/** supported-locales: the languages are declared to iOS (CFBundleLocalizations) and Android 13+. */
function checkSupportedLocales(ctx, file, text) {
  const { languages, report } = ctx;
  if (!languages) return;
  const found = supportedLocalesProblem(maskComments(text), languages.languages);
  if (found) report.problem({ file, line: lineOf(text, found.index), rule: 'supported-locales', message: found.message, fix: "Add ['expo-localization', { supportedLocales: { ios: languages, android: languages } }] with const { languages } = readAppLanguages(projectRoot) (scripts/i18n/app-languages.ts), so the list always equals LANGUAGES." });
}

/** The app's dependency names (package.json dependencies and devDependencies); empty without one. */
function installedPackages(ctx) {
  const manifest = join(ctx.root, appFile(ctx.layout, 'package.json'));
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** system-text-literal and system-text-locales on an app.config.* file. */
function checkPurposeTexts(ctx, file, text) {
  const { report } = ctx;
  const masked = maskComments(text);
  for (const found of literalPurposeTexts(masked)) {
    report.problem({ file, line: lineOf(text, found.index), rule: 'system-text-literal', message: `${found.name}: '${found.value.slice(0, 40)}' is a literal purpose string: one language for every person, outside the catalogs and the review queue`, fix: `Add a <area>.<topic>.usage-description key to every catalog, list its NS…UsageDescription key in NATIVE_TEXT_KEYS.usageDescriptions (nativeLocales writes every language) and pass sourceText(projectRoot, '<key>') here as the base text (scripts/i18n/native-locales.ts).` });
  }
  for (const found of defaultPurposeTexts(masked, installedPackages(ctx))) {
    const how = found.listed ? `${file} runs the ${found.pkg} plugin` : `${found.pkg} is installed, and prebuild applies its plugin even though ${file} does not list it`;
    report.problem({ file, line: lineOf(text, found.index), rule: 'system-text-literal', message: `${how}, so it writes ${found.plistKeys.join(', ')} with its English default ('Allow $(PRODUCT_NAME) to …'): one language for every person, outside the catalogs`, fix: `List ['${found.pkg}', { … }] in plugins with each option the app uses read from the catalogs (sourceText(projectRoot, '<area>.<topic>.usage-description'), its NS…UsageDescription key in NATIVE_TEXT_KEYS.usageDescriptions) and false for each permission it never asks (references/runtime-and-provider.md, "Base texts of config plugins").` });
  }
  for (const found of uncoveredPurposeKeys(masked)) {
    const via = found.via === found.plistKey ? '' : ` (through ${found.via})`;
    report.problem({ file, line: lineOf(text, found.index), rule: 'system-text-locales', message: `${file} sets ${found.plistKey}${via}, but NATIVE_TEXT_KEYS.usageDescriptions does not list it, so only the base text reaches iOS and every other language shows it untranslated`, fix: `Add ${found.plistKey}: '<area>.<topic>.usage-description' to NATIVE_TEXT_KEYS.usageDescriptions in ${file} (and the key to every catalog).` });
  }
  const unnamed = missingVariantName(masked);
  if (unnamed) report.problem({ file, line: lineOf(text, unnamed.index), rule: 'system-text-locales', message: 'the config builds variants, but nativeLocales() gets no variantName, so the development and preview builds show the store name on every phone whose language the app declares', fix: 'Pass nativeLocales(projectRoot, NATIVE_TEXT_KEYS, { variantName: (name) => variantIdentity({ ...BASE, name }, variant).name }) (app-variants-and-environment owns the label).' });
  const source = readSourceCatalog(ctx);
  if (source !== null) {
    for (const found of configCatalogKeys(masked).filter((entry) => !Object.hasOwn(source, entry.key))) {
      report.problem({ file, line: lineOf(text, found.index), rule: 'unknown-key', message: `${found.via} names "${found.key}", which is not in ${ctx.layout.i18nDir}/catalogs/${ctx.languages.sourceLanguage}.json: npx expo config (and every build) throws "native-locales: the ${ctx.languages.sourceLanguage} catalog lacks ${found.key}"`, fix: 'Add the key to every catalog as plain text (an app name, or a <area>.<topic>.usage-description purpose string), or fix the spelling.' });
    }
  }
  const catalog = source ?? {};
  const systemKeys = Object.keys(catalog).filter((key) => key.endsWith('.usage-description'));
  if (systemKeys.length > 0 && !/\blocales\s*[:,}\n]/.test(masked)) {
    report.problem({ file, line: 1, rule: 'system-text-locales', message: `the catalogs hold ${systemKeys.join(', ')}, but ${file} sets no "locales", so iOS shows the base text in every language`, fix: "Set locales: nativeLocales(projectRoot, { displayName: 'app.name', usageDescriptions: { NS…UsageDescription: '<area>.<topic>.usage-description' } }) from scripts/i18n/native-locales.ts." });
  }
  for (const key of systemKeys.filter((k) => typeof catalog[k] === 'string' && catalog[k].length > 0 && text.includes(catalog[k]))) {
    report.problem({ file, line: lineOf(text, text.indexOf(catalog[key])), rule: 'system-text-locales', message: `${file} repeats the text of ${key}: a second copy drifts from the catalogs`, fix: "Read the text from the catalogs instead: nativeLocales for locales, sourceText(projectRoot, '<key>') for a plugin's base text." });
  }
}

function checkAppConfig(ctx) {
  const { root, layout, report } = ctx;
  const config = APP_CONFIGS.map((name) => appFile(layout, name)).find((name) => existsSync(join(root, name)));
  if (config) {
    const text = readFileSync(join(root, config), 'utf8');
    checkSupportedLocales(ctx, config, text);
    checkPurposeTexts(ctx, config, text);
    return;
  }
  const json = appFile(layout, 'app.json');
  const file = appFile(layout, 'app.config.ts');
  const systemKeys = Object.keys(readSourceCatalog(ctx) ?? {}).filter((key) => key.endsWith('.usage-description'));
  if (!existsSync(join(root, json))) {
    const reason = notYetCreated(root, { file, owner: CONFIG_OWNER });
    report.skip({ file, rule: 'supported-locales', message: reason });
    if (systemKeys.length > 0) report.skip({ file, rule: 'system-text-locales', message: reason });
    return;
  }
  const text = readFileSync(join(root, json), 'utf8');
  checkSupportedLocales(ctx, json, text);
  if (systemKeys.length > 0) report.problem({ file: json, line: 1, rule: 'system-text-locales', message: 'app.json cannot read the catalogs, so its permission texts are a second copy', fix: 'Move the config to app.config.ts and build "locales" from the catalogs (scripts/i18n/native-locales.ts).' });
}

/** verify-script: the in-repo catalog gate (FormatJS verify + the linter) that CI runs without the skill. */
function checkVerifyScript(ctx) {
  const { root, layout, report } = ctx;
  const manifest = appFile(layout, 'package.json');
  const skip = notYetCreated(root, { file: manifest, owner: 'expo-project-bootstrap' });
  if (skip) return report.skip({ file: manifest, rule: 'verify-script', message: skip });
  const text = readFileSync(join(root, manifest), 'utf8');
  const command = JSON.parse(text).scripts?.['i18n:verify'];
  const FIX = 'Add "i18n:verify": "node scripts/i18n/verify-catalogs.ts" to "scripts" and copy templates/scripts/i18n/ from the skill; quality-gates\' npm run verify (and so CI) runs it.';
  const at = (needle) => Math.max(1, lineOf(text, Math.max(0, text.indexOf(needle))));
  if (typeof command !== 'string') return report.problem({ file: manifest, line: at('"scripts"'), rule: 'verify-script', message: 'package.json has no "i18n:verify" script, so CI never runs the catalog gate (FormatJS verify + the catalog linter)', fix: FIX });
  const target = /(?:^|\s)((?:\.\/)?[\w./-]*verify-catalogs\.(?:ts|mts|mjs|js))(?=\s|$)/.exec(command)?.[1];
  if (!target) return report.problem({ file: manifest, line: at('"i18n:verify"'), rule: 'verify-script', message: `"i18n:verify" runs "${command}", not scripts/i18n/verify-catalogs.ts`, fix: FIX });
  const file = appFile(layout, target.replace(/^\.\//, ''));
  if (!existsSync(join(root, file))) report.problem({ file: manifest, line: at('"i18n:verify"'), rule: 'verify-script', message: `"i18n:verify" runs ${target}, which does not exist (${file})`, fix: FIX });
  return undefined;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`nothing to check: ${root} does not exist`, 'Pass the app repo root.');
  const layout = resolveAppLayout(root, { appDir: options['app-dir'], i18nDir: options['i18n-dir'] });
  const languages = readLanguages(root, layout, {});
  const contract = readContract(root, layout, { contract: options.contract });
  const scanDirs = options.src.length > 0 ? options.src.map((dir) => dir.replace(/\/+$/, '')) : [layout.srcDir, ...contract.catalogs.map((entry) => entry.sourceDir).filter(Boolean)];
  const files = scanFiles(root, scanDirs);
  if (files.length === 0) {
    const workspaces = layout.appDir ? [] : layout.workspaces.map((entry) => entry.dir);
    const hint = workspaces.length > 0 ? ` In a monorepo, pass the app's workspace: --app-dir ${workspaces.join(' | ')}.` : '';
    fail(`nothing to check: no .ts/.tsx files under ${scanDirs.join(', ')}`, `Run from the app repo root, or pass it: node check-i18n-code.mjs <repo-root>.${hint}`);
  }
  const report = createReporter({ name: 'check-i18n-code', json: options.json });
  const ctx = { root, layout, languages, contract, catalogs: loadKeys(root, layout, languages, contract), report };
  for (const rel of files) checkFile(ctx, rel);
  checkRuntimeFiles(ctx);
  checkPolyfillList(ctx);
  checkToolingDir(ctx);
  checkEntry(ctx, options.entry);
  checkJest(ctx);
  checkVerifyScript(ctx);
  checkAppConfig(ctx);
  return report.finish({ checked: files.length, unit: 'source files' });
});
