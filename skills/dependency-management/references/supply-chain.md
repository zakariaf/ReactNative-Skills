# Supply chain: bans, deprecation, install scripts, licences, Expo alignment

What protects the app from packages nobody reviewed: the ban lists, deprecation, reviewed install
scripts, the licence policy, Expo's own alignment checks, and the gate files that run them inside
`npm run verify`. Read it before adding any package, when a check names one of these rules, and when a
gate in this area fails.

## Contents

- The guards at a glance
- Banned packages: the floor and the profiles
- Deprecated packages
- Install scripts: review first, then install
- npx and one-off tools inside the repo
- Licences: what may ship
- Expo alignment: expo install --check and expo-doctor
- The gate files in the app
- When a gate in this area fails

## The guards at a glance

| Guard | Rule | Checked by |
|---|---|---|
| Exact pins | every package exact, except the specifier `npx expo install` writes for Expo-managed modules | `check-deps-policy.mjs` (`pin-exact`, `expo-spec`, `table-version`) |
| Lockfile | `package-lock.json` committed; fresh clones and CI use `npm ci` (EAS Build does by default); never `package-lock=false` or `EAS_NO_FROZEN_LOCKFILE` | `check-deps-policy.mjs` (`lockfile-missing`, `lockfile-sync`, `npmrc-policy`, `npm-env`); `check-deps.ts` |
| Release age | `min-release-age=7`; exceptions only in dated blocks; no `before=`; no `NPM_CONFIG_*` variable or `~/.npmrc` line that overrides the project file | `check-deps.ts` in `verify`, `check-npm-config.ts` before an install; `check-deps-policy.mjs` (`npmrc-policy`, `npmrc-exclude`, `npm-env`) |
| Toolchain | `engine-strict=true` with root `engines` `npm >=11.17.0`, `node >=22.18` | `check-deps.ts` (`engines-floor.ts`); `check-deps-policy.mjs` (`engines`) |
| Install scripts | `strict-allow-scripts=true`; reviewed before they run, approved by pinned key in the root `allowScripts` | npm itself (`ESTRICTALLOWSCRIPTS`); `check-deps.ts`; `check-deps-policy.mjs` (`npmrc-policy`, `install-scripts`, `unpinned-approval`, `stale-approval`) |
| npx inside the repo | a tool the repo runs is a devDependency (npx runs the local copy); EAS CLI is a global install with the policy flags; no committed npx call installs a package the policy keeps out; `allow-scripts` unset in every layer | `check-deps-policy.mjs` (`npx-install`, `npm-env`, `npmrc-policy`); `check-npm-config.ts` |
| Bans | the supply-chain floor, the app's profiles and own bans, in the lockfile | `check-deps.ts`; `check-deps-policy.mjs` (`banned`, `policy-contract`); `plan-dependency.mjs` (`banned`) |
| Deprecation | no deprecated direct dependency without a written reason | `check-deps-policy.mjs` (`deprecated`, from the lockfile); `plan-dependency.mjs --online` (`deprecated`) |
| Licences | shipped code only under the policy's allowlist or an exception | `npm run audit:licenses`; `plan-dependency.mjs --online` (`licence`) |
| Expo alignment | `npx expo install --check` and `npx expo-doctor` pass; every policy row of a map package inside the map's specifier | `check-deps.ts`; `check-deps-policy.mjs` (`table-map`) |
| One copy | one React, no second copy of a pinned package or companion | `check-deps-policy.mjs` (`one-react`, `one-version`, `companion`, `overrides`) |

## Banned packages: the floor and the profiles

`assets/banned-packages.json` holds three lists; `references/policy-contract.md` explains how they
reach the app's policy.

**The supply-chain floor** (every app):

| Package(s) | Scope | Why | Use instead |
|---|---|---|---|
| `flatmap-stream` | anywhere | the malicious payload of the 2018 event-stream compromise; npm replaced it with a security placeholder, so a copy means a stale or poisoned lockfile | regenerate the lockfile from a clean tree |
| `node-ipc`, `peacenotwar` | anywhere | protestware: node-ipc 10.1.1 to 10.1.3 overwrote files on some machines; later releases pull peacenotwar | remove the parent (`npm explain <pkg>`) |
| `expo-cli` | direct | deprecated: the global CLI was superseded by `npx expo` and `eas-cli` | `npx expo`; EAS CLI as a pinned global install ("npx and one-off tools inside the repo") |
| `react-native-unimodules`, `expo-random` | direct | deprecated: replaced by `expo` and `expo-crypto` | `expo`, `expo-crypto` |
| `@react-native-community/async-storage` | direct | deprecated: the package moved, this name gets no fixes | `expo-sqlite/kv-store` |
| `metro-react-native-babel-preset` | direct | deprecated: replaced by `@react-native/babel-preset`, which `babel-preset-expo` includes | `babel-preset-expo` |
| `request`, `node-sass`, `expo-firebase-analytics` | direct | deprecated and unmaintained | built-in `fetch`; `sass`; an analytics SDK behind a port |

