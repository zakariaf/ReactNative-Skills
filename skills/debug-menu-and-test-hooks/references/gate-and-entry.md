# The test-only gate, its entry and the strip proof

How development and preview builds carry the debug menu, the debug link and the simulated clock and
connectivity while production builds contain none of it, and how that is proven. Verified on
2026-10-10 in a copy of the reference app (Expo SDK 57, expo 57.0.26, React Native 0.86.3, Node 26.4,
knip 6.38.0, TypeScript 6.0.3).

## Contents

- Who owns what
- The three files
- Why the literal comparison (and nothing else)
- Why TestOnlyApi is derived from the entry
- The entry is a manifest
- The sentinel
- Test-only folders
- The strip proof (iOS and Android)
- Pitfalls
- Re-verify

## Who owns what

| Piece | Owner |
|---|---|
| The gate file `src/test-only.ts`, the entry `src/test-only-entry.ts`, the sentinel's name, the test hooks, the debug deep-link registry and its contract, the debug menu | this skill |
| Of those, the gate and the test-hook kit (`src/services/test-hooks/` hooks, `src/services/debug-storage/`, `src/stores/debug-overrides/`, `TestHooksRoot` and the debug root kit) and `contracts/debug-links.json` are canonical in the library's shared templates: this skill owns them, other skills sync them; the entry stays app content | this skill |
| The root slots the debug kit fills (`prepareRootKits`, `motion`, `opensDebugRoutes`) and the registry template | app-startup-and-bootstrap |
| The literal comparison rule for every inclusion `require()` (`inclusion-gate`), the Metro cache key, the exported-bundle proof (`check-variant-bundle`) | app-variants-and-environment |
| The import side: `require()` only in a `src/**/test-only.ts` gate, the entry imported only by its gate, `testOnlyFolders` reached only through `TEST_ONLY`, no cycle through the gate (`test-only-gate`, `import-cycle`) | architecture-and-boundaries |
| The built `.app` proof (`check-sim-app`, rule `test-code`) | ios-simulator-build (Android: android-emulator-build) |
| The debug group's `Stack.Protected` guard (`debug-gated`) | navigation-and-routing |

A rule is stated once, in its owner. This skill's checker carries the gate's own shape (the form, the
derived type, the sentinel, the manifest), because only the gate file is this skill's.

## The three files

```ts
// src/test-only.ts
import type * as TestOnlyEntry from './test-only-entry';

export type TestOnlyApi = typeof TestOnlyEntry;

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
```

- `src/test-only-entry.ts`: `export { x } from '...'` lines and `TEST_BUILD_SENTINEL`, nothing else.
- Callers read `TEST_ONLY?.member`. `null` means production: do nothing, render the plain path.
- The canonical ESLint config exempts `src/**/test-only.ts` from `no-require-imports`; nothing else
  may `require()` code.
- Code may branch on the variant (`currentAppVariant()` from app-variants-and-environment): a Preview
  badge, which API to call. Whether code is in the bundle is decided only here.

## Why the literal comparison (and nothing else)

`babel-preset-expo` inlines `process.env.EXPO_PUBLIC_APP_VARIANT` during the transform, Metro folds
`'production' === 'production' ? null : require('./x')` to `null`, and only then collects `require`
dependencies. A `require()` in a folded-away branch never enters the graph, so the entry and every
module only it imports leave the bundle. Folding sees one expression with literals in it; an imported
`IS_TEST_BUILD`, a helper call or `__DEV__` (false in preview builds too) does not work the same way.
app-variants-and-environment ran the six variants of the gate side by side (references
"stripping-test-code" there) and owns the rule; `check-test-hooks` (`gate-form`) only insists that
the gate file is that one expression and runs nothing else.

Jest does **not** inline `EXPO_PUBLIC_*` values (verified: the template test sets the variable and
loads the gate with `jest.isolateModules`, and both answers come out), so the gate test covers both
branches without a bundle.

## Why TestOnlyApi is derived from the entry

The gate casts the `require()` result, so TypeScript never compares a hand-written `TestOnlyApi`
with what the entry really exports: a member without an export is `undefined` at run time
(`TEST_ONLY.createTestHooks is not a function`), and an export without a member is unreachable.
`import type * as TestOnlyEntry` plus `typeof TestOnlyEntry` makes the cast exact and erases to
nothing.

It also settles knip. Measured on 2026-10-10 with the canonical `knip.json`: a hand-written
`TestOnlyApi = { createSimulatedClock: ... }` made `npx knip` exit 1 with three unused exports (both
entry exports and the source module's export), because knip cannot follow a member read through a
casted `require()`. With the derived type, knip exits 0 and needs no `@public` tags and no ignore.
(`api-derived` fails a hand-written type, in the gate or in a `src/test-only-api.ts`.)

Older snippets that write `import type { TestOnlyApi } from './test-only-entry';` in the gate imply a
hand-written `TestOnlyApi` exported from the entry: that fails `api-derived` (the type is not
`typeof` the entry) and `entry-manifest` (a type declaration in the entry). Use the two lines above.

## The entry is a manifest

Only re-exports and the sentinel (`entry-manifest`). Code written in the entry is code nobody can
test on its own and nobody can find by folder. Every member lives in a test-only folder, has its own
test, and is listed here once. Every member is read somewhere as `TEST_ONLY?.member`
(`entry-reachable`); an export nobody reads rides in every development bundle and does nothing,
which usually means its wiring was forgotten.

The template's members and their readers:

| Member | Read by |
|---|---|
| `createTestHooks`, `createKvDebugStorageAdapter` | the app registry's `prepareRootKits` (`src/services/create-root-kits.ts`) |
| `createDebugKit` | the app registry's `createRootKits` (the kit puts `TestHooksRoot` in the root's motion slot and opens the `(debug)` group) |
| `DebugMenuRoot`, `DebugSetupRoot` | the debug routes in `src/app/(debug)/debug/` |
| `TEST_BUILD_SENTINEL` | nobody: it exists to be found in bundles |

