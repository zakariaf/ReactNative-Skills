# The naming contract and the two checkers

What `check-file-names.mjs` and `check-code-names.mjs` scan, every rule id they print, the repo-owned
`contracts/naming.json` that holds the app's own naming facts, and the layout keys they read. Read this
when a checker reports something unexpected, when adopting the skill in an existing app, or when
changing a checker.

## Contents

- Running the checkers
- What is scanned
- contracts/naming.json
- Layout keys (rn-skills.config.json)
- check-file-names rules
- check-code-names rules
- SKIP lines and exit codes
- Fixing a finding

## Running the checkers

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-file-names.mjs .          # files, folders, routes, ids, scripts
node ${CLAUDE_SKILL_DIR}/scripts/check-code-names.mjs .          # identifiers, testIDs, kinds, keys, flows
node ${CLAUDE_SKILL_DIR}/scripts/check-file-names.mjs . --json   # also one JSON line for tools
node ${CLAUDE_SKILL_DIR}/scripts/check-code-names.mjs . --contract qa/naming.json
```

Both need only Node 22 or newer (no `node_modules`), take the repo root as an optional positional
argument (default `.`), and end with `RESULT: PASS` or `RESULT: FAIL (<n> problems)`. Each problem is
one line: `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`.

## What is scanned

- `src/` (with `src/app/` as the Expo Router routes folder), `test/`, `scripts/`, `plugins/`,
  `__mocks__/` (path header only), `.maestro/`, `contracts/`, and the `.ts` files at the repo root
  (`app.config.ts`, `jest.setup.ts`). `.js`/`.mjs`/`.cjs` files in those folders and at the root
  (`babel.config.js`, `eslint.config.mjs`) get the path-header rule only.
- When multi-package: every workspace folder from `package.json` `workspaces`, each with its own layout.
- Never: `node_modules/`, generated `ios/` and `android/`, build output, and installed agent skills
  (any folder that holds a `SKILL.md`, plus `.agents/`, `.claude/`, `.cursor/`, `skills/` and the other
  agent folders). Installed skills carry planted-bug fixtures on purpose.
- Three kinds of code read env variables (`env-var`):
  - **Runtime code** (the app bundle: everything in `src/` that is not server or Node code) reads only
    the variables Expo inlines, by name with dot access.
  - **Server code** runs in Expo's server runtime, never in the app bundle: Expo Router API routes
    (`<name>+api.ts`, `[param]+api.ts`) and `+middleware.ts` in the routes folder, and the `src/server/`
    folder (Expo's own layout for helpers the API routes share). It may read any variable in any form,
    but not an `EXPO_PUBLIC_` name that says it holds a secret (`EXPO_PUBLIC_PAYMENTS_SECRET`): that
    value ships inside the app. The exemption assumes nothing bundled imports `src/server/`, which
    architecture-and-boundaries' `server-boundary` rule checks (packages-scripts-env-and-tags.md).
  - **Node code** (`app.config.ts`, `plugins/`, `scripts/`, `test/`, `__mocks__/`, tests, and
    `contracts/naming.json` `nodeCode`) may read any variable.
- Tooling (`plugins/`, `scripts/`, `__mocks__/`, root files) is exempt from the testID, kind and key
  rules, because it talks to external formats.

## contracts/naming.json

The app's own naming facts. Copy `templates/contracts/naming.json` to `contracts/naming.json` and edit
the values; `assets/naming-contract.schema.json` is its schema. Every key is optional; without the file
both checkers print `note: contracts/naming.json not found; library defaults apply (...)` and use the
library defaults. A malformed file (bad JSON, an unknown key, a wrong type) stops both checkers with
exit 2, and so does a contract that `--contract` or `rn-skills.config.json` `namingContract` names but
that does not exist (a typo there must never fall back to the defaults silently).

| Key | Default | Effect |
|---|---|---|
| `pathHeader` | `true` | `false` turns `path-header` off |
| `slugMatchesAppFolder` | `false` | (multi-package) `true` makes `app-id` fail an app workspace whose slug differs from its folder; the fix renames the folder, never the slug |
| `locales` | absent: any BCP 47 tag | the only catalog file names `catalog-file` accepts (`["en", "ar"]`) |
| `keyAreas` | absent: namespaces not checked | with a list, a message key must start with a feature folder or one of these (`i18n-key-namespace`); the template lists `app`, `common`, `crash`, `date`, `errors`, `permissions`, `reminders` |
| `allowedIndexFiles` | `[]` | repo-relative `index.ts(x)` files a tool requires by name (`barrel-index` skips them) |
| `nodeCode` | `[]` | globs of `src/` files that run only in Node or on the server outside the detected places, such as a module only `app.config.ts` imports (`env-var`) |
| `extraTestIdRoles` | `[]` | more role words a testID element may end in (`testid-role`), such as `cell` |
| `extraE2eFolders` | `[]` | `{ "folder", "why" }`: a folder inside `<e2e>/` for flows CI does not run (`screenshots`; in-app-purchases needs `storekit`, admob-ads-and-consent needs `ads-smoke`, each skill's own checker looks for its entry); `flow-file` accepts kebab-case YAML directly inside it. Never `flows` or `subflows` |
| `canonical.types` | `[]` | type names that must stay exported from `<kebab-name>.ts` (`canonical-name`) |
| `canonical.npmScripts` | `[]` | root scripts that must stay in `package.json` |
| `canonical.envVars` | `[]` | env variables that must still be read somewhere (code, `eas.json`, `app.json`) |
| `storeProductIds` | `[]` | App Store / Google Play product ids (`product-id`) |
| `publishedAppIds` | `[]` | `{ "id", "platform": "ios" \| "android" \| "both", "why" }`: a bundle id or package already live on a store; `app-id` accepts it for that platform and checks every other id |
| `publishedSlugs` | `[]` | `{ "slug", "why" }`: a slug that already names an EAS project; `app-id` accepts it |
| `publishedProductIds` | `[]` | `{ "id", "why" }`: a product that already exists on a store in another shape; `product-id` accepts it |

`rn-skills.config.json` `"namingContract": "<path>"` or the `--contract <file>` option moves the file
(a relative path is relative to the repo root). Findings about the contract point at the line of the
value (`contracts/naming.json:32 [product-id] ...`); catalog findings point at the key's line the same way.

## Layout keys (rn-skills.config.json)

The folders come from the canonical layout, overridable in the optional repo file
`rn-skills.config.json`: `srcDir` (`src`), `routesDir` (`src/app`; `app/` is detected when `src/app`
does not exist), `featuresDir`, `uiDir`, `storesDir`, `servicesDir`, `dataDir`, `i18nDir`
(`src/i18n`; catalogs in its `catalogs/` folder), `testDir` (`test`), `mocksDir` (`__mocks__`),
`scriptsDir` (`scripts`), `e2eDir` (`.maestro`), `contractsDir` (`contracts`), plus per-workspace
overrides under `workspaces`. The tsconfig `paths` aliases (`@/*`) are read too.

## check-file-names rules

| Rule | Fails when |
|---|---|
| `file-kebab` | a file name part outside `src/app/`, the catalogs and the Maestro flows is not kebab-case (`catalog-file` and `flow-file` own those) |
| `folder-kebab` | a folder name outside `src/app/` is not kebab-case (`__tests__/` is a `test-file` finding) |
| `route-segment` | a file or folder in `src/app/` breaks the router grammar (kebab segments, `(group)`, `[camelCaseParam]`, `[...rest]`, `_layout`, `index`, `+not-found`, `<name>+api`) |
| `route-export-name` | a route `.tsx` file has no named default-exported function ending in `Route` (`Layout` in `_layout.tsx`); `+html` and `+native-intent` are exempt |
| `grab-bag-file` | `utils`, `helpers`, `misc`, `common`, `shared`, `stuff` (`.ts`/`.tsx`, singular too) |
| `grab-bag-folder` | a folder in `src/` with one of those names |
| `barrel-index` | an `index.ts(x)` outside `src/app/`, other than a root entry file or an `allowedIndexFiles` entry |
| `path-header` | line 1 of a `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` file is not `// <repo-relative path>` (a note may follow `: ` or a space; after a `#!` line, line 2); `expo-env.d.ts` is exempt (files-and-folders.md states the whole rule) |
| `export-name` | a file with a role pattern does not export the name its file implies (see files-and-folders.md); a context module `<x>-context.ts(x)` exports `XProvider`, `XContext` or `useX`; a root kit `<x>-root-kit.tsx` exports `createXKit` |
| `one-hook-per-file` | a `use-x.ts(x)` that exports `useX` also exports a hook (`export function`/`const`/`let use...`) that is never called in the file; heuristic: a call anywhere in the file counts, so a hook called only by another companion still passes, and a re-export (`export { useY } from`) is not seen |
| `port-file` | `export type <X>Port` outside `<x>-port.ts` |
| `test-file` | `.spec` files, `__tests__/` folders, or a suffix other than `.test`, `.golden.test`, `.sim.test`, `.perf.test` and the platform suffixes `.android.test` (Jest project `android`) and `.ios.test` |
| `fake-file` | `*.mock.ts`, `mock-*.ts` or `*-mock.ts` outside `__mocks__/`; a test file is named after its subject, so `test/skia-mock.test.tsx` (a test of the vendor mock) is fine |
| `flow-file` | any YAML in `<e2e>/` outside `flows/<area>/<nn>-<name>.yaml`, `subflows/<name>.yaml` and `config.yaml`: a flow loose at the top, in an area folder directly under `<e2e>/` (`.maestro/smoke/add-task.yaml`, which a CI run of `.maestro/flows/smoke` never includes), nested below one area folder, not `<nn>-<name>`, or a sub-flow name not kebab-case; a folder in `extraE2eFolders` holds kebab-case YAML directly inside it |
| `catalog-file` | a catalog not named after a BCP 47 tag (or one of `locales`) |
| `plugin-file` | a file in `plugins/` not named `with-<capability>.ts` |
| `fixture-file` | a JSON file in a `fixtures/` folder of `src/data/` not named `<name>-v<N>[.<case>].json` |
| `level-file` | (games plugin) a level table in `src/games/<game-id>/levels/` not named `pack-<n>.json` |
| `package-name` | (multi-package) a workspace not named `@<scope>/<folder>`, or more than one scope |
| `app-id` | a bundle id or package not lowercase reverse-DNS, with a Java keyword segment, iOS ≠ Android, a slug not kebab-case, or (multi-package, with `slugMatchesAppFolder`) a slug that differs from its app folder; reads `app.config.ts` and `app.json` together (the code config wins), follows `bundleIdentifier: identity.appId` and `package: id` back to their literal, reads every literal of Expo's variant shapes (both ternary branches, a `??`/`||` fallback, the static start of a template literal, the returns of a same-file function such as `getUniqueIdentifier()`), compares iOS with Android literal by literal when both sides resolve to whole literals of one count, reads id consts and `appId` properties, and never takes a vendor id (AdMob, Firebase, Facebook) for the app id; ids and slugs in `publishedAppIds` / `publishedSlugs` are accepted |
| `product-id` | a declared product id invalid on either store, over 40 characters, `android.test*`, or not starting with the app id (the first valid id the configs declare), or `<last app-id segment>.` when `<app id>.<product>` would pass 40 characters; a `publishedProductIds` entry is accepted |
| `npm-script-name` | a root script not `<verb>` or `<area>:<verb>` |
| `canonical-name` | a declared canonical type, script or env variable no longer exists |

## check-code-names rules

| Rule | Fails when |
|---|---|
| `testid-format` | a literal or template testID is not `<screen>.<element>` in kebab-case, or a template value is glued into a segment (`tasks.row-${id}`; only a leading `${testID}` may stand for several segments) |
| `testid-index` | a template testID value reads `i`, `idx`, `index` or a name ending in `Index` (a list position), written on the `testID` prop or first built in a variable whose name ends in `ID` or `TestId` (`const rowID = \`lists.list-row.${index}\``) |
| `testid-role` | a pressable or input (`Pressable`, `Touchable*`, `Switch`, `TextInput`, `Button`, or a component whose name ends in a role word, such as `AppButton`, `ListRow`, that gets `onPress`/`onLongPress`/`onValueChange`/`onChangeText`) has a literal testID whose element does not end in a role; skipped when `testid-format` already failed it |
| `kind-value` | a `kind:`/`type:` string literal (or a union of them) is not kebab-case; exempt: MIME types (parameters and wildcards included), `type:` options in a `<library>-<concern>-adapter.ts`, the `type:` inside a react-hook-form `setError(...)` call, and `type:` values in test files |
| `i18n-key` | a catalog key, or a `t()`, `<T id>`, `<FormattedMessage id>`, `formatMessage({ id })`, `defineMessage({ id })` or `defineMessages` key, breaks the grammar |
| `i18n-key-built` | a key at a call site is a template literal |
| `i18n-key-namespace` | a key's first segment is not a feature folder or a `keyAreas` entry; (multi-package) a package key without its package prefix, or app code or an app catalog using a package's key |
| `i18n-placeholder` | a placeholder is not camelCase, or a plain `{x}` not ending in `Name`/`Text` |
| `env-var` | a variable not UPPER_SNAKE_CASE; app code reading a variable Expo does not inline (anything but `EXPO_PUBLIC_*`, `EXPO_OS`, `EXPO_SERVER`, `EXPO_BASE_URL`, `NODE_ENV`), reading one with brackets, or using `process.env` without dot access (destructuring, a copy, a spread, an argument, a computed or template key); server code reading an `EXPO_PUBLIC_` name that holds a secret word (`assets/naming-rules.json` `secretEnvWords`: `SECRET`, `TOKEN`, `KEY`, ...) |
| `test-title` | an `it()` title not starting with a third-person verb or `can`; `test()` instead of `it()` |
| `type-name` | a type not PascalCase, with an `I` prefix, or a plain `Props`/`State` outside tests |
| `boolean-name` | a boolean variable or parameter without `is`/`has`/`can`/`should`/`did`/`will`/`was` |
| `handler-name` | in `.tsx`, an `on*` prop receiving a local function not named `handleX`/`onX`, or a local handler named `onX` |
| `constant-name` | module-level fixed data (a literal, a regex, an `as const` table) not UPPER_CASE |
| `acronym-case` | an identifier with a run of three or more capitals (`SQLDriver`, `isRTL`) |
| `maestro-selector` | a flow step selecting by text (outside a `# system-ui:` comment, a `# system dialog` line or a matching guard), or an `id:` that is not a valid testID |

## SKIP lines and exit codes

- `check-code-names.mjs` prints `SKIP src/i18n/catalogs [i18n-key] not yet created (i18n-strings-and-catalogs creates it)`
  while the catalogs folder does not exist, and `SKIP .maestro [maestro-selector] not yet created (e2e-maestro creates it)`
  while the e2e folder does not exist. Both count as a pass; the rules turn strict the moment the
  folder appears.
- The pair is per Expo app: the root of a single-app repo, and each app workspace of a multi-package
  repo, with its folder in the path (`SKIP apps/mobile/src/i18n/catalogs ...`). A root or package that
  is not an Expo app (no app config, no `expo` dependency) prints none.
- Exit 0 pass (SKIP lines included), 1 problems, 2 bad input (a missing repo root, nothing to check, a
  malformed contract or `rn-skills.config.json`, a named contract that does not exist).

## Fixing a finding

Rename; do not silence. Inline ESLint disables are switched off in the canonical config, and neither
checker has an ignore comment. When a finding is wrong for a real reason, the fix is data the reviewer
can see: an `allowedIndexFiles` entry for a tool-required index, a `nodeCode` glob for a Node-only
module, an `extraTestIdRoles` word, a new `keyAreas` area, an `extraE2eFolders` entry for a folder of
flows CI does not run (a flow CI should run moves to `flows/<area>/` instead). An SDK call whose
`type:` option is not a MIME type moves into its `<library>-<concern>-adapter.ts`.

`kind-value` already leaves library-owned values alone where they are written: react-hook-form's
`setError('title', { type: 'maxLength' })` and the values a test asserts (valibot's
`{ type: 'min_length' }`). The canonical ESLint `kindValue` selector does not yet (code-identifiers.md
has the matching selector for typescript-and-lint-rules and what to write meanwhile: a kebab-case
type of the app's own in `setError`, a field assertion in a test).

Two findings must never be fixed by the rename their message suggests:

- **`app-id` or `product-id` on an id that is already live.** A live bundle id, package, slug or
  product id is permanent; changing it ships a new app or a new product. Stop, ask the developer
  whether it is live, and record the answer in `publishedAppIds`, `publishedSlugs` or
  `publishedProductIds` with its `why`. Rename only an id that has never been published. When the
  flagged value is not the app's id at all (a const `APP_ID = '1234567890'` that holds the App Store
  id), rename the const after its owner (`APP_STORE_ID`, `ADMOB_IOS_APP_ID`): a name that says whose id
  it is never reads as the bundle id.
- **`env-var` on a secret.** Never rename a secret to `EXPO_PUBLIC_`: that ships it inside the app.
  Code that runs only on the server moves to an `+api.ts` route or `src/server/`; a Node-only module
  (imported by `app.config.ts`) goes in `nodeCode`.

When a checker is wrong (it misreads valid code), fix the checker, add a self-test case that
reproduces the misread, and rerun `node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs`.