Deprecations were verified with `npm view <pkg> deprecated` on 2026-10-03 (npm keeps a security
placeholder for `flatmap-stream`, and the destructive node-ipc releases were unpublished).

**`offline-only`** (an app that promises no network from its own code; the privacy-and-store-
declarations skill owns that promise): `expo-updates`, `expo-dev-client`,
`@react-native-community/netinfo` (its default reachability check fetches a Google URL),
RevenueCat (`react-native-purchases`), `firebase` and `@react-native-firebase/*`, crash reporters
(`@sentry/*`, `sentry-expo`, `@bugsnag/*`, `@datadog/*`), Expo telemetry (`expo-insights`,
`expo-observe`, `expo-app-metrics`), `expo-notifications`, product analytics (`@amplitude/*`,
`@segment/*`, `posthog-react-native`, `mixpanel-react-native`), web views (`react-native-webview`,
`expo-web-browser`), all anywhere; HTTP clients (`axios`, `ky`, `got`, `node-fetch`, `cross-fetch`)
as direct dependencies, because some tools pull them in transitively (`fbjs` pulls `cross-fetch`).
It bans everything `no-telemetry` bans: an app without network sends no telemetry either.

**`no-telemetry`**: Firebase, crash reporters, Expo telemetry and product analytics (`@amplitude/*`,
`@segment/*`, `posthog-react-native`, `mixpanel-react-native`), anywhere.

A banned package that appears transitively: `npm explain <pkg>` names the parent; remove or replace
the parent. Never add an `overrides` entry to "hide" a banned package.

Some installed packages are fine while one of their options is not (an ads SDK's own tracking-text
option, a purchase library's server features, an E2E tool's AI commands). The skills that own those
packages enforce their options: admob-ads-and-consent, in-app-purchases, e2e-maestro.

## Deprecated packages

npm marks a release deprecated when its maintainers stop fixing it, and writes the message into
`package-lock.json`. A deprecated **direct** dependency fails `deprecated` unless its policy row says
why it stays and until when (`"deprecated": "<why>"`). The seed has one: ESLint 9 is end of life and
held back until `eslint-config-expo` supports ESLint 10, dev-only. Deprecated transitive packages
(old `glob`, `inflight`, `uuid` 7 under build tools) are not the app's install decision; they leave
with the upgrade of their parent. Before adding a package, `plan-dependency.mjs --online` reads
`npm view <pkg>@<v> deprecated`.

## Install scripts: review first, then install

An install script (`preinstall`, `install`, `postinstall`) runs arbitrary code on every machine and
CI runner that installs the package. **npm 11.17 without strict mode runs an unreviewed script**: it
installs, runs the script, and only afterwards prints `N packages have install scripts not yet
covered by allowScripts` (verified 2026-10-03: a probe package's postinstall ran on a plain
`npm install`). With `strict-allow-scripts=true` in `.npmrc` npm builds the tree first, and when a
package in it has a script the root `package.json` `allowScripts` does not cover, it stops before
anything runs:

```text
npm error code ESTRICTALLOWSCRIPTS
npm error --strict-allow-scripts: 1 package(s) have install scripts not covered by allowScripts:
npm error   unrs-resolver@1.12.2 (postinstall: node postinstall.js)
```

So the review comes first, in one of two ways (both verified 2026-10-03 with `unrs-resolver@1.12.2`
under `strict-allow-scripts=true`):

1. **Pre-approve by key** (the default). `plan-dependency.mjs <pkg> . --online` prints the package's
   own install scripts and a `review first` step before the install step. Read the script
   (`npm pack <pkg>@<x.y.z>`, unpack it, read the file the script runs), then write the pinned key
   into the root `package.json` yourself: `"allowScripts": { "<pkg>@<x.y.z>": true }` (or
   `"<pkg>": false` to skip it for every version). Then install. If the install still stops with
   `ESTRICTALLOWSCRIPTS`, it names the transitive packages with scripts; nothing ran: review each,
   add its key, and run the install again.
2. **Install without scripts, then approve and run.** `npm install --ignore-scripts <pkg>@<x.y.z>`
   installs nothing that runs; `npm approve-scripts --allow-scripts-pending` lists every pending
   script (transitive ones included); after reading each, `npm approve-scripts <pkg>` writes the
   pinned key and `npm rebuild <pkg>` runs the now-approved script.

```sh
npm approve-scripts --allow-scripts-pending    # read-only list; exits 0 whether or not something is pending
npm view <pkg>@<version> scripts               # what preinstall/install/postinstall run
npm approve-scripts <pkg>                      # approve one installed package, pinned to its version
npm deny-scripts <pkg>                         # or deny it (also a reviewed decision)
npm approve-scripts --allow-scripts-pending    # must print: No packages with unreviewed install scripts.
```

- Approvals are pinned (`"lefthook@2.1.14": true`), so a version bump needs a fresh review: with
  strict mode the bumped install stops until the new key is there, and `check-deps-policy.mjs`
  reports the old pin as `stale-approval`. A denial (`"lefthook": false`) covers every version.
