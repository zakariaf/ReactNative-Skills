#!/usr/bin/env node
// check-test-setup.mjs: checks the test set-up of an Expo app without running a test: exact test-tool
// pins and one React, the test scripts, babel.config.js with the Stryker branch, jest.config.js
// (projects, path aliases, UTC, mock reset, transforms, coverage gates and the device-only exclusions),
// jest.setup.ts, jest.sim.config.js when the app has simulations, stryker.config.json,
// tsconfig.stryker.json, the root native-SDK mocks, the render helper, and no test inside the
// Expo Router routes folder.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-test-setup.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { createReporter, fail, globToRegExp, maskComments, matchGlob, parseArgs, parseJsonc, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { jsLocator, jsonLocator } from './lib/config-lines.mjs';
import { KNOWN_ROOT_MOCKS, appVersion, declares, depsOf, loadContract, readManifests, sourceRoots, testCandidates, testRoots } from './lib/test-contract.mjs';

const SPEC = {
  name: 'check-test-setup',
  summary: 'Checks the Jest, Babel, Stryker and mock set-up of an Expo app against the rules of the unit-and-component-tests skill. It loads jest.config.js and jest.sim.config.js (as Jest would, so they run) but runs no test.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The test-setup contract (default: rn-skills.config.json "testSetupContract", else contracts/test-setup.json; missing = the defaults)' },
    ignore: { type: 'string', multiple: true, value: 'glob', help: 'Leave matching test files out (a folder another test runner owns; the contract key otherRunnerGlobs keeps it out for good)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  test-dep-missing          a test tool is missing from the root devDependencies (the message names its companion:',
    '                            RNTL 14.0.1 needs test-renderer 1.2.0, the React 19.2 line)',
    '  test-dep-range            a test tool is pinned with ^, ~ or a range instead of an exact version',
    '  test-dep-version          a test tool is on the wrong line (jest 29.7, RNTL 14, fast-check 4, jest-expo = the Expo SDK,',
    '                            @react-native/jest-preset = react-native, the Stryker packages all equal)',
    '  test-renderer-line        the test-renderer minor differs from the React minor (React 19.2 needs test-renderer 1.2.x)',
    '  test-dep-deprecated       a package.json declares react-test-renderer (deprecated since React 19; RNTL 14 renders',
    '                            through test-renderer, and Expo\'s unit-testing guide says to remove it)',
    '  one-react                 react / react-native are not exact pins in the app (when multi-package: root overrides',
    '                            do not pin both to the apps\' exact versions)',
    '  test-script               a test script differs (test, test:coverage, test:mutation; test:golden with Skia or',
    '                            golden tests; test:sim with simulations)',
    '  babel-config              root babel.config.js is missing or lacks the Stryker branch (worklets: false, reanimated: false;',
    '                            the template\'s branch, or the instrumented-only override of references/jest-config.md)',
    '  jest-config-missing       no jest.config.js at the repo root',
    '  jest-config-duplicate     package.json has a "jest" key (Expo\'s unit-testing guide adds one), or another',
    '                            jest.config.{ts,mjs,cjs,json} sits next to jest.config.js: Jest stops every run with',
    '                            "Multiple configurations found"',
    '  jest-config-load          jest.config.js or jest.sim.config.js throws when loaded',
    '  jest-tz                   a Jest config does not set process.env.TZ = \'UTC\'',
    '  jest-projects             projects are not unit (+ android when the app ships Android, + golden when it depends on',
    '                            @shopify/react-native-skia or has *.golden.test.* files; the template always has it),',
    '                            or another project appears',
    '  jest-orphan-tests         a file that Jest\'s defaults, jest-expo or Expo\'s guide treat as a test (*.test|spec.[jt]s(x),',
    '                            a test under __tests__/, *-test.[jt]s(x)), anywhere in the repo, is run by no project and',
    '                            not by jest.sim.config.js (silently never run), or by more than one project (run twice).',
    '                            Left out: installed skills, the Maestro folder, a folder that is not a workspace but runs',
    '                            its own tests (its own Jest, Vitest, Playwright or Cypress config, a deno.json, or a',
    '                            package.json test script), the folders a root playwright.config testDir or cypress.config',
    '                            specPattern names, the contract\'s otherRunnerGlobs and --ignore',
    '  test-in-routes            a test file (or a file under __tests__/) inside the Expo Router routes folder (src/app/;',
    '                            when multi-package, each app workspace\'s): Expo Router bundles every .js/.ts(x) file there',
    '                            as a route, so the production export fails to resolve it (only while expo-router is a',
    '                            dependency)',
    '  jest-unit-project         unit: preset jest-expo/ios, jest.setup.ts, every source and test root, goldens, sims and',
    '                            *.android.test.* left out',
    '  jest-android-project      android: preset jest-expo/android, *.android.test.ts(x) only, jest.setup.ts',
    '  jest-golden-project       golden: preset jest-expo/ios, *.golden.test.ts only; with Skia its CanvasKit jestEnv +',
    '                            jestSetup and not jest.setup.ts (its inert Skia mock would blank every pixel golden);',
    '                            without Skia jest.setup.ts and no Skia environment (Jest could not find it)',
    '  jest-alias-mapper         a tsconfig path alias (or, when multi-package, a workspace package) is not mapped to its',
    '                            source under <rootDir> in moduleNameMapper',
    '  jest-transform            transformIgnorePatterns keeps Babel away from a package that ships untranspiled code',
    '                            (React Native, Expo, and expo-router\'s standard-navigation, Skia, react-intl/FormatJS,',
    '                            FlashList, Sentry when installed)',
    '  jest-mock-reset           clearMocks and restoreMocks are not both true',
    '  jest-setup-file-missing   a setupFiles or setupFilesAfterEnv entry under <rootDir> does not exist',
    '  jest-retries              a Jest config or jest.setup.ts retries tests (testRetries, jest.retryTimes)',
    '  jest-ignored-paths        modulePathIgnorePatterns lets Jest see skills/, .agents/, .claude/ or .stryker-tmp/ (their',
    '                            package.json and __mocks__ copies collide: "duplicate manual mock found")',
    '  coverage-threshold        global below 90/90/90/85 or a logic key below 95/95/95/90',
    '  coverage-threshold-keys   a logic threshold key (contract logicCoverageKeys) is gone from jest.config.js',
    '  coverage-report           coverage is not written to reports/coverage with a json-summary reporter',
    '  coverage-scope            collectCoverageFrom counts tests, testing/ or fixtures/, or leaves out anything else',
    '  coverage-device-only      jest.config.js does not take its coverage exclusions from the device-only helper, the',
    '                            helper is missing, a file marked "// device-only: covered by <check>" is still counted,',
    '                            or a coverage exclusion hides a file that carries no such marker',
    '  jest-setup-missing        no jest.setup.ts at the repo root',
    '  jest-setup-content        jest.setup.ts lacks the Gesture Handler setup, the Worklets mock or Reanimated setUpTests',
    '                            (each required while its package is a dependency)',
    '  skia-unit-mock            the app depends on Skia but jest.setup.ts does not mock @shopify/react-native-skia',
    '  sim-config                the app has *.sim.test.ts files or jest.sim.config.js, and the config is missing, not',
    '                            a plain node environment, or matches more than sims',
    '  stryker-config            stryker.config.json is missing or weaker (runner, jest config, checker, break >= 75,',
    '                            logic scope, json report, agent-skill folders kept out of the sandbox)',
    '  stryker-tsconfig          tsconfig.stryker.json is missing, not a jest-only program, or extends a config that does',
    '                            not exist (the template extends ./tsconfig.base.json from typescript-and-lint-rules)',
    '  root-mock-missing         the app depends on a native SDK that crashes on import in Jest (known list, plus contract',
    '                            rootMocks) but __mocks__/<sdk>.ts is missing at the repo root',
    '  nested-sdk-mock           an SDK mock sits in a __mocks__ folder Jest does not apply to node modules',
    '  render-helper-missing     component tests exist but the render helper (test/render-with-providers.tsx) does not',
    '                            (a test marked "// no-providers: <why>" does not count)',
    '',
    'NOT APPLICABLE when no package.json in the repo depends on expo.',
    'Optional contract (contracts/test-setup.json, template and schema in templates/contracts/): renderHelper,',
    'routerHelper (read by check-test-code), deviceOnlyHelper, rootMocks, logicCoverageKeys, mutateGlobs,',
    'styleContractGlobs, logicTestGlobs, otherRunnerGlobs.',
    'Fixes name the template to copy from this skill (templates/<same path>).',
  ].join('\n'),
};

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const LINES = {
  jest: [/^29\.7\./, '29.7.x'],
  '@types/jest': [/^29\./, '29.x'],
  '@testing-library/react-native': [/^14\./, '14.x'],
  'fast-check': [/^4\./, '4.x'],
  'babel-jest': [/^29\.7\./, '29.7.x'],
  'test-renderer': [/^1\./, '1.x'],
};
// Test tools that only work as a pair: installing one alone lets npm pick a wrong line for the other.
const COMPANIONS = {
  '@testing-library/react-native': 'test-renderer 1.2.0 (the React 19.2 line; install both in one command)',
  'test-renderer': '@testing-library/react-native 14.0.1 (install both in one command)',
};
const STRYKER = ['@stryker-mutator/core', '@stryker-mutator/jest-runner', '@stryker-mutator/typescript-checker'];
const SKIA = '@shopify/react-native-skia';
const SKIA_ENV = `${SKIA}/jestEnv.js`;
const SKIA_SETUP = `${SKIA}/jestSetup.js`;
const UNIT_SETUP = '<rootDir>/jest.setup.ts';
const CANONICAL_COVERAGE_EXCLUSIONS = ['!**/*.{test,golden.test,sim.test}.{ts,tsx}', '!**/*.d.ts', '!**/fixtures/**', '!**/testing/**'];
const GLOBAL_MIN = { statements: 90, lines: 90, functions: 90, branches: 85 };
const LOGIC_MIN = { statements: 95, lines: 95, functions: 95, branches: 90 };
const PROJECT_NAMES = ['unit', 'android', 'golden'];
/** Folders Jest and Stryker must never index: installed skills hold package.json and __mocks__ copies. */
const MUST_IGNORE = [['skills', 'x', 'package.json'], ['.agents', 'skills', 'x', '__mocks__', 'expo-iap.ts'], ['.claude', 'skills', 'x', 'package.json'], ['.stryker-tmp', 'sandbox-1', 'package.json']].map((parts) => parts.join('/'));
const STRYKER_MUST_IGNORE = ['skills', '.agents', '.claude'];
const DEVICE_ONLY = /^\/\/\s*device-only:(.*)$/m;
const TEST_FILE = /\.(test|golden\.test|sim\.test)\.tsx?$/;
const GOLDEN_TEST = /\.golden\.test\.tsx?$/;
const SIM_TEST = /\.sim\.test\.tsx?$/;
/** Jest stops with "Multiple configurations found" when one of these, or a package.json "jest" key, sits next to jest.config.js. */
const OTHER_JEST_CONFIGS = ['jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'];
/** Jest's own default when a project sets neither testMatch nor testRegex. */
const DEFAULT_TEST_REGEX = /(\/__tests__\/.*|(\.|\/)(test|spec))\.[mc]?[jt]sx?$/;

