// eslint.config.mjs: the ONE ESLint config for the app (ESLint 9 flat config).
// Written by the expo-project-bootstrap skill; the typescript-and-lint-rules skill maintains it.
// Changing it needs a `Gate-Change:` commit trailer (it is a gated path in quality-gates.json).
// Exceptions live in this file only: inline eslint-disable comments are switched off (block 0).
// UI primitives, app zones, the expo-iap adapter block and the __mocks__ naming block are merged
// here too, so there is exactly one copy of every rule.
// Layout: one Expo app at the repo root (src/app routes, src/features, src/ui, src/core, ...).
// When multi-package: set IS_MULTI_PACKAGE (explicit .ts extensions) and add the package-boundary
// blocks described in the typescript-and-lint-rules skill.
// @ts-check
import reactNativeOfficial from '@react-native/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import prettierConfig from 'eslint-config-prettier/flat';
import checkFile from 'eslint-plugin-check-file';
import formatjs from 'eslint-plugin-formatjs';
import globals from 'globals';
import jestPlugin from 'eslint-plugin-jest';
import reactNative from 'eslint-plugin-react-native';
import sonarjs from 'eslint-plugin-sonarjs';
import testingLibrary from 'eslint-plugin-testing-library';
import tseslint from 'typescript-eslint';

// When multi-package: workspace packages consumed as TypeScript source through
// "exports": { "./*": "./src/*" } do not resolve without the file extension, so every import
// writes it (./x.ts, @org/pkg/x.tsx). A single app resolves extensionless imports; Node-run code
// (app.config.ts, plugins/, scripts/) always writes the extension (Node type stripping needs it).
const IS_MULTI_PACKAGE = false;

// ---------------------------------------------------------------------------------------------
// File groups (the canonical app layout).
// ---------------------------------------------------------------------------------------------
const ALL_TS = ['**/*.{ts,tsx}'];
/** Code that ships inside the app bundle. */
const RUNTIME = ['src/**/*.{ts,tsx}'];
/** Expo Router route files: the router reads their default export. */
const ROUTES = ['src/app/**/*.{ts,tsx}'];
/** Code that runs in Node: the app config, config plugins and tooling scripts. */
const NODE_CODE = ['app.config.ts', 'plugins/**/*.ts', 'scripts/**/*.ts'];
/** Pure TypeScript: no React, React Native, Expo or Skia imports. */
const PURE = ['src/core/**/*.ts', 'src/games/*/{rules,levels}/**/*.ts'];
/**
 * Deterministic code: seeded output (daily seeds, generated content, replays, levels) must match on
 * every device. A seeded generator module is named <name>-generator.ts wherever its feature lives.
 */
const DETERMINISTIC = [
  'src/core/rng/**/*.ts',
  'src/core/dates/**/*.ts',
  'src/games/*/{rules,levels,sim,geom}/**/*.ts',
  'src/**/*-generator.ts',
];
const TESTS = [
  '**/*.test.{ts,tsx}',
  'test/**/*.{ts,tsx}',
  'jest.setup.ts',
  '__mocks__/**/*.{ts,tsx}',
];
const GOLDEN_TESTS = ['**/*.golden.test.ts'];
/** Plain JS config files (babel, jest, metro, eslint itself) and JS tooling. */
const JS_CONFIG = ['*.{js,cjs,mjs}', 'scripts/**/*.{js,cjs,mjs}', 'plugins/**/*.{js,cjs,mjs}'];
/**
 * The only files allowed to import a vendor SDK (one adapter per port), with their platform files
 * (x-adapter.ios.ts). The same globs as architecture-and-boundaries' adapter defaults.
 */
const ADAPTERS = [
  'src/services/*/*-adapter{,.ios,.android,.native,.web}.{ts,tsx}',
  'src/data/**/*-adapter{,.ios,.android,.native,.web}.{ts,tsx}',
  'src/data/**/*-sql-driver{,.ios,.android,.native,.web}.ts',
];
const CLOCK_ADAPTERS = ['src/services/clock/*-adapter.ts'];
/** The root entry ("main"): it runs before the composition root, so no vendor SDK starts there. */
const ROOT_ENTRIES = ['index.{ts,tsx}'];
/** Background task registries: TaskManager.defineTask runs at module scope, outside any adapter. */
const TASK_REGISTRIES = ['src/services/*/define-*-tasks.ts'];
/** The one file that asks for App Tracking Transparency (ConsentPort.requestTracking). */
const ATT_ADAPTER = [
  'src/services/consent/*-consent-adapter{,.ios,.android,.native,.web}.{ts,tsx}',
];
const DIRECTION_MODULE = ['src/i18n/direction.ts'];
const APP_TEXT = ['src/ui/app-text.tsx'];
/** The network policy: fetch, XMLHttpRequest and WebSocket only inside the ApiClient. */
const NETWORK_CODE = ['src/api/**/*.ts'];
/** Remote URLs live only in config: the EXPO_PUBLIC_API_URL base URL and external links. */
const URL_CODE = ['src/config/**/*.ts'];
/** Locale-aware date and number formatting happens at the edge, in the i18n formatters. */
const FORMATTERS = ['src/i18n/**/*.{ts,tsx}'];