- Never a name-only approval: `"fsevents": true` or `"fsevents@*": true` (what `npm approve-scripts
  --no-allow-scripts-pin` writes) lets npm run the script of every future release under that name
  without a review, and `--allow-scripts-pending` then lists nothing. `check-deps-policy.mjs` fails
  it (`unpinned-approval`), and so does the app's gate (`unpinned-approvals.ts` in `check-deps.ts`).
  `npm approve-scripts <name>` replaces it with the pinned key of the installed version (verified
  2026-10-03 on npm 11.17.0: it printed `added fsevents@2.3.3` and `replaced-by-pin fsevents`).
  `plan-dependency.mjs` does not count a name-only `true` as a review: it prints the review step.
- npm counts only the values `true` (approve) and `false` (deny); anything else (`"true"`, `1`) is
  ignored, so the package stays unreviewed (`install-scripts`). A deny wins over an approval.
- npm 11.17 matches three key forms (arborist `script-allowed.js`, read 2026-10-03): a name (or
  `name@*`) for every version, `name@x.y.z`, and exact versions joined by `||`
  (`"fsevents@2.3.2 || 2.3.3": true`, which `npm approve-scripts` leaves alone). A range
  (`name@^2`) or a tag never matches (npm warns and drops the key), so the package stays
  unreviewed; git, file and URL keys match a resolved source. `check-deps-policy.mjs` evaluates the
  first three (a name-only key only as a denial) and reports any other key as `install-scripts` "a
  form this check cannot evaluate" instead of guessing.
- `npm approve-scripts` is not workspace-aware: approvals always live in the root `package.json`.
  Never in `.npmrc` (`allow-scripts=…`), and never `dangerously-allow-all-scripts`: both fail
  `npmrc-policy`.
- Registry installs run `preinstall`, `install` and `postinstall`; `prepare` runs only for git or
  local sources. (A copy of a project whose `node_modules` is a symlink to another folder makes npm
  list every `prepare` script as pending: run the check in a real install.)
- Never `npm approve-scripts --all`. If a script does something unexpected (downloads a binary from an
  unknown host, reads the home folder), deny it and stop and ask the developer.

Install scripts in the canonical stack (verified 2026-10-03). An approval is the pinned key; a
denial is the name-only key, which is what `npm deny-scripts <pkg>` writes (verified on npm 11.17.0:
`npm deny-scripts esbuild` wrote `"esbuild": false`) and what rule 7 allows, because a denial runs
nothing in any version:

| Package | Script | Decision and the key it writes |
|---|---|---|
| `lefthook@2.1.14` | postinstall `node postinstall.js` | in an app at the git top level, approve `"lefthook@2.1.14": true`: the binary comes from the platform package (`lefthook-darwin-arm64`, an optional dependency), but npm 11.17 links `node_modules/.bin/lefthook` only for an approved package, and the guarded `prepare`, the guardrail and `npx lefthook validate` run lefthook through that link (denied, `prepare` fails with `sh: lefthook: command not found`, verified 2026-10-10). The script itself runs `lefthook install` from `INIT_CWD` unless `CI` is set, so in an app nested in another repository (an example or reference app) it writes hooks, and lefthook's example `lefthook.yml`, into the enclosing repository: deny `"lefthook": false` there and run lefthook from the enclosing root (quality-gates owns the hook install) |
| `unrs-resolver@1.12.2` | postinstall `node postinstall.js` | approve `"unrs-resolver@1.12.2": true`: picks the native resolver binary the ESLint import resolver uses |
| `fsevents@2.3.3` (optional, macOS) | install `node-gyp rebuild` | approve `"fsevents@2.3.3": true`: compiles the file-watching addon of `jest-haste-map` locally, downloads nothing; without the key every macOS install stops under strict mode |
| `@shopify/react-native-skia@2.6.2` | postinstall `node scripts/install-libs.js` | approve `"@shopify/react-native-skia@2.6.2": true` when the app builds natively with Skia (it copies the native libraries the iOS and Android builds link); deny `"@shopify/react-native-skia": false` in a checkout that only runs tsc, ESLint and Jest |
| `@sentry/cli@2.58.4` (with `@sentry/react-native`) | postinstall `node ./scripts/install.js` | deny `"@sentry/cli": false` in every case: the CLI binary arrives through the optional `@sentry/cli-<platform>` packages, and the script only downloads a fallback when optional dependencies are omitted. Keep optional dependencies installed (never `--omit=optional`); the Xcode script, `sentry.gradle` and the upload script resolve the CLI with `require.resolve`, so the missing `.bin` link breaks nothing |

## npx and one-off tools inside the repo

`npx <tool>` and `npm exec` run inside the repo read the project `.npmrc`, so the release age and
`strict-allow-scripts` apply to the package npx installs into its own cache. They never read the root
`package.json` `allowScripts` (npm 11.17 skips that layer for exec: `resolve-allow-scripts.js`,
`skipProjectConfig`), and nothing they install lands in `package-lock.json`. Verified 2026-10-03 on
npm 11.17.0 in a folder holding the template `.npmrc`:

