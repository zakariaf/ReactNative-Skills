# Releases, symbols and source maps

A crash report is only useful when its frames point at your source. This reference covers the names
Sentry groups crashes by (release, dist, environment), how source maps and native debug symbols get
there for every store build and every OTA update, and how to prove it. Read from `@sentry/react-native`
7.11.0 (`dist/js/integrations/release.js`, `scripts/sentry-xcode.sh`,
`scripts/sentry-xcode-debug-files.sh`, `sentry.gradle`, `scripts/expo-upload-sourcemaps.js`,
`plugin/build/*.js`) and checked with `expo export` on Expo SDK 57 on 2026-10-14. Re-verify:
`npm ls @sentry/react-native @sentry/cli` and read the same files.

## Contents

1. Release, dist, environment
2. Debug IDs: how a map finds its bundle
3. Store builds on EAS: what uploads, when, with what
4. The local lane (prebuild + xcodebuild / Gradle)
5. OTA updates (EAS Update)
6. Hermes bytecode
7. Proving symbolication
8. Failure modes

## 1. Release, dist, environment

| Name | Value | Set by |
|---|---|---|
| release | `<bundle id or application id>@<version>+<build>`, e.g. `com.acme.tasks@1.4.0+318` | the native SDK (`nativeReleaseIntegration` reads it from native when the options set none) |
| dist | `<build>` (`CFBundleVersion` on iOS, `versionCode` on Android) | the native SDK |
| environment | the variant: `development`, `preview`, `production` | the adapter (`config.environment`) |

Why the JavaScript options set no `release` and no `dist` (`release-native`): native crash events
always carry the native names, the Xcode and Gradle upload steps name the uploaded release the same
way (`sentry.gradle` builds `${applicationId}@${versionName}+${versionCode}`, and `SENTRY_RELEASE` /
`SENTRY_DIST` override only when set in the build environment), and the variant ids differ already
(`.dev`, `.preview`, app-variants-and-environment), so releases of different variants never collide. A
hand-written release in JavaScript splits one build's JavaScript and native events into two releases
and breaks release health.

Builds need unique build numbers per store upload, which EAS's remote app versions with
`autoIncrement` give (eas-build-and-submit). An OTA update keeps the binary's release and dist (the
native build did not change); its own identity travels in the `ota_updates` context (`update_id`,
`channel`, `runtime_version`), which `expoContextIntegration` adds to every event automatically.

## 2. Debug IDs: how a map finds its bundle

`getSentryExpoConfig` makes Sentry's serializer prepend a debug-ID module to the bundle and write the
same id into the source map (`debugId`). At runtime the SDK reports the id with each event; Sentry
looks up the uploaded map by that id, independently of release and dist. Verified with
`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios
--source-maps`: with the Sentry config, the `.hbc.map`'s `debugId` is found inside the `.hbc`; with
Expo's default config the map has a `debugId` but the bytecode does not contain it, so nothing at
runtime can report it (`metro-debug-ids`).

## 3. Store builds on EAS: what uploads, when, with what

With the config plugin (`config-plugin`) every release build uploads during the build:

