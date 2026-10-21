# Jest, Babel and the test files of the app

How the one Jest set-up of an Expo app is built, why each part exists, and what breaks without it.
Every file named here is a template in `templates/`; copy it verbatim unless this page says otherwise.

## Contents

- Versions (verified 2026-10-03) and how to re-verify them
- Files, folders and where tests write
- babel.config.js
- jest.config.js, part by part
- jest.setup.ts
- jest.sim.config.js (simulations only)
- npm scripts and everyday commands
- Adding a dependency that Jest must transpile
- The optional contract and rn-skills.config.json
- When multi-package
- Known failures and their fixes
- Flaky Jest tests

## Versions (verified 2026-10-03) and how to re-verify them

Verified by installing the reference Expo SDK 57 app on 2026-10-03 (Node 26.4, npm 11.17). Test tools
are devDependencies pinned exactly (`save-exact`); native libraries are added with `npx expo install`.
`assets/package.test-deps.json` holds the lines to merge. Install the Testing Library with its
companion in one command, so npm never picks the renderer on its own:

```sh
npm install -D --save-exact @testing-library/react-native@14.0.1 test-renderer@1.2.0
```

| Package | Version | Note |
|---|---|---|
| `jest` | 29.7.0 | Expo SDK 57 pins `~29.7.0`; jest-expo 57 is built on Jest 29, so do not move to Jest 30 by hand |
| `jest-expo` | 57.0.5 | from `expo/bundledNativeModules.json` (`~57.0.5`); a dev tool, pinned exactly inside that range |
| `@react-native/jest-preset` | 0.86.3 | a jest-expo peer; equal to the `react-native` version |
| `babel-jest` | 29.7.0 | used directly by `jest.sim.config.js` (knip needs it listed); only with simulations |
| `@types/jest` | 29.5.14 | Expo's pin |
| `@testing-library/react-native` | 14.0.1 | the async API (render, fireEvent, renderHook and act return promises); install together with `test-renderer` |
| `test-renderer` | 1.2.0 | RNTL 14's renderer for React 19.2. npm's own peer pick is 1.3.0, which targets React 19.3 (verified: installing RNTL alone put 1.3.0 in the tree) |
| `react` / `react-native` | 19.2.3 / 0.86.3 | exact pins in `dependencies`, as `npx expo install` writes them |
| `fast-check` | 4.10.2 | property tests |
| `@stryker-mutator/core`, `jest-runner`, `typescript-checker` | 10.0.0 | mutation testing; all three on one version |
| Native libraries (via `npx expo install`) | Skia 2.6.2, Reanimated 4.5.1, Worklets 0.10.1, Gesture Handler 2.32.0, react-intl 12.1.3 | their Jest set-up follows the installed native versions |

**One React.** In a single app, `react` and `react-native` are exact pins in `dependencies` and npm
dedupes the test tools onto them. RNTL 14 needs React 19 or newer, React Native 0.78 or newer and Node
`^22.13.0 || >=24`; the `test-renderer` minor equals the React minor (19.2 needs 1.2.x).
`npm ls react react-native` shows exactly one version of each. (When multi-package, see below.)

Re-verify before every SDK upgrade and at least monthly:

```sh
# Expo's own pins (jest, @types/jest, typescript) for the installed SDK:
curl -s https://api.expo.dev/v2/versions/latest | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).data.sdkVersions['57.0.0'].relatedPackages;console.log(d.jest,d['@types/jest'],d.typescript)"
# jest-expo lives in bundledNativeModules.json; npx expo install --check does not look at devDependencies:
node -p "require('expo/bundledNativeModules.json')['jest-expo']"
# Everything else:
npm view @testing-library/react-native version; npm view test-renderer versions --json | tail -5
npm view fast-check version; npm view @stryker-mutator/core version
npx expo install --check     # native test set-ups follow the native versions
npm ls react react-native    # exactly one version of each
```

