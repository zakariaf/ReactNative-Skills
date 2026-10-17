# eas.json: the profiles, every key, and why each value

What the shipped `templates/eas.json` holds, what EAS CLI does with each key, and the decisions behind
the defaults. Verified on 2026-10-14 against EAS CLI 24.10.0 and the package it validates eas.json with,
`@expo/eas-json` 24.9.0 (`build/schema.js`, `build/build/schema.js`, `build/build/resolver.js`,
`build/submit/schema.js`), plus docs.expo.dev (`/eas/json`, `/build-reference/infrastructure`).
Re-verify: `npm view eas-cli version`, then `npm pack @expo/eas-json@<the version eas-cli depends on>`
and read those four files.

This template is the library's one `eas.json`. ota-updates (channels), ci-pipeline-and-gates (the
release job), ios-release-testflight and android-release-play (what happens to the store binary)
cite it and add only the keys the ownership table at the end gives them.

## Contents

- The file at a glance
- cli: the floor, remote versions, requireCommit
- The build profiles
- How EAS resolves a profile (extends)
- Node and the install on EAS
- Images (cross-reference)
- The submit profile
- Every key EAS CLI accepts
- Validating offline
- Who owns which part
- When multi-package

## The file at a glance

| Profile | Built with | For | Why it exists |
|---|---|---|---|
| `development` | `developmentClient: true`, `distribution: internal` | daily work with Metro on a device | the dev client, installable from the build page |
| `development-simulator` | extends development, `ios.simulator: true` | the dev client on an iOS simulator | a simulator build needs no device registration or signing |
| `preview` | `distribution: internal` (Android builds an APK by default) | testers installing a release build from a link | release behaviour without a store |
| `preview-simulator` | extends preview, `ios.simulator: true` | E2E and smoke runs of a release build on a simulator | the `.app` the simulator lanes install |
| `production` | `distribution: store`, `autoIncrement: true`, `android.buildType: app-bundle` | TestFlight and Google Play | the only profile that reaches a store |

Every profile carries `environment` and `env.APP_VARIANT` = `env.EXPO_PUBLIC_APP_VARIANT` = the variant
(app-variants-and-environment owns that wiring and checks it with `check-variants`), and `node`.
`submit.production` pins the store ids.

## cli: the floor, remote versions, requireCommit

- **`"version": ">= 24.10.0"`.** EAS CLI refuses to run when it is older than the floor, so every
  machine and CI reads this file the same way. Raise the floor when the file starts using a newer key;
  never pin an exact version (that blocks every patch). `check-eas-config` (`cli-version`) wants a
  `>= x.y.z` floor no older than the CLI this skill was verified on.
- **`"appVersionSource": "remote"`.** EAS stores `ios.buildNumber` and `android.versionCode` on its
  servers and ignores the values in the app config. Unset, EAS CLI 24.10.0 warns `The field
  "cli.appVersionSource" is not set, but it will be required in the future` and proceeds with `local`
  (read in `build/project/remoteVersionSource.js`). Details in versions-and-fingerprints.md.
- **`"requireCommit": true`.** Without it EAS CLI clones the repository and then copies the working
  tree over the clone, "This way we include the changed and untracked files" (`build/vcs/clients/git.js`,
  `makeShallowCopyAsync`): the build would carry files no commit holds, and its `gitCommitHash` would lie.
  With it, `eas build` stops on uncommitted changes. An `.easignore` next to `requireCommit` makes EAS
  CLI warn that the checked-out repository is no longer Git-clean; prefer no `.easignore`. `dist/` and
  `build/` must be git-ignored: the preflight writes fingerprints and the build line its records into
  `dist/eas/`, the gated downloads land in `build/`, and an untracked file there would stop every store
  build ("You have some uncommitted changes").