- `npx -y esbuild@0.25.0 --version` stopped with `ESTRICTALLOWSCRIPTS` (`esbuild@0.25.0
  (postinstall: node install.js)`) although `allowScripts` held `"esbuild@0.25.0": true`.
- `npx -y eas-cli@latest --version` stopped the same way on `dtrace-provider@0.8.8` (install
  `node-gyp rebuild || node suppress-error.js`) and `protobufjs@7.6.6` (postinstall `node
  scripts/postinstall`). The release age applied too: `latest` resolved 24.8.0, because 24.10.0 was <!-- stack-pin-ignore: what npx resolved that day -->
  one day old, and `npx -y eas-cli@24.10.0` gave `ETARGET`.
- A tool already in the npx cache runs without the check (the second run passed with no flag), so
  a command that works on the machine that wrote it can stop on a fresh CI runner. Try a new
  committed npx call on an empty cache: `npm_config_cache=$(mktemp -d) npx <tool>@<x.y.z> --version`.
- A package npx finds in the local tree runs from `node_modules/.bin` and installs nothing: with
  `esbuild` a devDependency approved by its pinned key, `npx esbuild` and `npx esbuild@0.25.0` ran
  the local copy.
- `npx expo-doctor` passed on an empty cache (1.20.4 has no install script in its tree), which is
  how `check-deps.ts` runs it.

One default for each kind of tool:

1. **A tool the repo runs from its scripts, git hooks or CI** (Prettier, ESLint, knip, Jest, `tsc`):
   a devDependency with a policy row. `npx <bin>` then runs the locked copy, and its install scripts
   are reviewed in the root `allowScripts` like every other package's.
2. **EAS CLI**, the exception. `expo-doctor` fails a project that has `eas-cli` anywhere in its tree
   ("EAS CLI should not be installed in your project", its check for a legacy global CLI installed
   locally; read in expo-doctor 1.20.4), so it is in the seed's `doNotAdd`. Install it globally,
   pinned, with the policy on the command line: a global install ignores the project `.npmrc` even
   when run inside the repo (npm skips the project config in global mode; `npm config get
   strict-allow-scripts --global` printed `false` there, and a plain `npm install -g esbuild@0.25.0`
   ran its postinstall unreviewed).

   ```sh
   npm view eas-cli time --json      # the newest release at least 7 days old (and at least eas.json cli.version)
   npm install -g --min-release-age=7 --strict-allow-scripts eas-cli@<x.y.z>   # the review step: stops, lists the scripts, runs nothing
   npm install -g --min-release-age=7 --ignore-scripts eas-cli@<x.y.z>         # after reading them: EAS CLI needs none
   eas --version
   ```

   Reviewed 2026-10-03: dtrace-provider's install compiles an optional DTrace addon and falls back to
   a stub when it cannot; protobufjs's postinstall only warns when a parent package pins it with
   another version scheme; `eas --version` ran without either. Should a later version need a script, pass
   `--allow-scripts=<pkg>@<x.y.z>,…` on the global install instead (npm accepts the flag there). In CI
   the decided install line is one step before `eas build`; a new EAS CLI version is a new review.
   Then call `eas` itself: `npx eas` resolves npm's unrelated `eas` package (a templating library,
   `eas` 0.1.0), and `npx eas-cli` installs into the npx cache under the project policy again.
3. **A command typed once** (a scaffolder, a codemod): an exact version, `npx <tool>@<x.y.z>`. When
   strict mode stops it, read each listed script, then run it again with `--ignore-scripts` if the
   tool needs none, or with `--allow-scripts=<pkg>@<x.y.z>,…` (pinned keys only: npm drops a range or
   a tag with a warning, and a bare name approves every version). npm accepts that flag only for
   npx, `npm exec` and global installs.

Both flags travel with the tool: npm exports them as `npm_config_allow_scripts` and
`npm_config_ignore_scripts` to the process it starts (verified), so an npm install that the tool
starts in the repo (an `npx expo install` it runs, a scaffolder's install) then stops with
`EALLOWSCRIPTS` (verified), or skips the project's own reviewed scripts. That is why EAS CLI is a
global install and never `npx --ignore-scripts eas-cli`.

Never:

- Run the tool from a folder outside the repo to get past the stop: no `.npmrc` applies there, so
  the release age is off and npm 11.17 runs every install script unreviewed (verified: esbuild's
  postinstall ran in a folder without `.npmrc`).
- `--dangerously-allow-all-scripts` on npx or a global install.
- `allow-scripts=` in the project `.npmrc` or `~/.npmrc`, although npm's own `ESTRICTALLOWSCRIPTS`
  message for a global install suggests `npm config set allow-scripts=<names> --location=user`. npm
  applies the line to npx, but also exports it to every script it runs, so an `npm install` started
  by an npm script fails with `EALLOWSCRIPTS` (verified for both layers). The project line fails
  `npmrc-policy`; `check-npm-config.ts` fails either.
- `NPM_CONFIG_ALLOW_SCRIPTS` in `eas.json`, a workflow or EAS environment variables: npm refuses it
  for `npm ci` and `npm install` inside the project (`EALLOWSCRIPTS: --allow-scripts is not allowed
  in project-scoped installs`, verified), so the build's install stops (`npm-env`,
  `check-npm-config.ts`).