The next SDK (58) moves React to 19.3 and Jest to 30: jest-expo 58.0.7 and later (what expo 58's
`~58.0.x` map resolves to) declare the peer `jest: ^30.0.0` and depend on `test-renderer` 1.3.0;
58.0.0 to 58.0.6 still used Jest 29 (verified 2026-10-10 with `npm view jest-expo@58
peerDependencies dependencies`). The versions API's `relatedPackages` for SDK 58 still says
`jest ~29.7.0` and `@types/jest 29.5.14`: trust jest-expo's peer range, not that list. Jest 30 removes the alias matchers (`toBeCalled*`, `toReturn*`,
`lastCalledWith`, `nthCalledWith`, `toThrowError`) and `jest.genMockFromModule`, renames
`--testPathPattern` to `--testPathPatterns`, and writes a new `.snap` header link. In the same move
`jest.config.js` gains Reanimated's Jest resolver in `SHARED` and an `asset-registry` entry at the top
of `PATH_ALIASES`; expo-sdk-upgrade owns that move and checks both. Reanimated, Worklets, Skia and
Gesture Handler move too: re-read their versioned testing docs, rerun every check of this skill, and
update this table.

## Files, folders and where tests write

```
<repo>/
  babel.config.js  jest.config.js  jest.setup.ts  stryker.config.json  tsconfig.stryker.json
  jest.sim.config.js                       only with simulations (games plugin)
  __mocks__/<sdk>.ts                       root manual mocks for native SDKs (mocks-and-fakes.md)
  scripts/quality/device-only.ts (+ test)  the coverage helper jest.config.js requires
  contracts/test-setup.json                optional: the app's facts for the checkers
  test/
    render-with-providers.tsx (+ test)     the render helper every component and hook test uses
    render-router-with-providers.tsx (+ test)  route tests: Expo Router inside the same providers
    test-app.tsx                           the app's provider tree for tests (the app grows it)
    flush-microtasks.ts  play-actions.ts   small helpers
    integration/<area>/<name>.test.ts      cross-module and Node-API tests (node:sqlite, node:fs)
    goldens/                               pixel goldens (golden-and-snapshot-tests)
  src/**/<unit>.test.ts(x)                 colocated unit, hook and component tests
  src/**/<unit>.android.test.ts(x)         Android-only behaviour (the android project)
  src/**/<unit>.golden.test.ts             colocated data goldens (the golden project, in every app)
  src/services/<port>/fake-<port>.ts       fakes beside their port
  src/app/                                 routes only: never a test (test-in-routes)
```

**No test inside the routes folder.** Expo Router bundles every `.js`/`.ts(x)` file under `src/app/`
as a route, test files included, and `npx expo export` then fails with `Unable to resolve module
... src/app/index.test.tsx ... (require.context)` while the unit project still runs the test
(verified 2026-10-03, expo-router 57.0.24). Screen and model tests sit next to their unit in
`src/features/`; route tests in `src/features/<feature>/<feature>-navigation.test.tsx`
(component-tests.md, "Routes and navigation").

**Tests another runner owns.** `jest-orphan-tests` and check-test-code leave out a folder that runs
its own tests: one with its own Jest, Vitest, Playwright or Cypress config, a `deno.json` (Deno tests
under `supabase/functions/`), or a `package.json` test script; and the folders a root
`playwright.config.*` names in a literal `testDir` (Playwright for the Expo web build) or a root
`cypress.config.*` names in `specPattern` (plus `cypress/`). A runner the checkers cannot see (a
`testDir` built with `path.join`, Playwright's default of the whole repo) goes into the contract's
`otherRunnerGlobs` (`"e2e-web/**"`); `--ignore <glob>` does the same for one run.

**Node APIs only under the root `test/`.** The app program (`src/tsconfig.json`) has only `jest`
types and lint bans `node:*` imports in `src/`; the root `tsconfig.json` has `node` types. So a test
or helper that needs `node:sqlite`, `node:fs`, `Buffer` or `process.cwd()` lives in
`test/integration/<area>/`. A helper that `src/` tests import through `@test/` must not use Node APIs
either, because the app program type-checks it.

| Artefact | Location | In git? |
|---|---|---|
| Data golden snapshots | `<test>.golden.test.ts.snap.ios` next to the test (jest-expo/ios uses a platform snapshot resolver) | yes, gated |
| Coverage | `reports/coverage/` (`coverage-summary.json`, `lcov-report/index.html`) | no |
| Mutation | `reports/stryker/mutation.{json,html}`, `reports/stryker/incremental.json` | no (keep the incremental file between local runs) |
| Simulations | `reports/sim/<name>.json` | no |

The root `.gitignore` covers `reports/` and `.stryker-tmp/`.

## babel.config.js

Generated by `npx expo customize babel.config.js` and kept at the repo root, because Jest runs from
there and jest-expo resolves Babel options from `process.cwd()`. Without a root Babel config every
suite fails on Flow syntax in React Native (verified).

The Stryker override is required in any app on Reanimated 4 or Worklets, and `templates/babel.config.js`
carries it (the canonical file of expo-project-bootstrap, which this skill copies unchanged). In a
mutation run (`STRYKER_MUTATOR_WORKER` set), only the files Stryker instrumented compile without the
Worklets and Reanimated plugins; every other file compiles exactly as the app builds it. Both halves
were found by failing runs:

- **Instrumented files lose the plugins.** Stryker injects helper functions into every mutated file;
  with the Worklets plugin active, a mutated file with the file-level `'worklet';` directive failed
  Stryker's initial run with `"stryNS_9fa48" is read-only` (verified). Both options must be `false`:
  `worklets: false` alone makes the preset add Reanimated's plugin instead (verified). Worklet
  transforms change no behaviour when code runs as plain JavaScript in Jest, so mutation results stay
  valid.
- **Every other file keeps them.** Under Jest, Reanimated 4.5.1 needs the plugin's `__closure` (or a
  dependency array) for `useAnimatedStyle(() => ...)`; without either it throws
  ``[Reanimated] `useAnimatedStyle` was used without a dependency array or Babel plugin``, and code
  written for the React Compiler never passes a dependency array. An earlier form of the template
  turned the plugins off for every file in a mutation run, so a mutated logic file with a related
  component test that rendered such a component (a list screen over a pressable row that animates its
  press) failed Stryker's initial run ("There were failed tests in the initial test run") although
  `npx jest` passed (verified in the reference app with `npx stryker run --mutate
  src/features/tasks/task-list.ts`).

