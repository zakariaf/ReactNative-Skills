# Jest, RNTL, goldens, coverage and Stryker

Failures of unit, component, golden, coverage and mutation tests. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npx jest --ci --maxWorkers=2`.

<!-- Generated from assets/known-failures/testing.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Jest setup
- Mocks
- RNTL
- Goldens
- Coverage
- Mutation
- Layout

## Jest setup

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-babel-config-missing` | Every Jest suite fails with a Flow syntax error in @react-native/jest-preset/jest/setup.js | babel.config.js is missing, so jest-expo cannot transform React Native | Create babel.config.js (presets: babel-preset-expo; the canonical file) | verified |  | `unit-and-component-tests` |
| `testing-esm-transform` | SyntaxError: Cannot use import statement outside a module (react-intl, @formatjs, intl-messageformat, standard-navigation, expo-router routes) | An ESM-only package is not in the transformIgnorePatterns allowlist (expo-router 57 imports standard-navigation, so every route test and every test that imports expo-notifications needs it) | Add the package to the allowlist in jest.config.js (the canonical TRANSPILE_PACKAGES) | verified |  | `unit-and-component-tests` |
| `testing-skia-global-env` | After setting Skia's jestEnv globally, React Native tests misbehave and every file loads CanvasKit | Skia's jestEnv extends jest-environment-node and replaces React Native's environment for every test | Use Jest projects: unit (jest-expo) and golden (*.golden.test.ts with the Skia env) | verified |  | `golden-and-snapshot-tests` |
| `testing-mock-calls-accumulate` | A mock expected once is called 2 or 4 times (calls from earlier tests in the file) | The Jest config lacks clearMocks and restoreMocks | Use the canonical jest.config.js (clearMocks and restoreMocks on); never reset by hand in each test | verified |  | `unit-and-component-tests` |
| `testing-duplicate-manual-mock` | jest-haste-map: duplicate manual mock found: <package> | Jest indexed an installed skills folder, whose fixtures ship __mocks__ with the app's package names | Ignore skills/ and the agent folders (.agents, .claude ...) in modulePathIgnorePatterns and testPathIgnorePatterns, as the canonical jest.config.js does | verified |  | `unit-and-component-tests` |
| `testing-selectprojects-path-order` | jest --selectProjects unit <file> runs the whole suite instead of the file | Jest reads every word after --selectProjects as another project name | Put the paths first: npx jest <file> --selectProjects unit | verified |  | `unit-and-component-tests` |
| `testing-jest-alias-cwd` | Cannot find module '@/...' only when Jest starts outside the repo root (Stryker sandbox, another working directory) | jest-expo derives the @/ mapper from tsconfig.json only in the working directory and not through extends | Spell out the aliases in jest.config.js moduleNameMapper (the canonical file does) | verified |  | `unit-and-component-tests` |
| `testing-intl-polyfill-digits` | A number test passes before the Intl polyfills exist and fails after (Latin digits where Node printed native digits, or the reverse) | The forced FormatJS polyfills format without Node's ICU, so a tag without -u-nu- formats differently | Pin the numbering system in the locale tag, or assert through the app formatter; never rely on Node ICU behaviour | verified |  | `i18n-strings-and-catalogs` |
| `testing-randomize-order-leak` | npm run test:coverage fails for some seeds only | It runs Jest with --randomize, which shuffles tests inside a file too; a test left files or state behind for a later one | Make each test clean up what it wrote (afterEach) and never depend on order | verified |  | `unit-and-component-tests` |
| `testing-fast-check-null-proto` | toStrictEqual fails on records that look equal in a property test | fast-check's fc.record can build null-prototype objects; a spread turns them into plain ones | Map records through ({ ...value }) when the property compares a transformed copy | verified |  | `unit-and-component-tests` |