const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const readOr = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');

/** The packages Babel must transpile, from what the app depends on (prefix match in the pattern). */
function transpileTargets(manifests) {
  const has = (name) => declares(manifests, name);
  const targets = ['react-native', '@react-native', 'expo', '@expo'];
  if (has('expo-router')) targets.push('standard-navigation', '@react-navigation');
  else if (manifests.all.some(({ pkg }) => Object.keys(depsOf(pkg)).some((name) => name.startsWith('@react-navigation/')))) targets.push('@react-navigation');
  if (has(SKIA)) targets.push(SKIA);
  if (has('react-intl')) targets.push('react-intl', '@formatjs', 'intl-messageformat');
  if (has('@shopify/flash-list')) targets.push('@shopify/flash-list');
  if (has('@sentry/react-native')) targets.push('@sentry/react-native');
  return targets;
}

/** False only when an app config lists platforms without android. */
function shipsAndroid(root, manifests) {
  for (const { dir } of manifests.apps) {
    for (const name of ['app.config.ts', 'app.config.js', 'app.json']) {
      const file = join(root, dir, name);
      if (!existsSync(file)) continue;
      const match = /["']?platforms["']?\s*:\s*\[([^\]]*)\]/.exec(maskComments(readFileSync(file, 'utf8')));
      if (match && !/android/.test(match[1])) return false;
    }
  }
  return true;
}

function checkPackage(root, layout, manifests, goldenTests, report) {
  const pkg = manifests.root.pkg;
  const { at } = jsonLocator(readOr(root, 'package.json'));
  const dev = { ...pkg.dependencies, ...pkg.devDependencies };
  const problem = (line, rule, message, fix) => report.problem({ file: 'package.json', line, rule, message, fix });
  const depLine = (name) => at(['devDependencies', name], ['dependencies', name], ['devDependencies']);
  const reactVersion = (layout.mode === 'monorepo' ? pkg.overrides?.react : null) ?? appVersion(manifests, 'react');
  const rnVersion = appVersion(manifests, 'react-native');
  const expoVersion = appVersion(manifests, 'expo');
  const required = ['jest', '@types/jest', 'jest-expo', '@react-native/jest-preset', '@testing-library/react-native', 'test-renderer', 'fast-check'];
  if (existsSync(join(root, 'jest.sim.config.js'))) required.push('babel-jest');
  if (existsSync(join(root, 'stryker.config.json'))) required.push(...STRYKER);
  for (const name of required) {
    const version = dev[name];
    if (version === undefined) {
      const companion = COMPANIONS[name] ? ` It comes with ${COMPANIONS[name]}.` : '';
      problem(at(['devDependencies'], ['dependencies']), 'test-dep-missing', `devDependencies lack ${name}`, `Add the exact pin from assets/package.test-deps.json (npm install --save-dev --save-exact ${name}@<version>), together with its companion.${companion}`);
      continue;
    }
    if (!EXACT.test(version)) {
      problem(depLine(name), 'test-dep-range', `${name} is "${version}", not an exact version`, 'Pin the exact version (save-exact); a range lets npm move a test tool under the suite.');
      continue;
    }
    if (LINES[name] && !LINES[name][0].test(version)) problem(depLine(name), 'test-dep-version', `${name} ${version} is not the verified line ${LINES[name][1]}`, 'Use the version in assets/package.test-deps.json; move lines only in an SDK upgrade.');
  }
  const jestExpo = dev['jest-expo'];
  if (jestExpo && expoVersion && EXACT.test(jestExpo) && jestExpo.split('.')[0] !== expoVersion.split('.')[0]) problem(depLine('jest-expo'), 'test-dep-version', `jest-expo ${jestExpo} does not match the app's Expo SDK ${expoVersion}`, 'Install the jest-expo listed in expo/bundledNativeModules.json of the installed SDK.');
  const preset = dev['@react-native/jest-preset'];
  if (preset && rnVersion && EXACT.test(preset) && preset !== rnVersion) problem(depLine('@react-native/jest-preset'), 'test-dep-version', `@react-native/jest-preset ${preset} differs from react-native ${rnVersion}`, 'Pin @react-native/jest-preset to exactly the React Native version.');
  const strykerVersions = new Set(STRYKER.map((name) => dev[name]).filter(Boolean));
  if (strykerVersions.size > 1) problem(depLine(STRYKER.find((name) => dev[name] !== dev[STRYKER[0]]) ?? STRYKER[0]), 'test-dep-version', `the Stryker packages are on different versions (${[...strykerVersions].join(', ')})`, 'Pin @stryker-mutator/core, jest-runner and typescript-checker to one version.');
  const renderer = dev['test-renderer'];
  if (renderer && reactVersion && EXACT.test(renderer)) {
    const reactMinor = reactVersion.split('.')[1];
    if (renderer.split('.')[1] !== reactMinor) problem(depLine('test-renderer'), 'test-renderer-line', `test-renderer ${renderer} does not match React ${reactVersion}`, `Pin test-renderer 1.${reactMinor}.x (the line for React 19.${reactMinor}); npm's automatic pick follows the newest React.`);
  }
  for (const name of ['react', 'react-native']) {
    if (layout.mode === 'monorepo') {
      const override = pkg.overrides?.[name];
      const app = appVersion(manifests, name);
      if (override === undefined) problem(at(['overrides'], ['devDependencies']), 'one-react', `overrides lack "${name}"`, `Add "overrides": { "${name}": "<the apps' exact version>" } so Jest tests the ${name} the app ships; check with npm ls react react-native.`);
      else if (!EXACT.test(override)) problem(at(['overrides', name]), 'one-react', `overrides pin ${name} as "${override}", not an exact version`, 'Use the exact version the apps declare.');
      else if (app && app !== override) problem(at(['overrides', name]), 'one-react', `overrides pin ${name} ${override} but the apps use ${app}`, 'Make the override equal the apps\' version.');
    } else {
      const declared = pkg.dependencies?.[name];
      if (declared === undefined) problem(at(['dependencies']), 'one-react', `dependencies lack "${name}"`, `Declare ${name} in dependencies with the exact version expo/bundledNativeModules.json names (npx expo install ${name}).`);
      else if (!EXACT.test(declared)) problem(at(['dependencies', name]), 'one-react', `${name} is "${declared}", not an exact version`, `Pin the exact version npx expo install writes, so Jest and the app run one ${name}; check with npm ls react react-native.`);
      else if (pkg.overrides?.[name] !== undefined && pkg.overrides[name] !== declared) problem(at(['overrides', name]), 'one-react', `overrides pin ${name} ${pkg.overrides[name]} but dependencies declare ${declared}`, 'Make them equal, or drop the override.');
    }
  }
  for (const { rel, pkg: manifest } of manifests.all) {
    if (depsOf(manifest)['react-test-renderer'] === undefined) continue;
    const where = jsonLocator(readOr(root, rel)).at(['devDependencies', 'react-test-renderer'], ['dependencies', 'react-test-renderer'], ['peerDependencies', 'react-test-renderer']);
    report.problem({ file: rel, line: where, rule: 'test-dep-deprecated', message: 'declares react-test-renderer, which React 19 deprecates and RNTL 14 does not use', fix: 'npm uninstall react-test-renderer @types/react-test-renderer (Expo\'s unit-testing guide says the same). RNTL 14 renders through test-renderer 1.2.0; a test that used react-test-renderer becomes an RNTL test through the render helper, and its toJSON() snapshot becomes assertions on roles and text.' });
  }
  const scripts = { test: 'jest --ci', 'test:coverage': 'jest --ci --coverage --randomize', 'test:mutation': 'stryker run' };
  if (declares(manifests, SKIA) || goldenTests.length > 0) scripts['test:golden'] = 'jest --ci --selectProjects golden';
  if (existsSync(join(root, 'jest.sim.config.js'))) scripts['test:sim'] = 'jest --ci --config jest.sim.config.js';
  for (const [name, command] of Object.entries(scripts)) {
    const actual = pkg.scripts?.[name];
    if (actual !== command) problem(at(['scripts', name], ['scripts']), 'test-script', `script "${name}" is ${actual === undefined ? 'missing' : JSON.stringify(actual)}`, `Set "${name}": ${JSON.stringify(command)} (--ci never writes snapshots).`);
  }
}

function checkBabel(root, manifests, report) {
  const file = join(root, 'babel.config.js');
  if (!existsSync(file)) {
    report.problem({ file: 'babel.config.js', line: 0, rule: 'babel-config', message: 'is missing at the repo root', fix: 'Copy templates/babel.config.js to the root; jest-expo reads Babel options from the working directory.' });
    return;
  }
  const text = maskComments(readFileSync(file, 'utf8'));
  const where = jsLocator(text);
  const needs = [[/babel-preset-expo/, 'babel-preset-expo', /presets/]];
  if (declares(manifests, 'react-native-reanimated') || declares(manifests, 'react-native-worklets')) {
    needs.push([/STRYKER_MUTATOR_WORKER/, 'the STRYKER_MUTATOR_WORKER branch', /babel-preset-expo|presets/], [/worklets:\s*false/, 'worklets: false', /babel-preset-expo|presets/], [/reanimated:\s*false/, 'reanimated: false', /babel-preset-expo|presets/]);
  }
  for (const [pattern, what, anchor] of needs) {
    if (!pattern.test(text)) report.problem({ file: 'babel.config.js', line: where.line(anchor), rule: 'babel-config', message: `lacks ${what}`, fix: 'Copy templates/babel.config.js: mutation workers must compile without the Worklets and Reanimated plugins ("stryNS_… is read-only").' });
  }
}

function loadConfig(root, rel, report) {
  try {
    return createRequire(join(root, 'package.json'))(join(root, rel));
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'jest-config-load', message: `throws when loaded: ${String(error.message).split('\n')[0]}`, fix: `Restore it from templates/${rel}.` });
    return null;
  }
}