Every instrumented file contains Stryker's namespace `stryNS_9fa48`, so the override's `test` reads
the file and looks for it (verified on 2026-10-03 and again on 2026-10-10 with `--concurrency 2`: the
run completed, every valid mutant was killed and `check-mutation-report.mjs . --changed
src/features/tasks/task-list.ts` printed `RESULT: PASS`). The shape of the template:

```js
const { readFileSync } = require('node:fs');
const STRYKER_NAMESPACE = 'stryNS_9fa48'; // written into every file Stryker mutates
function isInstrumented(filename) {
  if (filename === undefined) return false;
  try {
    return readFileSync(filename, 'utf8').includes(STRYKER_NAMESPACE);
  } catch {
    return false;
  }
}
module.exports = function (api) {
  const isMutationRun = process.env.STRYKER_MUTATOR_WORKER !== undefined;
  api.cache.using(() => isMutationRun);
  return {
    presets: ['babel-preset-expo'],
    overrides: isMutationRun
      ? [{ test: isInstrumented, presets: [['babel-preset-expo', { worklets: false, reanimated: false }]] }]
      : [],
  };
};
```

Copy the template as it is. An app that still has the old all-files branch (`presets` switched to
`worklets: false, reanimated: false` for the whole mutation run) replaces it with the template:
`babel-config` still accepts that form (both keep `worklets: false` and `reanimated: false` for
mutated files), but it fails the first Stryker run that reaches an animated component.

## jest.config.js, part by part

- **Projects.** `unit` (preset `jest-expo/ios`): every test except goldens, simulations and
  `*.android.test.*`. `android` (preset `jest-expo/android`): only `*.android.test.ts(x)`; there
  `.android.tsx` files resolve, `Platform.OS` is `'android'` and `BackHandler` is the real Android
  module (verified with React Native 0.86.3). `golden` (only `*.golden.test.ts`): in every app, so
  `npm run test:golden` and `-u` on one golden touch nothing else. A data golden (a readable snapshot
  of what a unit produces) runs there with the unit set-up (`jest.setup.ts`); once `package.json` lists
  `@shopify/react-native-skia`, the template spreads `CANVASKIT` into the project: Skia's CanvasKit
  environment and its `jestSetup.js`, so pixel goldens draw real pixels, and `jest.setup.ts` (whose
  inert Skia mock would blank them) stays out. Without the package, a project naming that environment
  fails every Jest run (verified), so the environment follows `package.json`. Verified 2026-10-03 on the
  reference app: one data golden wrote `<test>.golden.test.ts.snap.ios` without Skia, and the same
  snapshot passed under CanvasKit once Skia was back. Skia's environment replaces React Native's
  export conditions, so it is never the global environment. An earlier version of this template kept
  the whole project behind Skia, so in an app without Skia every data golden was silently never run
  (`jest-orphan-tests` now fails that).
