# Every root file: what it holds and why

The generator writes these files from `templates/` and `assets/`. This reference explains the
decisions inside each one, so a conflict can be resolved and a failing check understood without
guessing. The templates are the exact content; this file is the reasoning. Most root configs are
canonical files maintained by other skills (project-layout.md, "Who maintains each file"); the
bootstrap writes the same bytes they ship.

## Contents

- package.json
- .npmrc and .nvmrc
- .gitignore
- Prettier: .prettierrc.json and .prettierignore
- TypeScript: two programs, one strict base
- eslint.config.mjs
- knip.json
- lefthook.yml
- quality-gates.json (the guardrail)
- .claude/settings.json
- Jest, Babel and Stryker files
- app.config.ts and metro.config.js
- The starter app files and placeholder art
- AGENTS.md and CLAUDE.md
- Merging an existing repo (conflicts)

## package.json

- `"private": true`, `"main": "expo-router/entry"` (an `index.ts` entry replaces it once the Intl
  polyfills exist: i18n-strings-and-catalogs), no `"type"` (`metro.config.js`, `babel.config.js` and
  `jest.config.js` are CommonJS; `scripts/` has its own `package.json`). A Node script that imports
  an ESM `.ts` file from `src/` (for example `src/config/app-variant.ts`) prints a one-time
  `MODULE_TYPELESS_PACKAGE_JSON` warning for that reason; it is harmless, and adding `"type":
  "module"` would break the three CommonJS configs.
- `"engines": { "node": ">=22.18", "npm": ">=11.17.0" }` with `engine-strict=true`: Node 22.18 is the
  first release with type stripping on by default, which `app.config.ts`, `metro.config.js` (it
  requires a `.ts` helper) and every script rely on; npm 11.17.0 is the first that reads
  `min-release-age-exclude`, so an older npm silently ignores a dated exclude and the install fails
  with `ETARGET`.
- `scripts`: the canonical names and commands (quality-gates' `package-scripts.json`). The guardrail
  compares the gate scripts byte for byte (`root-scripts`); `start`, `android`, `ios` and `web` are
  the app's own (the first `npx expo prebuild` rewrites `android` and `ios` to `expo run:android` and
  `expo run:ios`; either form passes).
- `dependencies`: the skeleton's runtime set (`assets/app-dependencies.json`): `expo`, `expo-router`
  and its peers (`expo-constants`, `expo-linking`, `react-native-screens`,
  `react-native-safe-area-context`), `expo-splash-screen`, `expo-system-ui` (`userInterfaceStyle:
  'automatic'` needs it on Android), `expo-dev-client` (the development variant's build),
  `react-native-gesture-handler`, `react-native-reanimated` and `react-native-worklets` (loaded by
  `jest.setup.ts` and `babel-preset-expo`), and the web pair of the Expo template (`react-dom`,
  `react-native-web`). Each specifier comes from `contracts/dependency-policy.json`: Expo SDK modules
  keep the `~` that `npx expo install` writes (`"expo": "~57.0.27"`), everything else is exact
  (`"react": "19.2.3"`, `"react-native": "0.86.3"`). `pin-exact` fails any other range.
- `devDependencies`: exactly the tools the configs and scripts name, each pinned exactly; the
  skeleton leaves out `jest-image-snapshot` and its types until the first pixel golden (knip).
- `overrides`: the ten `@typescript-eslint/*` packages (`eslint-plugin`, `parser`, `project-service`,
  `scope-manager`, `tsconfig-utils`, `type-utils`, `types`, `typescript-estree`, `utils`,
  `visitor-keys`) at the `typescript-eslint` pin 8.70.1. `eslint-config-expo` asks for `^8.59.0` of
  them; on 2026-09-29 a fresh install resolved a one-day-old 8.71.0 at the root while
  `typescript-eslint` nested its own 8.70.1, and every ESLint run crashed with
  `Cannot redefine plugin "@typescript-eslint"`. Check: `npm ls @typescript-eslint/eslint-plugin`
  shows one version. The values move only with the `typescript-eslint` row (dependency-management).
- `allowScripts`: the reviewed install scripts of the skeleton's tree, each pinned to its version:
  `lefthook@2.1.14` (installs the hook runner's platform binary; `prepare` and the guardrail call its
  `.bin` link, which npm 11.17 omits while the script is denied), `unrs-resolver@1.12.2` (picks the
  native resolver binary of the ESLint import resolver), `fsevents@2.3.3` (`node-gyp rebuild` of the
  macOS file-watching addon jest-haste-map loads; it compiles locally and downloads nothing). Without
  the last one the first macOS install stops with `ESTRICTALLOWSCRIPTS` before anything is installed,
  and `npm approve-scripts` cannot help then: it only sees installed packages.

## .npmrc and .nvmrc

`.npmrc` (dependency-management) holds the supply-chain policy: `min-release-age=7` (refuse versions
younger than 7 days; an app may hold a longer age, never a shorter one), `engine-strict=true`,
`save-exact=true`, `strict-allow-scripts=true` (stop before an unreviewed install script runs), and
npm's defaults written out (`legacy-peer-deps=false`, `force=false`,
`dangerously-allow-all-scripts=false`, `package-lock=true`) so a developer's user config cannot switch
them off. npm keeps the last value of a key, so each line appears once; a later `min-release-age=0`
switches the policy off (`npmrc-policy`).

