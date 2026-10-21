// jest.config.js — the ONE Jest config for the app (run from the repo root).
// Projects: 'unit' (jest-expo iOS env, everything except goldens, sims and *.android.test.*)
//           'android' (jest-expo Android env, *.android.test.ts(x) only: .android files, Platform.OS)
//           'golden' (*.golden.test.ts only: data goldens, and pixel goldens in Skia's CanvasKit env
//           once the app depends on Skia).
// Simulations (*.sim.test.ts) are NOT here: they run via jest.sim.config.js (`npm run test:sim`).
// Security-rules tests (*.rules.test.ts) are NOT here either once jest.emulator.config.js exists:
// they run inside the Firebase emulators (`npm run test:rules`).
const fs = require('node:fs');
const path = require('node:path');

// The repo's manifests: the root package.json and, in a workspace repo (package.json "workspaces"),
// every workspace's, because a native library such as Skia is a dependency of the Expo app workspace
// there (apps/mobile/package.json), not of the root.
const ROOT_MANIFEST = require('./package.json');
const WORKSPACE_GLOBS = [ROOT_MANIFEST.workspaces?.packages ?? ROOT_MANIFEST.workspaces ?? []]
  .flat()
  .filter((glob) => typeof glob === 'string' && !glob.startsWith('!'));
const MANIFESTS = [
  ROOT_MANIFEST,
  ...fs
    .globSync(
      WORKSPACE_GLOBS.map((glob) => `${glob.replace(/\/+$/, '')}/package.json`),
      { cwd: __dirname },
    )
    .map((file) => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))),
];
const dependsOn = (name) =>
  MANIFESTS.some(
    ({ dependencies = {}, devDependencies = {} }) =>
      name in dependencies || name in devDependencies,
  );

// Coverage leaves out exactly the files whose first 6 lines say
// "// device-only: covered by <the e2e flow or simulator check that exercises it>" (native
// adapters, Skia and frame-callback modules, composition files). The one tested helper decides.
const { deviceOnlyCoveragePatterns } = require('./scripts/quality/device-only.ts');

// Every worker inherits this: date code under test never depends on the machine's time zone.
process.env.TZ = 'UTC';

// Packages that ship untranspiled ESM/Flow/TS and must go through Babel. Prefix match:
// 'react-native' also covers react-native-reanimated, -worklets, -gesture-handler, -google-mobile-ads,
// -keyboard-controller and -audio-api; 'expo' also covers expo-router, expo-iap, expo-sqlite,
// expo-network, expo-localization and expo-haptics. expo-router 57 imports standard-navigation (ESM
// only; without it every route test fails with "Cannot use import statement outside a module", and
// so does every test that imports expo-notifications, which imports expo-router).
const TRANSPILE_PACKAGES = [
  'react-native',
  '@react-native',
  'expo',
  '@expo',
  'standard-navigation',
  '@react-navigation',
  '@shopify/react-native-skia',
  '@shopify/flash-list',
  '@sentry/react-native',
  'react-intl',
  '@formatjs',
  'intl-messageformat',
];

const transformIgnorePatterns = [
  `/node_modules/(?!(${TRANSPILE_PACKAGES.join('|')}))`,
  // Kept from jest-expo: never transform the Reanimated Babel plugin or the RN Babel preset.
  '/node_modules/react-native-reanimated/plugin/',
  '/node_modules/@react-native/babel-preset/',
];

// Generated native projects, build output, Stryker sandboxes, tool downloads and installed agent
// skills (whose templates and fixtures hold package.json files and __mocks__ with our names) are
// invisible to Jest.
const IGNORED_PATHS = [
  '<rootDir>/(ios|android|build|dist|web-build)/',
  '<rootDir>/(coverage|reports|skills|\\.stryker-tmp|\\.skill-tooling)/',
  '<rootDir>/\\.(agents|claude|codex|cursor|windsurf|roo|cline|continue|kiro)/',
];