- **Every test file runs in exactly one place.** `check-test-setup.mjs` finds, anywhere in the repo,
  every file that Jest's defaults, jest-expo's presets or Expo's guide would treat as a test
  (`*.test|spec.[jt]s(x)`, a test under `__tests__/`, `*-test.[jt]s(x)`) and matches each against
  every project's `testMatch` and `testPathIgnorePatterns` and against `jest.sim.config.js`
  (`jest-orphan-tests`): a file no project runs (a `*.golden.test.tsx`, a `.sim.test.tsx`, a
  `.spec.ts`, a `__tests__/<name>-test.tsx`, a `lib/x.test.ts` outside `src/`, `scripts/` and
  `test/`) is silently skipped, and a file two projects run is run twice. `npx jest --listTests`
  shows what really runs. Left out of the search: installed skills, the Maestro folder, and a folder
  that is not a workspace but runs its own tests (a `functions/` package with its own Jest or Vitest
  config or `test` script, a Detox `e2e/jest.config.js`). `check-test-code.mjs` checks the same files,
  so a guide test keeps failing its rules (`component-snapshot`) after it moves.
- **`process.env.TZ = 'UTC'`** at the top: every worker inherits it, so date code never depends on the
  machine's time zone.
- **`transformIgnorePatterns`**: React Native, Expo, Skia, FormatJS and a few others ship untranspiled
  Flow or ESM (react-intl 12 is `"type": "module"`). The pattern is a prefix match, so `react-native`
  also covers every `react-native-*` library and `expo` every `expo-*` module. Expo Router 57 imports
  `standard-navigation`, which is ESM only: without its entry every route test, and every test that
  imports `expo-notifications`, fails with "Cannot use import statement outside a module" (verified).
  Overriding a preset key replaces the preset's array, so the two jest-expo exclusions
  (`react-native-reanimated/plugin/`, `@react-native/babel-preset/`) are copied in.
- **`moduleNameMapper`** spells out the `tsconfig.json` aliases (`@/` to `src/`, `@test/` to `test/`).
  jest-expo derives the same map only when Jest starts in the repo root, and not through `extends`;
  the explicit map keeps every working directory and Stryker's sandbox resolving to `<rootDir>`.
- **`modulePathIgnorePatterns` / `testPathIgnorePatterns`**: generated native projects (`ios/`,
  `android/`, `build/`, `dist/`), `coverage/`, `reports/`, `.stryker-tmp/`, `.skill-tooling/`, and
  every agent-skill folder (`skills/`, `.agents/`, `.claude/`, `.cursor/`, ...) are invisible to Jest.
  Installed skills hold templates and fixtures with `package.json` files and copies of `__mocks__/`;
  without the ignore, jest-haste-map prints "Haste module naming collision" and "duplicate manual mock
  found: expo-iap" and may apply a fixture's mock instead of the root one (verified).
- **`clearMocks` + `restoreMocks`**: call counts reset before each test; implementations given to
  `jest.fn(impl)` in root `__mocks__` survive (verified with Jest 29.7).
- **`setupFiles`**: the app's Intl polyfill module (`src/i18n/intl-polyfills.ts`,
  i18n-strings-and-catalogs creates it) runs before the framework, like the first import of the app
  entry, so Jest's V8 ICU and Hermes format identically. It is listed only once the file exists: a
  missing setup file fails every suite.