- The upgrade hint EAS CLI prints (`npm install -g eas-cli`): without the flags a global install takes
  the newest release however young, and runs its scripts unreviewed.

`check-deps-policy.mjs` fails (`npx-install`) a committed npx or `npm exec` call (package.json
scripts, GitHub workflow `run:` lines, `lefthook.yml`) that installs EAS CLI, runs `npx eas` without
a local `eas` bin, or installs a package the policy bans or keeps out (`doNotAdd`). It cannot know
offline whether another tool's tree holds an install script: try such a call on an empty cache.

**EAS Build workers** (read in `@expo/build-tools` 24.9.0; not run on a worker by this skill): the
worker itself runs `npx -y eas-cli@<version>` in the project folder for builds triggered by Expo's
GitHub integration (`eas config` before `eas-build-pre-install`, then `eas build:internal`), for the
EAS Workflows deploy step, and to upload the embedded update (on by default from SDK 58 when EAS
Update is configured; `EAS_UPDATE_UPLOAD_EMBEDDED_BUNDLE=0` turns it off; a failure there only
warns). It passes `NPM_CONFIG_MIN_RELEASE_AGE=0` and nothing for install scripts. With a Node that
ships npm 11.17 (what the `engines` rule needs) the project's `strict-allow-scripts` applies to that
npx, so such a step can stop with `ESTRICTALLOWSCRIPTS` naming EAS CLI's packages unless the worker
already holds that version. Builds started with `eas build` from a machine or CI skip the first two.
If it happens, stop and ask the developer: no repo setting fixes it without weakening the policy
(`NPM_CONFIG_ALLOW_SCRIPTS` breaks `npm ci`); the safe route is to start those builds with `eas
build` from CI, and to report it to Expo.

## Licences: what may ship

Every npm package that ends up in a release JavaScript bundle carries an allowed licence (the
policy's `licenses.allowed`; by default MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD,
OFL-1.1, CC0-1.0). In an SPDX expression `OR` needs one allowed side and `AND` needs every side.

- `npm run audit:licenses` (`scripts/audit/audit-licenses.ts`) reads the source maps of a release
  export, finds the package that owns each bundled source, and checks its `license`. Make the export
  first with `npm run export:audit` (`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production expo
  export --platform ios --platform android --source-maps --output-dir dist-audit`; quality-gates'
  `npm run verify` runs it right before `audit:licenses`). Maps land in
  `dist-audit/_expo/static/js/{ios,android}/*.hbc.map`; verified 2026-10-10 on the reference app:
  80 shipped packages on iOS, 75 MIT, 2 ISC, 3 BSD-3-Clause. Add `dist-audit/` to `.gitignore`.
- The audit finds each package the maps list on disk: Expo writes sources relative to the Metro
  server root with a leading `/` (the workspace root when multi-package), but a map can also hold
  relative or absolute paths (node_modules symlinked or hoisted outside the project). It tries the
  working folder, then each parent folder, so run it from the app folder after `npm ci`. A package
  it cannot find fails the audit (`listed in the source maps, but no package.json found`), and so do
  maps with no `node_modules` source at all: nothing checked is not a pass. A known limit when
  multi-package: a `/node_modules/x` source (the root copy) resolves to `apps/<app>/node_modules/x`
  first when the app also has a nested copy, and results are keyed by package name, so with two
  versions of one package only one licence is read. That matters only when a licence changes between
  versions; `npm ls <package>` shows both copies, and checking the other one by hand closes it.
- Only shipped code is audited: build tools in the lockfile (Expo CLI's `lightningcss` under
  MPL-2.0, `caniuse-lite` under CC-BY-4.0) never reach the app and must not fail the audit.
- **The audit does not cover native SDKs.** Source maps hold JavaScript only. The SDKs a native
  module pulls through CocoaPods and Gradle/Maven ship too: the Google Mobile Ads SDK and UMP under
  `react-native-google-mobile-ads`, Sentry Cocoa and Sentry Android under `@sentry/react-native`,
  each under its vendor's licence and terms. After `npx expo prebuild`, read `ios/Podfile.lock`
  (every pod and its resolved version) and the Gradle report (`cd android && ./gradlew
  :app:dependencies --configuration releaseRuntimeClasspath`; not run by this skill) for new vendors,
  then read each new vendor's licence and terms before the release. Podspecs and Gradle files pin
  these SDKs from the npm version, so they change only when the npm pin does; a new pod or Maven
  group in that diff is a new vendor. The pod and Maven allowlist an `offline-only` or
  `no-telemetry` app needs (no `Firebase*`, `GoogleAppMeasurement`, `Sentry`, `Bugsnag`, analytics
  or attribution SDKs in `Podfile.lock` or the Gradle report) belongs to the
  privacy-and-store-declarations skill.