// The tsconfig.json path aliases. jest-expo derives the same map from tsconfig.json, but only when
// Jest starts in the repo root; spelling it out keeps every working directory and Stryker's sandbox
// resolving to <rootDir>.
const PATH_ALIASES = {
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

// The FormatJS polyfills load before anything else, in every project (Jest's V8 ICU and Hermes then
// format numbers, plurals and dates identically). The i18n setup creates the module; until it
// exists, no project lists it (a missing setup file fails every suite).
const INTL_POLYFILLS = 'src/i18n/intl-polyfills.ts';
const POLYFILL_SETUP = fs.existsSync(path.join(__dirname, INTL_POLYFILLS))
  ? [`<rootDir>/${INTL_POLYFILLS}`]
  : [];

const SHARED = {
  rootDir: __dirname,
  preset: 'jest-expo/ios',
  transformIgnorePatterns,
  moduleNameMapper: PATH_ALIASES,
  modulePathIgnorePatterns: IGNORED_PATHS,
  testPathIgnorePatterns: ['/node_modules/', ...IGNORED_PATHS],
  clearMocks: true,
  restoreMocks: true,
  coveragePathIgnorePatterns: ['/node_modules/', ...deviceOnlyCoveragePatterns(__dirname)],
  setupFiles: POLYFILL_SETUP,
};

// Colocated tests in src/, scripts/ and plugins/ (local Expo config plugins, see
// expo-prebuild-and-config-plugins); Node-API tests (node:sqlite, fs, Buffer) in the root test/.
const TEST_ROOTS = [
  '<rootDir>/src/**/',
  '<rootDir>/scripts/**/',
  '<rootDir>/plugins/**/',
  '<rootDir>/test/**/',
];

// Stryker compiles the files it instrumented without the Worklets plugin (babel.config.js), so the
// test of the plugin's output fails once its directive file is mutated; mutation runs leave it out.
const IS_MUTATION_RUN = process.env.STRYKER_MUTATOR_WORKER !== undefined;

// Security-rules tests (*.rules.test.ts in test/rules/) run only inside the Firebase emulators,
// through jest.emulator.config.js (firestore-rules-and-emulator-tests); once that config exists the
// unit project leaves them out, and nothing else does.
const HAS_RULES_TESTS = fs.existsSync(path.join(__dirname, 'jest.emulator.config.js'));

const unitProject = {
  ...SHARED,
  displayName: 'unit',
  testMatch: TEST_ROOTS.map((root) => `${root}*.test.{ts,tsx}`),
  testPathIgnorePatterns: [
    ...SHARED.testPathIgnorePatterns,
    '\\.golden\\.test\\.',
    '\\.sim\\.test\\.',
    '\\.android\\.test\\.',
    ...(HAS_RULES_TESTS ? ['\\.rules\\.test\\.'] : []),
    ...(IS_MUTATION_RUN ? ['/quality/worklet-transform\\.test\\.'] : []),
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

// Android behaviour (an .android.tsx file, a Platform.OS branch, the hardware back button) is tested
// in <unit>.android.test.ts(x) under the Android preset, never by overwriting Platform.OS.
const androidProject = {
  ...SHARED,
  displayName: 'android',
  preset: 'jest-expo/android',
  testMatch: TEST_ROOTS.map((root) => `${root}*.android.test.{ts,tsx}`),
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

// Goldens run in their own project, so `npm run test:golden` and `-u` on one golden touch nothing
// else, in every app: a data golden (a readable snapshot of what a unit produces) needs only the unit
// set-up. Once the app depends on Skia, the project runs in Skia's CanvasKit environment instead, so
// pixel goldens draw real pixels (data goldens run there unchanged) and the inert Skia mock of
// jest.setup.ts stays out. Without the package, a project naming that environment fails every Jest
// run ("Test environment ... cannot be found"), so the environment follows the manifests (the
// root's and, in a workspace repo, the app workspace's).
const HAS_SKIA = dependsOn('@shopify/react-native-skia');

const CANVASKIT = {
  testEnvironment: '@shopify/react-native-skia/jestEnv.js',
  setupFilesAfterEnv: ['@shopify/react-native-skia/jestSetup.js'],
};

const goldenProject = {
  ...SHARED,
  displayName: 'golden',
  testMatch: TEST_ROOTS.map((root) => `${root}*.golden.test.ts`),
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  ...(HAS_SKIA ? CANVASKIT : {}),
};

// Coverage thresholds. A path key that matches no file makes Jest exit 1
// ("Coverage data for ... was not found"), so a key is only added once its folder has code.
const LOGIC = { statements: 95, lines: 95, functions: 95, branches: 90 };
const LOGIC_THRESHOLDS = {
  './src/core/': 'src/core/**/*.ts',
  './src/data/': 'src/data/**/*.ts',
  './src/games/*/rules/**/*.ts': 'src/games/*/rules/**/*.ts',
};

function hasSourceFiles(glob) {
  return fs
    .globSync(glob, { cwd: __dirname })
    .some((file) => !/\.(test|golden\.test|sim\.test)\.ts$/.test(path.basename(file)));
}

const coverageThreshold = {
  global: { statements: 90, lines: 90, functions: 90, branches: 85 },
  ...Object.fromEntries(
    Object.entries(LOGIC_THRESHOLDS)
      .filter(([, glob]) => hasSourceFiles(glob))
      .map(([key]) => [key, LOGIC]),
  ),
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [unitProject, androidProject, goldenProject],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{ts,tsx}',
    '!**/*.{test,golden.test,sim.test}.{ts,tsx}',
    '!**/*.d.ts',
    '!**/fixtures/**',
    '!**/testing/**',
  ],
  coverageDirectory: '<rootDir>/reports/coverage',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold,
};