// App zones on resolved paths (block 5-zones).
const ROOT = import.meta.dirname;

// ---------------------------------------------------------------------------------------------
// Shared option lists. A later flat-config block REPLACES a rule's options for the files it
// matches (no merging), so every block that narrows a rule rebuilds it from these lists.
// ---------------------------------------------------------------------------------------------
const NETWORK_POLICY =
  'Network calls go through the ApiClient in src/api/ (the default network policy).';
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: NETWORK_POLICY,
}));
const TEST_GLOBALS = ['jest', 'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach'].map(
  (name) => ({ name, message: 'Test globals belong in *.test.ts(x) files only.' }),
);

const RESTRICTED_PROPERTIES = [
  {
    object: 'Math',
    property: 'random',
    message: 'Use the seeded RNG (src/core/rng) or an injected random source.',
  },
  { object: 'Date', property: 'now', message: 'Inject ClockPort (src/services/clock).' },
  { object: 'performance', property: 'now', message: 'Use the frame timestamp or ClockPort.' },
  { object: 'I18nManager', property: 'isRTL', message: 'Read direction from DirectionContext.' },
];
// Node code (tooling, config) reads the wall clock in one module only.
const WALL_CLOCK = 'Read the wall clock only in scripts/clock/system-clock.ts.';
const NODE_CLOCK_PROPERTIES = [{ object: 'Date', property: 'now', message: WALL_CLOCK }];
const NODE_NEW_DATE = {
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message: WALL_CLOCK,
};
const withoutProperty = (object, property) =>
  RESTRICTED_PROPERTIES.filter(
    (entry) => !(entry.object === object && entry.property === property),
  );

const vendor = (name, port) => ({
  name,
  message: `Only the ${port} adapter (src/services/*/*-adapter.ts, src/data/**/*-adapter.ts) may import ${name}.`,
});
const VENDOR_SDK_PATHS = [
  vendor('react-native-google-mobile-ads', 'AdsPort/ConsentPort'),
  vendor('expo-iap', 'PurchasePort'),
  vendor('expo-sqlite', 'SqlDriver'),
  vendor('react-native-audio-api', 'AudioPort'),
  vendor('expo-haptics', 'HapticsPort'),
  vendor('expo-network', 'ConnectivityPort'),
  vendor('@react-native-community/netinfo', 'ConnectivityPort'),
  vendor('@sentry/react-native', 'CrashReporterPort'),
  vendor('expo-updates', 'UpdatesPort'),
  vendor('expo-secure-store', 'SecureStoragePort'),
  vendor('expo-auth-session', 'OauthPort'),
  vendor('expo-apple-authentication', 'AppleSignInPort'),
  vendor('expo-file-system', 'file-system (ExportFilesPort, DatabaseFiles)'),
  vendor('expo-sharing', 'ShareSheetPort'),
  vendor('expo-document-picker', 'FilePickerPort'),
  vendor('expo-notifications', 'LocalNotificationsPort/PushPort'),
  vendor('expo-background-task', 'BackgroundTasksPort'),
  vendor('expo-task-manager', 'BackgroundTasksPort'),
  vendor('posthog-react-native', 'AnalyticsPort'),
];
const TASK_MANAGER_IMPORT = VENDOR_SDK_PATHS.find((entry) => entry.name === 'expo-task-manager');
const banned = (name, message) => ({ name, message });
// The app asks for App Tracking Transparency before any ad or analytics request that could use the
// IDFA, and only the consent adapter does (every other file keeps this ban).
const ATT_IMPORT = banned(
  'expo-tracking-transparency',
  'Only src/services/consent/<sdk>-consent-adapter.ts asks for tracking (ConsentPort).',
);
const BANNED_PACKAGE_PATHS = [
  banned('axios', 'Use the ApiClient in src/api/ (fetch, typed and validated).'),
  banned(
    '@react-native-async-storage/async-storage',
    'Use expo-sqlite/kv-store for preferences and expo-secure-store for secrets.',
  ),
  banned('react-native-iap', 'IAP goes through PurchasePort (expo-iap).'),
  ATT_IMPORT,
  banned('react-native-restart', 'Use reloadAppAsync from expo.'),
  {
    name: 'react-native',
    importNames: ['Alert'],
    message: 'Use the dialog components in src/ui (themed, translatable, testable).',
  },
  {
    name: 'react-native',
    importNames: ['SafeAreaView'],
    message: 'Use react-native-safe-area-context.',
  },
];
const TEXT_IMPORT = {
  name: 'react-native',
  importNames: ['Text'],
  message: 'Render text with AppText from @/ui/app-text.',
};
const I18N_MANAGER_IMPORT = {
  name: 'react-native',
  importNames: ['I18nManager'],
  message: 'Only src/i18n/direction.ts touches I18nManager.',
};
const PARENT_IMPORT = {
  group: ['../*', '../../*', '../../../*', '../../../../*'],
  message: 'No parent-relative imports: use ./sibling or the @/ alias (@/features/tasks/...).',
};
const NODE_BUILTINS = {
  group: ['node:*', 'fs', 'path', 'child_process', 'os', 'crypto', 'http', 'https', 'net'],
  message: 'Node built-ins do not exist in the app runtime.',
};
const PURE_MESSAGE =
  "src/core and game rules are pure TypeScript: import only src/core, the game's own rules/levels/geom and siblings.";
