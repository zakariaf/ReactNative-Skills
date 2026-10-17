# Stripping test-only code from store bundles

How test-only code (debug menu, test hooks, simulated clock or network, harness entry points) is
present in development and preview bundles and absent from production bundles, the two traps that
silently ship it, and the bundle proof. Both traps were reproduced on 2026-10-03 with Expo SDK 57
(expo 57.0.26, `@expo/cli` 57.0.27), React Native 0.86.3, Node 26.4, in a copy of the reference app;
the commands are below so the experiment can be rerun after an SDK move.

## Contents

- Who owns what
- How Metro removes code
- The gate: one expression, the literal comparison
- Trap 1: an imported constant does not remove code
- Trap 2: Metro's cache ignores the inlined values
- The sentinel
- The bundle proof
- Rerunning the experiment

## Who owns what

| Piece | Skill |
|---|---|
| The variant value, the inlined `EXPO_PUBLIC_APP_VARIANT`, the literal-comparison rule for every inclusion `require()` (the gate and any other flag) and its check (`inclusion-gate`, the `env-reader` exception), the Metro cache key, the bundle proof (`check-variant-bundle`) | this skill (the rule is stated here; other skills name it) |
| The gate file (`src/test-only.ts`, the one file ESLint lets call `require()`), the test-only entry, the debug deep-link registry, the sentinel's name | `debug-menu-and-test-hooks` |
| The import side: `require()` only in the gate file, the entry imported only by its gate, no import cycle through the gate | `architecture-and-boundaries` |
| Checking a built `.app` or `.aab` (native markers, signing) | `ios-simulator-build`, `ios-release-testflight`, `android-emulator-build`, `android-release-play` |

## How Metro removes code

In a production transform, `babel-preset-expo` replaces `process.env.EXPO_PUBLIC_APP_VARIANT` with its
value, Metro's constant folding reduces `'production' === 'production' ? null : require('./x')` to
`null`, and only then are `require` dependencies collected. A `require` in a branch that folded away
never enters the dependency graph, so its module and everything only it imports leave the bundle.

Folding sees one expression with literals in it. It does not follow an identifier imported from
another module, a function call, or a value computed at run time.

## The gate: one expression, the literal comparison

```ts
// src/test-only.ts (the gate file; debug-menu-and-test-hooks owns it)
import type * as TestOnlyEntry from './test-only-entry';

/** Typed from the entry itself (debug-menu-and-test-hooks' api-derived rule; no hand-written type). */
export type TestOnlyApi = typeof TestOnlyEntry;

export const TEST_ONLY: TestOnlyApi | null =
  process.env.EXPO_PUBLIC_APP_VARIANT === 'production'
    ? null
    : (require('./test-only-entry') as TestOnlyApi);
```

- Compare with `'production'` only: development and preview keep the code, every store build drops
  it, and a new testing variant would keep it too.
- Callers use `TEST_ONLY?.member()`. Behaviour may branch on `currentAppVariant()`; inclusion may not.
- Nothing else imports `test-only-entry`: one static import ships it in every build
  (`architecture-and-boundaries` checks the import side).
- `check-env` (`inclusion-gate`) reports a `require()` of app code behind a condition that stands in for
  the variant without the literal comparison in the same expression, and the
  `if (...) { x = require(...) }` form (not the verified form). A condition stands in for the variant
  when it holds `__DEV__`, a variant-name literal (`process.env.NODE_ENV === 'production'`), or an
  identifier with a whole word (split on camelCase and `_`) such as test, debug, dev, variant, qa or
  staging, or preview, production, release or store next to is, build, mode or variant
  (`isPreview`, `IS_STORE_BUILD`). `shouldRestore`, `showPreview`, `releaseNotes` and a
  `Platform.OS` ternary are not its business.
- **Other inclusion flags follow the same rule.** A public flag that decides whether a module ships
  (Storybook, a mock server, a design gallery) is compared with its literal at the `require()`:
  `export default process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ? require('../../.rnstorybook').default : () => null`.
  This is the one read of a public value that stays outside `src/config/`: moving it into a reader
  and importing a `STORYBOOK_ENABLED` constant is trap 1 below, and the module ships in every bundle.
  `check-env` accepts the literal ternary for any `EXPO_PUBLIC_*` name (`env-reader`), reports the
  same flag in an `if` block or a separate `const` (`env-reader`), and reports a `require()` decided by
  an imported constant or helper that reads an `EXPO_PUBLIC_*` value (`inclusion-gate`).