## Mocks

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-native-module-import` | TurboModuleRegistry.getEnforcing(...): '<Module>' could not be found, or Cannot find native module '<X>' in Jest | A test imported a library whose native module does not exist in Jest (ads, keyboard controller, audio), or the module calls requireNativeModule at import time | Give the library a root manual mock in __mocks__/ (applied without jest.mock) or test through the fake port; in your own native adapters use requireOptionalNativeModule inside the factory | verified |  | `unit-and-component-tests` |
| `testing-skia-jsi-unit` | Native Skia Module failed to correctly install JSI Bindings! | Skia was imported in the unit project (jest-expo environment) | Test geometry as pure functions; pixel tests go in the golden project (Skia's jestEnv) | verified |  | `golden-and-snapshot-tests` |
| `testing-reanimated-resolver` | Cannot find module react-native-reanimated/jest/resolver | That path exists only in newer Reanimated docs, not in 4.5 | jest.setup: Gesture Handler's jestSetup, jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock')), require('react-native-reanimated').setUpTests() | verified (react-native-reanimated 4.x) |  | `unit-and-component-tests` |
| `testing-audio-mock-incomplete` | <AudioManager method> is not a function in tests | The audio library's own mock lags its API | Extend it in the root mock and re-check on every bump | verified |  | `audio-and-haptics-feedback` |
| `testing-mock-outdated` | TypeError: <SDK>.<method> is not a function in a test, after an SDK bump or a copied mock | An older copy of a root mock lacks a member the code calls | Keep one mock per library in __mocks__/ and update it with the SDK; delete copies | verified |  | `unit-and-component-tests` |
| `testing-perf-now-mock` | performance.now() timings in Jest are coarse | The preset's performance.now mock has 1 ms resolution | Measure fast code over many iterations; real timings come from device runs (test/**/*.perf.test.ts with node:perf_hooks) | verified |  | `performance-budgets` |
| `testing-isrtl-mock` | I18nManager.isRTL is false in every Jest test | The React Native Jest preset mocks it | Test RTL through an explicit direction option of the test render helper; layout itself is checked on a device | verified |  | `rtl-and-direction` |

## RNTL

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-rntl-async` | act() warnings or empty screens in RNTL 14 tests | RNTL 14 render, fireEvent and user events are async | await render(), await user.press(), await fireEvent.press(); when every call is already awaited and the warning stays, look for a store reset in afterEach (testing-store-reset-after-each) | verified (@testing-library/react-native 14.x) |  | `unit-and-component-tests` |
| `testing-store-reset-after-each` | Every run logs 'An update to TestComponent inside a test was not wrapped in act(...)' from a hook or screen test whose afterEach resets a module-level store (a Zustand store's setState or a reset helper), although every RNTL call is awaited | Jest runs the test file's afterEach before React Testing Library's own cleanup unmounts what the test rendered, so the reset publishes to a still-mounted subscriber outside act() | Reset the module-level store in beforeEach instead of afterEach (the next test starts clean and nothing is mounted yet); never wrap the reset in act() or silence the warning. Rerun the file and npm run test:coverage until no act warning is left | verified |  | `unit-and-component-tests` |
| `testing-router-pathname` | expect(screen).toHavePathname throws 'screen.getPathname is not a function' | expo-router's testing-library was written for RNTL 13; with RNTL 14 the screen object lacks its helpers, and fake timers leak between renderRouter tests | Assert the path through the object renderRouter returns (or the route's rendered root testID); use real timers in router tests | documented (expo-router 57.x) |  | `unit-and-component-tests` |
| `testing-getbyrole-view` | getByRole cannot find a View that has a role | A plain View is found by role only when it is accessible | Set accessible on the View (Pressable is accessible by default) | verified |  | `unit-and-component-tests` |
| `testing-hidden-decorative-parts` | A component test cannot find the testID of a decorative part (an icon, an illustration) | Decorative parts are hidden from screen readers, and RNTL skips hidden elements by default | Query them with { includeHiddenElements: true }; interactive elements stay visible to screen readers | verified |  | `unit-and-component-tests` |
| `testing-catalog-dash` | A screen test expects "Premium - active" but renders "Premium – active" | The catalog text uses an en dash; the test typed a hyphen | Assert the catalog text through the message key (or copy it exactly) | verified |  | `i18n-strings-and-catalogs` |
| `testing-i18n-missing-key-throws` | A component test throws on a missing message id | In tests the i18n onError throws, so a missing key fails the test run | Add the key to every catalog of the app's locales and rerun the catalog check | verified |  | `i18n-strings-and-catalogs` |