const PURE_IMPORTS = {
  group: [
    'react',
    'react/*',
    'react-native',
    'react-native-*',
    'react-native/*',
    '@react-native/*',
    'expo',
    'expo-*',
    '@expo/*',
    '@shopify/*',
    'zustand',
    'zustand/*',
  ],
  message: PURE_MESSAGE,
};
// The @/ alias outside src/core and the pure folders of a game (levels import their game's rules and
// geometry). A gitignore-style negation ('!@/core/*') cannot re-include a file under the excluded
// '@/core' folder, so the alias is matched by a regex (verified 2026-10-03). Which game may import
// which is an import/no-restricted-paths zone the games plugin adds.
const PURE_ALIAS = {
  regex: '^@/(?!core/|games/[^/]+/(?:rules|levels|geom)/)',
  message: PURE_MESSAGE,
};

// Every block that narrows no-restricted-imports starts from RUNTIME_PATHS minus its exemptions.
const without = (paths, ...removed) => paths.filter((entry) => !removed.includes(entry));
// `allow` lifts a banned package for one file-exact block (the ATT adapter); nothing else does.
// `allowParent` lifts the parent-import ban for Node code, which cannot use the @/ alias.
const restrictedImports = ({ paths = [], patterns = [], allow = [], allowParent = false }) => [
  'error',
  {
    paths: [...without(BANNED_PACKAGE_PATHS, ...allow), ...paths],
    patterns: [...(allowParent ? [] : [PARENT_IMPORT]), ...patterns],
  },
];
const REACT_INTL_IMPORT = {
  name: 'react-intl',
  message: 'Use t() / <T> from src/i18n, never react-intl directly.',
};
// UI primitives, compiler-era memo, deprecated/unsupported APIs.
const rn = (name, message) => ({ name: 'react-native', importNames: [name], message });
const PRESSABLE_IMPORT = rn('Pressable', 'Use the buttons and rows in src/ui.');
const IMAGE_IMPORT = rn(
  'Image',
  'Use Image from expo-image (caching, sizing) or the Icon component in src/ui.',
);
const UI_PATHS = [
  PRESSABLE_IMPORT,
  IMAGE_IMPORT,
  rn('Dimensions', 'Use useWindowDimensions: windows resize on iPad, foldables and desktop.'),
  rn('Animated', 'Use react-native-reanimated.'),
  {
    name: 'react',
    importNames: ['useMemo', 'useCallback', 'memo'],
    message: 'React Compiler memoizes; a hand-written memo needs a measured reason.',
  },
];
const RUNTIME_PATHS = [
  ...VENDOR_SDK_PATHS,
  TEXT_IMPORT,
  I18N_MANAGER_IMPORT,
  REACT_INTL_IMPORT,
  ...UI_PATHS,
];
// Port types (`*-port.ts`) stay importable: a ui/ component may receive a port as a prop.
// Match files, not folders: a negation cannot re-include a file under an excluded folder.
const UI_BOUNDARY = {
  group: [
    '@/stores/*',
    '@/features/*',
    '@/services/*/*',
    '!@/services/*/*-port',
    '!@/services/*/*-port.ts',
  ],
  message: 'src/ui is presentational: data arrives through props.',
};
// The only app files that read the wall clock or performance.now (performance instrumentation).
const PERF_CLOCK_FILES = ['src/services/perf/*-adapter.ts'];
const PERF_PROPERTIES = RESTRICTED_PROPERTIES.filter(
  (entry) => entry.object !== 'Date' && entry.object !== 'performance',
);
// IAPKit server features and hidden transaction finishing stay banned inside the purchase adapter.
const EXPO_IAP_SERVER_APIS = {
  name: 'expo-iap',
  importNames: ['kitApi', 'KitApiError', 'verifyPurchaseWithProvider', 'verifyPurchase', 'useIAP'],
  message:
    'IAPKit server features and useIAP (hidden finishing) are off: the adapter calls the plain API.',
};
const RUNTIME_IMPORTS = restrictedImports({ paths: RUNTIME_PATHS, patterns: [NODE_BUILTINS] });

// Physical-direction style keys (RTL), only inside style contexts: logic may use `left`/`right` as
// data. Verified selector (2026-09-26).
const PHYSICAL_KEYS =
  '/^(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/';