- `__DEV__` does fold (Metro's inline plugin replaces it with `false` in release transforms, read in
  the `metro-transform-plugins` source), but it is false in preview builds too, so it would strip
  test-only code from the builds testers use.
- **Debug-bundle tooling is the exception.** Reactotron, why-did-you-render and similar tools belong
  in Metro debug bundles only, so `__DEV__` is their right gate, including Reactotron's documented
  `if (__DEV__) { require('./reactotron-config') }` (Metro's constant-folding plugin folds `if`
  statements too, read in `metro-transform-plugins` 0.84.5). `inclusion-gate` skips a specifier that
  names reactotron or why-did-you-render, a package specifier behind `__DEV__`
  (`__DEV__ ? require('@tanstack/react-query-devtools') : null`), and any specifier matching a glob in
  the `rn-skills.config.json` key `devOnlyRequires` (`["./dev-tools/*"]`). A debug menu testers use
  in preview is test-only code, never dev tooling.
- **Why the ternary and not an `if`.** Metro folds `if (process.env.EXPO_PUBLIC_APP_VARIANT !==
  'production') { x = require(...) }` too, so the `if` form is not broken; it is outside what the gate
  file, its ESLint exemption and the bundle proof were verified with, and an `if` block grows other
  statements. `inclusion-gate` therefore asks for the ternary with its own message.

## Trap 1: an imported constant does not remove code

The experiment had two gates side by side:

```ts
// gate A (kept literal): src/test-only.ts
export const TEST_ONLY = process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require('./test-hooks/entry');
// gate B (imported constant): src/test-only-const.ts
import { IS_TEST_BUILD } from './is-test-build';   // = process.env.EXPO_PUBLIC_APP_VARIANT !== 'production'
export const TEST_ONLY_CONST = IS_TEST_BUILD ? require('./test-hooks/entry-const') : null;
```