## Goldens

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-ci-snapshot` | New snapshot was not written. The update flag must be explicitly passed | jest --ci (the default when CI=1) never writes snapshots | Create or update goldens deliberately with jest <file> -u and a Gate-Change trailer | verified |  | `golden-and-snapshot-tests` |
| `testing-golden-update-all` | npx jest --selectProjects golden <file> -u rewrote every golden in the project | The path after --selectProjects is read as a project name, so -u applies to every golden test | Always npx jest <file> --selectProjects golden -u; restore the other goldens from git | verified |  | `golden-and-snapshot-tests` |
| `testing-obsolete-snapshot` | Jest exits 1 with "1 snapshot obsolete" although every test passed | Jest 29.7 fails the run on obsolete snapshot entries in --ci | Remove the entry with the path-first -u command for that file, or restore the test that owned it | verified |  | `golden-and-snapshot-tests` |
| `testing-snap-platform-path` | jest -u writes snapshots to *.snap.ios (or *.snap.android) files that the gate does not know | The jest-expo platform presets add the platform suffix next to the test | List **/*.golden.test.ts.snap.ios and .snap.android in gatedPaths (the canonical quality-gates.json does); commit golden changes with a Gate-Change trailer | verified |  | `golden-and-snapshot-tests` |
| `testing-golden-text-tolerance` | A pixel golden passes although a two-digit label is missing | A 0.1 % tolerance is about 220 pixels on a 390x560 canvas; a small label is fewer | Add recording-canvas assertions for every label, or a pixel-count threshold for text goldens | verified |  | `golden-and-snapshot-tests` |
| `testing-headless-fonts` | Text is missing in Jest golden images | Skia's jest setup mocks useFonts and matchFont to null | Load the TTF with Skia.Typeface.MakeFreeTypeFaceFromData in text golden tests | verified |  | `golden-and-snapshot-tests` |
| `testing-sim-baselines-runtime` | Simulator or emulator screenshot baselines differ after an Xcode, iOS runtime or system image change | Rendering differs across runtime versions | Tie baselines to one device model and runtime per platform and regenerate them deliberately with a Gate-Change trailer | documented |  | `e2e-maestro` |

## Coverage

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-coverage-missing-dir` | Jest: Coverage data for ./src/<folder>/ was not found (exit 1) | A coverageThreshold key names a folder that has no files yet | Add per-folder threshold keys only when the folder has source files (filter the keys with fs.globSync, as the canonical config does) | verified |  | `unit-and-component-tests` |
| `testing-coverage-untested-templates` | npm run test:coverage fails a global threshold right after adopting templates: Jest: "global" coverage threshold for statements (90%) not met: 83.8% | Files that ship neither a test nor the device-only marker count at 0 % (native adapters, Skia and frame-callback modules, composition files, model hooks) | Give each file a test, or (native, Skia, frame-callback and composition files only) the line "// device-only: covered by <e2e flow or device check>" in its first 6 lines; never lower a threshold or hand-write coveragePathIgnorePatterns | verified |  | `unit-and-component-tests` |
| `testing-subset-coverage-threshold` | A subset run with --coverage exits 1: Jest: "global" coverage threshold for statements (90%) not met: 0% (or a few %), although every test passed | The root config's thresholds count every file collectCoverageFrom names, and the subset ran only a few | Only npm run test:coverage judges thresholds; for a subset: npx jest <paths> --coverage --collectCoverageFrom='<path>/**/*.ts' --coverageThreshold='{}' | verified |  | `unit-and-component-tests` |
| `testing-untested-helper` | The test check reports untested-module for a helper tested only through its caller | The rule is "every pure module has its own test"; a caller's test does not count | Write a small direct test next to the module; the device-only marker is only for wrappers Jest cannot load | verified |  | `tdd-workflow` |

## Mutation

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-stryker-worklet` | Stryker's initial run fails on a file with a file-level 'worklet' directive ("stryNS_..." is read-only), or a related test throws useAnimatedStyle was used without a dependency array or Babel plugin | Stryker injects helpers that the Worklets plugin then workletizes; turning the plugin off for every file breaks Reanimated in the files Stryker did not mutate | Turn the Worklets/Reanimated Babel plugins off only for the files that hold Stryker's namespace (the canonical babel.config.js does) | verified |  | `unit-and-component-tests` |
| `testing-stryker-sandbox-skills` | Stryker copies thousands of files into its sandbox and every mutant run is slow | The sandbox included skills/ and the agent folders | Add them to ignorePatterns in stryker.config.json | verified |  | `unit-and-component-tests` |
| `testing-stryker-nan-score` | Stryker reports a mutation score of NaN (or runs no mutant) and the run passes | Only static mutants were found or every mutant was ignored, so nothing ran; a NaN score is not a pass | Check the mutate globs and the static-mutant setting; a mutation gate treats NaN or zero mutants as a failure | documented |  | `unit-and-component-tests` |
| `testing-weak-properties` | Mutants survive in code covered only by property tests | Determinism and range properties do not pin exact outputs | Add golden example values next to every property test | verified |  | `tdd-workflow` |

## Layout

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `testing-node-api-tests` | A test using node:sqlite, Buffer or node:fs fails tsc inside src/ | The app program carries only jest types (no Node globals in app code) | Put Node-API tests and drivers under test/ (for example test/sqlite/) | verified |  | `unit-and-component-tests` |
| `testing-perf-test-clock` | The test check reports nondeterminism for performance.now() in a speed test | Only test/**/*.perf.test.ts files may time real work, with performance imported from node:perf_hooks | Move the timing test to test/<area>/<name>.perf.test.ts and import performance from node:perf_hooks | verified |  | `tdd-workflow` |
| `testing-sqlite-in-jest` | expo-sqlite fails in Jest | The native module does not run in Jest | Keep SQL behind the SqlDriver port and test the real SQL on node:sqlite (test/sqlite/); the device check is the final proof | verified |  | `persistence-and-migrations` |