function checkSetupFiles(root, rel, project, where, report) {
  const name = project.displayName ?? '?';
  for (const entry of [...list(project.setupFiles), ...list(project.setupFilesAfterEnv)]) {
    if (!String(entry).startsWith('<rootDir>/')) continue;
    const path = String(entry).replace('<rootDir>/', '');
    if (!existsSync(join(root, path))) report.problem({ file: rel, line: where.inProject(String(name), path, 'setupFiles'), rule: 'jest-setup-file-missing', message: `project "${name}" loads ${path}, which does not exist`, fix: `Create ${path}, or list it only once it exists (templates/jest.config.js adds the Intl polyfills that way).` });
  }
}

/**
 * The patterns as Jest would apply them under `base`. The root is escaped here, so a repo path holding
 * a regex metacharacter (a '+' in a folder name) is judged by what the config means; Jest itself
 * substitutes <rootDir> unescaped (references/jest-config.md, "Known failures and their fixes").
 */
function regexes(patterns, base) {
  const root = String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return list(patterns).flatMap((pattern) => {
    try {
      return [new RegExp(String(pattern).replaceAll('<rootDir>', () => root))];
    } catch {
      return [];
    }
  });
}

function checkIgnoredPaths(root, rel, config, name, line, report) {
  const matchers = regexes(config.modulePathIgnorePatterns, String(config.rootDir ?? root));
  const seen = MUST_IGNORE.filter((sample) => !matchers.some((re) => re.test(join(root, sample)))).map((sample) => sample.split('/')[0]);
  if (seen.length > 0) report.problem({ file: rel, line, rule: 'jest-ignored-paths', message: `${name} does not ignore ${seen.join(', ')} in modulePathIgnorePatterns`, fix: `Copy modulePathIgnorePatterns from templates/${rel} (skills, the agent folders such as \\.agents and \\.claude, and \\.stryker-tmp under <rootDir>); otherwise jest-haste-map indexes installed skills' package.json and __mocks__ copies and may apply a fixture's mock instead of the root one.` });
}

/** What moduleNameMapper turns `spec` into, or null when no key matches. */
function mapped(project, spec) {
  for (const [key, value] of Object.entries(project.moduleNameMapper ?? {})) {
    let match = null;
    try {
      match = new RegExp(key).exec(spec);
    } catch {
      continue;
    }
    if (match) return list(value).map((target) => String(target).replace(/\$(\d+)/g, (_, index) => match[Number(index)] ?? ''));
  }
  return null;
}

/** Each alias (and workspace package) the mapper must resolve: [{ spec, label, expected: [paths] }]. */
function aliasProbes(layout) {
  const probes = [];
  for (const { pattern, targets } of layout.aliases) {
    if (!pattern.endsWith('/*')) continue;
    const spec = `${pattern.slice(0, -1)}__probe__/x`;
    probes.push({ spec, label: pattern, expected: targets.filter((target) => target.endsWith('/*')).map((target) => `<rootDir>/${target.slice(0, -1)}__probe__/x`) });
  }
  for (const workspace of layout.workspaces) {
    if (!workspace.name) continue;
    probes.push({ spec: `${workspace.name}/__probe__/x`, label: `${workspace.name}/*`, expected: [`<rootDir>/${workspace.dir}/src/__probe__/x`, `<rootDir>/${workspace.dir}/__probe__/x`] });
  }
  return probes;
}