- **`TEST_ROOTS`**: colocated tests in `src/`, `scripts/` and `plugins/`, and the root `test/`.
  `plugins/` holds the app's local Expo config plugins (expo-prebuild-and-config-plugins), Node code
  whose colocated `with-<feature>.test.ts` files would otherwise never run (`jest-orphan-tests`;
  that skill's `plugin-test` rule fails the same gap). A new root changes the project scope that
  quality-gates guards: its `quality-gates.json` `jest.projects.*.testMatch` changes in the same
  gate change, or every app's guardrail fails.
- **`IS_MUTATION_RUN`**: inside Stryker workers the unit project leaves out the one test that checks
  the Worklets plugin's output (`scripts/quality/worklet-transform.test.ts`). The files Stryker
  instrumented compile without that plugin (see "babel.config.js"), so the test fails whenever its
  directive file is in the mutation scope (a `--mutate` that names it); it kills no mutant either way.
- **`coverageThreshold`**: see `coverage-and-mutation.md`. A key joins the config only when
  `fs.globSync` finds a non-test source file, so a young app never fails with "Coverage data for
  ./src/... was not found".
- **`collectCoverageFrom`** counts `src/**`, except tests, `*.d.ts`, `fixtures/` and `testing/`.
- **`coveragePathIgnorePatterns`** comes from `deviceOnlyCoveragePatterns(__dirname)` (the device-only
  marker; `coverage-and-mutation.md`).

## jest.setup.ts

Runs after the framework is installed, in the `unit` and `android` projects (and in `golden` while
the app has no Skia): Gesture Handler's
`jestSetup`, the Worklets mock (`jest.mock('react-native-worklets', () =>
require('react-native-worklets/src/mock'))`) and `require('react-native-reanimated').setUpTests()`.
`react-native-reanimated/jest/resolver` does not exist in 4.5.1 (newer docs describe it); use the docs
of the installed version. An app without one of these libraries deletes its line; the checker
requires each line only while its package is a dependency.

It also holds the one central Skia mock, guarded so it exists only where Skia is installed (a
`jest.mock` factory for a package that is not installed fails the setup file, and with it every suite;
verified). Skia's native module does not load under jest-expo (`Native Skia Module failed to correctly
install JSI Bindings!`), so the mock makes every Skia component (`Canvas`, `Group`, `Path`, `Picture`,
any capitalised export) render as an inert host element named `Skia<Component>` that keeps its props,
so `testID`, `accessibilityRole` and `accessibilityLabel` stay queryable. Every `Skia.*` factory and
lower-case helper (`vec`, `rect`, `matchFont`) returns an inert object that accepts any call, and the
loading hooks (`useFont`, `useImage`, any `use*`) return `null`, which is what the real hooks return
while loading. Rules for it:

- Component and screen tests need no Skia mock of their own. They assert text, roles and names; pixels
  are proven in the `golden` project (real CanvasKit) and by draw-call tests (skia-canvas-rendering).
- A test that must inspect Skia calls writes its own `jest.mock('@shopify/react-native-skia', factory)`;
  a test file's mock replaces the setup file's for that file.
- While the app depends on Skia, the `golden` project never loads `jest.setup.ts`: the inert mock
  would blank every pixel golden.
- `test/skia-mock.test.tsx` renders a `Canvas` with a `Path`; it fails at import if the mock is gone.

An app module of your own that draws with Skia at import time (an icon rasterizer, for example) gets
its own `jest.mock` in `jest.setup.ts`, guarded by `existsSync` on its file while the file may not
exist yet: a `jest.mock` of a missing module fails every suite.

## jest.sim.config.js (simulations only)

Only for apps with long-running simulations, such as the games plugin's bot runs
(game-balance-and-bots): `npm run test:sim`, never pre-commit or `npm test`. Plain Node environment:
a simulation that needs a React Native mock means the simulated logic is not pure. It transforms `.ts`
with `babel-jest` using Metro's caller, maps the aliases like the main config, pins `TZ=UTC` and
allows 300 s per test; keep one file under about 60 s. An app without simulations does not copy it,
and the checker then requires neither the file nor the `test:sim` script.

## npm scripts and everyday commands

```json
{
  "test": "jest --ci",
  "test:golden": "jest --ci --selectProjects golden",
  "test:sim": "jest --ci --config jest.sim.config.js",
  "test:coverage": "jest --ci --coverage --randomize",
  "test:mutation": "stryker run"
}
```

`test:golden` belongs to apps with Skia or with any `*.golden.test.ts`, `test:sim` to apps with
simulations. `--ci` never writes snapshots, so a missing golden fails instead of being created
silently. `test:coverage` runs in random order and prints the seed.

Expo's own unit-testing guide (SDK 57) sets Jest up in `package.json`: `"jest": { "preset":
"jest-expo" }` and `"test": "jest --watchAll"`. With this skill's `jest.config.js` next to that key,
every Jest run stops with `Multiple configurations found` (verified with Jest 29.7). Delete the
`jest` key, and replace the script with `jest --ci` (`--watchAll` never ends in CI or an agent's
shell); `check-test-setup.mjs` fails both (`jest-config-duplicate`, `test-script`), and any other
`jest.config.{ts,mjs,cjs,json}` beside `jest.config.js`. The guide (fetched 2026-10-03) also puts
tests in a root `__tests__/` folder as `home-screen-test.tsx` (its `"jest"` preset runs every file
under `__tests__/`; Jest's own default also runs `*.spec.ts`). No project here runs them, so after the
migration they would silently stop running: move each next to its unit as `<unit>.test.tsx`, turn
its `toJSON()` snapshot into assertions on roles and text, and uninstall `react-test-renderer`, which
the guide itself calls deprecated (`jest-orphan-tests`, `component-snapshot`, `test-dep-deprecated`).

| Need | Command |
|---|---|
| One file | `npx jest --ci src/features/tasks/task-list.test.ts` |
| One title | `npx jest --ci -t 'clears the list'` |
| Tests related to staged files | `npx jest --ci --findRelatedTests <files>` |
| Only one project | `npx jest --ci <file> --selectProjects unit` (or `android`; the path goes before the flag) |
| Coverage with the gate | `npm run test:coverage` |
| Replay an order-dependent failure | `npx jest --ci --randomize --seed=<printed seed> -i` |
| Mutants of one file | `npx stryker run --mutate src/features/reminders/reminder-policy.ts` |

Run Jest from the repo root only. `--selectProjects` takes several names, so a path written right
after it is read as a project name and Jest silently runs the whole project (verified with
`--listTests`). Put paths first, or let another flag follow the project name.

## Adding a dependency that Jest must transpile

A new runtime dependency that ships only ESM (or Flow, or untranspiled TypeScript) fails with
`SyntaxError: Cannot use import statement outside a module`. Add its package-name prefix to
`TRANSPILE_PACKAGES` in `jest.config.js` (a gated file). A package with a `require` export condition
(valibot 1.5.0, TanStack Query 5) needs no entry (verified). `check-test-setup.mjs` derives the
packages it expects in the list from what the app depends on (`jest-transform`).

## The optional contract and rn-skills.config.json

The checkers work on the canonical layout without configuration. When the app keeps something
elsewhere, it says so in `contracts/test-setup.json` (copy `templates/contracts/test-setup.json`;
`test-setup.schema.json` describes every key). Every key is optional and replaces its default:

| Key | Default | Read by |
|---|---|---|
| `renderHelper` | `{ "file": "test/render-with-providers.tsx", "functions": [the three helper functions] }` | both checkers |
| `routerHelper` | `{ "file": "test/render-router-with-providers.tsx", "functions": ["renderRouterWithProviders"] }` | check-test-code (`rntl-await` for its functions, and the fix text of `expo-router-testing`) |
| `deviceOnlyHelper` | `scripts/quality/device-only.ts` | check-test-setup |
| `rootMocks` | `[]` (extra native SDKs that need a root mock, beyond the known list) | both checkers |
| `logicCoverageKeys` | `./src/core/`, `./src/data/`, `./src/games/*/rules/**/*.ts` | check-test-setup |
| `mutateGlobs` | `src/core/**/*.ts`, `src/data/**/*.ts`, `src/**/*-policy.ts`, `src/**/*-reducer.ts` (and the game rules and levels when `src/games/` exists) | check-test-setup |
| `styleContractGlobs` | `src/ui/**`, `src/theme/**`, `src/i18n/**` | check-test-code |
| `logicTestGlobs` | `src/core/**`, `src/data/**`, `src/stores/**`, `src/services/**`, `src/api/**`, game rules, levels and sims | check-test-code |
| `otherRunnerGlobs` | `[]` (files another test runner owns that the checkers cannot detect: `"e2e-web/**"`, `"supabase/functions/**"`) | both checkers (left out of the test files) |

The repo file `rn-skills.config.json` may move the contract (`"testSetupContract":
"qa/test-setup.json"`) and any layout folder (`srcDir`, `testDir`, `scriptsDir`, `mocksDir`,
`contractsDir`); both checkers also take `--contract <file>`. A malformed contract stops the check
with exit 2, never a silent pass.

## When multi-package

One Jest config, run from the repo root, still covers every workspace:

- **One React.** The root `package.json` pins `"overrides": { "react": "<exact>", "react-native":
  "<exact>" }`, equal to the app workspace's versions. Without them npm hoisted React 19.3.0 for the
  root test tools while the app used 19.2.3, so Jest tested a React the app does not ship (verified).
- **Workspace imports by package name**, each mapped straight to its source:
  `'^@acme/core/(.*)$': '<rootDir>/packages/core/src/$1'`. Through the `node_modules` workspace
  symlinks, Stryker's sandbox imports the original files and reports "NoCoverage" or false survivors
  (verified). Never a relative import that leaves the workspace (`cross-root-import`).
- **Roots**: `TEST_ROOTS = ['<rootDir>/{apps,packages}/*/src/**/', '<rootDir>/scripts/**/',
  '<rootDir>/apps/*/plugins/**/', '<rootDir>/test/**/']` (each app keeps its config plugins beside its
  app config; without `scripts/` the device-only helper's own test never runs;
  `jest-orphan-tests` fails it), `collectCoverageFrom: ['<rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}',
  ...]`, and the device-only helper reads the root `package.json` `workspaces` itself, so the marked
  files of every workspace's `src/` (`apps/*`, `packages/*`, a `functions` backend) leave coverage with
  the canonical helper unchanged.
- **Skia in a workspace only.** The template's `HAS_SKIA` reads the root `package.json`; when only an
  app workspace lists Skia, read that workspace's manifest instead (the checker looks at every
  workspace).
- **Stryker** `disableTypeChecks: "{apps,packages}/*/src/**/*.{ts,tsx}"` (coverage-and-mutation.md).
- **Ignore lists** add each app's generated folders (`<rootDir>/apps/[^/]+/(ios|android|build|dist)/`).
- **The contract** names the logic keys and mutate globs of each workspace
  (`./apps/mobile/src/core/`, `packages/core/src/**/*.ts`); without it the checker requires the
  `core/` and `data/` folders that exist in each workspace.