const STYLE_CONTEXT =
  ":matches(CallExpression[callee.object.name='StyleSheet'][callee.property.name='create'], JSXAttribute[name.name=/[sS]tyle$/], VariableDeclarator[id.typeAnnotation.typeAnnotation.typeName.name=/Style$/])";
const KEBAB = '[a-z0-9]+(-[a-z0-9]+)*';
// A MIME type (`type: 'image/jpeg'` in a multipart part, getDocumentAsync({ type: 'application/pdf' }),
// or a wildcard: '*/*', 'image/*') is an external data format, not an app kind.
const MIME_TYPE = '/^([a-z]+|[*])\\/([a-z0-9.+-]+|[*])$/';
// Handlers passed straight to an on* prop. react-hook-form's handleSubmit(onValid) returns a promise
// and rethrows what onValid throws, so it counts as an async handler.
const ON_PROP = 'JSXAttribute[name.name=/^on[A-Z]/] > JSXExpressionContainer';
const HANDLER_NAME = 'VariableDeclarator[id.name=/^handle[A-Z]/]';

const SYNTAX = {
  physicalStyleKeys: {
    selector: `${STYLE_CONTEXT} Property[key.name=${PHYSICAL_KEYS}]`,
    message: 'RTL: use start/end (marginStart, paddingEnd, start, end), never left/right.',
  },
  textAlignLiteral: {
    selector: "Property[key.name='textAlign'][value.value=/^(left|right)$/]",
    message: "RTL: pass align='start'|'end' to AppText instead of textAlign left/right.",
  },
  rowReverse: {
    selector: "Property[key.name='flexDirection'][value.value='row-reverse']",
    message: 'RTL: row already mirrors in right-to-left layouts; row-reverse double-flips.',
  },
  enums: {
    selector: 'TSEnumDeclaration',
    message: 'No enums: use a string-literal union from an `as const` array.',
  },
  remoteUrl: {
    selector: 'Literal[value=/^(https?|wss?|ftp):\\/\\//i]',
    message:
      'No remote URLs in app code: the API base URL comes from src/config (EXPO_PUBLIC_API_URL); links live in src/config.',
  },
  remoteUrlTemplate: {
    selector: 'TemplateElement[value.raw=/^(https?|wss?|ftp):\\/\\//i]',
    message: 'No remote URLs in app code: the API base URL and links come from src/config.',
  },
  // new Date() with no argument reads the wall clock; new Date(epochMs) converts an instant.
  newDate: {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'new Date() reads the wall clock: inject ClockPort (src/services/clock).',
  },
  intlDate: {
    selector:
      "MemberExpression[object.name='Intl'][property.name=/^(DateTimeFormat|RelativeTimeFormat)$/]",
    message: 'Format dates in src/i18n (one place applies the locale, calendar and polyfills).',
  },
  toLocaleCall: {
    selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
    message: 'Hermes ignores numbering-system settings here: use t() or the src/i18n formatters.',
  },
  setTimeoutNoDelay: {
    selector: "CallExpression[callee.name='setTimeout'][arguments.length<2]",
    message: 'Pass an explicit delay.',
  },
  a11yLiteral: {
    selector:
      'JSXAttribute[name.name=/^(aria-label|accessibilityLabel|accessibilityHint|placeholder|title|alt)$/] > Literal',
    message: 'User-facing text props come from t().',
  },
  testIdFormat: {
    selector: `JSXAttribute[name.name='testID'] > Literal[value!=/^${KEBAB}(\\.${KEBAB})+$/]`,
    message: "testID is '<screen>.<element>' in kebab-case, e.g. 'tasks.add-button'.",
  },
  kindValue: {
    selector: `Property[key.name=/^(kind|type)$/] > Literal[value=/[^a-z0-9-]/][value!=${MIME_TYPE}]`,
    message: "`kind`/`type` values are kebab-case string literals, e.g. 'task-completed'.",
  },
  kindTypeValue: {
    selector: `TSPropertySignature[key.name=/^(kind|type)$/] TSLiteralType > Literal[value=/[^a-z0-9-]/][value!=${MIME_TYPE}]`,
    message: "`kind`/`type` values are kebab-case string literals, e.g. 'task-completed'.",
  },
  asyncHandler: {
    selector: [
      `${ON_PROP} > :function[async=true]`,
      `${ON_PROP} > CallExpression:matches([callee.name='handleSubmit'], [callee.property.name='handleSubmit'])`,
      `${HANDLER_NAME} > :function[async=true]`,
      'FunctionDeclaration[async=true][id.name=/^handle[A-Z]/]',
    ].join(', '),
    message: 'Event handlers are synchronous: start async work with `task().catch(reportError)`.',
  },
  // A handler returns nothing, so a promise it starts is a statement no-floating-promises sees:
  // onPress={() => Linking.openURL(url)} returns the promise, and React Native's Strict API types
  // onPress as returning unknown, so no-misused-promises stays silent and the rejection vanishes.
  handlerBody: {
    selector: [
      `${ON_PROP} > ArrowFunctionExpression[expression=true]`,
      `${HANDLER_NAME} > ArrowFunctionExpression[expression=true]`,
      `${ON_PROP} > :function > BlockStatement > ReturnStatement[argument]`,
      `${HANDLER_NAME} > :function > BlockStatement > ReturnStatement[argument]`,
      'FunctionDeclaration[id.name=/^handle[A-Z]/] > BlockStatement > ReturnStatement[argument]',
    ].join(', '),
    message: 'Event handlers return nothing: use a block body and end async work with .catch().',
  },
  pressableA11y: {
    selector:
      "JSXOpeningElement[name.name='Pressable']:not(:has(JSXAttribute[name.name=/^(accessibilityRole|role)$/]))",
    message: 'Every Pressable declares role (and a label from t()).',
  },
  storeWithoutSelector: {
    selector:
      ":matches(CallExpression[callee.name=/^use[A-Z][A-Za-z]*Store$/][arguments.length=0], CallExpression[callee.name='useStore'][arguments.length<2])",
    message: 'Pass a selector to the store hook: a bare call re-renders on every change.',
  },
};
// Relative imports in Node-run code carry their extension (Node type stripping resolves nothing).
const NODE_IMPORT_EXTENSION = {
  selector:
    ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^\\./][source.value!=/\\.(ts|tsx|json|js|mjs|cjs)$/]',
  message: 'Write the file extension (./x.ts): Node type stripping needs it.',
};
// When multi-package: every relative and workspace import carries its extension.
const PACKAGE_IMPORT_EXTENSION = {
  selector:
    ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^(\\.|@\\/)/][source.value!=/\\.(ts|tsx|json)$/]',
  message: 'Write the file extension (./x.ts, @org/pkg/x.tsx): package source imports need it.',
};
const DETERMINISM_SYNTAX = [
  {
    selector:
      "MemberExpression[object.name='Math'][property.name!=/^(sqrt|imul|floor|round|abs|min|max|PI)$/]",
    message: 'Deterministic code uses only + - * /, sqrt, imul, floor, round, abs, min, max.',
  },
  {
    selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
    message: 'Deterministic code: ** is Math.pow; multiply explicitly.',
  },
  // Locale-aware calls read the device's ICU data and locale (Hermes and V8 ship different data).
  // Intl.DateTimeFormat, Intl.RelativeTimeFormat and toLocale(Date|Time)String are already banned by
  // runtimeSyntax(), so these selectors leave them out (one message per node).
  {
    selector: "CallExpression[callee.property.name='localeCompare']",
    message:
      'Deterministic code: localeCompare depends on the device locale; compare with < and >.',
  },
  {
    selector:
      "MemberExpression[object.name='Intl'][property.name!=/^(DateTimeFormat|RelativeTimeFormat)$/]",
    message: 'Deterministic code: Intl output depends on the device locale and ICU data.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^toLocale(Upper|Lower)Case$/]',
    message: 'Deterministic code: use toUpperCase/toLowerCase, never the device locale.',
  },
];
const runtimeSyntax = (omit = []) => [
  'error',
  ...Object.entries(SYNTAX)
    .filter(([key]) => !omit.includes(key))
    .map(([, value]) => value),
  ...(IS_MULTI_PACKAGE ? [PACKAGE_IMPORT_EXTENSION] : []),
];