function checkProjectCommon(root, layout, manifests, rel, project, where, report) {
  const name = String(project.displayName ?? '?');
  const lineOfKey = (...keys) => where.inProject(name, ...keys);
  checkIgnoredPaths(root, rel, project, `project "${name}"`, lineOfKey('modulePathIgnorePatterns'), report);
  const missingAliases = aliasProbes(layout).filter(({ spec, expected }) => {
    const got = mapped(project, spec);
    return got === null || !got.some((target) => expected.includes(target.replace(/^<rootDir>\/\.\//, '<rootDir>/')));
  });
  if (missingAliases.length > 0) report.problem({ file: rel, line: lineOfKey('moduleNameMapper'), rule: 'jest-alias-mapper', message: `project "${name}" does not map ${missingAliases.map(({ label }) => label).join(', ')} to its source under <rootDir> in moduleNameMapper`, fix: 'Copy PATH_ALIASES from templates/jest.config.js (one entry per tsconfig paths alias; when multi-package, each workspace package name to <rootDir>/<workspace>/src/). jest-expo derives the alias map only when Jest starts in the repo root, and Stryker\'s sandbox resolves through the mapper.' });
  const ignored = regexes(project.transformIgnorePatterns, root);
  const missing = transpileTargets(manifests).filter((pkg) => ignored.some((re) => re.test(join(root, 'node_modules', pkg, 'index.js'))));
  if (missing.length > 0) report.problem({ file: rel, line: lineOfKey('transformIgnorePatterns'), rule: 'jest-transform', message: `project "${name}" does not transpile ${missing.join(', ')}`, fix: 'Copy TRANSPILE_PACKAGES and transformIgnorePatterns from templates/jest.config.js (otherwise "Cannot use import statement outside a module").' });
  if (project.clearMocks !== true || project.restoreMocks !== true) report.problem({ file: rel, line: lineOfKey(project.clearMocks !== true ? 'clearMocks' : 'restoreMocks'), rule: 'jest-mock-reset', message: `project "${name}" does not set clearMocks and restoreMocks to true`, fix: 'Set both in SHARED; call counts must reset before every test while root-mock implementations stay.' });
  if (project.testRetries !== undefined) report.problem({ file: rel, line: lineOfKey('testRetries'), rule: 'jest-retries', message: `project "${name}" sets testRetries`, fix: 'Remove it; fix the flaky test instead.' });
  checkSetupFiles(root, rel, project, where, report);
}

/** True when some glob (with <rootDir>/ stripped) matches the sample path. */
const anyGlob = (globs, sample) => list(globs).some((glob) => matchGlob(sample, String(glob).replace(/^<rootDir>\//, '')));

function checkUnit(rel, layout, unit, hasAndroid, where, report) {
  const problem = (key, message, fix, isOwn = false) => report.problem({ file: rel, line: isOwn ? where.inOwnProject('unit', key) : where.inProject('unit', key), rule: 'jest-unit-project', message, fix });
  if (unit.preset !== 'jest-expo/ios') problem(/\bpreset\s*:/, `unit preset is ${JSON.stringify(unit.preset)}, not "jest-expo/ios"`, 'Use preset jest-expo/ios; Android code is tested by the android project.');
  if (!list(unit.setupFilesAfterEnv).includes(UNIT_SETUP)) problem('setupFilesAfterEnv', 'unit does not load <rootDir>/jest.setup.ts', 'Add setupFilesAfterEnv: [\'<rootDir>/jest.setup.ts\'] to the unit project.', true);
  const ignored = regexes(unit.testPathIgnorePatterns, layout.root);
  const kinds = [['x.golden.test.ts', 'golden'], ['x.sim.test.ts', 'sim'], ...(hasAndroid ? [['x.android.test.tsx', 'android']] : [])];
  const leaks = kinds.filter(([file]) => !ignored.some((re) => re.test(join(layout.root, 'src', file)))).map(([, kind]) => `*.${kind}.test.*`);
  if (leaks.length > 0) problem('testPathIgnorePatterns', `unit does not leave out ${leaks.join(', ')}`, 'Add \'\\\\.golden\\\\.test\\\\.\', \'\\\\.sim\\\\.test\\\\.\' and \'\\\\.android\\\\.test\\\\.\' to the unit testPathIgnorePatterns.');
  const roots = [...sourceRoots(layout), layout.testDir];
  const uncovered = roots.filter((dir) => !anyGlob(unit.testMatch, `${dir}/probe/x.test.tsx`));
  if (uncovered.length > 0) problem('testMatch', `unit testMatch does not cover ${uncovered.join(', ')}`, 'Copy TEST_ROOTS and testMatch from templates/jest.config.js.', true);
}

function checkAndroid(rel, layout, android, where, report) {
  const problem = (key, message, fix, isOwn = true) => report.problem({ file: rel, line: isOwn ? where.inOwnProject('android', key) : where.inProject('android', key), rule: 'jest-android-project', message, fix });
  if (android.preset !== 'jest-expo/android') problem(/\bpreset\s*:/, `android preset is ${JSON.stringify(android.preset)}, not "jest-expo/android"`, 'Use preset jest-expo/android: it resolves .android files and sets Platform.OS to android.', false);
  const dir = sourceRoots(layout)[0] ?? 'src';
  if (!anyGlob(android.testMatch, `${dir}/probe/x.android.test.tsx`) || anyGlob(android.testMatch, `${dir}/probe/x.test.tsx`)) problem('testMatch', 'android testMatch does not match exactly the *.android.test.ts(x) files', 'Use TEST_ROOTS.map((root) => `${root}*.android.test.{ts,tsx}`).');
  if (!list(android.setupFilesAfterEnv).includes(UNIT_SETUP)) problem('setupFilesAfterEnv', 'android does not load <rootDir>/jest.setup.ts', 'Add setupFilesAfterEnv: [\'<rootDir>/jest.setup.ts\'] to the android project.');
}

/**
 * Goldens run in every app: data goldens with the unit set-up, and once the app depends on Skia, in
 * its CanvasKit environment (pixel goldens draw real pixels; jest.setup.ts would blank them).
 */
function checkGolden(rel, golden, hasSkia, where, report) {
  const problem = (keys, message, fix, isOwn = false) => report.problem({ file: rel, line: isOwn ? where.inOwnProject('golden', ...keys) : where.inProject('golden', ...keys), rule: 'jest-golden-project', message, fix });
  // The CanvasKit set-up is usually a shared object spread into the project (CANVASKIT in the template).
  const skiaSetupKeys = where.first(SKIA_SETUP) ? [SKIA_SETUP] : ['CANVASKIT', 'setupFilesAfterEnv'];
  const setup = list(golden.setupFilesAfterEnv);
  const usesCanvasKit = String(golden.testEnvironment ?? '').includes(SKIA) || setup.includes(SKIA_SETUP);
  if (golden.preset !== 'jest-expo/ios') problem([/\bpreset\s*:/], `golden preset is ${JSON.stringify(golden.preset)}, not "jest-expo/ios"`, 'Keep the jest-expo/ios preset from SHARED: its snapshot resolver writes <test>.golden.test.ts.snap.ios next to the test.');
  if (hasSkia) {
    if (golden.testEnvironment !== SKIA_ENV) problem(['testEnvironment', 'CANVASKIT'], `golden testEnvironment is ${JSON.stringify(golden.testEnvironment)}`, `Use testEnvironment: '${SKIA_ENV}' (CanvasKit) in the golden project only: templates/jest.config.js spreads CANVASKIT into it while the app depends on Skia.`);
    if (!setup.includes(SKIA_SETUP)) problem(skiaSetupKeys, `golden does not load ${SKIA_SETUP}`, 'Add it to the golden setupFilesAfterEnv (CANVASKIT in templates/jest.config.js).');
    if (setup.includes(UNIT_SETUP)) problem(skiaSetupKeys, 'golden loads <rootDir>/jest.setup.ts, whose inert Skia mock replaces CanvasKit', `Load only ${SKIA_SETUP} in the golden project while the app depends on Skia; jest.setup.ts belongs to unit and android.`);
  } else {
    if (usesCanvasKit) problem(['CANVASKIT', 'testEnvironment', 'jestSetup.js'], `golden uses Skia's CanvasKit environment, but the app does not depend on ${SKIA} (Jest cannot find it and every run fails)`, 'Spread CANVASKIT into the golden project only while package.json lists Skia, as templates/jest.config.js does (HAS_SKIA).');
    else if (!setup.includes(UNIT_SETUP)) problem(['setupFilesAfterEnv'], 'golden does not load <rootDir>/jest.setup.ts (without Skia, goldens run with the unit set-up)', 'Add setupFilesAfterEnv: [\'<rootDir>/jest.setup.ts\'] to the golden project, as templates/jest.config.js does.', true);
  }
  const matches = list(golden.testMatch);
  if (matches.length === 0 || !matches.every((glob) => String(glob).endsWith('*.golden.test.ts'))) problem(['testMatch'], 'golden testMatch matches more than *.golden.test.ts', 'Use TEST_ROOTS.map((root) => `${root}*.golden.test.ts`).', true);
}

function checkThresholds(rel, text, config, contract, where, report) {
  const thresholds = config.coverageThreshold ?? {};
  const problem = (line, rule, message, fix) => report.problem({ file: rel, line, rule, message, fix });
  const below = (actual, min) => Object.entries(min).filter(([key, value]) => !(Number(actual?.[key]) >= value)).map(([key, value]) => `${key} ${actual?.[key] ?? 'missing'} < ${value}`);
  const global = below(thresholds.global, GLOBAL_MIN);
  if (global.length > 0) problem(where.line(/\bglobal\s*:/, 'coverageThreshold'), 'coverage-threshold', `global coverage threshold is weaker than 90/90/90/85 (${global.join(', ')})`, 'Restore the global thresholds; add tests instead of lowering a gate.');
  for (const [key, value] of Object.entries(thresholds)) {
    if (key === 'global') continue;
    const weak = below(value, LOGIC_MIN);
    if (weak.length > 0) problem(where.line(/\bLOGIC\s*=/, `'${key}'`, `"${key}"`, 'coverageThreshold'), 'coverage-threshold', `logic threshold ${key} is weaker than 95/95/95/90 (${weak.join(', ')})`, 'Restore LOGIC = { statements: 95, lines: 95, functions: 95, branches: 90 }.');
  }
  for (const key of contract.logicCoverageKeys) {
    if (!text.includes(`'${key}'`) && !text.includes(`"${key}"`)) problem(where.line('LOGIC_THRESHOLDS', 'coverageThreshold'), 'coverage-threshold-keys', `the logic threshold key ${key} is gone`, 'Copy LOGIC_THRESHOLDS from templates/jest.config.js (a key switches on by itself once its folder has code); a different logic folder goes into contracts/test-setup.json logicCoverageKeys.');
  }
  if (!String(config.coverageDirectory ?? '').endsWith('reports/coverage') || !list(config.coverageReporters).includes('json-summary')) problem(where.line('coverageDirectory', 'coverageReporters'), 'coverage-report', 'coverage is not written to <rootDir>/reports/coverage with the json-summary reporter', 'Set coverageDirectory: \'<rootDir>/reports/coverage\' and coverageReporters: [\'text-summary\', \'json-summary\', \'lcov\'] (the report reads coverage-summary.json).');
  const collect = list(config.collectCoverageFrom).map(String);
  for (const [needle, what] of [['test', 'test files'], ['testing', 'testing/ helpers'], ['fixtures', 'fixtures/']]) {
    if (!collect.some((glob) => glob.startsWith('!') && glob.includes(needle))) problem(where.line('collectCoverageFrom'), 'coverage-scope', `collectCoverageFrom does not exclude ${what}`, 'Copy collectCoverageFrom from templates/jest.config.js.');
  }
  for (const glob of collect.filter((entry) => entry.startsWith('!'))) {
    if (!CANONICAL_COVERAGE_EXCLUSIONS.includes(glob)) problem(where.line(`'${glob}'`, `"${glob}"`, 'collectCoverageFrom'), 'coverage-scope', `collectCoverageFrom leaves out ${glob}`, 'Remove it: only tests, .d.ts, fixtures/ and testing/ are left out of coverage; a file Jest cannot run carries "// device-only: covered by <check>" in its first 6 lines instead (the device-only helper turns that into a coverage exclusion).');
  }
}

const hasDeviceOnlyMarker = (source) => {
  const marker = DEVICE_ONLY.exec(source.split('\n').slice(0, 6).join('\n'));
  return marker !== null && /\bcovered by\s+\S.{8,}/i.test(marker[1]);
};

/** Source files coverage counts, with their device-only marker. */
function coverageSources(root, layout) {
  const roots = sourceRoots(layout);
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['reports/**', '.stryker-tmp/**', '.skill-tooling/**'] })
    .filter((rel) => roots.some((dir) => rel.startsWith(`${dir}/`)) && !TEST_FILE.test(rel) && !rel.endsWith('.d.ts'))
    .map((rel) => ({ rel, isMarked: hasDeviceOnlyMarker(readFileSync(join(root, rel), 'utf8')) }));
}

/** Coverage leaves out exactly the files marked device-only, through the one helper. */
function checkDeviceOnly(root, layout, rel, config, report) {
  const seen = new Set();
  const sources = coverageSources(root, layout);
  for (const project of list(config.projects).filter((entry) => entry && typeof entry === 'object')) {
    const base = String(project.rootDir ?? config.rootDir ?? root);
    const patterns = regexes(project.coveragePathIgnorePatterns, base);
    for (const { rel: file, isMarked } of sources) {
      const isIgnored = patterns.some((re) => re.test(join(base, file)));
      if (seen.has(file) || isIgnored === isMarked) continue;
      seen.add(file);
      if (isMarked) report.problem({ file, line: 1, rule: 'coverage-device-only', message: `is marked device-only but ${rel} still counts it in coverage (project "${project.displayName ?? '?'}")`, fix: 'Copy templates/jest.config.js: SHARED.coveragePathIgnorePatterns comes from deviceOnlyCoveragePatterns(__dirname).' });
      else report.problem({ file, line: 1, rule: 'coverage-device-only', message: `is left out of coverage by ${rel} but carries no "// device-only: covered by <check>" marker`, fix: 'Remove the hand-written exclusion and test the file; only a native adapter, a Skia or frame-callback module, a composition file or a tooling entry point may carry the marker, naming the e2e flow or device check that covers it.' });
    }
  }
}

/** A second Jest configuration next to jest.config.js stops every run with "Multiple configurations found". */
function checkDuplicates(root, manifests, report) {
  if (manifests.root.pkg.jest !== undefined) report.problem({ file: 'package.json', line: jsonLocator(readOr(root, 'package.json')).at(['jest']), rule: 'jest-config-duplicate', message: 'has a "jest" key next to jest.config.js, so every Jest run stops with "Multiple configurations found"', fix: 'Delete the "jest" key (Expo\'s unit-testing guide adds "jest": { "preset": "jest-expo" }, and a "test": "jest --watchAll" script that test-script replaces); jest.config.js holds the whole configuration.' });
  for (const name of OTHER_JEST_CONFIGS) {
    if (existsSync(join(root, name))) report.problem({ file: name, line: 1, rule: 'jest-config-duplicate', message: 'sits next to jest.config.js, so every Jest run stops with "Multiple configurations found"', fix: 'Delete it; whatever it set that the app needs goes into jest.config.js (templates/jest.config.js).' });
  }
}

function checkJest(root, layout, manifests, contract, goldenTests, report) {
  const rel = 'jest.config.js';
  if (!existsSync(join(root, rel))) {
    report.problem({ file: rel, line: 0, rule: 'jest-config-missing', message: 'no jest.config.js at the repo root', fix: 'Copy templates/jest.config.js to the repo root and run Jest from there.' });
    return null;
  }
  checkDuplicates(root, manifests, report);
  const text = readFileSync(join(root, rel), 'utf8');
  const code = maskComments(text);
  const where = jsLocator(code);
  if (!/process\.env\.TZ\s*=\s*['"]UTC['"]/.test(code)) report.problem({ file: rel, line: where.line(/process\.env\.TZ/), rule: 'jest-tz', message: 'does not set process.env.TZ = \'UTC\'', fix: 'Add process.env.TZ = \'UTC\'; at the top so date code never depends on the machine\'s time zone.' });
  if (/retryTimes|testRetries/.test(code)) report.problem({ file: rel, line: where.line(/retryTimes|testRetries/), rule: 'jest-retries', message: 'retries tests', fix: 'Remove the retry; a retry hides a flaky test.' });
  const helper = contract.deviceOnlyHelper;
  const helperName = helper.split('/').pop();
  const usesHelper = code.includes(helperName) && /deviceOnlyCoveragePatterns/.test(code);
  if (!usesHelper) report.problem({ file: rel, line: where.line('coveragePathIgnorePatterns'), rule: 'coverage-device-only', message: `does not take its coverage exclusions from ${helper}`, fix: 'Copy templates/jest.config.js: coveragePathIgnorePatterns = [\'/node_modules/\', ...deviceOnlyCoveragePatterns(__dirname)], so exactly the files marked "// device-only: covered by <check>" leave coverage.' });
  if (usesHelper && !existsSync(join(root, helper))) {
    report.problem({ file: helper, line: 0, rule: 'coverage-device-only', message: 'jest.config.js requires this helper but it does not exist (every Jest run fails to load the config)', fix: `Copy templates/${helper.startsWith(`${layout.scriptsDir}/`) ? `scripts/${helper.slice(layout.scriptsDir.length + 1)}` : 'scripts/quality/device-only.ts'} and its test into the repo.` });
    return null;
  }
  const config = loadConfig(root, rel, report);
  if (!config) return null;
  const entries = list(config.projects);
  const projects = entries.filter((project) => project && typeof project === 'object');
  const names = projects.map((project) => String(project.displayName ?? '?'));
  const hasSkia = declares(manifests, SKIA);
  const wantsAndroid = shipsAndroid(root, manifests);
  const projectProblem = (message, fix) => report.problem({ file: rel, line: where.line(/\bprojects\s*:/), rule: 'jest-projects', message, fix });
  if (!names.includes('unit')) projectProblem(`projects are [${names.join(', ')}]: the unit project is missing`, 'Use projects from templates/jest.config.js: unit, android and golden.');
  if (wantsAndroid && !names.includes('android')) projectProblem(`projects are [${names.join(', ')}]: the android project is missing`, 'Add androidProject from templates/jest.config.js (preset jest-expo/android, *.android.test.ts(x)); Android-only code is untested without it.');
  if (!names.includes('golden') && (hasSkia || goldenTests.length > 0)) projectProblem(`projects are [${names.join(', ')}]: ${hasSkia ? `the app depends on ${SKIA}` : `${goldenTests[0]} is a golden test`} but the golden project is missing`, 'Add goldenProject from templates/jest.config.js: it belongs in every app (data goldens run with the unit set-up) and switches to Skia\'s CanvasKit environment only while the app depends on Skia.');
  for (const name of names.filter((entry) => !PROJECT_NAMES.includes(entry))) projectProblem(`project "${name}" is not one of ${PROJECT_NAMES.join(', ')}`, 'Long-running simulations go in jest.sim.config.js; every other test belongs to unit, android or golden.');
  for (const project of projects) checkProjectCommon(root, layout, manifests, rel, project, where, report);
  const unit = projects.find((project) => project.displayName === 'unit');
  const android = projects.find((project) => project.displayName === 'android');
  const golden = projects.find((project) => project.displayName === 'golden');
  if (unit) checkUnit(rel, layout, unit, android !== undefined, where, report);
  if (android) checkAndroid(rel, layout, android, where, report);
  if (golden) checkGolden(rel, golden, hasSkia, where, report);
  checkThresholds(rel, text, config, contract, where, report);
  if (usesHelper) checkDeviceOnly(root, layout, rel, config, report);
  // A project given as a path to another config cannot be read here; the orphan check then stays out.
  if (entries.some((project) => typeof project === 'string')) return null;
  return projects.length > 0 ? projects : [{ ...config, displayName: config.displayName ?? 'jest.config.js' }];
}

function checkSetup(root, manifests, report) {
  const rel = 'jest.setup.ts';
  if (!existsSync(join(root, rel))) {
    report.problem({ file: rel, line: 0, rule: 'jest-setup-missing', message: 'no jest.setup.ts at the repo root', fix: 'Copy templates/jest.setup.ts.' });
    return;
  }
  const code = maskComments(readFileSync(join(root, rel), 'utf8'));
  const where = jsLocator(code);
  const needs = [
    ['react-native-gesture-handler', /react-native-gesture-handler\/jestSetup/, 'the react-native-gesture-handler/jestSetup import'],
    ['react-native-worklets', /jest\.mock\(\s*['"]react-native-worklets['"]/, 'jest.mock(\'react-native-worklets\', ...)'],
    ['react-native-reanimated', /react-native-reanimated['"]\s*\)\s*\.setUpTests\(\)/, 'require(\'react-native-reanimated\').setUpTests()'],
  ];
  for (const [pkg, pattern, what] of needs) {
    if (declares(manifests, pkg) && !pattern.test(code)) report.problem({ file: rel, line: 1, rule: 'jest-setup-content', message: `lacks ${what}`, fix: 'Copy the line from templates/jest.setup.ts (required while the package is a dependency).' });
  }
  if (/retryTimes/.test(code)) report.problem({ file: rel, line: where.line(/retryTimes/), rule: 'jest-retries', message: 'calls jest.retryTimes', fix: 'Remove it; fix the flaky test instead.' });
  if (declares(manifests, SKIA) && !/jest\.mock\(\s*['"]@shopify\/react-native-skia['"]/.test(code)) report.problem({ file: rel, line: 1, rule: 'skia-unit-mock', message: `does not mock ${SKIA}`, fix: `Copy the guarded jest.mock('${SKIA}', ...) block from templates/jest.setup.ts: Skia's native module cannot load under jest-expo, so every suite that imports a component drawing with Skia crashes. A per-file Skia mock is only for a test that inspects Skia calls.` });
}

/** The simulation config when it exists and loads, else null. */
function checkSim(root, layout, testFiles, report) {
  const rel = 'jest.sim.config.js';
  const sims = testFiles.filter((file) => SIM_TEST.test(file));
  const exists = existsSync(join(root, rel));
  if (!exists && sims.length === 0) return null;
  if (!exists) {
    report.problem({ file: rel, line: 0, rule: 'sim-config', message: `is missing, but ${sims[0]} is a simulation test`, fix: 'Copy templates/jest.sim.config.js; simulations run only through it (npm run test:sim), never in npm test.' });
    return null;
  }
  const where = jsLocator(maskComments(readFileSync(join(root, rel), 'utf8')));
  if (!/process\.env\.TZ\s*=\s*['"]UTC['"]/.test(maskComments(readFileSync(join(root, rel), 'utf8')))) report.problem({ file: rel, line: where.line(/process\.env\.TZ/), rule: 'jest-tz', message: 'does not set process.env.TZ = \'UTC\'', fix: 'Add process.env.TZ = \'UTC\'; at the top.' });
  const config = loadConfig(root, rel, report);
  if (!config) return null;
  checkIgnoredPaths(root, rel, config, 'the sim config', where.line('modulePathIgnorePatterns'), report);
  if (config.testEnvironment !== 'node') report.problem({ file: rel, line: where.line('testEnvironment'), rule: 'sim-config', message: `testEnvironment is ${JSON.stringify(config.testEnvironment)}, not "node"`, fix: 'Simulations run in plain Node: a simulation that needs a React Native mock means the simulated logic is not pure.' });
  const matches = list(config.testMatch);
  if (matches.length === 0 || !matches.every((glob) => String(glob).endsWith('.sim.test.ts'))) report.problem({ file: rel, line: where.line('testMatch'), rule: 'sim-config', message: 'testMatch matches more than *.sim.test.ts', fix: `Match only <rootDir>/${layout.srcDir}/**/*.sim.test.ts and <rootDir>/${layout.testDir}/**/*.sim.test.ts.` });
  return { ...config, displayName: rel };
}

/** Does this Jest config (a project or the sim config) run the repo file `rel`? Mirrors testMatch / testRegex and testPathIgnorePatterns. */
function runnerOf(root, config) {
  const rootDir = toPosix(String(config.rootDir ?? root));
  const prefix = `${rootDir}/`;
  const ignored = regexes(config.testPathIgnorePatterns ?? ['/node_modules/'], rootDir);
  const globs = list(config.testMatch).map((glob) => String(glob).replaceAll('<rootDir>', rootDir));
  const testRegex = regexes(config.testRegex, rootDir);
  const globMatches = (rel, glob) => (glob.startsWith(prefix) ? matchGlob(rel, glob.slice(prefix.length)) : globToRegExp(glob).test(`${prefix}${rel}`));
  return (rel) => {
    const abs = `${prefix}${rel}`;
    let isMatch;
    if (globs.length > 0) {
      const negated = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
      isMatch = globs.some((glob) => !glob.startsWith('!') && globMatches(rel, glob)) && !negated.some((glob) => globMatches(rel, glob));
    } else {
      isMatch = testRegex.length > 0 ? testRegex.some((re) => re.test(abs)) : DEFAULT_TEST_REGEX.test(abs);
    }
    return isMatch && !ignored.some((re) => re.test(abs));
  };
}

const MOVE_NEXT_TO_UNIT = 'Move it next to its unit as <unit>.test.ts(x) (a test that needs Node APIs goes under test/): the projects run only *.test.ts(x) files in src/, scripts/, plugins/ (local config plugins) and test/.';
const OTHER_RUNNER = ' If another test runner owns it (Playwright for the web build, Cypress, Deno for supabase/functions) and the checker cannot see that runner\'s config, list its folder in contracts/test-setup.json "otherRunnerGlobs" (for example "e2e-web/**").';

function orphanFix(rel, layout) {
  if (/(?:^|\/)__tests__\/|-test\.[jt]sx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)) return `${MOVE_NEXT_TO_UNIT} Expo's unit-testing guide puts tests in __tests__/<name>-test.tsx, which jest.config.js does not run; drop react-test-renderer while moving them, as the guide says.`;
  if (/\.spec\.[jt]sx?$/.test(rel)) return `Rename it to <unit>.test.ts(x) next to its unit: ${MOVE_NEXT_TO_UNIT.slice(MOVE_NEXT_TO_UNIT.indexOf('the projects'))}${OTHER_RUNNER}`;
  if (/\.jsx?$/.test(rel)) return `Convert it to TypeScript as <unit>.test.ts(x) next to its unit: ${MOVE_NEXT_TO_UNIT.slice(MOVE_NEXT_TO_UNIT.indexOf('the projects'))}`;
  if (/\.golden\.test\.tsx$/.test(rel)) return 'Rename it to *.golden.test.ts: the golden project runs *.golden.test.ts (a golden pins data or pixels, never a component tree).';
  if (/\.golden\.test\./.test(rel)) return 'Keep goldenProject from templates/jest.config.js in projects: it belongs in every app (data goldens run with the unit set-up) and switches to CanvasKit only while the app depends on Skia.';
  if (/\.sim\.test\.tsx$/.test(rel)) return 'Rename it to *.sim.test.ts: jest.sim.config.js runs only *.sim.test.ts (simulated logic is pure TypeScript).';
  if (/\.android\.test\./.test(rel)) return 'Add androidProject from templates/jest.config.js (preset jest-expo/android, *.android.test.ts(x)).';
  if (!testRoots(layout).some((dir) => rel.startsWith(`${dir}/`))) return `${MOVE_NEXT_TO_UNIT}${OTHER_RUNNER}`;
  return 'Put the test where a project matches it: copy TEST_ROOTS and testMatch from templates/jest.config.js (tests sit in src/, scripts/, plugins/ or test/ as <unit>.test.ts(x)).';
}

/** Every test file runs in exactly one place: one Jest project, or the simulation config. */
function checkOrphans(root, layout, projects, simConfig, testFiles, report) {
  const runners = [...projects, ...(simConfig ? [simConfig] : [])].map((config) => ({ name: String(config.displayName ?? '?'), runs: runnerOf(root, config) }));
  for (const rel of testFiles) {
    if (SIM_TEST.test(rel) && !simConfig && !existsSync(join(root, 'jest.sim.config.js'))) continue; // sim-config reports it
    const names = runners.filter(({ runs }) => runs(rel)).map(({ name }) => name);
    const projectList = projects.map((project) => project.displayName ?? '?').join(', ');
    if (names.length === 0) report.problem({ file: rel, line: 1, rule: 'jest-orphan-tests', message: simConfig ? `neither a Jest project (${projectList}) nor jest.sim.config.js runs this test, so it never runs` : `no Jest project (${projectList}) runs this test, so it never runs`, fix: orphanFix(rel, layout) });
    else if (names.length > 1) report.problem({ file: rel, line: 1, rule: 'jest-orphan-tests', message: `runs in ${names.length} places (${names.join(', ')}), so every run executes it twice`, fix: 'Leave it out of all but one: the unit project drops goldens, simulations and *.android.test.* through testPathIgnorePatterns (templates/jest.config.js).' });
  }
}

/**
 * Expo Router bundles every .js/.jsx/.ts/.tsx file under the routes folder as a route: with
 * expo-router 57.0.24, EXPO_ROUTER_CTX_IGNORE (expo-router/_ctx-shared.js) leaves out only +html,
 * +native-intent and +api files. A test there becomes a route, and `expo export` fails to resolve it
 * (verified 2026-10-03), while a Jest project still runs it, so every other check passes. The message
 * says so only when a project's testMatch really takes the file (a .spec.tsx there runs nowhere, and
 * jest-orphan-tests reports that on its own line).
 */
function checkRoutesFolder(root, layout, manifests, testFiles, ignore, projects, report) {
  // When multi-package: each app workspace (it depends on expo) while it or the root lists expo-router.
  const rootHasRouter = depsOf(manifests.root.pkg)['expo-router'] !== undefined;
  const routeDirs = layout.mode === 'monorepo'
    ? manifests.apps.filter(({ pkg }) => rootHasRouter || depsOf(pkg)['expo-router'] !== undefined).map(({ dir }) => layout.workspaces.find((workspace) => workspace.dir === dir)?.layout.routesDir).filter(Boolean)
    : declares(manifests, 'expo-router') ? [layout.routesDir] : [];
  const inRoutes = (rel) => routeDirs.some((dir) => rel.startsWith(`${dir}/`));
  const found = new Set(testFiles.filter(inRoutes));
  // A helper beside the tests in __tests__/ holds no test call, but it is bundled as a route all the same.
  for (const dir of routeDirs.filter((one) => existsSync(join(root, one)))) {
    for (const rel of walkRepo(root, { include: [`${dir}/**`], ignore })) if (/(?:^|\/)__tests__\/.+\.[jt]sx?$/.test(rel) && !rel.endsWith('.d.ts')) found.add(rel);
  }
  const runners = (projects ?? []).map((config) => ({ name: String(config.displayName ?? '?'), runs: runnerOf(root, config) }));
  for (const rel of [...found].sort()) {
    const dir = routeDirs.find((one) => rel.startsWith(`${one}/`));
    const features = layout.mode === 'monorepo' ? `${dir.replace(/\/app$/, '')}/features` : layout.featuresDir;
    const runBy = runners.filter(({ runs }) => runs(rel)).map(({ name }) => name);
    const stillRuns = runBy.length > 0 ? ` (the ${runBy.join(' and ')} project still runs it, so Jest passes)` : '';
    report.problem({ file: rel, line: 1, rule: 'test-in-routes', message: `a test file inside the routes folder ${dir}/: Expo Router bundles every file there as a route, so the production export fails to resolve it${stillRuns}`, fix: `Move it out of ${dir}/. A screen or model test goes next to its unit in ${features}/<feature>/; a route test (a link, a deep link, a redirect, back) goes to ${features}/<feature>/<feature>-navigation.test.tsx and renders the route files' default exports with renderRouterWithProviders. The route file needs no test beside it: that route test covers it, or it carries "// device-only: covered by <flow>".` });
  }
}

function checkStryker(root, contract, report) {
  const rel = 'stryker.config.json';
  if (!existsSync(join(root, rel))) {
    report.problem({ file: rel, line: 0, rule: 'stryker-config', message: 'is missing', fix: 'Copy templates/stryker.config.json and templates/tsconfig.stryker.json to the repo root.' });
    return;
  }
  const text = readFileSync(join(root, rel), 'utf8');
  const { at } = jsonLocator(text);
  const problem = (line, message, fix = 'Restore the value from templates/stryker.config.json.') => report.problem({ file: rel, line, rule: 'stryker-config', message, fix });
  let config;
  try {
    config = parseJsonc(text);
  } catch (error) {
    problem(1, `is not valid JSON (${String(error.message).split('\n')[0]})`);
    return;
  }
  if (config.testRunner !== 'jest') problem(at(['testRunner']), `testRunner is ${JSON.stringify(config.testRunner)}, not "jest"`);
  if (config.jest?.configFile !== 'jest.config.js') problem(at(['jest', 'configFile'], ['jest']), 'jest.configFile is not "jest.config.js"');
  if (!list(config.checkers).includes('typescript')) problem(at(['checkers']), 'the typescript checker is off', 'Add "checkers": ["typescript"]; mutants that do not compile must count as errors, not kills.');
  if (!(Number(config.thresholds?.break) >= 75)) problem(at(['thresholds', 'break'], ['thresholds']), `thresholds.break is ${config.thresholds?.break ?? 'missing'} (must be at least 75)`, 'Restore "break": 75; kill survivors with boundary examples instead.');
  const mutate = list(config.mutate);
  for (const glob of contract.mutateGlobs) if (!mutate.includes(glob)) problem(at(['mutate']), `mutate lacks ${glob}`, 'Keep the logic scope from templates/stryker.config.json (a different logic folder goes into contracts/test-setup.json mutateGlobs).');
  const ignores = list(config.ignorePatterns).map(String);
  const scanned = STRYKER_MUST_IGNORE.filter((folder) => !ignores.some((pattern) => pattern.replace(/^\/|\/(\*\*)?$/g, '') === folder));
  if (scanned.length > 0) problem(at(['ignorePatterns']), `ignorePatterns do not keep ${scanned.join(', ')} out of the sandbox`, 'Add them to "ignorePatterns": with installed skills in the sandbox Stryker copied 16,152 files instead of 338 and each mutant ran slower.');
  if (config.jsonReporter?.fileName !== 'reports/stryker/mutation.json' || !list(config.reporters).includes('json')) problem(at(['jsonReporter', 'fileName'], ['jsonReporter'], ['reporters']), 'the json reporter does not write reports/stryker/mutation.json', 'Add "json" to reporters and "jsonReporter": { "fileName": "reports/stryker/mutation.json" } (check-mutation-report.mjs reads it).');
  const tsRel = String(config.tsconfigFile ?? 'tsconfig.json');
  if (!existsSync(join(root, tsRel))) {
    report.problem({ file: tsRel, line: 0, rule: 'stryker-tsconfig', message: 'the Stryker tsconfig is missing', fix: 'Copy templates/tsconfig.stryker.json and set "tsconfigFile": "tsconfig.stryker.json".' });
    return;
  }
  const tsText = readFileSync(join(root, tsRel), 'utf8');
  let tsConfig;
  try {
    tsConfig = parseJsonc(tsText);
  } catch (error) {
    report.problem({ file: tsRel, line: 1, rule: 'stryker-tsconfig', message: `is not valid JSON (${String(error.message).split('\n')[0]})`, fix: 'Restore templates/tsconfig.stryker.json.' });
    return;
  }
  const types = tsConfig?.compilerOptions?.types;
  if (!Array.isArray(types) || types.length !== 1 || types[0] !== 'jest') report.problem({ file: tsRel, line: jsonLocator(tsText).at(['compilerOptions', 'types'], ['compilerOptions']), rule: 'stryker-tsconfig', message: `compilerOptions.types is ${JSON.stringify(types)}, not ["jest"]`, fix: 'Keep it an app-world program (jest types only): Node types clash with the app\'s own process declaration (src/app-env.d.ts).' });
  for (const target of list(tsConfig?.extends).filter((entry) => typeof entry === 'string')) {
    if (resolvesTsconfig(root, dirname(tsRel), target)) continue;
    report.problem({ file: tsRel, line: jsonLocator(tsText).at(['extends']), rule: 'stryker-tsconfig', message: `extends ${target}, which does not exist, so Stryker stops at start-up (error TS5083: Cannot read file)`, fix: 'Adopt the tsconfig set of typescript-and-lint-rules first (it creates tsconfig.base.json, which templates/tsconfig.stryker.json extends), or point "extends" at a config the app has ("./tsconfig.json" in an app on create-expo-app\'s default tsconfig; this file\'s own types, paths and include still win).' });
  }
}

/**
 * True when a tsconfig "extends" target exists, the way TypeScript resolves it: a relative path from
 * the extending file's folder (".json" added when missing); a package config (expo/tsconfig.base)
 * through node_modules, checked only when node_modules is installed.
 */
function resolvesTsconfig(root, fromDir, target) {
  if (target.startsWith('.') || target.startsWith('/')) {
    const path = target.startsWith('/') ? target : join(root, fromDir, target);
    return existsSync(path) || existsSync(`${path}.json`);
  }
  if (!existsSync(join(root, 'node_modules'))) return true;
  const require = createRequire(join(root, fromDir, 'tsconfig.json'));
  for (const candidate of [target, `${target}.json`, `${target}/tsconfig.json`]) {
    try {
      require.resolve(candidate);
      return true;
    } catch {
      // try the next form
    }
  }
  return false;
}

function checkMocks(root, layout, manifests, contract, report) {
  const sdks = [...new Set([...KNOWN_ROOT_MOCKS, ...contract.rootMocks])].sort();
  for (const sdk of sdks) {
    const user = manifests.all.find(({ pkg }) => depsOf(pkg)[sdk] !== undefined);
    const file = `${layout.mocksDir}/${sdk}.ts`;
    if (user && !['.ts', '.tsx', '.js'].some((ext) => existsSync(join(root, layout.mocksDir, `${sdk}${ext}`)))) report.problem({ file, line: 0, rule: 'root-mock-missing', message: `${user.rel} depends on ${sdk} but the root mock is missing`, fix: KNOWN_ROOT_MOCKS.includes(sdk) ? `Copy templates/__mocks__/${sdk}.ts; the real SDK crashes on import in Jest.` : `Write ${file} (the SDK's own Jest mock re-exported, or the members the adapter uses as jest.fn()); it crashes on import in Jest.` });
  }
  const rootMocks = new Set(walkRepo(root, { include: [`${layout.mocksDir}/**`] }).filter((rel) => rel.startsWith(`${layout.mocksDir}/`)).map((rel) => rel.slice(layout.mocksDir.length + 1).replace(/\.(ts|tsx|js)$/, '')));
  const watched = new Set([...sdks, ...rootMocks]);
  for (const rel of walkRepo(root, { include: ['**/__mocks__/**'] })) {
    if (rel.startsWith(`${layout.mocksDir}/`)) continue;
    const name = rel.split('/__mocks__/').pop().replace(/\.(ts|tsx|js)$/, '');
    if (watched.has(name)) report.problem({ file: rel, line: 1, rule: 'nested-sdk-mock', message: `the ${name} mock outside the root __mocks__ folder is never applied to the node module`, fix: `Move it to ${layout.mocksDir}/${name}.ts at the repo root (next to node_modules).` });
  }
}

/** A test that renders with plain RNTL on purpose says so: "// no-providers: <why>" (the check-test-code marker). */
const needsNoProviders = (source) => {
  const match = /\/\/\s*no-providers:\s*(.+)$/m.exec(source);
  return match !== null && match[1].trim().length >= 10;
};

/**
 * A component test that needs the render helper: it imports the helper module, or it renders with
 * plain RNTL render()/renderHook() without a reasoned "// no-providers:" marker and without a
 * { wrapper } of its own (a test of a provider builds its own tree and does not need the helper).
 */
function needsRenderHelper(source, helperFile) {
  const code = maskComments(source);
  const base = helperFile.split('/').pop().replace(/\.tsx?$/, '');
  if (new RegExp(`from\\s*['"][^'"]*\\/${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.tsx?)?['"]`).test(code)) return true;
  const plain = /import\s*\{[^}]*\b(?:render|renderHook)\b[^}]*\}\s*from\s*['"]@testing-library\/react-native['"]/.test(code);
  return plain && !needsNoProviders(source) && !/\bwrapper\b/.test(code);
}

function checkHelper(root, layout, contract, testFiles, report) {
  const roots = sourceRoots(layout);
  const helper = contract.renderHelper.file;
  const componentTests = testFiles.filter((rel) => rel.endsWith('.tsx') && roots.some((dir) => rel.startsWith(`${dir}/`)) && needsRenderHelper(readFileSync(join(root, rel), 'utf8'), helper));
  if (componentTests.length === 0 || existsSync(join(root, helper))) return;
  report.problem({ file: helper, line: 0, rule: 'render-helper-missing', message: `${componentTests.length} component test file(s) exist (${componentTests[0]}) but the render helper does not`, fix: 'Copy templates/test/render-with-providers.tsx, its test and templates/test/test-app.tsx (then wire the app\'s providers into test-app.tsx). A test whose unit reads nothing from context, or that supplies the provider under test itself or proves the no-provider default, says so with "// no-providers: <why>".' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${positionals[0] ?? '.'} has no package.json`, 'Run from the repo root or pass the repo root.');
  const layout = resolveLayout(root);
  const manifests = readManifests(root);
  const contract = loadContract(layout, options.contract);
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!declares(manifests, 'expo')) return report.notApplicable('expo is not a dependency in package.json or any workspace (this check covers Expo apps)');
  const ignore = [...contract.otherRunnerGlobs, ...(options.ignore ?? [])];
  const testFiles = testCandidates(root, layout, { ignore });
  const goldenTests = testFiles.filter((rel) => GOLDEN_TEST.test(rel));
  checkPackage(root, layout, manifests, goldenTests, report);
  checkBabel(root, manifests, report);
  const projects = checkJest(root, layout, manifests, contract, goldenTests, report);
  checkSetup(root, manifests, report);
  const simConfig = checkSim(root, layout, testFiles, report);
  if (projects) checkOrphans(root, layout, projects, simConfig, testFiles, report);
  checkRoutesFolder(root, layout, manifests, testFiles, ignore, projects, report);
  checkStryker(root, contract, report);
  checkMocks(root, layout, manifests, contract, report);
  checkHelper(root, layout, contract, testFiles, report);
  return report.finish({ checked: 1, unit: 'repo' });
});
