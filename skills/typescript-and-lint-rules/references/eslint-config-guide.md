# The ESLint config: how it is built, read and changed

The one `eslint.config.mjs` of the app (the complete file is `templates/eslint.config.mjs`), the
versions it was verified with, how its blocks cascade, and the only allowed way to add an exception;
then Prettier and knip. Read this before touching `eslint.config.mjs`, when a lint message is unclear,
or when a new folder, adapter or exemption is needed.

## Contents

- Versions and install
- The stack and the one-config rule
- Blocks, in order
- File groups
- Shared option lists (why exception blocks rebuild whole lists)
- How check-configs reads the config
- The file-exact exemptions
- Blocks other skills own
- Adding an exception, step by step (and lifting a ban for a scoped doNotAdd entry's importers)
- Prettier
- knip
- Troubleshooting
- When multi-package

## Versions and install

Verified on 2026-10-03 against the reference Expo SDK 57 app; `check-configs.mjs` (rule `package-pin`)
compares `package.json` with this table. Re-verify: `npm view <package> version` and the harness proof
(`npm run typecheck`, `npx eslint . --max-warnings 0`, `npx prettier --check .`, `npx knip`).

| Package | Pin | Notes |
|---|---|---|
| typescript | 6.0.3 | Expo SDK 57's range `~6.0.3`, saved exact; typescript-eslint 8.70.1 supports `>=4.8.4 <6.1.0`, so npm `latest` (7.x) is held back |
| eslint | 9.39.5 | ESLint 10 is held back: it breaks eslint-plugin-react inside eslint-config-expo 57. ESLint 9 reached end of life on 2026-08-06; it is a dev tool and never ships |
| eslint-config-expo | 57.0.2 | brings eslint-plugin-import 2.32.0, eslint-plugin-react-hooks 7.1.1 (React Compiler rules), eslint-plugin-react 7.37.5, eslint-import-resolver-typescript |
| typescript-eslint | 8.70.1 | `package.json` `overrides` pin all ten `@typescript-eslint/*` packages to it, so no second copy floats in (`Cannot redefine plugin "@typescript-eslint"`) |
| eslint-plugin-sonarjs | 4.2.1 | LGPL-3.0-only, dev-only (never shipped) |
| eslint-plugin-react-native | 5.0.0 | styles rules; last release December 2024, peer ESLint 9 at most |
| @react-native/eslint-plugin | 0.86.3 | matches the react-native version (`no-deep-imports`) |
| eslint-plugin-check-file | 3.3.2 | file and folder names, the Expo Router grammar |
| eslint-plugin-jest | 29.16.6 | |
| eslint-plugin-testing-library | 7.16.2 | React Native Testing Library 14 async rules |
| eslint-plugin-formatjs | 8.1.0 | only `no-literal-string-in-jsx` |
| eslint-config-prettier | 10.1.8 | last entry of the config |
| globals | 17.12.0 | Node globals for plain JS config files |
| prettier | 3.9.9 | |
| knip | 6.38.0 | `npm run check:unused` |
| @types/node | 26.4.1 | matches the Node 26.4 runtime of the root program |
| @types/jest | 29.5.14 | both programs list `types: ["jest"]`; without it `tsc` fails with TS2688 ("Cannot find type definition file for 'jest'"). unit-and-component-tests installs Jest itself |

Install from the repo root (`.npmrc` sets `save-exact=true` and `min-release-age=7`):

```sh
npm install -D -E typescript@6.0.3 eslint@9.39.5 eslint-config-expo@57.0.2 typescript-eslint@8.70.1 \
  eslint-plugin-sonarjs@4.2.1 eslint-plugin-react-native@5.0.0 @react-native/eslint-plugin@0.86.3 \
  eslint-plugin-check-file@3.3.2 eslint-plugin-jest@29.16.6 eslint-plugin-testing-library@7.16.2 \
  eslint-plugin-formatjs@8.1.0 eslint-config-prettier@10.1.8 globals@17.12.0 prettier@3.9.9 \
  knip@6.38.0 @types/node@26.4.1 @types/jest@29.5.14
```

Then paste this block into `package.json` (top level, next to `devDependencies`) and run `npm install`
once more, so every `@typescript-eslint/*` package resolves to the one typescript-eslint version.
eslint-config-expo depends on its own `@typescript-eslint/*` range; without the block npm can install a
second copy and ESLint stops with `Cannot redefine plugin "@typescript-eslint"`. `check-configs.mjs`
checks all ten entries (`package-overrides`):

```json
"overrides": {
  "@typescript-eslint/eslint-plugin": "8.70.1",
  "@typescript-eslint/parser": "8.70.1",
  "@typescript-eslint/project-service": "8.70.1",
  "@typescript-eslint/scope-manager": "8.70.1",
  "@typescript-eslint/tsconfig-utils": "8.70.1",
  "@typescript-eslint/type-utils": "8.70.1",
  "@typescript-eslint/types": "8.70.1",
  "@typescript-eslint/typescript-estree": "8.70.1",
  "@typescript-eslint/utils": "8.70.1",
  "@typescript-eslint/visitor-keys": "8.70.1"
}
```

When typescript-eslint moves, the pin and all ten overrides move together.

If npm refuses a version as too young, never lower the age or change the pin: hand off to
dependency-management, which owns the release-age policy. Upgrade triggers: the next ESLint major only
when eslint-config-expo declares support; the next TypeScript major only when typescript-eslint
supports it. Both are developer-visible changes: stop and ask.

## The stack and the one-config rule

`eslint-config-expo/flat` → typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`
(`projectService`) → the app's rules → `eslint-config-prettier` last.

- Every rule is an error, never a warning. Lint runs with `--max-warnings 0` everywhere
  (`"lint": "eslint . --max-warnings 0"`), inline `eslint-disable` comments are switched off
  (`noInlineConfig`), and unused directives are errors.
- There is exactly one config, at the repo root. It also carries rules other skills own (below),
  merged into this one listing so no copy can drift. expo-project-bootstrap writes the same bytes;
  this skill maintains the file.
- Run ESLint only through the npm scripts (`npm run lint`, `npm run check:fast`, the hooks). Never
  pass `--rule`, `--no-inline-config`, `--config`, `--quiet`, `--ignore-pattern`, `--ignore-path` or
  similar, and always lint `.`: CLI flags bypass the config, a narrower target (`eslint src`) skips
  `app.config.ts`, `plugins/`, `scripts/` and the tests, and the quality-gates guardrail sees neither
  (`check-configs.mjs` rule `lint-script`).

## Blocks, in order

Later blocks override earlier ones for the files they match.

| Block | Files | Purpose |
|---|---|---|
| ignores | generated and agent folders | `ios/`, `android/`, `.expo/`, build output, `reports/`, `skills/`, `.agents/`, `.claude/` and the other agent folders, `...PRE_EXISTING` |
| 0 | all | `noInlineConfig`, unused-directive errors |
| 1 | all | `eslint-config-expo/flat`, plugins, the TypeScript import resolver over both programs |
| 2 | `**/*.{ts,tsx}` | typescript-eslint strict + stylistic (type-aware), naming, promises, comments |
| 3 | `**/*.{ts,tsx}` | size and complexity limits (80 lines for `.tsx`) |
| 4 | `**/*.{ts,tsx}` | exports, import order and cycles, banned packages, the `../` ban, file and folder names |
| 5 | `RUNTIME` | network globals, clock and randomness, RTL styles, literal text, vendor SDKs, UI primitives and memo, store selectors, handlers (never async, a block body), React Native and React Compiler rules |
| 5-routes | `ROUTES` | Expo Router files: default export allowed, the router's file and folder grammar |
| 5-zones | `RUNTIME` minus tests | import zones on resolved paths (routes are leaves, `src/core` is the bottom layer; `scripts/`, `plugins/`, `app.config.ts`, `test/` and `__mocks__/` never reach the app) |
| 5-i18n | `src/**/*.tsx` | FormatJS: no literal JSX text or user-facing props; only `src/i18n` imports react-intl |
| 5a | `PURE` | `src/core` and game rules import no React, React Native, Expo, Skia or app layer |
| 5b | `DETERMINISTIC` | integer-safe math only, no device locale (`localeCompare`, `Intl`, `toLocale*`) |
| 5c | named files | the only exemptions (next sections) |
| 6 | `NODE_CODE` | Node APIs, network, console and `../` allowed; extensions required; the wall clock only in `scripts/clock/system-clock.ts`; default exports in `app.config.ts` and config plugins |
| 7 | `TESTS` | Jest and Testing Library rules, relaxed limits, `.d.ts` merging, root mocks |
| 8 | plain JS config files | Node globals, no type information |
| 9 | all | `eslint-config-prettier` last |

`PRE_EXISTING` (declared just above `defineConfig`) lists top-level folders and files that were in the
repo before the app and are not code: knowledge folders, design exports, notes (for example
`['handbook/**', 'research/**']`). The template ships it empty. Fill it once, and list the same
entries in two more places:

| List | Entry for `handbook/` | Without it |
|---|---|---|
| `PRE_EXISTING` in `eslint.config.mjs` | `'handbook/**'` | ESLint lints stray `.js`/`.mjs`/`.ts` tools inside it and fails |
| `.prettierignore` | `handbook/` | `format:check` fails and `npm run format` rewrites the developer's notes |
| root `tsconfig.json` `exclude` | `"handbook"` | the root program's `**/*.ts` include type-checks its `.ts` files under the strict set, so `npm run typecheck` fails while both checkers pass |

`check-configs.mjs` lists every top-level entry outside the app layout that one of the lists misses
(`ignore-pre-existing`; the `exclude` entry is required once the folder holds `.ts`/`.tsx` files). A
folder that is app code, or a tool config the app uses (`tailwind.config.js`), is declared in
`rn-skills.config.json` `"layoutEntries"` instead, so it stays linted. Ordinary Expo and repo files
(`store.config.json`, `google-services.json`, `react-native.config.js`, `modules/`, `patches/`, lockfiles,
`CONTRIBUTING.md`, a root `*.d.ts`) are known already, and so is `design/` (the design tokens,
design-system-structure): pre-existing exports inside it get their own `.prettierignore` line
(`design/exports/`).

The three lists never reach app code: the layout folders (`src/`, `test/`, `__mocks__/`, `scripts/`),
`plugins/`, `modules/`, `app.config.ts`, the root entry files, every workspace and every
`"layoutEntries"` item. One line such as `PRE_EXISTING = ['src/features/**']` would take a whole folder
out of ESLint, Prettier and `tsc` while every tool stays quiet, so `check-configs.mjs` fails it
(`ignore-app-code`, also for an extra `globalIgnores` entry, a `.prettierignore` line and a root
`exclude` entry), and `check-source.mjs` reports such an entry and checks the files anyway. Entries are
read the way each tool reads them: ESLint and `tsc` anchor a name at the root (`'docs'` is the
top-level `docs/` only), while a `.prettierignore` line without an inner slash matches at any depth
(`components/` also hides `src/features/tasks/components/`; write `/components/`). An older template's
top-level `components/` or `hooks/` holds app code: move it under `src/` (or declare it in
`"layoutEntries"`), never into the ignore lists. `globalIgnores` itself holds only the canonical
entries and `...PRE_EXISTING` (`eslint-weakened [global-ignores]`), and no block adds its own `ignores`
(`[block-ignores]`).

## File groups

The groups at the top of the file map the canonical layout. A folder outside them gets only the
generic rules, so a new kind of folder needs a glob here.

| Group | Globs | Meaning |
|---|---|---|
| `RUNTIME` | `src/**/*.{ts,tsx}` | ships inside the app bundle |
| `ROUTES` | `src/app/**/*.{ts,tsx}` | Expo Router route files |
| `NODE_CODE` | `app.config.ts`, `plugins/**/*.ts`, `scripts/**/*.ts` | runs in Node |
| `PURE` | `src/core/**/*.ts`, `src/games/*/{rules,levels}/**/*.ts` | no React, React Native, Expo, Skia or app layer; imports only `@/core/...`, `@/games/<id>/{rules,levels,geom}/...` and siblings |
| `DETERMINISTIC` | `src/core/rng/**`, `src/core/dates/**`, `src/games/*/{rules,levels,sim,geom}/**`, `src/**/*-generator.ts` | output every device must compute identically (a seeded generator module is named `<name>-generator.ts` wherever its feature lives) |
| `TESTS` | `**/*.test.{ts,tsx}`, `test/**`, `jest.setup.ts`, `__mocks__/**` | relaxed limits, Jest rules |
| `ADAPTERS` | `src/services/*/*-adapter.ts`, `src/data/**/*-adapter.ts`, `src/data/**/*-sql-driver.ts`, each with its platform files (`x-adapter.ios.ts`, `.android`, `.native`, `.web`) | the only files that import a vendor SDK (the same globs as architecture-and-boundaries' adapter defaults) |
| `NETWORK_CODE`, `URL_CODE` | `src/api/**`; `src/config/**` | where `fetch` may appear (the ApiClient); where remote URLs may appear (the API base URL read from `EXPO_PUBLIC_API_URL`, and external links). The ApiClient builds requests from that base URL and holds no URL literal (networking-and-server-state) |
| `FORMATTERS` | `src/i18n/**` | where `Intl` date formatting and react-intl live |

`check-configs.mjs` pins every group (`[file-group]`): a group never loses a canonical glob. `ALL_TS`,
`RUNTIME`, `PURE` and `DETERMINISTIC` may gain globs (their blocks add rules: a generator module that
does not follow the `-generator.ts` name goes in `DETERMINISTIC`); every other group is an exemption
and gains only exact file names (`'src/i18n/text-direction.ts'`), never a folder or a name pattern.

## Shared option lists (why exception blocks rebuild whole lists)

In flat config a later block **replaces** a rule's options for the files it matches; it does not merge
(verified). So the file keeps shared lists (`BANNED_PACKAGE_PATHS`, `RUNTIME_PATHS`, `SYNTAX`,
`RESTRICTED_PROPERTIES`) and every block that narrows a rule rebuilds it from those lists minus the one
item it exempts:

- `withoutProperty('Date', 'now')` for the clock adapter,
- `runtimeSyntax(['newDate'])` to drop one `no-restricted-syntax` entry,
- `without(RUNTIME_PATHS, PRESSABLE_IMPORT)` to lift one import ban,
- `restrictedImports({ paths, patterns })` always prepends `BANNED_PACKAGE_PATHS` and `PARENT_IMPORT`;
  its `allow` list lifts one banned package, and only the file-exact consent-adapter block uses it
  (`check-configs.mjs` fails a second one: `eslint-weakened [allow-list]`), except the sanctioned lift
  of a scoped `doNotAdd` entry ("Lifting a ban for the importers a scoped doNotAdd entry names" below).
- A package that is banned with its subpaths (`firebase` and `firebase/firestore`, `firebase/app`, ...)
  is a `bannedWithSubpaths(name, message)` entry of `BANNED_PACKAGE_PATHS`: `restrictedImports()` bans
  the name as a path and `<name>/*` as a pattern, and an `allow` that names the entry lifts both. A
  plain `banned()` entry bans the exact name only (verified with ESLint 9.39.5 on 2026-10-22: with
  `bannedWithSubpaths('firebase', ...)` an app file importing `firebase` and `firebase/firestore`
  fails twice, a `test/rules/` file under the lift block passes; re-verify with `npx eslint
  --print-config <file>` and a planted import).

A block that writes a fresh short list (`'no-restricted-imports': ['error', { paths: [x] }]`) silently
drops every other ban for those files. That is the most likely way to weaken the config by accident.
The helper can do the same: `restrictedImports({})` keeps only the package bans, so a broad block that
uses it drops every vendor, `Text`, react-intl and memo ban. Every non-Node `restrictedImports()` call
names `RUNTIME_PATHS` (block 5a included); the canonical exceptions are the two `restrictedImports({})`
calls (block 4 and `__mocks__`/`jest.setup.ts`) and the Node-code block. The same holds for options: a
later `'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }]` turns `void`
checking off for its files, and a bare `'max-depth': 'error'` falls back to ESLint's default of 4.
`check-configs.mjs` reports:

- a hand-written `no-restricted-*` list, an extra `restrictedImports({})`, or a `restrictedImports()`
  call without `RUNTIME_PATHS` beyond the canonical three (`eslint-weakened [fresh-list]`);
- a second declaration of a rule whose options carry a guarantee (`no-floating-promises`,
  `strict-boolean-expressions`, `switch-exhaustiveness-check`, `no-unused-vars`, `no-empty`, ...), of a
  limit rule (`max-lines`, `complexity`, `max-depth`, ...), or of a strictTypeChecked rule the canonical
  config never touches (`no-misused-promises`, `ban-ts-comment`, `no-explicit-any`, ...)
  (`[option-redeclared]`);
- whatever the spelling (`RESTRICTED_PROPERTIES.filter(...)`, a string const, a new group), a block
  or group that reaches a whole folder: the structural comparison below (`[canonical-block]`,
  `[exemption-scope]`, `[file-group]`, `[canonical-const]`).

The selectors this skill relies on (`asyncHandler`, `handlerBody`, `newDate`, `setTimeoutNoDelay`,
`enums`, `NODE_IMPORT_EXTENSION`, `DETERMINISM_SYNTAX`) and the four `BANNED_PACKAGE_PATHS` bans are pinned
verbatim, like the `RESTRICTED_PROPERTIES` messages: an edit in place fails `eslint-required`.

## How check-configs reads the config

`check-configs.mjs` compares the app's `eslint.config.mjs` with the skill's own
`templates/eslint.config.mjs`, as text (whitespace and comments aside; it never runs either file):

| Part | Rule | Allowed to differ |
|---|---|---|
| each canonical block (its `files`, `ignores`, `rules`, `extends` and options) | present, unchanged, in the template's order (`[canonical-block]`): a later block replaces an earlier one's options, so order is part of the config | nothing; when multi-package, see that section |
| every other block | names exact files: each `files` entry has a literal file name as its last segment (`src/services/perf/frame-sampler-adapter.ts`, `src/**/test-only.ts`); a block without `files`, a folder glob, a name pattern (`src/**/use-*.ts`) or a `files` value that is not a string list fails (`[exemption-scope]`); the one exception is the sanctioned lift of a scoped `doNotAdd` entry, which may name its `allowIn` glob (`[scoped-lift]`, "Adding an exception") | anything inside it, within the other rules (`[fresh-list]`, `[option-redeclared]`, `eslint-rule-off`) |
| the file groups | `[file-group]` (above) | widening groups gain globs; exemption groups gain exact file names |
| every other top-level `const` (shared lists, selectors, helpers) | verbatim (`[canonical-const]`) | `PRE_EXISTING`, `IS_MULTI_PACKAGE` and `PACKAGE_IMPORT_EXTENSION` are the app's to fill; `VENDOR_SDK_PATHS` and `BANNED_PACKAGE_PATHS` gain entries but never lose one; new consts are allowed |
| the items of `defineConfig([...])` that are not blocks | only `globalIgnores(...)`, `expoConfig` and `prettierConfig` (`[config-item]`) | nothing |
| statements | imports, consts and `export default defineConfig([...])` only (`[top-level-statement]`); nothing mutates a shared value (`.length = 0`, `push`, `splice`, `Object.assign`, `delete`: `[side-effect]`) | nothing |

The comparison reads text, so a glob built at run time (a function call, an import from another file)
is reported as unresolvable rather than evaluated. Probe with `npx eslint --print-config <file>` when
in doubt.

A pattern list is gitignore-style: a negation cannot re-include a file under an excluded folder. To ban
"everything under the alias except some folders", match files (`'@/services/*/*'`,
`'!@/services/*/*-port'`) or use a `regex` pattern; `'@/*'` with `'!@/core/*'` bans `@/core/...` too
(verified 2026-10-03). `PURE_ALIAS` is `{ regex: '^@/(?!core/|games/[^/]+/(?:rules|levels|geom)/)' }`:
pure code reaches `src/core` and the pure folders of a game (a level generator imports its game's rules
engine), and nothing else under `@/`. Probe after changing it (verified 2026-10-03, ESLint 9.39.5): in
a scratch copy of the app, `src/games/lights-out/levels/first-level.ts` importing
`@/games/lights-out/rules/board` lints clean, while the same file importing `react` or `@/ui/app-text`
fails `no-restricted-imports`. Which game may import which is an `import/no-restricted-paths` zone the
games plugin adds.

## The file-exact exemptions

| API | Only in |
|---|---|
| `Date.now`, `new Date()` with no argument (app) | `src/services/clock/*-adapter.ts`; `new Date(epochMs)` converts an instant and is allowed everywhere |
| `Date.now`, `new Date()` (Node) | `scripts/clock/system-clock.ts` (`new Date(value)` stays allowed in Node code) |
| `Date.now`, `performance.now` | `src/services/perf/*-adapter.ts` (performance instrumentation) |
| `I18nManager` | `src/i18n/direction.ts` |
| `textAlign: 'left' \| 'right'`, the `Text` import | `src/ui/app-text.tsx` |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | `src/api/**` (the ApiClient) |
| remote URL literals | `src/config/**` |
| `Intl.DateTimeFormat`, `.toLocaleString()`, `react-intl` | `src/i18n/**` |
| `require()` | `src/**/test-only.ts` (test-only code stays out of store bundles) |
| raw `Pressable` | `src/ui/**` |
| raw `Image` from react-native | `src/ui/icons/icon.tsx` |
| vendor SDK imports | `ADAPTERS` (one adapter per port, with its platform files) |
| `expo-tracking-transparency` | `src/services/consent/*-consent-adapter.ts` and its platform files (one place asks for tracking; admob-ads-and-consent owns the flow) |
| `expo-iap` server features (`kitApi`, `useIAP`, ...) | banned even inside `src/services/purchase/expo-iap-purchase-adapter.ts` (in-app-purchases owns it) |
| typed-array mutation (`no-param-reassign` props) | `src/games/*/sim/**` (the games plugin's real-time loop) |
| `export default` | route files, `app.config.ts`, `plugins/**`, `__mocks__/**`, `jest.setup.ts`, plain JS config files |

If the file that owns such an API is named differently in your app, add its exact path to the group
(`DIRECTION_MODULE = ['src/i18n/direction.ts', 'src/i18n/text-direction.ts']`, with a `Gate-Change:`
trailer), never a rule change. The canonical glob stays; a folder or a name pattern fails
`eslint-weakened [file-group]`.

## Blocks other skills own

One config holds every lint rule, but each topic has an owner skill that states the rule and its why:
naming, the route grammar and the path header on line 1 of every file (naming-conventions), the zones
and adapters (architecture-and-boundaries), the hooks that run lint (`lefthook.yml`, quality-gates),
UI primitives, memo and store selectors (react-components-and-hooks), literal strings (i18n-strings-and-catalogs),
logical styles (rtl-and-direction), test titles and async Testing Library calls
(unit-and-component-tests), deterministic math (seeded-determinism-and-golden-vectors), the network
policy (networking-and-server-state; the `offline-only` profile lives in privacy-and-store-declarations).
`BANNED_PACKAGE_PATHS` mirrors the app's own dependency policy (dependency-management): edit both
together. This skill owns the mechanics: severities, limits, the shared lists, exceptions, Prettier and
knip.

## Adding an exception, step by step

Exceptions are rare; most lint errors are fixed in the code (references/forbidden-patterns.md). When a
tool or library contract truly needs one:

1. Confirm the need: the error comes from a tool or library contract, not from code that could be
   written another way.
2. Add a `files`-scoped block in block 5c naming the exact file, with a comment that states the
   reason:

   ```js
   // Hypothetical: a frame-time sampler in test builds must read performance.now.
   {
     files: ['src/services/perf/frame-sampler-adapter.ts'],
     rules: { 'no-restricted-properties': ['error', ...PERF_PROPERTIES] },
   },
   ```

   Prefer adding the exact path to an existing file list (here `PERF_CLOCK_FILES`) over a new block.
   An exception that switches a rule `'off'` beyond the canonical count fails `eslint-rule-off`, and
   one whose glob covers a whole folder or a name pattern fails `eslint-weakened [exemption-scope]`
   (`[file-group]` in a list): both are baseline changes, so stop and ask the developer.
3. When the rule takes a list (`no-restricted-imports`, `no-restricted-syntax`,
   `no-restricted-properties`, `no-restricted-globals`), rebuild it from the shared lists minus the one
   exempted item; a literal list fails `eslint-weakened [fresh-list]`. Never re-declare a rule whose
   options carry a guarantee (`[option-redeclared]`).
4. Run `npx eslint --print-config <file>` for the exempted file and for a neighbour, and check the
   exemption applies only to the named file.
5. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-configs.mjs .`.
6. When `scripts/quality/check-quality-gates.ts` exists, run `npm run verify` (or the script): the
   quality-gates guardrail compares the resolved ESLint config of its probe files, the tsconfigs, the
   Jest thresholds, the scripts and the hooks with `quality-gates.json`. Never edit
   `quality-gates.json` to make it pass; quality-gates owns it.
7. Commit with a `Gate-Change: <why>` trailer (the config is a gated file).

### Lifting a ban for the importers a scoped doNotAdd entry names

The one exception that may name a glob instead of exact files. When the dependency policy keeps a
package out of the app but lets some files import it (a scoped `doNotAdd` entry with `allowIn`,
dependency-management; the Firebase JS SDK for the security-rules tests is the usual case), mirror it
in three parts and change nothing else:

```js
// The Firebase JS SDK: the app talks to Firebase through @react-native-firebase/*; only the rules
// tests import it (contracts/dependency-policy.json doNotAdd "firebase", allowIn test/rules/**).
const FIREBASE_JS_SDK = bannedWithSubpaths(
  'firebase',
  'Use @react-native-firebase/* in the app; the Firebase JS SDK is test tooling for test/rules/ only.',
);
const BANNED_PACKAGE_PATHS = [
  FIREBASE_JS_SDK,
  // ... the canonical entries
];

// block 5c or later: the importers the doNotAdd entry's allowIn names, nothing else lifted
{
  files: ['test/rules/**'],
  rules: { 'no-restricted-imports': restrictedImports({ allow: [FIREBASE_JS_SDK] }) },
},
```

`check-configs.mjs` accepts such a block, as many as there are scoped entries, without an exact file
name and without counting its `allow` list, when all of this holds; otherwise it reports each gap as
`eslint-weakened [scoped-lift]` next to the usual `[exemption-scope]` and `[allow-list]`:

- every name in `allow` is a `banned()` or `bannedWithSubpaths()` const whose package has a `doNotAdd`
  entry in `contracts/dependency-policy.json` with `allowIn`;
- every `files` entry lies within one of those `allowIn` globs (`test/rules/**`, or exact files under
  it); `test/**` fails;
- the block sets `no-restricted-imports` and nothing else, and its value is the value the canonical
  config gives those files plus the `allow` list: `restrictedImports({ allow: [...] })` for `test/`
  (block 4's `restrictedImports({})`), `restrictedImports({ paths: RUNTIME_PATHS, patterns:
  [NODE_BUILTINS], allow: [...] })` for a file under `src/`. Any other lift drops more than the one
  package.

The rules tests assert with `assertSucceeds` and `assertFails` of `@firebase/rules-unit-testing`, which
`jest/expect-expect` does not count. Append exactly those two names to the tests block's
`assertFunctionNames` (`['expect', 'fc.assert', 'assertSucceeds', 'assertFails']`): it is the one
sanctioned value of that rule besides the canonical one (`ts-lint-baseline.json`
`structure.ruleAlternatives`), and the quality-gates guardrail accepts the appended names in
`quality-gates.json` too. Any other name fails `[canonical-block]`.

A new rules test file then needs no config change. architecture-and-boundaries' `check-boundaries.mjs`
reads the same `allowIn`, so both gates agree on who may import the package.

Editing `eslint.config.mjs`, `.prettierrc.json` or a `tsconfig*.json` may show the developer a
permission prompt (they are `ask` paths in `.claude/settings.json`). That is expected: say in one plain
sentence what the change is and why.

## Prettier

- Prettier is the only formatter (`npm run format`); never format by hand and never through an ESLint
  plugin (`eslint-plugin-prettier` is banned; `check-configs.mjs` rule `eslint-forbidden-import`).
- It runs as its own check (`npm run format:check`); `eslint-config-prettier` only turns off conflicting
  ESLint rules, and it is the last entry of the config (`eslint-required [prettier-last]`).
- `.prettierrc.json`: `printWidth` 100, `singleQuote`, `trailingComma` all, `bracketSpacing`,
  `arrowParens` always, `endOfLine` lf.
- `.prettierignore` lists the lockfile, generated and native folders, snapshots, `expo-env.d.ts`, the
  agent folders (`skills/`, `.agents/`, `.claude/`, ...), then a closing comment: add one line below it
  per pre-existing top-level entry (`handbook/`, `notes.md`), the same entries that go in
  `PRE_EXISTING` and the root `tsconfig.json` `exclude`. Without those lines `format:check` fails on
  day one and `npm run format` rewrites the developer's notes (`ignore-pre-existing`). An older copy
  that still holds the `__PRE_EXISTING__` placeholder line fails `prettier-ignore`.
- The native folders are anchored (`/ios/`, `/android/`, as Expo's SDK 57 template writes them in
  `.gitignore`): an unanchored `ios/` also hides `scripts/ios/` and a local module's
  `modules/<name>/ios/` from Prettier (`prettier-ignore` for the missing line, `ignore-app-code` for an
  old unanchored one that reaches app code). The canonical `.gitignore` (`dot-gitignore`, which this
  skill owns; expo-project-bootstrap and quality-gates ship it) anchors them the same way, so that
  native source stays committed. ESLint `ignores` and the tsconfig `exclude` are anchored already.
- One config: `prettier.config.js`, `.prettierrc`, a `prettier` key in `package.json` or
  `package.yaml` (Prettier 3.9.9 reads both before `.prettierrc.json`) and a nested `.prettierrc*`
  under an app folder (Prettier resolves the config per folder, so it wins below it) are strays
  (`config-stray`), as are an `eslintConfig` or `knip` key in a `package.json`.

## knip

`knip.json` finds unused files, exports, types, dependencies and unlisted binaries
(`npm run check:unused`; the script is not named `knip` because expo-doctor fails a script named like a
binary). Entry points are the route files, scripts, root mocks and tests; the project is everything
TypeScript under `src/`, `test/`, `scripts/` and `__mocks__/`.

- Every rule is `"error"` (`check-configs.mjs` rule `knip-config`): an unused export is deleted, not
  ranked down. `ignoreExportsUsedInFile` stays on so a type used only in its own file is not noise.
- A config plugin loaded by path (`plugins: ['./plugins/with-task-widget.ts']`) is an entry, or tag its
  default export `/** @public */` so knip does not report it.
- A global tool an npm script starts by name (EAS CLI, which is never a dependency) makes knip fail
  with "Unlisted binaries"; keep `eas` out of npm scripts (eas-build-and-submit runs it directly), or
  add it to the app's `ignoreBinaries` with its reason. The canonical list leaves it out, because most
  apps never script it.
- A dependency only the native build uses (a config plugin package) goes in knip's
  `ignoreDependencies`, never by turning `dependencies` off. knip's schema refuses comment keys, so
  the reason goes in `contracts/knip-ignores.json` at the same key path (quality-gates' rule
  `knip-ignores`).
- The canonical `ignore` list holds the ten agent folders (`skills/**`, `.agents/**`, `.claude/**`
  and the rest). Installed skills carry templates and fixtures that import packages the app never
  installs, and knip's Jest plugin falls back to Jest's default test glob, so without them
  `check:unused` fails with "Unlisted dependencies" as soon as a skill is installed. knip prints
  "Remove from ignore" hints for folders that do not exist yet; the hints do not fail the run. Their
  reasons ship in quality-gates' `contracts/knip-ignores.json`.
- `check-configs.mjs` also fails the issue-type filters `exclude` and `include` (`knip-config`), an
  `ignore`, `ignoreFiles`, `ignoreIssues` or `ignoreWorkspaces` entry that reaches app code
  (`ignore-app-code`), a canonical `entry` or `project` glob that is gone, and an extra `entry` that
  is not an exact file (every export of an entry counts as used). `ignoreDependencies` and
  `ignoreBinaries` stay allowed.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "file not found in any of the provided project(s)" | the file belongs to no tsconfig program | the root program includes `**/*.ts`; check its `exclude` (references/tsconfig-set.md) |
| a `no-restricted-imports` ban stops working in one folder | a later block wrote a fresh list | rebuild the block from `RUNTIME_PATHS` / `restrictedImports()` |
| `src/core` cannot import `@/core/...` | a gitignore-style negation under an excluded folder | match with a `regex` pattern (`PURE_ALIAS`) |
| a game's `levels/` cannot import its own `rules/` ("src/core and game rules are pure TypeScript") | an older `PURE_ALIAS` (`'^@/(?!core/)'`) | restore the canonical regex that also allows `games/<id>/{rules,levels,geom}/` |
| `tsc` fails (TS2688) "Cannot find type definition file for 'jest'" | `@types/jest` is not installed; both programs list `types: ["jest"]` | `npm install -D -E @types/jest@29.5.14` |
| `npm run typecheck` fails inside a pre-existing folder (TS1294, implicit any) | the folder is in `PRE_EXISTING` and `.prettierignore` but not in the root `tsconfig.json` `exclude` | add it to `exclude` (`ignore-pre-existing`) |
| an Expo Router API route (`src/app/api/tasks+api.ts`) fails `check-file/filename-naming-convention` | an older `ROUTE_FILE` without the `+api` forms | restore the canonical `ROUTE_FILE` (naming-conventions owns the grammar) |
| `check-file/filename-blocklist` crashes with "invalid pattern" | a free-text suggestion | the suggestion must be a glob (`**/[a-z]*-[a-z]*.ts`) |
| `no-misused-promises` accepts `onPress={async () => ...}` | React Native's Strict API types `onPress` as returning `unknown` | the `asyncHandler` selector catches it; keep handlers synchronous |
| `onPress={handleSubmit(onValid)}` fails "Event handlers are synchronous" | react-hook-form's `handleSubmit` returns a promise and rethrows what `onValid` throws | `onPress={() => { handleSubmit(onValid)().catch(reportError); }}` |
| `type: 'image/jpeg'` (a multipart part) or `getDocumentAsync({ type: 'application/pdf' })` fails "`kind`/`type` values are kebab-case" | an older `kindValue` selector without the MIME exemption | restore the canonical `kindValue`/`kindTypeValue` (they skip values shaped `<type>/<subtype>`, `<type>/*` and `*/*`); naming-conventions owns the rule |
| `check-configs` reports `ignore-app-code` | an ignore list reaches `src/`, `test/`, `scripts/`, `plugins/` or another app path | remove the entry and fix the code; app code the repo keeps elsewhere moves under `src/` or into `"layoutEntries"` |
| `check-configs` reports `[exemption-scope]` | a block beyond the canonical ones reaches a folder, every file or a name pattern | name the one file the contract needs |
| `check-configs` reports `[canonical-block]` | a canonical block's files, ignores, rules or options changed, or it moved | restore it from `templates/eslint.config.mjs`; an exception is a new block naming exact files |
| `check-configs` reports `[file-group]` | a group lost a canonical glob, or an exemption group gained a folder or a name pattern | restore the glob; add exact file names only |
| `check-configs` reports `[canonical-const]` | a shared list, selector or helper was edited in place | restore it verbatim; `VENDOR_SDK_PATHS` and `BANNED_PACKAGE_PATHS` may only grow |
| "Event handlers return nothing: use a block body ..." | an inline `on*` arrow or a `handleX` arrow with an expression body, or a `return value` in a handler | `onPress={() => { save().catch(reportError); }}`; a responder handler that must return a value (`onStartShouldSetResponder`) is a named function passed by reference |
| a route `[TaskId].tsx` or folder `[TaskId]` fails `check-file` | a route param starts with a lowercase letter (naming-conventions) | `[taskId].tsx` |
| "Deterministic code: localeCompare ..." (or `Intl`, `toLocaleUpperCase`) in a `*-generator.ts` | locale-aware calls read the device's ICU data | compare with `<` and `>`; `toUpperCase` |
| ESLint lints a `.mjs` tool in a pre-existing folder; `format:check` fails on hand-written notes | pre-existing top-level folders are not ignored | add them to `PRE_EXISTING`, `.prettierignore` and the root `tsconfig.json` `exclude` (`ignore-pre-existing`) |
| the guardrail reports `no-restricted-properties` differs | a `RESTRICTED_PROPERTIES` message or entry changed | restore the exact entry from `templates/eslint.config.mjs` |
| lint gets slow (minutes) | type-aware rules over a large program | `npm run check:fast` caches by content; never weaken rules for speed |

## When multi-package

- Set `IS_MULTI_PACKAGE = true`: `runtimeSyntax()` then adds `PACKAGE_IMPORT_EXTENSION`, which requires
  the extension on relative and `@/` imports. Extend its pattern with the workspace scope
  (`/^(\.|@\/|@acme\/)/`), because the config cannot know package names; `check-source.mjs` reads them
  from `package.json` `workspaces`.
- Widen the file groups to the workspaces (`apps/*/src/**`, `packages/*/src/**`) and add the package
  direction (which package may import which) as `import/no-restricted-paths` zones;
  architecture-and-boundaries owns the direction. `check-configs.mjs` reads a workspace prefix from
  `package.json` `workspaces` (`apps/*/src/api/**/*.ts` counts as the canonical `src/api/**/*.ts`), so
  widened groups pass `[exemption-scope]` while a folder-wide adapter glob still fails.
- Still one config at the repo root: a workspace `eslint.config.*`, `.prettierrc*` or `knip.json` is a
  stray (`config-stray`). List every workspace's `tsconfig.json` in the import resolver's `project`.
- Add `apps/*/ios/` and `apps/*/android/` to `.prettierignore`, next to `/ios/` and `/android/`.
  Prebuild writes each Expo app's native projects into `apps/<app>/ios` and `apps/<app>/android`; the
  anchored root lines do not reach them, and Prettier reads only the root `.prettierignore` and
  `.gitignore`, so `format:check` fails on Xcode's JSON (`"info" : {`) after the first local
  `expo run:ios`. `check-configs.mjs` requires a line for each Expo app workspace (`prettier-ignore`)
  and lets a line that names exactly an Expo app workspace's `ios/` or `android/` pass
  `ignore-app-code`; `packages/*/ios/` (a local Expo module's committed native source, recognised by
  `expo-module.config.json`), `apps/**/ios/` and `apps/*/src/` still fail. For git, keep each app's
  own `.gitignore` from the Expo template (`/ios`, `/android`) or add `apps/*/ios` and `apps/*/android`
  to the root `.gitignore`. ESLint and tsc need nothing: generated native folders hold no `.ts` or
  `.js`, and every checker's repo scan skips each workspace's `ios/` and `android/`.
- **A Node backend's build output** (a Cloud Functions workspace whose `package.json` `"main"` is
  `lib/index.js`: the deploy build writes `functions/lib/`) is the one workspace folder the ignore
  lists name. Add `'functions/lib/**'` to `globalIgnores` next to `'build/**'`, the line
  `functions/lib/` to `.prettierignore` and `/functions/lib/` to `.gitignore`; `check-configs.mjs`
  requires all three for every workspace outside `packages/` that is no Expo app and whose `"main"` is
  built JavaScript outside `src/` (the folder `"main"` names; `eslint-required [backend-build-ignore]`,
  `prettier-ignore`, `knip-config`), and lets exactly that folder pass `ignore-app-code`
  (`functions/` and `functions/src/` still fail). Why each: after a real deploy build `eslint .`
  lints the minified bundle (hundreds of errors) and `format:check` fails on it; knip reads
  `.gitignore` and takes `"main"` as the workspace's entry, so an unignored bundle reports everything
  it inlined as "Unlisted dependencies" (verified with knip 6.38.0 on 2026-10-21). The repo scans of
  every checker (check-source and the rest) skip the folder on their own, and Jest needs nothing (its
  tests and coverage read only `src/`). Never move the build to a root `build/` folder to dodge the
  lists: `firebase deploy` reads the bundle at `"main"`, inside the backend's own folder.
- **knip in a backend workspace**: its entry file (`src/index.ts`, what the esbuild command bundles)
  exports every deployed function by design, and nothing in the repo imports them. Give the workspace
  `"entry"` that exact file (plus its tests, `"src/**/*.test.ts"`) and leave `includeEntryExports`
  off, so knip counts the entry's exports as used and still reports every dead export below it;
  `includeEntryExports: true` reports each deployed function as an unused export. A folder-wide entry
  (`"src/**/*.ts"`) would count every export of the backend as used (`knip-config`). Shared packages
  keep `includeEntryExports: true` (their `exports` map makes every file an entry).
- The structural comparison accepts these multi-package edits: workspace prefixes on any glob (in the
  groups and in a canonical block's own `files`), extra zones in the 5-zones block (they only add
  bans), and a different import resolver `project` list (block 1 `settings`). knip's `entry` and
  `project` are not compared (each workspace has its own).