- **Internal-only EAS.** An app that builds dev clients and preview builds on EAS but ships its store
  builds on the local lane (`release:ios`, `release:android`) keeps the local lane's one counter: no
  store profile, no `submit`, `appVersionSource` `local` and the app config's build-number lines.
  `check-eas-config` prints an `internal-only EAS` note and leaves `version-source`, `store-profile`,
  `config-versions`, `submit-profile` and `release-preflight` to ios-release-testflight and
  android-release-play (their `version-source` rule refuses remote versions next to a local lane);
  `--release` fails there, because nothing ships through EAS.

## The build profiles

- **production** is a store build: `distribution: "store"` is the default but written out, so a reader
  sees it. `autoIncrement: true` makes every build take the next number from the remote counter, so
  two builds never share one (App Store Connect refuses a reused build number, Google Play any
  `versionCode` it has seen). With remote versions `autoIncrement` must be the boolean: Expo's app
  versions page says it "does not support the `version` option". `android.buildType: "app-bundle"`:
  "Google Play requires new apps to be published as app bundles instead of .apk files" (Expo docs).
- **Internal profiles** produce something a tester can install: on Android EAS CLI picks `apk` when an
  internal profile sets no `buildType` (`build/build/android/prepareJob.js`); an AAB cannot be installed
  from the build page (`internal-profile`). On iOS an internal (ad hoc) build installs only on devices
  registered with `eas device:create` before the build; a new tester means a new build.
- **Simulator profiles** extend their variant and add `ios.simulator: true`. The iOS output is a `.app`
  for the simulator, no signing. Android has no simulator flag: the internal APK runs on emulators.
- **Never a store build with `developmentClient`, `withoutCredentials` or `ios.simulator`**
  (`store-profile`): none of those can be submitted.
- **Channels** (`"channel": "<variant>"`) are added by ota-updates when the app installs expo-updates:
  one per shipping profile, equal to its `environment` and `env.APP_VARIANT` (`preview`, `production`),
  none on the development profiles; ota-updates' `examples/eas.json` is this template plus exactly those
  two keys. This template leaves them out because an app without expo-updates has no use for them.
- **Other skills' keys in a profile's `env`** (each owned and checked by its skill): with
  `@sentry/react-native`, the profiles that never report (development, simulator, E2E builds) set
  `SENTRY_DISABLE_AUTO_UPLOAD: "true"` and the store and preview profiles never do
  (crash-reporting-and-observability); analytics keys live in the EAS environments, not here
  (analytics-and-consent); push credentials are `eas credentials` steps of the developer
  (push-notifications).

## How EAS resolves a profile (extends)

`resolveBuildProfile` in `@expo/eas-json` 24.9.0, mirrored by `scripts/lib/eas-json.mjs` and the
template `scripts/eas/eas-profile.ts`:

1. Follow `extends` from the named profile to its root, at most 5 deep ("Too long chain of profile
   extensions, make sure "extends" keys do not make a cycle"); a missing parent is `Extending
   non-existent build profile in eas.json: "<name>"`.
2. Merge each child over its parent: the child's keys win; `env`, `ios` and `android` merge one level
   deeper (a child's `env` adds to the parent's instead of replacing it).
3. For one platform, merge that platform's block over the common keys (`android.env` adds to `env`).
4. Fill the defaults: `distribution: "store"`, `credentialsSource: "remote"`.

So a profile that forgets `distribution` is a store build. A shared `base` profile is fine for `node`,
`env` values every variant shares and `ios.image`; it never names a variant (app-variants-and-environment
checks that).

## Node and the install on EAS

The SDK 57 images ship Node 22.23.1 with npm 10.9.8 (docs.expo.dev/build-reference/infrastructure, read <!-- stack-pin-ignore -->
2026-10-14). EAS runs `npm ci --include=dev` there. A project whose `package.json` says
`"engines": { "npm": ">=11.17.0" }` with `engine-strict=true` (dependency-management's policy) stops
that install with `EBADENGINE`, which is the point: npm 10 knows neither `min-release-age` nor <!-- stack-pin-ignore -->
`allowScripts`. So every build profile sets `"node": "26.4.0"`, the project's Node (it ships npm 11.17),
equal to `.nvmrc` (`build-node`; a partial `.nvmrc` such as `26` is read as a prefix the full
pin must match, and an alias such as `lts/*` as no pin, so `engines` decides). The value must be a full version: `"node": "26"` makes EAS CLI stop
with `"build.production.node" failed custom validation because 26 is not a valid version` (run on
2026-10-14). The alternative an app may choose is an `eas-build-pre-install` npm script that upgrades
npm (`npm install -g npm@11.17.0`); the checker accepts either. Without `.nvmrc` or `.node-version`
the checker compares the pin with `engines`: below `engines.node` fails, and so does a Node older than
26.4.0 while `engines.npm` asks for npm 11.17 or newer (no older Node release bundles it, per
nodejs.org/dist/index.json: 22.18.0 ships npm 10.9.3, 24.11.0 ships 11.6.1), since that install would <!-- stack-pin-ignore -->
stop with `EBADENGINE` just the same. `eas build --local` ignores `node`,
`image` and the other version fields: the local machine's tools build.

## Images (cross-reference)

Leave `ios.image` and `android.image` out: EAS then uses `auto`, the image for the app's SDK and React
Native version. expo-sdk-upgrade owns the image rule (`check-sdk-alignment`, rule `eas-image`): never
`"latest"` (EAS moves it with every image release, `eas init`'s template writes it), an `sdk-<n>` alias
only for the app's SDK, an exact image only on purpose. `image` belongs inside `ios` or `android`; at
the profile's top level EAS CLI stops with `"build.production.image" is not allowed` (run on 2026-10-14).

## The submit profile

```json
"submit": {
  "production": {
    "ios": { "ascAppId": "6740000000", "bundleIdentifier": "com.example.tasks" },
    "android": { "applicationId": "com.example.tasks", "track": "internal", "releaseStatus": "completed" }
  }
}
```

- **Pin the ids.** A standalone `eas submit` evaluates the app config without the build profile's env
  (app-variants-and-environment verified this in eas-cli 24.10.0's `submit.js`), so with nothing
  exported the resolver returns the development id. `ascAppId` (the numeric Apple ID of the app
  record, App Store Connect > App Information) also skips the app lookup; `bundleIdentifier` picks the
  stored submit credentials (the App Store Connect API key is stored per bundle id, so `ascAppId`
  alone would still look the key up under the development id; `submit-profile` requires both, and
  plain mode accepts a missing `ascAppId` until `--release`); `android.applicationId` picks the stored Google service account key.
  `eas build --auto-submit` evaluates the config with the build profile's env and is correct either way.
- **Testing tracks only.** `track` defaults to `internal` and `releaseStatus` to `completed` in the
  schema. A submission reaches testers (internal: up to 100, immediately); promotion to production and
  staged rollouts are store-console steps android-release-play owns. `submit-profile` refuses
  `production` and `inProgress`/`halted` here.
- **No credentials in the file.** No `appleId` (an interactive Apple ID login with two-factor prompts)
  and no literal key path (`submit-credentials`): EAS-managed keys (set up once with `eas credentials`),
  or `"$ASC_API_KEY_PATH"` / `"$GOOGLE_SERVICE_ACCOUNT_KEY_PATH"` that CI fills from a secret file.
  EAS CLI substitutes environment variables in `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId` and
  `serviceAccountKeyPath` only.

## Every key EAS CLI accepts

`check-eas-config` (`eas-schema`) applies the same table offline; anything else is "is not allowed".

| Where | Keys and values |
|---|---|
| top level | `$schema`, `cli`, `build`, `submit` |
| `cli` | `version`, `requireCommit` (boolean), `appVersionSource` (`local`/`remote`), `promptToConfigurePushNotifications`, `updateAssetHostOverride`, `updateManifestHostOverride` |
| build profile and platform blocks | `extends` (profile only), `resourceClass` (`default`/`medium`/`large`), `env` (strings), `node`/`pnpm`/`bun`/`yarn`/`expoCli` (exact versions), `corepack`, `credentialsSource` (`local`/`remote`), `distribution` (`store`/`internal`), `channel` (`^[a-z\d][a-z\d._-]*$`), `releaseChannel`, `developmentClient`, `prebuildCommand`, `autoIncrement`, `buildArtifactPaths`, `uploadSourceMaps`, `cache` (`disabled`, `key`, `cacheDefaultPaths`, `paths`), `config`, `withoutCredentials`, `environment` (3-100 of `[a-z0-9_-]`) |
| `ios` and `android` only | `image`, `artifactPath` or `applicationArchivePath` (not both) |
| `android` only | `ndk`, `gradleCommand`, `buildType` (`apk`/`app-bundle`), `autoIncrement` (boolean, `version`, `versionCode`), `keystoreName` |
| `ios` only | `resourceClass` also `m-medium` (`m1-medium`, `m-large` deprecated), `bundler`, `fastlane`, `cocoapods`, `enterpriseProvisioning` (`adhoc`/`universal`), `simulator`, `scheme`, `buildConfiguration`, `autoIncrement` (boolean, `version`, `buildNumber`) |
| submit `android` | `serviceAccountKeyPath`, `track`, `releaseStatus` (`completed`/`draft`/`halted`/`inProgress`), `changesNotSentForReview`, `applicationId`, `rollout` (0-1, only and always with `inProgress`) |
| submit `ios` | `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`, `appleId`, `ascAppId`, `appleTeamId`, `sku`, `language`, `companyName`, `appName`, `bundleIdentifier`, `metadataPath`, `groups` (TestFlight internal group names) |

## Validating offline

Two ways, neither needs an Expo account:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-eas-config.mjs .
eas config --eas-json-only --profile production --platform ios --json --non-interactive
```

The second is EAS CLI itself; it printed the resolved profile without a login on 2026-10-14 (eas-cli
24.10.0, an empty `HOME`) and reproduces EAS's own error text. Run it for each profile you changed.

## Who owns which part

| Part of eas.json | Owner |
|---|---|
| the file, `cli`, `distribution`, `autoIncrement`, `node`, `buildType`, simulator profiles, `submit` | eas-build-and-submit |
| `env.APP_VARIANT`, `env.EXPO_PUBLIC_APP_VARIANT`, `environment`, no secrets in `env` | app-variants-and-environment |
| `ios.image`, `android.image` | expo-sdk-upgrade |
| `channel` per profile (and, outside eas.json, `runtimeVersion: { policy: 'fingerprint' }` and `updates.url` in the app config) | ota-updates |
| `SENTRY_DISABLE_AUTO_UPLOAD` in the non-reporting profiles' `env` | crash-reporting-and-observability |
| the CI jobs that run `eas`, `EXPO_TOKEN`, protected environments | ci-pipeline-and-gates |
| what happens to the store binary after `check-eas-build`: the `.ipa` gate, the `.aab` gate, tracks beyond `internal`, rollouts | ios-release-testflight, android-release-play |
| `NPM_CONFIG_*` and `EAS_NO_FROZEN_LOCKFILE` never in `env` | dependency-management |

## When multi-package

Each app keeps its own `eas.json` next to its `app.config.ts`; EAS CLI runs from that folder. Pass
`--app-dir apps/<app>` to both checkers. The install still runs at the workspace root on EAS, so the
root `package.json` `engines` decide the Node each profile must pin. Upload tags start with the app's
folder (`mobile/v1.2.0+ios.14` for `apps/mobile`, git-commits-and-reporting); with `--app-dir apps/mobile`,
`check-eas-build` reads only the `mobile/v*+<platform>.*` tags, so another app's numbers never count.
The preflight template assumes one app at the root: when multi-package, its printed record-check lines
need `--app-dir apps/<app>` added.