const BOOLEAN_PREFIXES = ['is', 'has', 'can', 'should', 'did', 'will', 'was'];
const NAMING_CONVENTION = [
  {
    selector: 'default',
    format: ['camelCase'],
    leadingUnderscore: 'forbid',
    trailingUnderscore: 'forbid',
  },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
  // React components are PascalCase functions.
  { selector: 'variable', types: ['function'], format: ['camelCase', 'PascalCase'] },
  { selector: 'function', format: ['camelCase', 'PascalCase'] },
  {
    selector: 'variable',
    types: ['boolean'],
    format: ['PascalCase', 'UPPER_CASE'],
    prefix: [...BOOLEAN_PREFIXES, ...BOOLEAN_PREFIXES.map((p) => `${p.toUpperCase()}_`)],
  },
  { selector: 'variable', modifiers: ['destructured'], format: null },
  { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
  {
    selector: 'parameter',
    types: ['boolean'],
    format: ['PascalCase'],
    prefix: BOOLEAN_PREFIXES,
    leadingUnderscore: 'allow',
  },
  { selector: 'typeLike', format: ['PascalCase'] },
  {
    selector: 'typeParameter',
    format: ['PascalCase'],
    custom: { regex: '^(T|T[A-Z][A-Za-z]+)$', match: true },
  },
  // Object keys may mirror external APIs, style props or catalog keys.
  { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
];

// Expo Router names: index, _layout, +not-found / +html / +native-intent / +middleware, [param],
// [...rest], (group), API routes (tasks+api, [taskId]+api), plus kebab-case segments. A param starts
// with a lowercase letter ([taskId], never [TaskId]: naming-conventions' route-segment rule). Every
// other file is kebab-case.
const ROUTE_FILE =
  '@(_layout|index|+([a-z0-9-])|+(+)+([a-z-])|\\[*(.)[a-z]*([a-zA-Z0-9])\\]|+([a-z0-9-])\\+api|\\[*(.)[a-z]*([a-zA-Z0-9])\\]\\+api)';
const ROUTE_FOLDER = '@(+([a-z0-9-])|\\(+([a-z0-9-])\\)|\\[*(.)[a-z]*([a-zA-Z0-9])\\])';

// Top-level folders and files that existed before the app (knowledge, design exports, notes).
// The bootstrap generator fills this list; nothing in them is our code. Each entry is also a line in
// .prettierignore and an entry of the root tsconfig.json "exclude" (tsc includes every **/*.ts).
const PRE_EXISTING = [];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.expo/**',
    'ios/**',
    'android/**',
    'build/**',
    'dist/**',
    'web-build/**',
    'coverage/**',
    'reports/**',
    'dist-audit/**',
    '.stryker-tmp/**',
    '.skill-tooling/**',
    '**/expo-env.d.ts',
    // Agent skills (installed copies hold templates and planted-bug fixtures) and agent settings.
    'skills/**',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.cursor/**',
    '.windsurf/**',
    '.roo/**',
    '.cline/**',
    '.continue/**',
    '.kiro/**',
    ...PRE_EXISTING,
  ]),

  // 0. No inline eslint-disable comments anywhere; unused exceptions are errors.
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },

  // 1. Expo base: import, react, react-hooks (React Compiler rules) and expo rules.
  expoConfig,
  {
    plugins: {
      sonarjs,
      'react-native': reactNative,
      '@react-native': reactNativeOfficial,
      'check-file': checkFile,
    },
    settings: {
      'import/resolver': {
        typescript: { project: ['tsconfig.json', 'src/tsconfig.json'] },
        node: true,
      },
    },
    rules: { 'import/no-named-as-default-member': 'off' },
  },

  // 2. Type-aware TypeScript rules.
  {
    files: ALL_TS,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: true },
      ],
      '@typescript-eslint/no-floating-promises': [
        'error',
        { ignoreVoid: false, ignoreIIFE: false },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-async-promise-executor': 'error',
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'start' },
      ],
      'sonarjs/no-commented-code': 'error',
      '@typescript-eslint/naming-convention': ['error', ...NAMING_CONVENTION],
    },
  },

  // 3. Size and complexity limits.
  {
    files: ALL_TS,
    rules: {
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 40, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', { max: 10, variant: 'modified' }],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'max-classes-per-file': ['error', 1],
      'react/jsx-max-depth': ['error', { max: 5 }],
      'react/no-multi-comp': ['error', { ignoreStateless: false }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 4. Rules for every TypeScript file: exports, imports, hygiene.
  {
    files: ALL_TS,
    rules: {
      'import/no-default-export': 'error',
      'import/no-cycle': ['error', { maxDepth: 10 }],
      'import/no-duplicates': 'error',
      'import/no-self-import': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          pathGroups: [
            { pattern: '@/**', group: 'internal' },
            { pattern: '@test/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-restricted-imports': restrictedImports({}),
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-nested-ternary': 'error',
      'no-param-reassign': ['error', { props: true }],
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { '{test,scripts,plugins}/**/': 'KEBAB_CASE', 'src/!(app)/**/': 'KEBAB_CASE' },
      ],
      'check-file/filename-blocklist': [
        'error',
        {
          '**/{util,utils,helper,helpers,misc,common,shared,stuff}.{ts,tsx}': '**/[a-z]*-[a-z]*.ts',
        },
      ],
    },
  },

  // 5. App runtime code: network, determinism of time, RTL-safe styles, i18n, SDK adapters.
  {
    files: RUNTIME,
    rules: {
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS, ...TEST_GLOBALS],
      'no-restricted-properties': ['error', ...RESTRICTED_PROPERTIES],
      'no-restricted-imports': RUNTIME_IMPORTS,
      'no-restricted-syntax': runtimeSyntax(),
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, noAttributeStrings: false },
      ],
      'react-native/no-unused-styles': 'error',
      'react-native/no-inline-styles': 'error',
      'react-native/no-color-literals': 'error',
      'react-native/no-single-element-style-arrays': 'error',
      '@react-native/no-deep-imports': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
      'check-file/filename-blocklist': [
        'error',
        {
          '**/{util,utils,helper,helpers,misc,common,shared,stuff}.{ts,tsx}': '**/[a-z]*-[a-z]*.ts',
          'src/!(app)/**/index.{ts,tsx}': '**/[a-z]*-[a-z]*.ts',
        },
      ],
    },
  },

  // 5-routes. Expo Router route files: the router reads the default export (and the exact names
  // unstable_settings, ErrorBoundary, generateStaticParams), and file and folder names follow the
  // router's grammar.
  {
    files: ROUTES,
    rules: {
      'import/no-default-export': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        ...NAMING_CONVENTION,
        {
          selector: 'variable',
          modifiers: ['exported'],
          filter: { regex: '^unstable_settings$', match: true },
          format: null,
        },
      ],
      'check-file/filename-naming-convention': [
        'error',
        { 'src/app/**/*.{ts,tsx}': ROUTE_FILE },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { 'src/app/**/': ROUTE_FOLDER }],
    },
  },

  // 5-zones. import/no-restricted-paths works on RESOLVED paths, so it catches every spelling
  // (relative or @/): routes are leaves, src/core is the bottom layer, and the app never imports
  // tooling, test helpers or mocks. Target globs must match files, and basePath is the repo root.
  {
    files: RUNTIME,
    ignores: TESTS,
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          basePath: ROOT,
          zones: [
            {
              target: './src/!(app)/**/*',
              from: './src/app',
              message:
                'Routes are leaves: move shared code from src/app into src/features or src/ui.',
            },
            {
              target: './src/core/**/*',
              from: './src',
              except: ['./core'],
              message: 'src/core is the bottom layer: it imports only src/core.',
            },
            {
              target: './src/**/*',
              from: ['./scripts', './plugins', './app.config.ts', './test', './__mocks__'],
              message: 'Tooling, test helpers and mocks are never bundled into the app.',
            },
          ],
        },
      ],
    },
  },

  // 5-i18n. FormatJS for JSX text and user-facing props: src/i18n wraps react-intl in t() and <T>,
  // and only src/i18n may import react-intl.
  {
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { formatjs },
    settings: { formatjs: { additionalFunctionNames: ['t'], additionalComponentNames: ['T'] } },
    rules: {
      'formatjs/no-literal-string-in-jsx': [
        'error',
        {
          props: {
            include: [
              [
                '*',
                '{accessibilityLabel,accessibilityHint,aria-label,aria-description,placeholder,title,alt,label}',
              ],
            ],
          },
        },
      ],
    },
  },
  {
    files: FORMATTERS,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, REACT_INTL_IMPORT),
        patterns: [NODE_BUILTINS],
      }),
      'no-restricted-syntax': runtimeSyntax(['intlDate', 'toLocaleCall']),
    },
  },

  // 5a. Pure code (src/core, game rules and levels): no UI, no platform, no app layers. It keeps
  // RUNTIME_PATHS, so a vendor SDK or react-intl is banned here too.
  {
    files: PURE,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: RUNTIME_PATHS,
        patterns: [NODE_BUILTINS, PURE_IMPORTS, PURE_ALIAS],
      }),
    },
  },

  // 5b. Deterministic code: integer-safe arithmetic only.
  {
    files: DETERMINISTIC,
    rules: { 'no-restricted-syntax': [...runtimeSyntax(), ...DETERMINISM_SYNTAX] },
  },

  // 5c. File-level exemptions (the ONLY places these APIs are allowed).
  // Real-time sims mutate typed arrays inside shared values in place.
  {
    files: ['src/games/*/sim/**/*.ts'],
    rules: { 'no-param-reassign': ['error', { props: false }] },
  },
  // The network policy: only the ApiClient talks to the network.
  {
    files: NETWORK_CODE,
    rules: { 'no-restricted-globals': ['error', ...TEST_GLOBALS] },
  },
  {
    files: URL_CODE,
    rules: { 'no-restricted-syntax': runtimeSyntax(['remoteUrl', 'remoteUrlTemplate']) },
  },
  {
    files: ADAPTERS,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, ...VENDOR_SDK_PATHS),
        patterns: [NODE_BUILTINS],
      }),
    },
  },
  // The ADAPTERS block lifts every expo-iap ban, so the purchase adapter gets the server-feature
  // names back.
  {
    files: ['src/services/purchase/expo-iap-purchase-adapter.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: [...without(RUNTIME_PATHS, ...VENDOR_SDK_PATHS), EXPO_IAP_SERVER_APIS],
        patterns: [NODE_BUILTINS],
      }),
    },
  },
  // The consent adapter alone imports expo-tracking-transparency (the ADAPTERS block above keeps the
  // ban for every other adapter).
  {
    files: ATT_ADAPTER,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, ...VENDOR_SDK_PATHS),
        patterns: [NODE_BUILTINS],
        allow: [ATT_IMPORT],
      }),
    },
  },
  // The root entry file is outside src/, so the RUNTIME bans miss it: a vendor SDK set up there
  // (Sentry.init in index.ts) would bypass its port. The entry imports only app modules.
  {
    files: ROOT_ENTRIES,
    rules: { 'no-restricted-imports': restrictedImports({ paths: VENDOR_SDK_PATHS }) },
  },
  // A background task registry alone (besides the adapters) imports expo-task-manager.
  {
    files: TASK_REGISTRIES,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, TASK_MANAGER_IMPORT),
        patterns: [NODE_BUILTINS],
      }),
    },
  },
  {
    files: CLOCK_ADAPTERS,
    rules: {
      'no-restricted-properties': ['error', ...withoutProperty('Date', 'now')],
      'no-restricted-syntax': runtimeSyntax(['newDate']),
    },
  },
  {
    files: DIRECTION_MODULE,
    rules: {
      'no-restricted-properties': ['error', ...withoutProperty('I18nManager', 'isRTL')],
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, I18N_MANAGER_IMPORT, REACT_INTL_IMPORT),
        patterns: [NODE_BUILTINS],
      }),
    },
  },
  // Raw Pressable only in ui/, raw Image only in the Icon component; ui/ stays presentational.
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, PRESSABLE_IMPORT),
        patterns: [NODE_BUILTINS, UI_BOUNDARY],
      }),
    },
  },
  {
    files: ['src/ui/icons/icon.tsx'],
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, PRESSABLE_IMPORT, IMAGE_IMPORT),
        patterns: [NODE_BUILTINS, UI_BOUNDARY],
      }),
    },
  },
  // Performance instrumentation reads clocks.
  {
    files: PERF_CLOCK_FILES,
    rules: { 'no-restricted-properties': ['error', ...PERF_PROPERTIES] },
  },
  {
    files: APP_TEXT,
    rules: {
      'no-restricted-imports': restrictedImports({
        paths: without(RUNTIME_PATHS, TEXT_IMPORT, PRESSABLE_IMPORT),
        patterns: [NODE_BUILTINS, UI_BOUNDARY],
      }),
      'no-restricted-syntax': runtimeSyntax(['textAlignLiteral']),
    },
  },
  // Test-only code is loaded by require() behind an inline variant check, so Metro drops it from
  // production bundles.
  {
    files: ['src/**/test-only.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // 6. Node code (app config, config plugins, tooling): Node APIs and network allowed.
  {
    files: NODE_CODE,
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': ['error', ...NODE_CLOCK_PROPERTIES],
      'no-restricted-syntax': ['error', SYNTAX.enums, NODE_IMPORT_EXTENSION, NODE_NEW_DATE],
      'no-restricted-imports': restrictedImports({ allowParent: true }),
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/clock/system-clock.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': ['error', SYNTAX.enums, NODE_IMPORT_EXTENSION],
    },
  },
  // Expo reads the default export of app.config.ts and of a config plugin named by path.
  {
    files: ['app.config.ts', 'plugins/**/*.ts'],
    rules: { 'import/no-default-export': 'off' },
  },

  // 7. Tests.
  {
    files: TESTS,
    extends: [jestPlugin.configs['flat/recommended'], jestPlugin.configs['flat/style']],
  },
  {
    files: TESTS,
    extends: [testingLibrary.configs['flat/react']],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      'max-nested-callbacks': ['error', 4],
      'sonarjs/no-duplicate-string': 'off',
      'react/jsx-no-literals': 'off',
      'react/no-multi-comp': 'off',
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
      'no-restricted-syntax': runtimeSyntax(['a11yLiteral', 'handlerBody']),
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'testing-library/no-await-sync-events': 'off',
      'testing-library/await-async-events': ['error', { eventModule: ['fireEvent', 'userEvent'] }],
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert'] }],
      'jest/consistent-test-it': ['error', { fn: 'it', withinDescribe: 'it' }],
      'jest/no-disabled-tests': 'error',
      'jest/no-focused-tests': 'error',
      'jest/require-top-level-describe': 'error',
      'jest/prefer-strict-equal': 'error',
      'jest/no-large-snapshots': ['error', { maxSize: 50, inlineMaxSize: 10 }],
      'jest/valid-title': ['error', { mustMatch: { it: '^(can|[a-z]+s)\\b' } }],
    },
  },
  { files: GOLDEN_TESTS, rules: { 'jest/no-large-snapshots': 'off' } },
  // Declaration merging (NodeJS.ProcessEnv, ExpoRouter types) needs `interface`.
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
    },
  },
  {
    files: ['__mocks__/**/*.{ts,tsx}', 'jest.setup.ts'],
    rules: { 'import/no-default-export': 'off', 'no-restricted-imports': restrictedImports({}) },
  },
  // Root mocks mirror the libraries' PascalCase exports (AdsConsent, TestIds).
  {
    files: ['__mocks__/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/naming-convention': 'off' },
  },

  // 8. Plain JS config files: no type information.
  {
    files: JS_CONFIG,
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { 'import/no-default-export': 'off', 'no-restricted-globals': 'off' },
  },

  // 9. Prettier last: turns off every formatting rule that conflicts with Prettier.
  prettierConfig,
]);