A dated exception exists only while a needed release is younger than the release age:
`# exclude-block expires=YYYY-MM-DD reason=<link>` followed by `min-release-age-exclude[]=<package>`
lines, agreed with the developer. Once the date has passed the whole block is deleted, never
extended; the lockfile keeps the installed versions, because `npm ci` does not re-check age. An
exclude outside a dated block, in any spelling npm accepts, or in an expired block fails
`npmrc-exclude`.

`.nvmrc` pins Node 26.4.0 for nvm, mise, fnm and CI (`actions/setup-node` reads `node-version-file`).
Another pin file (`.node-version`, `.mise.toml`, `.tool-versions`) must agree with it (`node-pin`).

## .gitignore

Generated native projects (`/ios`, `/android`, anchored, so `scripts/ios/` and a local module's native
source stay committed), build output, reports, coverage, Stryker sandboxes, `node_modules/`, `.expo/`,
`expo-env.d.ts`, and every signing or key file (`*.p8`, `*.p12`, `*.pem`, `*.key`,
`*.mobileprovision`, `*.keystore`, `*.jks`, `AuthKey_*`, `ApiKey_*`, `*.xcarchive`, `*.ipa`,
`*.aab`, `*.apk`, `credentials.json`), `.env*` except `.env.example`, `.claude/settings.local.json`
and the per-developer Lefthook overrides. The generator appends missing lines to an existing
`.gitignore` and never removes one (`gitignore`). The lefthook `no-secrets` job also refuses staged
key files, which catches `git add -f`.

## Prettier: .prettierrc.json and .prettierignore

Options: `printWidth` 100, `singleQuote`, `trailingComma` "all", `bracketSpacing`, `arrowParens`
"always", `endOfLine` "lf" (`prettier-config`). Prettier runs as its own check (`format:check`);
`eslint-config-prettier` only switches off conflicting ESLint rules. Prettier formats `package.json`
like `JSON.stringify`, which is how the generator writes it.

`.prettierignore` lists the lockfile, generated folders, snapshots, `/ios/` and `/android/`, the agent
folders (`skills/`, `.agents/`, `.claude/`, ...), and one line per pre-existing entry
(`format-ignore`).

## TypeScript: two programs, one strict base

`tsconfig.base.json` holds every compiler option and extends `expo/tsconfig.base`: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `erasableSyntaxOnly` (no enums,
because Node strips types), `allowImportingTsExtensions`, `verbatimModuleSyntax`, `isolatedModules`,
`useUnknownInCatchVariables`, `allowUnreachableCode: false`, `allowUnusedLabels: false`,
`forceConsistentCasingInFileNames`, `noErrorTruncation`, `incremental`, and `customConditions`
`["react-native-strict-api", "react-native"]` (overriding replaces the base array, so `react-native`
must stay) (`tsconfig-base`).