A production export with a cleared cache
(`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --no-bytecode --clear`)
contained `RNSKILLS_IMPORTED_CONST_SENTINEL` (gate B's module) and not `RNSKILLS_INLINE_GATE_SENTINEL`
(gate A's module). `IS_TEST_BUILD` folded to `false` inside its own module, but the `require` sits in
another module that only sees an identifier.

## Trap 2: Metro's cache ignores the inlined values

`@expo/metro-config` keeps the transform cache in `metro-cache` under the system temp folder, shared by
every project and build on the machine. Its cache key covers the Babel config files, the transformer
options and package versions, not the values of `EXPO_PUBLIC_*` (read in the SDK 57 source of
`babel-transformer.js` and `ExpoMetroConfig.js`; Metro's own default `cacheVersion` is `"1.0"`).

Without a `metro.config.js`, these two exports ran back to back in the same temp folder:

| Export | Bundle file | Contents |
|---|---|---|
| development (`APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development`) | `entry-6ff83dcc....js` | both sentinels, `variant=development` |
| production, same cache, about 1 second | `entry-6ff83dcc....js` (the same hash) | both sentinels, `variant=development` |
| production with `--clear` | `entry-ce432357....js` | gate B's sentinel only, `variant=production` |

The second production export reused the development transforms byte for byte: the store bundle would
have shipped the debug menu and believed it was a development build. With `templates/metro.config.js`
(`cacheVersion` keyed on the public values), development, production, development, production exports
in a row were each correct.

The template keys the cache on every `EXPO_PUBLIC_*` name and value
(`scripts/metro/public-env-cache-version.ts`), not just the variant: a changed API URL between two
production builds is the same trap. In development the values are not inlined, so the only cost is a
fresh transform after a value changes. `npx expo export --clear` also works once, which is why it hides
the missing key until the next build.

A web target that uses expo-sqlite adds one wrapper to the same file, keeping the cache key:
`module.exports = withWebSqlite(config)` with `const { withWebSqlite } = require('./scripts/metro/web-sqlite-metro.ts')`
(web-support's template: the `wasm` asset extension and the COOP/COEP dev-server headers; without it
`npx expo export --platform web` cannot resolve `wa-sqlite.wasm`). The `cacheVersion` line stays.

**Where it bites** (read in the sources on 2026-10-03: `@expo/cli` 57.0.27, react-native 0.86.3,
eas-cli 24.10.0; only the first row was run as an experiment):

| Command | Cache reset? | Exposed |
|---|---|---|
| `npx expo export` (iOS, Android, `--platform web` for API routes), locally or in CI | never, unless `--clear` | yes: the experiment above, the bundle proof, any custom OTA or web pipeline |
| Release bundling inside a native build (`expo export:embed`, run by the Xcode "Bundle React Native code and images" phase and the Gradle bundle task) | React Native's scripts pass `--reset-cache` (`react-native-xcode.sh`, `BundleHermesCTask.kt`), but `@expo/cli` turns it off when `CI` is set: "we shouldn't need this in CI environments" (`export/embed/exportEmbedAsync.js`) | on any machine with `CI` set: a self-hosted runner, a job that builds preview then production, a restored Metro cache, a local Release simulator build that exports `CI=1` for every step (`ios-simulator-build` does, to avoid prompts). EAS Build workers set `CI=1` but start from a fresh VM |
| `npx expo run:ios --configuration Release`, `run:android --variant release` | the pre-bundle resets only when `CI` is unset (`export/embed/exportEager.js`: `resetCache = !env.CI`) | with `CI` set |
| `eas update --environment <e>` | yes: eas-cli passes `--clear` whenever `--environment` is given (`build/commands/update/index.js`: `clearCache: flags['clear-cache'] ? true : !!flags['environment']`) | no |
| `eas update` without `--environment` (CI never prompts for it: `environmentFlagNeededForSdk550OrGreater` in `build/update/utils.js` returns false when `CI` or `EAS_BUILD` is set; a prompted answer does not count) | no: `clearCache` is false, `.env` files load, no EAS variables | yes: an OTA update bundled from a warm cache on a runner that built another variant. Always pass `--environment` |

Re-verify with `grep -n "resetCache" node_modules/expo/node_modules/@expo/cli/build/src/export/embed/exportEmbedAsync.js`
and `npm pack eas-cli@24.10.0 && tar -xzf eas-cli-24.10.0.tgz && grep -n "clearCache:" package/build/commands/update/index.js`.
Key the cache anyway: every reset in that table is an implementation detail of one tool, and the
exports and CI builds have none.

`check-variants` (`metro-cache-key`) proves the key by behaviour, not by reading the code: it loads
`metro.config.js` in a child Node process (with `expo/metro-config` replaced by a stub, so nothing has
to be installed), once with the production pair, once more with only `EXPO_PUBLIC_RNSKILLS_PROBE`
added, and once per variant. It fails when there is no Metro config, when `cacheVersion` is not set,
when it stays the same while only the probe value changes (a key built from the variant alone fails
here), or when two variants get the same key. When the file cannot be loaded (a wrapper package such
as a CSS plugin is not installed) it prints a `note:` and falls back to reading the source.

## The sentinel

The test-only entry exports one string that exists nowhere else:

```ts
// in the test-only entry (debug-menu-and-test-hooks)
export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';
```

Hermes bytecode keeps string literals as plain bytes, so the sentinel is found in `.hbc` and embedded
`main.jsbundle` files as well as in plain JS. `check-variant-bundle` finds sentinels by itself (every
`export const *SENTINEL* = '...'` in the app source), from `rn-skills.config.json` `testOnlySentinels`,
or from `--sentinel`.

## The bundle proof

Make both bundles in one shell, in this order, without `--clear`, so a missing cache key shows:

```sh
APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo export --platform ios --output-dir dist/variant-proof/development
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --output-dir dist/variant-proof/production
node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/development --variant development
node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/production --variant production
rm -rf dist/variant-proof
```

- Production: no sentinel (`bundle-sentinel`) and no secret value (`bundle-secret`).
- Before the app has test-only code, there is no sentinel to look for: `bundle-sentinel` prints
  `SKIP src/test-only.ts [bundle-sentinel] not yet created (debug-menu-and-test-hooks creates it)` and
  `bundle-secret` still runs, so the leaked-key scan works from the first export. A test-only gate
  with no known sentinel is a problem, because a clean production bundle would then prove nothing.
- Development (or preview): every sentinel present; a missing one means the gate strips testing builds
  or the entry is not reachable, and then a clean production bundle proves nothing.
- Add `--env-file .env.local` (for example after `eas env:pull production`) to also prove that no
  secret-named value from that file reached the bundle. The checker prints names, never values.
- Repeat with `--platform android` when platform files differ. The exports live under `dist/`, which
  the canonical `.gitignore`, `.prettierignore`, tsconfig excludes and the checkers' repo scans already
  skip; delete `dist/variant-proof/` after the proof.

## Rerunning the experiment

In a scratch copy of the app (never the working tree), add gate A and gate B as above with a sentinel
in each entry, import both from the root layout, remove `metro.config.js`, set `TMPDIR` to an empty
folder so the cache starts cold, and run the development then production exports. Both sentinels in
the production bundle reproduce trap 2; gate B's sentinel after `--clear` reproduces trap 1. Put the
template Metro config back and repeat to see both fixed.