| Platform | What | Step | Skipped when |
|---|---|---|---|
| iOS | JS bundle + source map | "Bundle React Native code and images" through `sentry-cli react-native xcode` | `SENTRY_DISABLE_AUTO_UPLOAD=true` |
| iOS | dSYMs (native symbols) | "Upload Debug Symbols to Sentry" | the configuration name contains "Debug", `SENTRY_DISABLE_AUTO_UPLOAD` or `SENTRY_DISABLE_XCODE_DEBUG_UPLOAD` |
| Android | JS bundle + source map | `sentry.gradle` around `createBundle<Variant>JsAndAssets` | the variant name contains "debug", or `SENTRY_DISABLE_AUTO_UPLOAD=true` (`SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD` does not affect it; sentry.gradle 7.11.0) |
| Android | ProGuard/R8 mapping, NDK symbols | Sentry Android Gradle Plugin (`experimental_android.enableAndroidGradlePlugin`) | not configured (default), or `SENTRY_DISABLE_AUTO_UPLOAD=true`, or `SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD=true` (read by the plugin's auto-upload switch, `withSentryAndroidGradlePlugin.js`) |

Inputs the build needs: `SENTRY_AUTH_TOKEN` (EAS secret), and org/project from the plugin entry.
On iOS a failed source map upload **fails the build** (`sentry-xcode.sh` exits 1) unless
`SENTRY_ALLOW_FAILURE=true`; a failed dSYM upload only prints an error. That is the right default for
store builds: a release whose crashes cannot be read should not ship silently, so upload profiles keep
neither switch (`upload-not-disabled`). Profiles that never report (development, E2E) set
`SENTRY_DISABLE_AUTO_UPLOAD=true` in eas.json `env`, so they build without the token.

iOS dSYMs: EAS Build archives with bitcode off (Xcode 14 and later have no bitcode), so the dSYMs
the archive produces are the final ones and the build phase uploads them; App Store Connect's own
symbol upload (`uploadSymbols` in export options) is separate and feeds Apple's crash reports.

## 4. The local lane (prebuild + xcodebuild / Gradle)

The same build phases run locally: `npx expo prebuild --clean` then the release build
(ios-release-testflight, android-release-play). `sentry-cli` reads `SENTRY_AUTH_TOKEN` from the
environment, or from `.env.sentry-build-plugin` at the app root (both upload scripts load it), which
must be git-ignored (`token-files`). Never put the token in `.sentryclirc` or `sentry.properties` in the
repository; the plugin writes `sentry.properties` into the generated `ios/` and `android/` folders,
which continuous native generation keeps out of git.

## 5. OTA updates (EAS Update)

`eas update` exports new bundles that no native build uploaded. Upload them right after publishing,
from the app root:

```sh
eas update --channel production --environment production --message "<what changed>" \
  && npx sentry-expo-upload-sourcemaps dist
```

**EAS Workflows.** A `type: update` job (how ota-updates publishes from `.eas/workflows/`) runs on
its own worker, and its `dist/` exists only there, so a later job cannot upload the maps. Use the
job's own switch (verified against the EAS Workflows pre-packaged jobs reference, 2026-10-14):

```yaml
jobs:
  publish_production:
    type: update
    environment: production        # SENTRY_AUTH_TOKEN is a secret variable of this EAS environment
    params:
      channel: production
      upload_sentry_sourcemaps: true   # upload, and fail the job when the upload fails
```

Left out, the job checks whether `@sentry/react-native` is installed, tries the upload, and stays
green when it fails (a missing token only prints an error), so crashes from that update show
minified frames and nobody notices; `false` skips the upload. The other accepted form runs the
upload in the job's `after_update` hook, which sees `dist/`:

```yaml
    hooks:
      after_update:
        - run: npx sentry-expo-upload-sourcemaps dist
```

A custom job (`steps:` with `run: npx eas-cli update ...`) follows the shell rule above: the upload
runs in a later step of the same job.

`sentry-expo-upload-sourcemaps` (a bin of `@sentry/react-native`) reads org and project from the
environment or the config plugin entry, `SENTRY_AUTH_TOKEN` from the environment, walks `dist/` for
bundle/map pairs (`.js`, `.hbc`, `.map`), copies `debugId` to `debug_id`, and runs
`sentry-cli sourcemaps upload --debug-id-reference` for Hermes bundles. Every package.json script and
CI workflow that runs `eas update` must do both, and every `type: update` job must upload as shown
above (`ota-sourcemaps`). The update's events keep the
binary's release and dist; filter them by `ota_updates.update_id` (the scrubber keeps the ids of that SDK context intact; privacy
reference, section 3). Before `Updates.reloadAsync()`, the
update flow flushes the reporter (error-flow reference, section 7; ota-updates owns the flow).

## 6. Hermes bytecode

Release builds ship Hermes bytecode. The upload steps upload the Hermes source map composed with the
Metro map (React Native's `compose-source-maps` runs inside the bundle phase), and the debug-ID module
survives compilation (verified in section 2), so frames resolve to the TypeScript source lines. A
custom bundle phase that disables source maps (`SOURCEMAP_FILE` unset by an old script) breaks this:
regenerate the native projects (`npx expo prebuild --clean`) instead of editing them.

## 7. Proving symbolication

On a preview build that reports (testing reference, device proof):

1. Trigger a JavaScript error through debug-menu-and-test-hooks' test-only triggers (throw in a press
   handler, reject a promise, throw in render), with crash reports turned on in the build's settings.
2. In Sentry, the issue's frames show `src/...` paths and TypeScript line numbers, the release is
   `<id>@<version>+<build>`, the environment `preview`, the `source` tag names the boundary, and the
   event's debug meta lists the bundle's debug ID.
3. Native symbols: the project's Debug Files page lists the build's dSYMs (iOS) after the build, and
   the next real native crash shows symbolicated frames. `sentry-cli debug-files check <dSYM>` checks a
   dSYM locally; `sentry-cli sourcemaps explain <event-id>` explains a missing map (both through the
   `sentry-cli` script of `@sentry/cli`, run as `node node_modules/@sentry/cli/bin/sentry-cli ...`
   when the `.bin` link is absent).

The developer runs these against their own Sentry project; never upload from an agent session
without the developer's go-ahead.

## 8. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Minified frames (`index.android.bundle:1:23456`) | no debug-ID module (default Metro config), or the map was never uploaded (upload disabled, OTA without upload) | `getSentryExpoConfig`; remove the disable switch; upload after `eas update` |
| iOS build fails at "Bundle React Native code and images" with `error: sentry-cli` | no `SENTRY_AUTH_TOKEN` in that EAS environment | the developer adds the secret, or the profile is not a reporting one and sets `SENTRY_DISABLE_AUTO_UPLOAD=true` |
| `sentry-cli` not found during the build | optional dependencies omitted at install | install with optional dependencies (`optional-deps`) |
| Preview crashes mixed with store issues | no `environment` in the options | `environment: config.environment` |
| Two releases per build | `release` set in JavaScript | remove it (`release-native`) |
| Native crash frames unsymbolicated (iOS) | dSYM upload skipped (a configuration named like Debug, or disabled) | build the Release configuration; keep upload on |
| Android Java frames obfuscated | R8 on without the Gradle plugin's mapping upload | `experimental_android: { enableAndroidGradlePlugin: true }` with the mapping upload |