| Program | Types | Covers |
|---|---|---|
| `tsconfig.json` (root) | `jest`, `node` | every `**/*.ts(x)` outside the excludes: `app.config.ts`, `scripts/`, `test/`, the configs |
| `src/tsconfig.json` | `jest` | the app; `app-env.d.ts` declares `process` for `EXPO_PUBLIC_*` dot access, `env.d.ts` declares each public variable |

A program sets only `types`, `paths` and `tsBuildInfoFile` (`tsconfig-program`). The root maps
`@/*` to `./src/*`; the app program includes `../.expo/types/**/*.ts`, the typed-routes declarations
`expo start` writes, or every `href` type-checks as a plain string. `expo-env.d.ts` stays out of
every program: `expo/types` breaks `TextStyle` under React Native's Strict TypeScript API
(typescript-and-lint-rules has the details).

## eslint.config.mjs

The one ESLint 9 flat config (typescript-and-lint-rules): `eslint-config-expo/flat`, typescript-eslint
`strictTypeChecked` and `stylisticTypeChecked` with the project service, the project rules, and
`eslint-config-prettier` last. Inline `eslint-disable` comments are inert (`noInlineConfig: true`);
every exception is a `files`-scoped block. What the bootstrap adds: `PRE_EXISTING` filled with the
pre-existing entries (`lint-ignore`, `format-width`). `globalIgnores` already lists the agent folders.

## knip.json

Every issue type knip 6 knows is `"error"` (`cycles` defaults to warn, which never fails). The entry
and project globs cover `src/app/`, `scripts/`, `__mocks__/` and the tests. `"ignore"` lists exactly
the agent folders (`skills/**`, `.agents/**`, `.claude/**`, ...): knip's Jest plugin cannot read the
`testMatch` of Jest projects and falls back to Jest's default test globs anywhere, so without the
ignore it analysed every installed skill template and fixture (hundreds of "Unlisted dependencies").
Only a pre-existing top-level entry may join the list; anything wider hides dead code
(`knip-config`). knip evaluates `app.config.ts`: its Expo plugin counts every plugin package as used
and, unless `updates.enabled` is `false`, expects `expo-updates`, which is why the skeleton turns
updates off until ota-updates configures them.

## lefthook.yml

`pre-commit` (parallel, staged files): `no-secrets` (key and signing files, with and without `**/`),
`format`, `lint`, `typecheck` (the whole-project script: one file can break another), `test-related`.
`commit-msg`: `node scripts/git/check-commit-message.ts {1}` (Conventional Commits, the `Gate-Change:`
trailer when a gated path is staged). `pre-push`: `npm run verify`. `assert_lefthook_installed: true`
fails loudly when the hooks were never installed; `npm install` installs them through `prepare`
(`node scripts/hooks/install-git-hooks.ts`, which skips by itself outside the git top level), so the
folder must be a git repository first (`lefthook`).

## quality-gates.json (the guardrail)

The likeliest failure of an unsupervised agent is quietly relaxing a threshold.
`scripts/quality/check-quality-gates.ts` (run by `npm run verify`) compares what the tools resolve
with this file: ESLint probes, `tsc --showConfig`, Jest thresholds, the gate scripts, the agent
settings, the knip rules, `lefthook dump` and the `.npmrc` policy lines. The checker repeats the
cheap half (`quality-gates`): `npmScripts` against `package.json`, `claudeSettings` against
`.claude/settings.json`, `npmrcLines` against `.npmrc`, `knip.rules` against `knip.json`,
`typescript.shared` against `tsconfig.base.json`. A mismatch means: restore the gate, never edit the
JSON to match. `scripts/quality/gated-paths.ts` keeps wildcard patterns (`**/__snapshots__/**`) out of
the agent folders, so editing an installed skill needs no trailer (`gate-scope`).

## .claude/settings.json