The checkers find workspaces from `package.json` `workspaces`, never from folder names.

## Known failures and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Coverage counts a device-only file, or `modulePathIgnorePatterns` misses `skills/`, only in one checkout | the repo path holds a regex metacharacter (`+`, `(`): Jest substitutes `<rootDir>` into those patterns unescaped | keep repo and temp paths free of regex metacharacters; check-test-setup escapes the root, so it judges the config, not the path |
| Every suite fails on Flow syntax (`import typeof`) | no `babel.config.js` at the repo root, or Jest started from another folder | copy the template to the root; run Jest from the root |
| `npx expo export` fails: `Unable to resolve module ... src/app/<name>.test.tsx ... (require.context)`, though `npx jest` passes | a test file inside the routes folder: Expo Router bundles it as a route | move it to `src/features/<feature>/` (`test-in-routes`) |
| Stryker stops at start-up: `error TS5083: Cannot read file '.../tsconfig.base.json'` | `tsconfig.stryker.json` extends the base config of typescript-and-lint-rules' tsconfig set, which the app has not adopted | adopt that set, or point `extends` at `./tsconfig.json` (`stryker-tsconfig`) |
| A Playwright, Cypress or Deno test is reported as a Jest test that never runs (`jest-orphan-tests`) | its runner's config is not where the checker looks, or names no literal folder | add the folder to the contract's `otherRunnerGlobs` |
| `Test environment @shopify/react-native-skia/jestEnv.js cannot be found` | the golden project names Skia's environment in an app without Skia | the template spreads `CANVASKIT` into the golden project only while `package.json` lists Skia |
| A data golden never runs (`npx jest --listTests` does not list it), and every check passes | an older config kept the whole golden project behind Skia, or the file is a `.golden.test.tsx` | the golden project of `templates/jest.config.js` in every app; goldens are `*.golden.test.ts` (`jest-orphan-tests`) |
| Tests in `__tests__/<name>-test.tsx` (or `*.spec.ts`, or a `lib/` folder) never run, and `npx jest --listTests` does not list them | the app followed Expo's unit-testing guide, whose `"jest"` preset ran every file under `__tests__/`; `jest.config.js` runs only `<unit>.test.ts(x)` in `src/`, `scripts/`, `plugins/` and `test/` | move each next to its unit as `<unit>.test.tsx` and remove `react-test-renderer`, as the guide itself says (`jest-orphan-tests`) |
| `Multiple configurations found: jest.config.js, jest key in package.json` | Expo's unit-testing guide added `"jest": { "preset": "jest-expo" }` to `package.json` (or a `jest.config.ts` sits beside `jest.config.js`) | delete the key (and the guide's `jest --watchAll` script) or the second file (`jest-config-duplicate`) |
| Every Stryker run prints `WARN DisableTypeChecksPreprocessor ... Requires Babel "^7.0.0-0", but was loaded with "8.0.6"` for `eslint.config.mjs` | Stryker's default `disableTypeChecks` covers every JS/TS file, and its Babel 8 cannot load `babel-preset-expo` (Babel 7) | `"disableTypeChecks": "{src,test}/**/*.{ts,tsx}"` from `templates/stryker.config.json` (results unchanged, verified) |
| `Cannot find module '@shopify/react-native-skia' from 'jest.setup.ts'` | an unguarded Skia mock in an app without Skia | the guarded block from `templates/jest.setup.ts` |
| `Cannot use import statement outside a module` in a route test | `standard-navigation` (Expo Router) or another ESM-only package not transpiled | add its prefix to `TRANSPILE_PACKAGES` |
| `TurboModuleRegistry.getEnforcing(...): 'RNGoogleMobileAdsModule' could not be found` | a test (or a module it imports) loads the real AdMob SDK | the root `__mocks__/react-native-google-mobile-ads.ts`; only adapters import the SDK |
| `Cannot find native module 'ExpoIap'` | same for expo-iap | the root `__mocks__/expo-iap.ts` |
| `Failed to install react-native-audio-api: The native module could not be found` | same for react-native-audio-api | the root `__mocks__/react-native-audio-api.ts` |
| `react-native-keyboard-controller ... doesn't seem to be linked` | a screen with a keyboard-aware scroll view | the root `__mocks__/react-native-keyboard-controller.ts` |
| `Coverage data for ./src/... was not found` | a threshold key for a folder without source files | keep the `hasSourceFiles` filter from the template |
| Stryker initial run: `"stryNS_…" is read-only` | Worklets plugin active for the instrumented files in mutation workers | the template's Stryker override in `babel.config.js` (both options `false`) |
| Stryker initial run fails with ``[Reanimated] `useAnimatedStyle` was used without a dependency array or Babel plugin``, though `npx jest` passes | an old all-files Stryker branch turned the Worklets plugin off for every file, and a related component test renders a component whose `useAnimatedStyle` has no dependency array | copy `templates/babel.config.js`: its override applies only to the instrumented files ("babel.config.js" above) |
| Stryker: "NoCoverage" on a file whose tests pass | workspace imports resolved through `node_modules` symlinks | map each workspace package to its source; import by package name |
| `requireMock` returns an object whose `jest.fn()`s have zero calls | the test called `jest.requireMock` without `jest.mock` | add `jest.mock('<sdk>')` at the top of the test file |
| Two Reacts (`Invalid hook call`, or a React version other than the app's) | test tools resolved another React | exact React pins (root `overrides` when multi-package); `npm ls react react-native` |
| `act(...)` warnings | an un-awaited `render`, press or state change | await every RNTL call (`component-tests.md`) |
| `jest-haste-map: duplicate manual mock found: expo-iap` or `Haste module naming collision` | Jest indexes `skills/`, `.agents/` or `.claude/` (installed skills hold copies) | the agent-folder entries of the ignore lists (`jest-ignored-paths`) |
| `npx jest --selectProjects unit <file>` runs every suite | `--selectProjects` swallowed the path as a second project name | `npx jest --ci <file> --selectProjects unit` |
| `Native Skia Module failed to correctly install JSI Bindings!` | the unit project loaded the real Skia: the central mock is missing, or a test called `jest.requireActual('@shopify/react-native-skia')` | the guarded Skia block of `templates/jest.setup.ts`; pixel tests go to the golden project |
| A pixel golden is fully transparent | the golden project loads `jest.setup.ts`, whose inert Skia mock replaced CanvasKit | only `@shopify/react-native-skia/jestSetup.js` in the golden `setupFilesAfterEnv` |
| `TypeError: screen.getPathname is not a function` | Expo Router's matchers (`toHavePathname`, ...) or `testRouter` with RNTL 14 (expo-router 57.0.24, verified) | `renderRouterWithProviders` and its `getPathname()` / `getSegments()` getters (`component-tests.md`) |
| Timers stay fake after a route test (a later `setImmediate`, `flushMicrotasks()` or real-timer wait hangs) | `renderRouter` calls `jest.useFakeTimers()` and never restores them | `renderRouterWithProviders` restores real timers after the first commit |
| An Android-only test passes under `unit` but the app misbehaves on Android | the test overwrote `Platform.OS` under `jest-expo/ios`, so `.android.tsx` files never loaded | `<unit>.android.test.tsx` in the android project |

## Flaky Jest tests

A flaky test passed and failed on the same commit: a bug in the test or the product. No
`jest.retryTimes`, no skips. Rerun with the printed seed: `npx jest --ci --randomize --seed=<n> -i
<file>`. Typical causes: shared mutable module state (use factories), real timers, time zone,
unawaited promises, an overwritten global (`Platform.OS`), order dependence. fast-check is never flaky
by design: a new failure is a new counterexample. CanvasKit renders are byte-identical run to run, so
a varying pixel golden means the draw path reads time or randomness.