## The sentinel

`export const TEST_BUILD_SENTINEL = '<APP>_TEST_BUILD_ONLY';` (the template says `TASKS_...`; put the
app's name first). Hermes bytecode keeps string literals as plain bytes, so the string is found in a
`.hbc` export, in the iOS `main.jsbundle` and in Android's `index.android.bundle` alike.
app-variants-and-environment's `check-variant-bundle` and ios-simulator-build's `check-sim-app` find
every exported `*SENTINEL*` string by themselves (or `rn-skills.config.json` `testOnlySentinels`).

- One sentinel, named `TEST_BUILD_SENTINEL` (`sentinel`): those checks require every sentinel in a
  development bundle, so a second one in a module the entry does not reach would fail them.
- The text exists nowhere else in app code, comments aside (`sentinel`): a copy in a shipped file
  would make every production bundle fail the proof, and teams then learn to ignore it.
- `<APP>_TEST_BUILD_ONLY` in upper snake case: a distinctive string no library or catalog contains.

## Test-only folders

architecture-and-boundaries' `contracts/architecture.json` `testOnlyFolders` lists the folders only
the entry may reach; its `check-boundaries` then fails a static import of them from shipped code (a
route that re-exports the debug screen ships it, and every fake it imports, in every build). This
skill's checker fails a folder the entry re-exports from that the contract does not list
(`test-only-folders`; SKIP while the contract does not exist). The template's folders:

```json
"testOnlyFolders": ["src/features/debug/", "src/services/test-hooks/", "src/services/debug-storage/", "src/stores/debug-overrides/"]
```

Why four folders and not one: the canonical layout puts stores in `src/stores/` (state-management-
zustand's placement rule), ports and adapters in `src/services/<concern>/`, and a store factory may
not be called from feature code, so the composition of the hooks (`createTestHooks`) is a service.

## The strip proof (iOS and Android)

Run after any change to the gate, the entry, variants or Metro (app-variants-and-environment's
workflow, its checker):

```sh
APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo export --platform ios --output-dir dist/variant-proof/development
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --output-dir dist/variant-proof/production
# then app-variants-and-environment's check-variant-bundle on each folder with --variant
```

Measured on 2026-10-10 with this skill's templates wired into the reference app (one Hermes `.hbc`
each, about 4.7 MB, 9 s per export on a warm machine): the development bundle held
`TASKS_TEST_BUILD_ONLY`, `debug-link-bad-value`, `debug.overrides`, `apply-overrides` and
`debug.setup-error` once each; the production bundle held none of them, and `check-variant-bundle`
passed both. What production still holds, by design: the route files of `src/app/(debug)/` (Expo
Router bundles every route; they render `<Redirect href="/" />` when `TEST_ONLY` is null), the
property names read through `TEST_ONLY?.` at the call sites, and the `debug.*` catalog texts
(i18n-strings-and-catalogs keeps them in the catalogs; they are data no code reads in production).

Repeat with `--platform android` when platform files differ. On a native build, ios-simulator-build
(`check-sim-app`, rule `test-code`) reads the sentinel in the embedded `main.jsbundle`; the Android
twin reads `assets/index.android.bundle` in the APK or AAB.

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| The production bundle contains the sentinel after a clean export | the gate is an imported constant, a helper or `__DEV__` | the template's one expression (`gate-form`) |
| It contains it only after a development export ran first | Metro's cache ignores inlined values | app-variants-and-environment's `metro.config.js` cache key |
| `TEST_ONLY.x is not a function` in a preview build | a hand-written `TestOnlyApi` lists a member the entry does not export | derive the type (`api-derived`) |
| knip reports the entry's exports as unused | the same hand-written type | derive the type; never a knip ignore on app code |
| `import-cycle ... through the test-only gate` | a member imports `@/test-only` (or a helper that does) | members import each other from their own files, never the gate |
| The debug screen ships in production | a route imports it statically | the route renders `TEST_ONLY?.DebugMenuRoot`; list the folder in `testOnlyFolders` |
| Every production check fails on the sentinel | the text was copied into a shipped file | keep it in the entry only (`sentinel`) |

## Re-verify

```sh
# knip and the derived type (inside a scratch copy of the app with the templates):
npx knip                                   # exit 0
# the strip, from the app root (app-variants-and-environment's checker):
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --output-dir dist/variant-proof/production
grep -a -c "_TEST_BUILD_ONLY" dist/variant-proof/production/_expo/static/js/ios/*.hbc   # 0
```
