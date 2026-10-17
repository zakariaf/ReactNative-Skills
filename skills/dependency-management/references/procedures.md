# Procedures: add, upgrade, remove, the monthly pass

The exact steps for every kind of dependency change, with the commands and the traps. Read it at the
start of any dependency task; `plan-dependency.mjs` prints the same steps for one package.

## Contents

- Decide the kind of package first
- Add a package that is in the policy
- Add a package that is not in the policy
- Upgrade a package
- Remove a package
- The monthly dependency pass
- After a native change (iOS and Android)
- Commands that behave differently from what training data suggests
- A same-day Expo patch
- EAS Build and other CI installs
- What to record in the commit
- When multi-package

## Decide the kind of package first

| Kind | Examples | Where | How |
|---|---|---|---|
| Expo-managed runtime (in the SDK's module map) | `expo-haptics`, `expo-image`, `react-native-screens`, Reanimated, Skia | `dependencies` | `npx expo install <pkg>@<row spec>` (`expo-constants@~57.0.21`); keep what it writes |
| Native runtime outside the map | `react-native-google-mobile-ads`, `expo-iap`, `react-native-audio-api` | `dependencies`, exact | `npm install <pkg>@<exact>` |
| JavaScript runtime library | `zustand`, `valibot`, `@tanstack/react-query`, `react-intl` | `dependencies`, exact | `npm install <pkg>@<exact>` |
| Development tool | ESLint plugins, Jest, Prettier, knip, `@types/*` | `devDependencies`, exact | `npm install -D <pkg>@<exact>` |

Expo-related dev tools (`typescript`, `jest`, `@types/jest`, `@types/react`, `jest-expo`,
`eslint-config-expo`) are `devDependencies` installed with npm at the row's exact version, which lies
inside Expo's range (verified: `npm install -D typescript@~6.0.3` under `save-exact` saves `6.0.3`).

A native runtime package is never a devDependency: Expo autolinking (57.0.13) still links top-level
`devDependencies`, so it builds, but the dependency audits and the native-library checks read only
`dependencies` (native-modules-and-new-architecture treats a native devDependency as a note).

## Add a package that is in the policy

1. `node ${CLAUDE_SKILL_DIR}/scripts/plan-dependency.mjs <pkg> . --online` prints the kind, where it
   belongs, its companions and every step, plus the publish age (measured like npm, honouring valid
   dated excludes), any npm deprecation, the licence and the install scripts.
2. Review before installing. When the plan prints a `review first` step (the `scripts` line names a
   `preinstall`, `install` or `postinstall`), read the script (`npm pack <pkg>@<v>`, then the file it
   runs) and write its pinned key into the root `package.json`: `"allowScripts": {
   "<pkg>@<v>": true }` (or `"<pkg>": false` to skip it). `strict-allow-scripts=true` refuses the
   install until then, and nothing runs (the supply-chain reference, "Install scripts").
3. Run the install step exactly as printed: `npx expo install <pkg>@<row spec>` for an Expo-managed
   package (the spec keeps a same-day patch out; see "A same-day Expo patch"), or the exact
   `npm install` with every companion in the same command (RNTL 14.0.1 with `test-renderer` 1.2.0;
   `jest-image-snapshot` 6.5.2 with `@types/jest-image-snapshot` 6.4.2; `expo-router` with its four
   peers). An `ESTRICTALLOWSCRIPTS` stop names transitive packages with scripts: nothing ran; review
   each as in step 2 and run the install again. `npm ls <pkg>` must show one version, and
   `npm approve-scripts --allow-scripts-pending` must print `No packages with unreviewed install
   scripts.`
4. Write the code that uses it in the same change. A vendor SDK is imported only by its adapter
   (`src/services/<concern>/<library>-<concern>-adapter.ts`, the architecture-and-boundaries skill);
   add its root Jest mock if importing it crashes Jest. `npm run -s check:unused` (knip) fails on an
   unused package, and `check-deps-policy.mjs` fails an unused native module (`unused-dependency`).
5. If it has a config plugin, add one entry to the `plugins` list of `app.config.ts` (the one list;
   never a second one, never an edit in the generated `ios/` or `android/` folders), with a comment
   naming the skill that owns it. A package whose plugin prebuild applies on its own once installed
   (`expo-notifications`, `expo-image-picker`, `expo-file-system`, `expo-task-manager`,
   `expo-apple-authentication`, ...) is listed too, bare when the defaults are wanted, so the config
   shows every native change. The expo-prebuild-and-config-plugins skill owns plugin authoring, its
   `check-native-generation.mjs` fails an unlisted one (`auto-plugin-listed`), and its
   `check-native-snapshot.mjs` shows what the new package changed natively.
6. `npx expo install --check` and `npx expo-doctor`.
7. `node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .` until `RESULT: PASS`, then
   `npm run -s check:fast`.
8. A native package: follow "After a native change".

## Add a package that is not in the policy

A new dependency outside the policy is the developer's decision (stop and ask). Bring a short case:

- what it is for and why the decided stack cannot do it;
- `plan-dependency.mjs <pkg>@<version> . --online` facts: age (at least 7 days), deprecation,
  licence (the policy's allowlist for anything that ships), install scripts;
- whether it is native, pre-1.0, network-capable, or maintained by one person (wrap such a package
  behind a port so it can be replaced).
- when it is native: whether it supports the New Architecture (native-modules-and-new-architecture's
  `check-native-libraries.mjs` classifies it from `node_modules` as an Expo module, a codegen
  library or interop only, next to `npx expo-doctor`'s React Native Directory check; an interop-only
  package needs a decision entry in `contracts/native-libraries.json`).

After a yes: add its row to `contracts/dependency-policy.json` (version, spec, install, where, why,
`native`, companions), then follow "Add a package that is in the policy". The row lands in the same
commit as the install.

## Upgrade a package

1. Candidates: `npx expo install --check` lists Expo-managed packages behind the SDK's expected
   versions; `npm outdated` lists the rest. Ignore majors the `heldBack` list blocks.
2. For each: `plan-dependency.mjs <pkg>@<version> . --online` after the row moves, or
   `npm view <pkg>@<version> time deprecated scripts --json` (old enough for the `.npmrc`
   min-release-age, not deprecated), and read its changelog. A needed fix younger than that goes
   through a dated exception (the release-age reference) with the developer's agreement.
3. Update the row (version and spec), its companions, and any root override with it (the ten
   `@typescript-eslint/*` overrides move with `typescript-eslint`).
4. Review the new version's install script before installing it: approvals are pinned, so write the
   new key (`"<pkg>@<new>": true`, replacing the old one) after reading the script; with
   `strict-allow-scripts=true` the install stops until you do, and `check-deps-policy.mjs` reports
   the old pin as `stale-approval`.
5. Apply it: an Expo-managed runtime package with `npx expo install <pkg>@<new spec>`, or
   `npx expo install --fix` once every expected version is old enough; an Expo-map dev tool in
   `devDependencies` (`jest-expo`, `eslint-config-expo`) with `npm install -D <pkg>@<exact>`.
   `--fix` writes Expo's `~` range, which is right for runtime packages only: a dev tool it
   rewrote fails `pin-exact` and `table-version` until it is pinned exactly again (both install
   forms: the release-age reference, "A new Expo patch inside the 7 days"). Every other package:
   `npm install <pkg>@<new>`.
6. `npm run verify`; a native or pre-1.0 package also "After a native change"; Skia also re-renders
   goldens (golden-and-snapshot-tests: review, then a `Gate-Change:` trailer).
7. `check-deps-policy.mjs .` passes; commit the row, `package.json` and `package-lock.json` together.

Expo SDK majors (57 to 58) are not an upgrade of one package: they move every Expo-managed package at
once and follow the expo-sdk-upgrade skill.

## Remove a package

1. `node ${CLAUDE_SKILL_DIR}/scripts/plan-dependency.mjs <pkg> . --remove` lists where it is declared
   and the overrides it holds.
2. Remove its imports, its `plugins` entry, its root Jest mock and any ESLint mention first; then
   `npm uninstall <pkg>`, and delete it from the root `overrides` (a leftover is a `stale-override`).
3. Delete its row from the policy (unless it only moves place).
4. Remove its `allowScripts` key (the plan names it), then `npm approve-scripts
   --allow-scripts-pending`, `npm run -s check:unused`, `check-deps-policy.mjs .`, and for a native
   package "After a native change".

## The monthly dependency pass

Once a month, and before each release:

1. `npx expo install --check`, then `npm outdated`.
2. For each candidate: age, deprecation and changelog, then the upgrade steps above.
3. `npm run verify`, a development build on a named iOS simulator and a named Android emulator, the
   E2E flows (e2e-maestro), and a screenshot review; before a release, a preview or release build
   on both as well (see "After a native change", step 4).
4. Refresh `verified` in the policy and commit. Delete any dated exclude block whose date has passed.

## After a native change (iOS and Android)

A new or upgraded native module is not in the installed binary: a JavaScript reload is not enough.

1. `npx expo prebuild --clean` (the generated `ios/` and `android/` folders are rebuilt from
   `app.config.ts`; never hand-edit them), then a development build on a named iOS simulator
   (ios-simulator-build) and a named Android emulator (android-emulator-build), or
   `eas build --profile development` with a simulator profile (`ios.simulator: true`, and an APK
   for Android; eas-build-and-submit owns the profiles). Launch both.
2. Read what the package's config plugin changed: `npx expo config --type introspect` shows what
   config plugins write (iOS usage strings in `ios.infoPlist`, manifest entries a plugin adds).
   It does not show the Android permissions a native module brings by itself: those come from its
   library `AndroidManifest.xml` and from the SDKs it depends on, and Gradle merges them into the
   app's manifest at build time. Verified 2026-10-03 on the reference app:
   `react-native-google-mobile-ads`'s plugin only adds `<meta-data>`, while its library manifest
   declares `INTERNET`, `WAKE_LOCK` and `ACCESS_NETWORK_STATE`, and Google Play services adds
   `com.google.android.gms.permission.AD_ID`. So after an Android build read the merged manifest,
   `android/app/build/intermediates/merged_manifests/<variant>/process<Variant>Manifest/AndroidManifest.xml`
   (the folder name changes between Android Gradle Plugin versions; `find android/app/build -path
   '*merged_manifest*' -name AndroidManifest.xml` finds it), or the built APK:
   `apkanalyzer manifest permissions <apk>` (Android SDK command-line tools) or
   `aapt2 dump permissions <apk>` (build-tools). Not run by this skill. New permissions and
   privacy-manifest entries go to the privacy-and-store-declarations skill.
3. Native layers have no age gate and no lockfile integrity. CocoaPods pods and Gradle/Maven
   artifacts follow the npm pins because podspecs and `build.gradle` files pin them; read a new
   package's `android/build.gradle` and `*.podspec` for dynamic versions (`+`, `latest.release`,
   `>=`), which pull whatever is newest at build time. Read them, and the package's `scripts`, for
   downloads as well: a podspec `prepare_command` or `script_phase`, a Gradle `Exec` or download
   task wired before `preBuild`, a `postinstall` that fetches a binary. Each fetches code at build
   time, outside `min-release-age` and the lockfile. Name the host and how the download is pinned
   (a release tag, a checksum); treat a dynamic version, an unpinned URL or a download without a
   checksum as a reason to ask before adding the package. Worked case, read 2026-10-03 in the
   `react-native-audio-api` 0.13.6 tarball (MIT, no npm install script): `RNAudioAPI.podspec` runs
   `scripts/download-prebuilt-binaries.sh` as its `prepare_command` and again as a `script_phase`,
   and `android/build.gradle` runs it in a `downloadPrebuiltBinaries` task before `preBuild`. The
   script `curl`s FFmpeg and the Opus/Vorbis static libraries from
   `github.com/software-mansion-labs/rn-audio-libs/releases/download/v3.1.0/` (pinned by release
   tag, no checksum). The config plugin options `disableFFmpeg` and `disableStaticExternalLibs`
   (both `false` by default; `["react-native-audio-api", { "disableFFmpeg": true,
   "disableStaticExternalLibs": true }]`) set `DISABLE_AUDIOAPI_FFMPEG` /
   `DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS` in the Podfile and the matching Gradle properties: with
   both set the script downloads nothing on either platform (and the iOS script phase is not even
   added), which also drops the formats those libraries decode (FFmpeg-backed formats, Ogg
   Opus/Vorbis). An app that plays short bundled WAV sounds (UI feedback) sets both; re-read the
   podspec and Gradle file on every upgrade of the package.
4. Before the next release, launch a preview or release build of the change on a named iOS simulator
   and a named Android emulator: the release lanes of ios-simulator-build and
   android-emulator-build, or `eas build --profile preview` with a simulator profile (an iOS build
   installs on a simulator only when its profile sets `ios.simulator: true`, and a default
   internal-distribution iOS build is a device build; eas-build-and-submit owns the profiles). A
   development build never runs what only a release does: R8/ProGuard can strip a new module's
   classes when its consumer rules are missing, JavaScript runs as Hermes bytecode, and config
   plugins can take release-only branches. Keep development builds for day-to-day work.

## Commands that behave differently from what training data suggests

- `npx expo install X -- --save-dev` puts the package into `dependencies`. `npx expo install X --dev`
  does reach `devDependencies`, but for an Expo-map dev tool (`jest-expo`, `typescript`,
  `eslint-config-expo`) it writes Expo's `~` range, which fails `pin-exact` and `table-version`.
  Install dev tools with `npm install -D <pkg>@<row version>`: Expo-map dev tools are pinned exactly
  inside Expo's range.
- For a package outside Expo's map, `npx expo install <pkg>` without a version runs
  `npm install --save <pkg>` (read in `@expo/package-manager` 1.13.1, with `@expo/cli` 57.0.27),
  which takes npm `latest`: the
  newest release at least 7 days old under this `.npmrc`, possibly the wrong major, not the policy
  row. `save-exact` still applies (a probe saved `"left-pad": "1.3.0"`). With a version
  (`<pkg>@<v>`) Expo writes the specifier into `package.json` itself and runs `npm install`. Use
  `npm install <pkg>@<exact>` instead.
- `npx expo install expo-haptics@~57.0.3` writes `~57.0.3` even with `save-exact=true` (Expo writes
  the specifier itself); that tilde is correct for Expo-managed packages.
- `npx expo install <pkg>` without a version asks Expo's online versions list, not the installed
  `expo`: on 2026-09-29 it wrote `~57.0.20` for `expo-constants` (published that morning) while the
  table and the installed `expo`'s module map still said `~57.0.19`. With the spec,
  `npx expo install expo-constants@~57.0.19` printed `Using ~57.0.19 instead of ~57.0.20 for
  expo-constants because this version was explicitly provided` (verified 2026-09-30).
- `npm install` with an existing lockfile, and `npm ci`, install the locked versions without
  re-checking age; the 7-day policy acts when a version enters the lockfile.
- `npm ls --parseable` redacts UUID-like path segments as `***`; read `package-lock.json` instead.
- `npm approve-scripts` is not workspace-aware: approvals live in the root `package.json` `allowScripts`.
- `npm approve-scripts --allow-scripts-pending` exits 0 whether or not something is pending; read the text.
- Without `strict-allow-scripts=true`, npm 11.17 runs an install script nobody approved and only warns
  afterwards; the warning is not a gate. With it, an install whose tree holds one stops before
  anything runs (`ESTRICTALLOWSCRIPTS`), `npm ci` included.
- `before=<date>` in `.npmrc` replaces `min-release-age` (npm uses `before` and drops the age), and a
  bare `legacy-peer-deps` or `force` line counts as `true`: `check-deps-policy.mjs` fails each. So
  does `force # for now`: npm cuts the value at the `#` and reads a bare `force`.
- An `NPM_CONFIG_*` environment variable beats every line of the project `.npmrc`, and `~/.npmrc`
  fills every key the project file leaves unset (the release-age reference, "Config outside
  .npmrc"); `npm config get <key>` shows what npm will use.
- `npx <tool>` and `npm exec` inside the repo follow the project `.npmrc` (the release age,
  `strict-allow-scripts`) but never the root `allowScripts`, and install outside the lockfile; a tool
  already in the npx cache skips the check, so a call that works locally can stop with
  `ESTRICTALLOWSCRIPTS` on a fresh runner. A tool the repo runs is a devDependency (npx then runs the
  local copy); EAS CLI is a global install (the supply-chain reference, "npx and one-off tools inside
  the repo").
- `npm install -g` ignores the project `.npmrc` even inside the repo: no release age and no strict
  mode unless the command passes `--min-release-age=7 --strict-allow-scripts` itself.
- `npx eas …` without a local `eas` bin installs npm's unrelated `eas` package (a templating
  library); the `eas` command comes from a global install of `eas-cli`.
- `--allow-scripts` is refused for any install inside the project (`EALLOWSCRIPTS`), and on an npx
  call npm exports it, like `--ignore-scripts`, to the tool's own npm runs.
- `npm deny-scripts <pkg>` writes the name-only denial `"<pkg>": false` (a denial runs nothing in any
  version, so it is not pinned); `npm approve-scripts <pkg>` writes the pinned approval.
- `npm approve-scripts --no-allow-scripts-pin <pkg>` writes a name-only key (`"<pkg>": true`) that
  approves every future version; plain `npm approve-scripts <pkg>` writes the pinned key, and also
  replaces an existing name-only one.
- `npx expo install --check` covers both `dependencies` and `devDependencies` of the app it runs in
  (read in `@expo/cli` 57.0.27, and verified 2026-10-03 on a copy of the reference app: with `jest-expo`
  faked to 56.0.4 it printed `jest-expo@56.0.4 - expected version: ~57.0.5` and exited 1). <!-- stack-pin-ignore --> When multi-package, the root `devDependencies` are
  outside every app's check (see "When multi-package").
- `npm install` ends with "N moderate severity vulnerabilities" and suggests `npm audit fix --force`.
  Never run `npm audit fix`: it rewrites pins outside the policy, and `--force` can move `expo` to
  another SDK. For each advisory, `npm explain <pkg>` shows who pulls it in. Under `expo` (its config
  plugins or CLI) or under a dev tool it is build tooling that never reaches the bundle (`--omit=dev`
  does not separate it, because `expo` is a runtime dependency). An advisory in code that ships is
  fixed by upgrading that package through "Upgrade a package", or by the next Expo patch, and reported
  to the developer.

## A same-day Expo patch

Expo publishes patches of the SDK line often, and its online versions list names them the day they
appear. A new patch (for example `expo` 57.0.26 and `expo-constants` 57.0.20 on 2026-09-29) shows up
three ways: a bare `npx expo install <pkg>` writes it, `npx expo install --check` and `expo-doctor`
ask for it, and a dated exclude block for `expo-*` (while it lasts) lets it past the 7-day age.

1. Keep the row's spec. Install with `npx expo install <pkg>@<row spec>`; if `package.json` already
   holds the newer specifier, run that command (it rewrites the specifier), then `npm install` so the
   lockfile follows. `check-deps-policy.mjs` names the command in its `expo-spec` and
   `table-version` fix lines.
2. Leave the patch alone for 7 days. `scripts/deps/check-deps.ts` prints it as a `WARN` line with the
   day it becomes due and passes; report that line to the developer as information.
3. On the due date the same mismatch fails. Then move it through "Upgrade a package": the row,
   `npx expo install <pkg>@<new spec>`, any root override, `npm install`, one commit.

Never add an exclude for such a patch, never pass `--fix` to Expo's checks inside the 7 days, and never
add the package to `expo.install.exclude` (it would silence the due-date check for good).

## EAS Build and other CI installs

- EAS Build runs the optional `eas-build-pre-install` script, then `npm ci --include=dev` in the
  project root (the workspace root when multi-package): a frozen-lockfile install, for every app on
  Expo SDK 53 or newer (React Native 0.79 or newer). pnpm, Yarn and Bun get their own
  frozen-lockfile flag. Read 2026-10-03 in `@expo/build-tools` 24.9.0 (`shouldUseFrozenLockfile`
  in `dist/utils/packageManager.js`, `dist/common/installDependencies.js`) and on Expo's "Cache
  dependencies" page ("Immutable lockfiles"); Expo's Android and iOS build-process pages still say
  `npm install`. Not run on an EAS worker by this skill.
- So EAS installs exactly the committed lockfile, and a drift fails the build instead of updating
  it: `npm ci` stops with `npm error code EUSAGE` ("`npm ci` can only install packages when your
  package.json and package-lock.json or npm-shrinkwrap.json are in sync", then `Missing:
  <pkg>@<version> from lock file`; verified locally on npm 11.17.0). `check-deps-policy.mjs` fails
  the same drift before you build (`lockfile-sync`): run `npm install` locally and commit
  `package.json` and `package-lock.json` together.
- `EAS_NO_FROZEN_LOCKFILE` switches EAS to `npm install --include=dev`. Any non-empty value does it,
  even `"0"` (the source only tests that the variable is set). That install resolves on the worker
  whatever `package.json` asks for and the lockfile lacks, outside the reviewed lockfile, and under
  `package-lock=false` (a `.npmrc` line or an `NPM_CONFIG_PACKAGE_LOCK` variable) it ignores the
  lockfile altogether (verified on npm 11.17.0 under `NPM_CONFIG_PACKAGE_LOCK=false`: with
  `left-pad` 1.1.0 locked under `^1.1.0`, `npm ci --include=dev` installed 1.1.0 and
  `npm install --include=dev` 1.3.0). Never set it: not
  in `build.<profile>.env` of `eas.json` (`check-deps-policy.mjs` fails it as `npm-env`), and not
  in EAS environment variables on expo.dev, which no check of this skill can see (read them by hand
  with `eas env:list --environment <name>` for each environment).
- The default EAS images for SDK 57 ship Node 22.23 with npm 10.9 (Expo's build-infrastructure page, <!-- stack-pin-ignore -->
  read 2026-10-03). With `engine-strict=true` and `engines.npm >=11.17.0`, that install refuses to
  run (`npm ci` checks the root `engines` too: verified on npm 11.17.0 against an `engines.npm` it
  does not meet, `EBADENGINE`), which is the point: npm 10 has no `min-release-age`, `allowScripts` <!-- stack-pin-ignore -->
  or `strict-allow-scripts` and would run every install script. Without the `engines` field
  `engine-strict` guards nothing, so `check-deps-policy.mjs` fails a missing or open
  `engines.npm`/`engines.node` (`engines`). Set `"node": "26.4.0"` (the project's Node, which ships
  npm 11.17) in each `build.<profile>` of `eas.json`, or upgrade npm in `eas-build-pre-install`.
  Verified from the `eas.json` reference; not run on an EAS worker by this skill.
- Never put an `NPM_CONFIG_*` policy key into `build.<profile>.env` of `eas.json` (the usual
  `ERESOLVE` workaround is `NPM_CONFIG_LEGACY_PEER_DEPS=true`), nor into EAS environment variables on
  expo.dev: EAS runs its install with them, and a variable beats `.npmrc` (with
  `NPM_CONFIG_STRICT_ALLOW_SCRIPTS=false`, `npm ci` runs every unreviewed install script).
  `check-deps-policy.mjs` fails the ones in `eas.json` (`npm-env`); it cannot see expo.dev. To check
  what the worker really uses, add `"eas-build-pre-install": "node scripts/deps/check-npm-config.ts"`
  to the root `package.json` scripts: EAS runs it before the install, and it fails the build when the
  effective npm config breaks the policy (on npm 10 it fails on the unknown `min-release-age`). It <!-- stack-pin-ignore -->
  reads npm's config only, not `EAS_NO_FROZEN_LOCKFILE`. Not run on an EAS worker by this skill.
- The worker itself runs `npx -y eas-cli@<version>` inside the project for builds triggered by
  Expo's GitHub integration, the EAS Workflows deploy step and (from SDK 58) the embedded-update
  upload, and the project's `strict-allow-scripts` applies to it: such a step can stop with
  `ESTRICTALLOWSCRIPTS` (read in `@expo/build-tools` 24.9.0, not run on a worker; the supply-chain
  reference, "npx and one-off tools inside the repo", says what to do). Never answer it with
  `NPM_CONFIG_ALLOW_SCRIPTS`: npm refuses that variable for `npm ci` (`EALLOWSCRIPTS`).
- Other CI: Node 26, or `npm install -g npm@11.17.0` before `npm ci`; run `npm run -s
  check:npm-config` before the install, and keep `NPM_CONFIG_*` policy keys out of the workflow
  (`check-deps-policy.mjs` reads `.github/workflows/*.yml`). A job that runs EAS CLI installs it in
  its own step, `npm install -g --min-release-age=7 --ignore-scripts eas-cli@<x.y.z>`, then calls
  `eas`; never `npx eas-cli` in the repo (`npx-install`).

## What to record in the commit

- Type and scope: `build(deps): …` for dependency-only changes, or the feature commit that needed the
  package (the install belongs with its first user).
- The body names each package, old and new version, why, and the age, deprecation and licence checks.
- `Gate-Change: <reason>` when `.npmrc` or `contracts/dependency-policy.json` changes. Both are gate
  files; git-commits-and-reporting owns the trailer, and whether the commit hook enforces it depends
  on the app's `gatedPaths` list (quality-gates owns that list; check that it names both).
- The policy rows change in the same commit as `package.json` and `package-lock.json`.

## When multi-package

npm workspaces (`apps/*` Expo apps, `packages/*` shared code). The policy stays one file at the root.

- **Where.** Expo-managed and native packages are `"app"` rows installed in each Expo app that uses
  them: `(cd apps/<app> && npx expo install <pkg>@<spec>)`; npm packages for apps
  `npm install <pkg>@<exact> -w apps/<a> -w apps/<b>`; a library one package uses
  `npm install <pkg>@<exact> -w packages/<pkg>` (`where: "packages/<pkg>"`); a JavaScript library the
  apps and a shared package both import is one row with a list, `where: ["app", "packages/core"]`,
  installed in all of them at one specifier (`lockstep`); tools at the root with `-D`.
- **Never a native module at the root or in a shared package's `dependencies`.** Since SDK 54
  autolinking does find it there (it resolves an app's dependencies and their dependencies and peers
  recursively; `legacy_shallowReactNativeLinking` restores the old direct-only search), but
  `npx expo install --check` and `expo-doctor` verify only an app's direct dependencies, so a native
  module that arrives through a shared package, or through an auto-installed `"*"` peer, escapes the
  SDK alignment check and lands at npm's newest release. And only one copy of a native module can be
  compiled into an app build (Expo's monorepo guide). Docs read 2026-10-03.
- **Shared packages and peers.** A shared package whose code imports a native module lists it as a
  `"*"` peer. Add the peer and its root override first, then install in the apps:
  `plan-dependency.mjs <pkg> . --peer-of packages/ui` prints that order. Without the override npm may
  satisfy the peer with its newest release at the root (seen: `react-native-screens` 4.28.0 at the
  root next to the app's 4.26.2), and expo-doctor reports duplicate native modules.
- **Every app.** Each app that depends on a shared package installs that package's native peers
  (`every-app`), with one specifier across all workspaces (`lockstep`); all apps move in the same
  commit, never one app first.
- **One React.** The root `overrides` pin `react` and `react-native` at the apps' versions (Expo's
  monorepo guide: duplicate React Native versions are not supported).
- **Checks.** Run `npx expo install --check` and `npx expo-doctor` inside each Expo app;
  `scripts/deps/check-deps.ts` does that for every workspace that depends on `expo`. Add
  `npx expo-modules-autolinking verify` inside each app: it lists every duplicate installation of a
  native module (the duplicate part of expo-doctor, without the other checks). From SDK 55 <!-- stack-pin-ignore: the SDK that changed the default -->
  `experiments.autolinkingModuleResolution` is on by default for apps in monorepos, so Metro bundles
  the copy autolinking links; that hides a duplicate from the bundle but leaves it in
  `node_modules`, so deduplicate rather than rely on it.
- **Root dev tools.** The root `devDependencies` (`jest-expo`, `eslint-config-expo`, `typescript`)
  sit outside every app's `npx expo install --check`. `check-deps-policy.mjs` covers the ones in
  Expo's module map: `table-map` fails any policy row whose version lies outside the map's
  specifier, and `table-version` fails a root pin that differs from its row, so a stale `jest-expo`
  after an SDK move fails there. (`node -p "require('expo/bundledNativeModules.json')['jest-expo']"`
  inside an app shows the map's specifier; `typescript` and `jest` are not in the map, they come from
  Expo's related-packages list, see the versions reference.)
