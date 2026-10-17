# Versions, build numbers and fingerprints

Three numbers describe a build: the **version** users see (`1.4.0`), the **build number** the stores
count (`ios.buildNumber` / `android.versionCode`), and the **fingerprint**, a hash of every native input.
This file says where each lives, who changes it, and how the fingerprint decides between a new build and
an over-the-air update. Verified on 2026-10-14 in eas-cli 24.10.0's source, docs.expo.dev
(`/build-reference/app-versions`, `/versions/v57.0.0/sdk/fingerprint`) and by running
`@expo/fingerprint` 0.20.13 (the copy Expo SDK 57 installs) on the reference app.

## Contents

- The version: the app config, raised per release
- Build numbers: remote, per app id
- Setting up remote versions on an existing app
- Tags after an upload
- The fingerprint: what goes in, what does not
- How EAS records it, and how the release proves it
- New build or update?
- Keeping the fingerprint honest
- Test recipes

## The version: the app config, raised per release

`version: '1.4.0'` is a literal in `app.config.ts` (`config-versions`), identical for every variant and
both platforms, and it becomes `CFBundleShortVersionString` and `versionName`. Raise it in its own
commit before a store release: App Store Connect wants a version higher than the last one approved for
sale, and this library keeps one rising history for both platforms, so the preflight
(`scripts/eas/release-preflight.ts`) refuses a version that is not above the last release tag `vX.Y.Z`
(upload tags `vX.Y.Z+ios.N` do not count). More builds of the same version before the reviewer says
"ship" are normal: only the build number changes.

## Build numbers: remote, per app id

With `"appVersionSource": "remote"` EAS keeps the counter and "the build version values stored in app
config are ignored and not updated" (Expo docs); with `autoIncrement: true` every build of the profile
takes the next number. In eas-cli 24.10.0 (`build/build/ios/version.js`,
`resolveRemoteBuildNumberAsync`) the counter is looked up by project, platform and **application
identifier**: development (`com.example.tasks.dev`), preview (`.preview`) and production each count on
their own, so dev builds never use up store numbers. Without a remote value EAS starts from the local
`buildNumber`/`versionCode` (or fails with "Remote versions are not configured" when there is none and
the profile does not auto-increment).

- Read the current number: `eas build:version:get --platform ios --profile production`.
- A failed or abandoned build has spent its number. Never set the counter back: a lower number than one
  the store has seen is refused (ITMS-90189 on iOS; Play refuses any used `versionCode`).
- `ios.buildNumber` and `android.versionCode` stay out of the app config (`config-versions`): EAS
  ignores them, so a number in the file is never the build's.
- `eas build:version:sync` writes the remote values into native folders for a local Xcode or Gradle
  build; in a CNG app the local lane skills set numbers their own way.

## Setting up remote versions on an existing app

When an app already has store builds, initialise each counter with the last uploaded number before the
first EAS build, or the store refuses the next upload:

```sh
eas build:version:set --platform ios --profile production       # enter the last build number App Store Connect has
eas build:version:set --platform android --profile production   # enter the last versionCode Play has
```

The command runs in the developer's Expo account and changes shared state: ask first. A new app needs
nothing: the first build uses 1.

## Tags after an upload

After a submission succeeds, tag the commit with the number the build record reports
(`appBuildVersion` in `eas build:view <id> --json`): `git tag -a v1.4.0+ios.14 -m "App Store build 14"`,
`git tag -a v1.4.0+android.31 -m "Play build 31"`. The template `scripts/eas/eas-commands.ts`
(`uploadTag`) formats both; git-commits-and-reporting owns the tag scheme and its checker, and tags are
pushed only with the developer's word. `check-eas-build` reads these tags to prove the next build number
is higher.

## The fingerprint: what goes in, what does not

`@expo/fingerprint` hashes the dependencies, the app config, config plugins, native files, patches and
the package.json scripts, with `ios/` and `android/` left out under CNG. Run on the reference app on
2026-10-14 (`npx --no-install @expo/fingerprint fingerprint:generate --platform ios`):

| Change | Fingerprint |
|---|---|
| `APP_VARIANT=development` vs `production` | different (the app config differs: id, name, icons, plugins) |
| `version: '1.0.0'` to `'1.0.1'` | different (`ExpoConfigVersions` is not skipped by default) |
| a new file in `src/core/` (JS only) | unchanged |
| iOS vs Android | each platform has its own hash |

So compare fingerprints only for the same variant and platform, and expect raising the version to
change it.

## How EAS records it, and how the release proves it