- `permissions.deny`: reading key and signing files (`*.p8`, `AuthKey_*`, `*.keystore`, `*.jks`,
  `credentials.json`, service-account files, `key.properties`) and `git commit`/`push` with
  `--no-verify` or `-n`.
- `permissions.ask`: every edit to a gate file, each rule anchored at the repo root
  (`Edit(/tsconfig*.json)`, `Edit(/src/tsconfig.json)`); an unanchored `Edit(**/tsconfig*.json)` also
  prompts for every tsconfig template inside installed skills (`gate-scope`). In a non-interactive run
  the edit is refused, which is the intended stop-and-ask.
- `hooks.PostToolUse` (`Edit|Write`): `node "$(git rev-parse --show-toplevel)/scripts/hooks/after-edit.ts"`
  formats the edited file and runs `eslint --fix`, exiting 2 with the problems so the agent sees them.
- `hooks.Stop`: `cd "$(git rev-parse --show-toplevel)" && npm run -s check:fast 1>&2 || exit 2`, so an
  agent never stops on a red tree (`claude-settings`).
- `enabledPlugins` keeps Expo's official plugin; the merge keeps every other key already in the file.

## Jest, Babel and Stryker files

- `babel.config.js` (this skill's canonical file): `babel-preset-expo` at the root so the root Jest run
  finds it. Stryker workers compile only the files Stryker instrumented without the Worklets and
  Reanimated plugins: with the plugin on, Stryker's helpers inside a file-level `'worklet'` module fail
  with `"stryNS_9fa48" is read-only`; with it off for every file, any related test that renders a
  component calling `useAnimatedStyle(() => ...)` without a dependency array (all React Compiler code)
  throws. Both cases were verified on the reference app on 2026-10-10.
- `jest.config.js`: projects `unit`, `android` and `golden`; the transform allowlist (Expo Router 57
  needs `standard-navigation`); `TZ=UTC`; the `@/` and `@test/` mappers; installed skills, generated
  folders and Stryker sandboxes invisible to Jest; coverage thresholds 90/90/90/85 global, folder keys
  added only once the folder has code; `coveragePathIgnorePatterns` from
  `scripts/quality/device-only.ts` (files whose first lines say `// device-only: covered by ...`).
- `jest.setup.ts`: Gesture Handler's setup, the Worklets mock, Reanimated's `setUpTests()`, and the
  Skia mock once the package exists.
- `jest.sim.config.js`: simulations only (`npm run test:sim`), never in pre-commit.
- `stryker.config.json` + `tsconfig.stryker.json`: mutation testing on logic folders; `ignorePatterns`
  keeps `skills`, `.agents` and `.claude` out of every sandbox copy (`stryker-config`).

## app.config.ts and metro.config.js

`app.config.ts` is the only app config (`app-config`). `@expo/config` (SDK 57, read in its
`getConfigFilePaths`) loads the first dynamic config in the order `.ts`, `.mts`, `.cts`, `.mjs`,
`.cjs`, `.js`, so a sibling `app.config.js` is never read and an edit there changes nothing; and it
passes `app.config.json` (else `app.json`) into the dynamic config as the static base, so values in
either are merged in unseen. The checker fails every sibling config; `app.json` is a template leftover.
The display name may hold quotes: the generator writes it as the string literal Prettier prints
(`name: "Tom's Tasks"`). The config is a default-exported function that resolves the
variant with `resolveAppVariant(process.env)` from `src/config/app-variant.ts` (APP_VARIANT must equal
EXPO_PUBLIC_APP_VARIANT; unset means development locally and is an error in a production bundle or on
EAS Build). One production identity (`BASE`: id, name, scheme) is extended per variant: development
and preview append `.dev`/`.preview` to the id, `(Dev)`/`(Preview)` to the name and `-dev`/`-preview`
to the scheme. iOS (`bundleIdentifier`) and Android (`package`, the adaptive icon, predictive back)
take the same identity (`app-id`, `platforms`); icons come from `assets/icons/<variant>/`.
The `app-id` check (and the generator's `--app-id`) tests the shape (lower case, dot-separated, each
part starting with a letter) and rejects a part that is a Kotlin hard keyword or a Java reserved word
(`com.acme.class`, `com.acme.fun`, `com.acme.package`): prebuild writes the id into the `package` line
of `MainActivity.kt`, which then fails to compile at the first Android build, while iOS accepts it.
`platforms` is `['ios', 'android']`: the template's web pair stays installed for Expo Router, and
web-support adds `'web'` with its contract when the team ships the web (without the line, Expo treats
an app with `react-dom` installed as a web target).
`experiments.typedRoutes` and `experiments.reactCompiler` are on, `userInterfaceStyle` is
`'automatic'`, `updates.enabled` is `false` until ota-updates. Prebuild's Android template declares
`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` capped at API 32 (`maxSdkVersion="32"`); an app
that never touches shared storage may add both to `android.blockedPermissions`
(permissions-and-system-prompts decides, privacy-and-store-declarations declares). Relative imports carry `.ts`: Node loads
the file with type stripping and fails with "Cannot find module" without it. Secrets never flow into
the returned object: the whole public config is embedded in the app.

`metro.config.js` sets `config.cacheVersion = publicEnvCacheVersion(process.env)`: Metro inlines every
`EXPO_PUBLIC_*` value, but its shared cache is not keyed on them, so a production export after a
development one reused the development transforms (verified on SDK 57; `metro-cache`).

## The starter app files and placeholder art

`src/app/_layout.tsx` renders one `Stack` without animation (motion-and-animation brings the screen
transition with the Reduce Motion answer; app-startup-and-bootstrap replaces the file with the root
skeleton). `src/app/index.tsx` renders `HomeScreen` from `src/features/home/` and nothing else (route
files stay thin). The starter screen shows no text: words come from the catalogs, never literals. Its
test says `// no-providers:` because the screen reads nothing from context yet.

The placeholder art (`app-files`): `assets/icons/<variant>/icon.png` (1024 x 1024) and the Android
adaptive layers (`android-foreground.png`, `android-background.png`, `android-monochrome.png`) for
each variant, development with an orange band and preview with a blue one so a tester sees which build
is open; `assets/images/splash-icon.png` and `favicon.png`. An image that already exists is kept.

## AGENTS.md and CLAUDE.md

`AGENTS.md` is the short session contract every agent reads: the skills as sources of truth starting
with react-native-conventions-index, start green with `npm run -s check:fast`, commands, when to stop
and ask, safety (keys, hooks, named devices), commits. `CLAUDE.md` is the one line `@AGENTS.md`, so
Claude Code imports it and nothing is written twice. The developer may keep notes in `CLAUDE.md`: an
existing file that has the import is kept, one without it gains the line at the top. A `CLAUDE.md`
that is a symlink to `AGENTS.md` also passes (it is one source), but the import line is the default:
git checks a symlink out as a small text file holding the target path on Windows without symlink
support, and Claude Code then reads the path, not the rules. An app nested in
a larger repository whose root holds the agent files sets `rn-skills.config.json`
`"agentInstructions": "parent-repo"` instead (`agents`).

## Merging an existing repo (conflicts)

The generator never overwrites a file whose content differs from the template:

- `.gitignore`: missing lines are appended.
- `package.json`: a manifest that differs from the rendered one only in `allowScripts` (rewritten by
  `npm approve-scripts`) counts as unchanged; any other difference is a conflict.
- `.claude/settings.json`: existing keys and allow rules are kept, plugins merged, `deny`, `ask` and
  `hooks` set to the gate values; existing different deny or ask rules or hooks are a conflict, because
  the guardrail compares those arrays exactly: drop them, or add them to `quality-gates.json` too, with
  the developer's agreement. The merged file needs no formatting: `.prettierignore` lists `.claude/`.
- `CLAUDE.md`: kept, or given the import line; never a conflict.
- Images: an existing image is kept (the app's own art wins over a placeholder).
- Any other file that differs is a conflict: read both, keep what the developer needs by editing the
  template content into the file, or rerun with `--replace <file>` when it is only an old draft.
  Report every replaced file.