- Dev-only tools may use other licences (`eslint-plugin-sonarjs` is LGPL-3.0-only, never shipped).
- An exception is an entry in `licenses.exceptions`: `{ "<package>": { "license": "<exact SPDX>",
  "reason": "<why it is acceptable>" } }`. It applies only while the package keeps that exact licence,
  and every entry needs the developer's agreement.
- Fonts and sounds are not npm packages; the skills that add them record their licences.

## Expo alignment: expo install --check and expo-doctor

- `npx expo install --check` compares the Expo-managed packages in `dependencies` and
  `devDependencies` of the app it runs in (`jest-expo`, `typescript` and `eslint-config-expo`
  included) with the SDK's module map and prints `Dependencies are up to date` when they match. It
  tests that the installed version is inside Expo's range, not that the pin is exact (that is
  `check-deps-policy.mjs`). When multi-package, root `devDependencies` are outside each app's check.
- `npx expo install --fix` rewrites mismatched Expo-managed specifiers to the SDK's `~` range; use
  it only when every expected version is at least 7 days old. That range is right for runtime
  packages only: an Expo-map dev tool in `devDependencies` (`jest-expo`, `eslint-config-expo`) is
  pinned with `npm install -D <pkg>@<exact>` instead, or `pin-exact` and `table-version` fail (both
  install forms: the release-age reference, "A new Expo patch inside the 7 days").
- `npx expo-doctor` runs the project health checks (21 on SDK 57; all pass on the reference app),
  including duplicate native modules and config problems.
- Both contact Expo's API. That is fine for development tools; set `EXPO_NO_TELEMETRY=1` in tooling
  environments.
- A patch that Expo published in the last 7 days makes both report a mismatch overnight;
  `check-deps.ts` turns that into a `WARN` line with the due date (the release-age reference).
- `npm run -s <script>` exports `npm_config_loglevel=silent` to the script, and a silent npm prints
  nothing at all, not even `--json` output. expo-doctor runs `npm explain <pkg> --json` for three of
  its checks, so under `-s` they fail with "Failed to find dependency tree for @expo/vector-icons" (and
  `react-native-unimodules`, `expo-cli`) although the project is fine. `check-deps.ts` therefore starts
  every npm and npx child with `childProcessEnv(process.env)` (`effective-npm-config.ts`), which drops
  that one variable, so `npm run verify` (it runs each step with `-s`) and a plain
  `npm run check:deps` give the same verdict (verified on 2026-10-10 with npm 11.17.0 and
  expo-doctor on SDK 57; re-verify: `npm_config_loglevel=silent npx expo-doctor` shows the three
  failures, `npx expo-doctor` does not). Run expo-doctor by hand the same way: never under `-s`.

## The gate files in the app

Copy each from `templates/` to the path its first line names. The root `package.json` runs them
through these script lines (an app not created by expo-project-bootstrap adds them by hand, or
`npm run` answers `Missing script`):

```json
"check:deps": "node scripts/deps/check-deps.ts",
"check:npm-config": "node scripts/deps/check-npm-config.ts",
"export:audit": "APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production expo export --platform ios --platform android --source-maps --output-dir dist-audit",
"audit:licenses": "node scripts/audit/audit-licenses.ts"
```

The quality-gates skill owns `npm run verify`, which runs `export:audit`, then `audit:licenses`, then
`check:deps`; an older verify plan may name another path for the dependency gate, so check that the
step runs this file. `check:npm-config` runs
before an install (CI before `npm ci`; on EAS Build as `"eas-build-pre-install": "node
scripts/deps/check-npm-config.ts"`), because it needs no `node_modules`.