EAS CLI 24.10.0 computes the fingerprint **on the machine that starts the build**, with the project's own
`expo/fingerprint`, for the build's platform and with the build's environment (`build/build/build.js`,
`computeAndMaybeUploadFingerprintWithoutExpoUpdatesAsync`; with expo-updates and
`runtimeVersion: { policy: 'fingerprint' }` the runtime version is that hash). The build record carries
it as `fingerprint.hash`; `EAS_SKIP_AUTO_FINGERPRINT=1` turns it off, so never set it.

The release preflight writes the same hash for the reviewed commit and the production env to
`dist/eas/fingerprint-<platform>.json`. `check-eas-build` (`build-fingerprint`) compares it with the
record: equal means EAS built exactly the native inputs that were reviewed. A difference means the build
saw something else: an EAS environment variable the app config reads (EAS merges the EAS environment
under the profile's `env`), an uncommitted file (impossible with `requireCommit`), a dependency resolved
differently, or a different commit.

**When the app config reads an EAS environment variable.** EAS CLI 24.10.0 evaluates the config and
computes the fingerprint with `process.env`, the plain-text and sensitive variables of the profile's
`environment`, and the profile's `env` (`evaluateConfigWithEnvVarsAsync`, then
`createFingerprintAsync` with `ctx.env`). The preflight sees only `process.env` and the profile's `env`,
so such a config gives a different hash on every build and `build-fingerprint` always fails. Run the
preflight inside that environment instead, so it sees the same variables:

```sh
eas env:exec production 'node scripts/eas/release-preflight.ts --profile production --platform all'
```

`eas env:exec <environment> '<bash command>'` loads the variables of that EAS environment (secret
variables are not readable and stay out) and runs the command (EAS CLI 24.10.0, `commands/env/exec.js`).
It needs a login, like every EAS command; the preflight prints this hint whenever the profile names an
`environment`. An app config that reads no EAS variable (the canonical one reads only `APP_VARIANT`,
which the profile's `env` sets) needs nothing extra.

## New build or update?

A JS-only change can ship as an EAS Update to binaries with the same runtime; anything that changes the
fingerprint needs a new build and a store submission. Decide with the fingerprint, never by reading the
diff:

```sh
eas fingerprint:compare --build-id <the store build users have>      # this commit's project vs that build
npx --no-install @expo/fingerprint fingerprint:generate --platform ios > dist/eas/now.json   # offline
npx --no-install @expo/fingerprint fingerprint:diff dist/eas/fingerprint-ios.json dist/eas/now.json
```

Export the build's variant pair first (`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production`), or
the comparison is between two variants. ota-updates owns runtime versions, channels and the update
itself; this skill owns the build side.

## Keeping the fingerprint honest

`.fingerprintignore` (gitignore syntax, minimatch) and `fingerprint.config.js` change what is hashed.
`fingerprint-config` fails a pattern that hides `package.json`, a lockfile, the app config, `plugins/`,
`patches/` or `node_modules/`, and a `sourceSkips` of `ExpoConfigAll` (Expo's own docs: it "will
potentially ignore some native changes that should be part of most fingerprints"). Skipping
`ExpoConfigVersions` or `ExpoConfigRuntimeVersionIfString` is fine when a team wants the version out of
the hash; ignoring generated folders (`ios/**/*` with `!ios/Podfile`) is fine.

## Test recipes

- **The template modules:** `npx jest scripts/eas --ci --maxWorkers=2` (profile resolution, the store
  profile rules, command lines, upload tags, the release plan).
- **The preflight on a clean commit:** `node scripts/eas/release-preflight.ts --profile production
  --platform all --what-to-test "Check reminders"`; on the reference app it ran the gates, wrote both
  fingerprints and printed the release sequence: the `eas build ... --json > dist/eas/builds.json` line
  without `--auto-submit`, a `check-eas-build` line per platform, the download and store-artifact gate
  lines and an `eas submit --path` line per platform with What to Test on the iOS one (the `--path`
  lines replaced `--id` on 2026-10-16 and are covered by the template tests) (2026-10-14, with `npm run verify` shortened in a scratch
  copy).
- **A planted bug:** remove `autoIncrement` from `build.production`; the preflight stops before
  `npm run verify` with `build.production (ios) has no autoIncrement: true`, and
  `check-eas-config` fails `store-profile`.
- **The build record:** save it with `eas build:view <id> --json > dist/eas/build-ios.json` and run
  `node ${CLAUDE_SKILL_DIR}/scripts/check-eas-build.mjs . --build dist/eas/build-ios.json`.