| File | What it does |
|---|---|
| `scripts/deps/check-deps.ts` | the dependency gate: the `.npmrc` policy and dated excludes, the config npm runs with, root `engines`, banned packages (from the policy), one specifier per package across workspaces, `expo install --check` and `expo-doctor` in each Expo app, no pending install scripts, no name-only approval. Needs the network |
| `scripts/deps/check-npm-config.ts` | before an install: the config npm runs with (`npm config get …`) is the policy; no `node_modules` needed |
| `scripts/deps/effective-npm-config.ts` (+ test) | pure: judges the `npm config get` output (release age, the guard keys, `before=null`, only the project's own excludes, no `allow-scripts` list) |
| `scripts/deps/unpinned-approvals.ts` (+ test) | pure: every `allowScripts` key that approves all versions of a package (`"name": true`, `"name@*": true`) |
| `scripts/deps/dependency-policy.ts` (+ test) | reads `banned` and `licenses` from `contracts/dependency-policy.json`, refusing entries it cannot use |
| `scripts/deps/release-age-excludes.ts` (+ test) | pure: the four policy lines present and never weakened, no key that switches a guard off (`package-lock=false` included), every exclude inside an unexpired dated block that names real packages and does not outlive its release; values read as npm reads them (inline comments, quotes) |
| `scripts/deps/engines-floor.ts` (+ test) | pure: the root `engines` keep out npm below 11.17.0 and Node below 22.18 |
| `scripts/deps/banned-packages.ts` (+ test) | the lockfile inventory (direct vs anywhere) and the banned hits |
| `scripts/deps/workspace-lockstep.ts` (+ test) | when multi-package: every package two workspaces declare with different specifiers |
| `scripts/deps/expo-patch-age.ts` (+ test) | pure: parses the mismatches of both Expo checks and decides which are patches younger than 7 days (a `WARN` with the due date) |
| `scripts/clock/system-clock.ts` (+ test) | the only tooling module that reads the wall clock (the canonical ESLint config exempts exactly this file) |
| `scripts/audit/audit-licenses.ts`, `license-policy.ts` (+ test) | the licence audit above |

All of them pass `tsc`, the canonical ESLint config with `--max-warnings 0`, Prettier and Jest in the
reference app (verified 2026-10-03), and `check-deps.ts` passed there against the real
`expo install --check`, `expo-doctor` and `npm approve-scripts`.

## When a gate in this area fails

| Failure | Fix |
|---|---|
| `npm error notarget No matching version found for <pkg>@<v> with a date before …` | the version is younger than 7 days: wait, or (a needed fix, with the developer) add a dated exception. Never delete the lockfile or the policy line |
| `npm error code EBADENGINE` on CI or EAS | npm is older than 11.17: use Node 26 (or set `node` in `eas.json`), or `npm install -g npm@11.17.0` first |
| `EBADENGINE` naming a transitive package whose `engines` stops short of the repo's Node (`Not compatible with your version of node/npm: superstatic@10.0.0`, `Required: {"node":"20 \|\| 22 \|\| 24"}` under firebase-tools on Node 26) | `npm explain` is unavailable before the install, so read `npm view <parent>@<pin> dependencies.<pkg>` and `npm view <pkg> versions engines --json`; when a release past the release age declares the repo's Node, pin it with a root override recorded as a `via: "overrides"` companion of the parent's row (versions reference, Companions and root overrides), in the root `package.json` of a workspace repo; never `--force` or `--engine-strict=false` |
| `npm error code ESTRICTALLOWSCRIPTS` | nothing ran: read each listed script, add its pinned key (`"<pkg>@<x.y.z>": true`) or a denial to the root `allowScripts`, run the install again. Never `--dangerously-allow-all-scripts` |
| `npx <tool>` (or `npm exec`, a CI step, an EAS worker step) stops with `ESTRICTALLOWSCRIPTS` | the root `allowScripts` never covers what npx installs: make a tool the repo runs a devDependency, install EAS CLI globally with the policy flags, or for a one-off read the listed scripts and pass `--ignore-scripts` or `--allow-scripts=<pkg>@<x.y.z>,…` ("npx and one-off tools inside the repo"). Never run it from outside the repo. On an EAS worker step, stop and ask the developer |
| `npm error code EALLOWSCRIPTS` (`--allow-scripts is not allowed in project-scoped installs`) | an `allow-scripts` value reached an install inside the project: a `NPM_CONFIG_ALLOW_SCRIPTS` variable, a `--allow-scripts` flag, or a value npm exported to a script from `~/.npmrc`, the project `.npmrc` or an npx call. `npm config get allow-scripts` shows it; unset it, and keep approvals in the root `allowScripts` |
| `check-deps-policy` `npx-install` | EAS CLI: install it globally as the fix line says and call `eas`; another kept-out or banned package: follow the policy's reason, never npx |
| `check-npm-config: npm runs with allow-scripts=…` (also from `check-deps`) | unset `NPM_CONFIG_ALLOW_SCRIPTS` or the `allow-scripts` line of `~/.npmrc` (npm's own hint for global installs writes one) |
| `check-deps-policy` `unpinned-approval` (or `check-deps: allowScripts "<name>": true approves …`) | read the installed version's script, then `npm approve-scripts <name>`: it replaces the key with `"<name>@<x.y.z>": true`; or `"<name>": false` to deny every version |
| `check-deps-policy` `npm-env`: `build.<profile>.env sets NPM_CONFIG_…` or a workflow line | delete the variable: the project `.npmrc` holds the policy, and a variable beats it. On `ERESOLVE` go back to the policy row; a needed young release goes into a dated block |
| `check-deps-policy` `npm-env`: `build.<profile>.env sets EAS_NO_FROZEN_LOCKFILE=…` | delete it: EAS Build then runs `npm install` instead of `npm ci` and resolves on the worker what the lockfile lacks. Keep it off expo.dev too (`eas env:list --environment <name>`) |
| EAS Build fails in "Install dependencies" with `npm error code EUSAGE` (`npm ci` can only install packages when your package.json and package-lock.json … are in sync) | the committed lockfile drifted from `package.json` (`check-deps-policy` reports it as `lockfile-sync`): run `npm install` locally, commit `package.json` and `package-lock.json` together, run the build again. Never `EAS_NO_FROZEN_LOCKFILE` |
| `check-npm-config: npm runs with <key>=<value> (the policy needs …)` (also from `check-deps`) | an `NPM_CONFIG_*` variable (the shell, the CI job, EAS environment variables) or a `~/.npmrc` line overrides the project file: unset it (`npm config get <key>` shows the value, `npm config list` names the file); keep the line in the project `.npmrc` |
| `check-deps-policy` `engines` (or `check-deps: package.json "engines.npm" …`) | set `"engines": { "npm": ">=11.17.0", "node": ">=22.18" }` in the root `package.json`; without it `engine-strict` guards nothing |
| `check-deps-policy` `npmrc-policy`: `sets legacy-peer-deps` / `force` / `before=…` / `dangerously-allow-all-scripts` / `allow-scripts` / `package-lock=false` | delete the line (or write the harmless value the template has); on `ERESOLVE` go back to the policy row, and a needed young release goes into a dated block |
| `check-deps-policy` `npmrc-exclude`: `block expires …, after …` or `matches every package` | set `expires=` to the publish date + the release age (or delete the block); name exact packages instead of a catch-all |
| `check-deps-policy` `table-map` | a policy row of a package in Expo's module map sits outside the map's specifier (often a root dev tool after an SDK move): move the row and the package into the range in one commit |
| `check-deps: .npmrc line N: expired <pattern>` | delete the whole expired block; nothing reinstalls |
| `check-deps: .npmrc line N: policy-overridden min-release-age=0` | a later line switches the policy off (npm keeps the last value): delete it |
| `check-deps: .npmrc line N: policy-bypass legacy-peer-deps=true` (or `outlives-release`, `catch-all`) | as the `check-deps-policy` rows above |
| `npm install` prints "N moderate severity vulnerabilities" | `npm explain <pkg>` for each advisory; build tooling under `expo` or a dev tool does not ship; never `npm audit fix` |
| `check-deps: banned package <name>` / `check-deps-policy` `banned` | `npm explain <name>`, remove the dependency that pulls it in |
| `check-deps-policy` `policy-contract`: `"banned" lacks …` | paste the printed entry into `banned` of the policy (the app's own gate reads only that list) |
| `check-deps: <pkg> differs between workspaces` | move every workspace to the same specifier in one commit |
| `check-deps: expo install --check failed` (or `expo-doctor failed`) | expected versions at least 7 days old: runtime packages with `npx expo install --fix` (or `npx expo install <pkg>@<spec>`), Expo-map dev tools in `devDependencies` (`jest-expo`, `eslint-config-expo`) with `npm install -D <pkg>@<exact>` (a `~` range there fails `pin-exact`); move the rows and any root override in the same commit. Anything else (a duplicate native module, a config problem): fix the named cause |
| `check-deps: WARN expo install --check: expo 57.0.27 (found 57.0.26) was published …; min-release-age=7 refuses it until …` | not a failure: an Expo patch younger than 7 days. Change nothing today; on the due date it fails and moves as above |
| ESLint crashes on every file: `Cannot redefine plugin "@typescript-eslint"` | two copies of `@typescript-eslint/eslint-plugin`: restore the ten `@typescript-eslint/*` root overrides at the typescript-eslint pin, remove any `@typescript-eslint/*` exclude from `.npmrc`, `npm install` |
| `check-deps-policy` `one-version`: `<pkg> is installed as <a>, <b>` | a second copy floated in on a range: `npm explain <pkg>`, pin it with a root override at the row's version (a companion row says which), `npm install`, `npm ls <pkg>` shows one version |
| `check-deps-policy` `companion` | install the pair together with the command plan-dependency prints |
| `check-deps-policy` `deprecated` | replace the package with what the message names, or (a deliberate hold, agreed by the developer) write the reason into its row |
| `check-deps-policy` `unused-dependency` | write the code that needs it in the same change, or remove it; a package something else loads gets an `implicitUse` reason in its row |
| `check-deps-policy` `install-scripts`: `allowScripts key "…" is a form this check cannot evaluate` | rewrite it as `name@x.y.z` or `name@x.y.z \|\| a.b.c` (`npm approve-scripts <name>` writes the pinned form), or `"name": false` to deny every version (a name-only `true` fails `unpinned-approval`); a range never matches in npm |
| `check-deps-policy` `policy-contract`: `… is not a key of the contract (did you mean …)` | fix the spelling: an unknown key is ignored, so the guard it meant (a held-back major, a do-not-add entry) was off |
| `audit:licenses: <pkg>: licence "…" is not allowed` | replace the package, or ask the developer for an exception entry |
| `audit:licenses: <root>: listed in the source maps, but no package.json found` (or `nothing was checked`) | run the audit from the app folder the export ran in, after `npm ci`, on the maps of a fresh `npm run export:audit`; never pass it by deleting the maps' entries |
| knip `Unused dependencies` | the package was installed before its code: import it, or uninstall it |
| npm `ERESOLVE` peer conflict | the requested version is outside the SDK set; go back to the policy row. Never `--force` or `--legacy-peer-deps` |
| When multi-package: `peer-override`, or expo-doctor "Found duplicates for react-native-screens" | a shared package's `"*"` peer without its root override: add it at the version the apps install, `npm install` |
