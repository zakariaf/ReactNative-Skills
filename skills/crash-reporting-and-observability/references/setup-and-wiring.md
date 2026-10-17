# Setup and wiring

How Sentry enters an Expo app in this library: one package, one adapter behind `CrashReporterPort`,
one config plugin entry, one Metro wrapper, and the composition root. Verified on 2026-10-14 against
Expo SDK 57 (`expo` 57.0.26), React Native 0.86.3 and `@sentry/react-native` 7.11.0 (with
`@sentry/core` 10.37.0, Sentry Cocoa `Sentry/HybridSDK` 8.58.0 and `@sentry/cli` 2.58.4) by reading
the installed sources and by an `expo export` of a wired copy of the reference app. Re-verify:
`npm ls @sentry/react-native @sentry/cli` and `npx expo install --check`.

## Contents

1. Why Sentry, and why behind a port
2. Install
3. The files the skill adds
4. Configuration: DSN, variant, sample rates
5. The composition root and the tests
6. The config plugin and Metro
7. EAS environment variables
8. Expo Go, web, development builds
9. When multi-package

## 1. Why Sentry, and why behind a port

`@sentry/react-native` is in the Expo SDK 57 module map (`~7.11.0`), handles JavaScript errors, iOS
and Android native crashes (including NDK on Android and app hangs and watchdog terminations on
iOS), symbolicates Hermes bytecode through debug IDs, and has a supported Expo config plugin. Its
npm `latest` is a newer major that sits outside the SDK 57 map: install with `npx expo install`, never
`npm install @sentry/react-native@latest` (dependency-management's policy pins it to `~7.11.0`, the SDK 57 map).
`sentry-expo` is the superseded wrapper; `check-crash-reporting` fails while it is installed.

The port exists for three reasons, each a rule of this skill:

- **One file decides what leaves the device.** Every option that could send personal data sits in
  `sentry-crash-reporter-adapter.ts`, so a reviewer audits one file (the ESLint vendor rule and the
  checker's `sdk-import` keep it that way).
- **Consent is enforced in code.** The port's `setConsent` is the only way to start the SDK; features
  call `captureException` and `addBreadcrumb` without knowing whether reporting is on.
- **Tests never touch the SDK.** `createFakeCrashReporter()` records what would have been sent; the
  root mock keeps the real module (which starts a timer at import) out of every Jest run.

## 2. Install

```sh
npx expo install @sentry/react-native        # ~7.11.0 on SDK 57; a native module: rebuild the dev client
```

- `@sentry/cli` comes with it. Its binary arrives as an **optional dependency**
  (`@sentry/cli-darwin`, `@sentry/cli-linux-x64`, ...); the package's `postinstall` only downloads a
  fallback when the optional package is missing (read from `@sentry/cli` 2.58.4 `scripts/install.js`).
  So the canonical `allowScripts` may keep `"@sentry/cli": false`: uploads still work. What breaks
  them is an install without optional dependencies (`--omit=optional`, `--no-optional`,
  `omit=optional` in `.npmrc`): `optional-deps` fails those.
- With npm 11.17 a denied install script also skips the package's `.bin` link, so `npx sentry-cli`
  does not resolve. Nothing needs it: the Xcode script, `sentry.gradle` and
  `sentry-expo-upload-sourcemaps` all find the CLI through `require.resolve('@sentry/cli/...')`.
- The SDK is a native module: Expo Go cannot run it (section 8). Build a development client after
  installing (ios-simulator-build, android-emulator-build).

## 3. The files the skill adds

| File | What it does |
|---|---|
| `src/services/crash-reporter/crash-reporter-port.ts` | `CrashReporterPort`: `setConsent`, `captureException`, `addBreadcrumb`, `flush`, `status`; no `setUser` |
| `src/services/crash-reporter/sentry-crash-reporter-adapter.ts` | The only SDK import; `sentryOptions()` and the consent state machine |
| `src/services/crash-reporter/crash-scrubber.ts` | Pure scrubbing for `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` |
| `src/services/crash-reporter/crash-forwarder.ts` | The kit's error forwarding: `render` and `unhandled-rejection` to the crash reporter (the root sink already recorded every report) |
| `src/services/crash-reporter/crash-reporting-root-kit.tsx` | `createCrashReportingKit({ crashReporter, consent })`: the root kit (forward slot, effects that apply the choice and record route breadcrumbs), `fixedCrashConsent` |
| `src/services/crash-reporter/fake-crash-reporter.ts` | The fake every test uses |
| `src/config/crash-reporting-config.ts` | `parseCrashReportingConfig(raw, variant)`, `readCrashReportingConfig()` and the sample-rate constants |
| `src/config/crash-reporting-env.d.ts` | The type of `EXPO_PUBLIC_CRASH_REPORTER_DSN` (or the same line in `src/env.d.ts`) |
| `scripts/metro/metro-kits.ts` | The app's Metro kits: Sentry's `getSentryExpoConfig` as the base config |
| `src/hooks/use-crash-reporting-consent.ts` | Applies the saved choice after the splash, and every change |
| `src/hooks/use-route-breadcrumbs.ts` | One navigation breadcrumb per route pattern |
| `__mocks__/@sentry/react-native.ts` | The root mock (automatic in every Jest project) |
| `contracts/crash-reporting.json` (+ schema) | The app's facts: consent model, tracing cap, upload profiles, declarations |

Each has its test beside it. The adapter folder holds the port, the adapter, the fake and the fake's
test, which is architecture-and-boundaries' `port-triple`.

## 4. Configuration: DSN, variant, sample rates

The DSN is public by design: it lets a client send events to one project and nothing else (it cannot
read data). It is still a per-environment value, so it travels as `EXPO_PUBLIC_CRASH_REPORTER_DSN`
(app-variants-and-environment's name for it): declared in `src/config/crash-reporting-env.d.ts` (it
merges into `src/env.d.ts`'s `ProcessEnv`; an app may move the line there), read with dot access by
`readCrashReportingConfig()` in `src/config/` (or by the app's environment reader, which then passes
the raw value on), and checked once by `parseCrashReportingConfig(raw, variant)`:

| Variant | DSN set | Result |
|---|---|---|
| development | any | `dsn: null`: the SDK never starts (local runs and the dev client stay silent) |
| preview | yes | reports as environment `preview` |
| preview | empty | `dsn: null` (an internal build may skip reporting) |
| production | yes | reports as environment `production` |
| production | empty | fails the EAS build first (`app.config.ts` throws when `EAS_BUILD=true` and `APP_VARIANT=production`, `examples/app.config.ts`), and throws on the first launch as the second check: a store build without reporting is a misconfiguration |
| any | malformed | throws with the variable's name |

When the app has app-variants-and-environment's environment reader, it replaces that reader's plain
`crashReporterDsn` field (which allows an empty value in every variant) with one field,
`crashReporting: parseCrashReportingConfig(...)`, and the registry passes that instead of calling
`readCrashReportingConfig()`; production requires the DSN either way. Keep the variable name from that
skill; only the parsed shape and the production rule change.

The order of the two checks matters: the build-time guard stops a production build whose EAS
environment lacks the variable before anyone installs it; the runtime throw catches a build made some
other way (a local release build, a forgotten guard). The guard reads only `EAS_BUILD`, so a local
production export (privacy-and-store-declarations' `export:audit`) and `eas update` (which loads the
EAS environment it is given) are unaffected.

`environment` is always the variant. Without it the SDK picks `development` or `production` from
`__DEV__` (read from `utils/environment.js`), so every preview crash would land among the store
build's issues (`environment-set`).

`TRACES_SAMPLE_RATE` and `PROFILES_SAMPLE_RATE` live in the same file as literals the checker can
read (`trace-rate`); tracing is off at `0` (see the error-flow reference, section 6).

## 5. The root kit, the registry and the tests

- The reporter is a root kit (app-startup-and-bootstrap's slots), not a member of `Services`: the
  app's registry `src/services/create-root-kits.ts` (part of the composition root) creates the adapter
  and registers `createCrashReportingKit({ crashReporter, consent })` (`examples/create-root-kits.ts`).
  `startApp` runs the registry once, after the data layer and the settings, so the adapter's failures
  go to the SQLite error log and the consent source can read the settings store. Creating the adapter
  only builds an object: no I/O, no connection.
- The kit fills two slots: `forward` (the error sink hands it every report) and `effects` (mounted
  beside the root Stack after the splash release: `useCrashReportingConsent` over the consent source,
  then `useRouteBreadcrumbs`). No root file names it; check-startup's `root-kits` fails a root file
  that imports a kit.
- Code that reports a handled defect itself takes the port as a factory argument from the registry
  (an OTA update checker's `beforeApply`, a debug crash trigger); the kit needs no context provider.
- Tests pass `createFakeCrashReporter()`; only the adapter's own test talks to the root mock, through
  `jest.mock('@sentry/react-native')` and a locally typed `jest.requireMock` (unit-and-component-tests'
  rule for native SDKs).

**Why the root mock:** importing `@sentry/react-native` 7.11 in Jest starts a `setInterval` in its
time-to-display fallback map (`AsyncExpiringMap`), so any suite that reaches the adapter, even through
the registry, ends with "A worker process has failed to exit gracefully" (observed in a
wired copy of the reference app on 2026-10-14; `--detectOpenHandles` points at the import). The root
mock replaces the module in every project, and the open handle is gone.

## 6. The config plugin and Metro

```ts
// app.config.ts, inside plugins
['@sentry/react-native/expo', { organization: '<org-slug>', project: '<project-slug>' }],
```

What the plugin does at prebuild (read from `plugin/build/withSentry*.js`):

- **iOS:** wraps the "Bundle React Native code and images" phase with `sentry-xcode.sh`, which runs
  `sentry-cli react-native xcode` (bundle plus source map upload), and adds the "Upload Debug Symbols
  to Sentry" phase (`sentry-xcode-debug-files.sh`, dSYMs; skipped for any configuration named Debug).
  It writes `ios/sentry.properties` (url, org, project).
- **Android:** adds `apply from: .../sentry.gradle` to `android/app/build.gradle`; for every variant
  whose name does not contain `debug`, it hooks the `createBundle*JsAndAssets` task and uploads the
  bundle and map. ProGuard mappings and NDK symbols need the Sentry Android Gradle Plugin
  (`experimental_android: { enableAndroidGradlePlugin: true, ... }` in the plugin options); Expo builds
  do not minify by default, so most apps start without it.
- `authToken` in the options is written into `sentry.properties` of both native projects (the plugin
  only deletes it from the embedded config): never pass it (`plugin-auth-token`).

Without `organization`/`project` in the entry the upload falls back to `SENTRY_ORG`/`SENTRY_PROJECT`
from whoever builds; the checker asks for them in the entry (they are not secret).

Metro: the canonical `metro.config.js` composes the Metro slot from `scripts/metro/metro-kits.ts`
(`readMetroKits` and `composeMetroConfig`) and sets `cacheVersion` last; crash reporting lists one kit
there and never edits `metro.config.js`:

```ts
// scripts/metro/metro-kits.ts (templates/scripts/metro/metro-kits.ts)
import { getSentryExpoConfig } from '@sentry/react-native/metro.js';   // Node ESM needs the .js
export const METRO_KITS: readonly MetroKit[] = [
  { name: 'crash-reporting', baseConfig: (projectRoot) => getSentryExpoConfig(projectRoot) },
];
```

An app that keeps its own `metro.config.js` (no slot) builds it with `getSentryExpoConfig(__dirname)`
and keeps the `cacheVersion` line; the checker accepts both. `getSentryExpoConfig` wraps Expo's default config with Sentry's serializer, which prepends a debug-ID
module to every bundle. Verified on 2026-10-14 with `expo export --platform ios --source-maps`: with
Expo's default config the source map has a `debugId` but the Hermes bytecode does not contain it (the
running app cannot report it); with `getSentryExpoConfig` the `.hbc` contains the map's `debugId`.
`annotateReactComponents` stays off (it adds component names to the tree; not needed for crashes).

## 7. EAS environment variables

The developer creates these in their Expo account (stop and ask before running any `eas env:*`
command; never create them yourself):

| Variable | Visibility | Environments | Why |
|---|---|---|---|
| `EXPO_PUBLIC_CRASH_REPORTER_DSN` | plain text | preview, production | inlined in the bundle; public by design |
| `SENTRY_AUTH_TOKEN` | secret | every environment whose builds upload (contract `uploadProfiles`) | read by sentry-cli during the build; Sentry's org auth token scoped to releases and source maps |

```sh
eas env:set --name SENTRY_AUTH_TOKEN --environment production --visibility secret   # prompts for the value (eas-cli 24.10: env:set creates or updates)
```

A build profile that never reports (development, an E2E profile) sets
`"SENTRY_DISABLE_AUTO_UPLOAD": "true"` in its eas.json `env`; on iOS a failed source map upload fails
the build (`sentry-xcode.sh` exits 1 unless `SENTRY_ALLOW_FAILURE=true`), and on Android the upload is
skipped for debug variants anyway. A profile listed in `uploadProfiles` never sets either variable
(`upload-not-disabled`). CI that runs `eas update` gets `SENTRY_AUTH_TOKEN` from its own secrets.

## 8. Expo Go, web, development builds

- **Expo Go** has no Sentry native module: the SDK logs that offline caching and native errors are
  unavailable. The adapter is never started in development anyway (`dsn: null`).
- **Development builds** report nothing (development variant). To test reporting, use a preview build
  (testing and verification reference).
- **Web** (react-native-web): this skill covers iOS and Android only; `@sentry/react-native` was
  verified at import on web, nothing more. A web target is web-support's hand-off: the checker's
  `adapter-single` and `sdk-import` rules expect exactly one adapter on `@sentry/react-native`, so do
  not add a `.web.ts` adapter on `@sentry/react` under this skill; web-support decides where web
  errors and source maps go.

## 9. When multi-package

The app's folder holds `app.config.ts`, `metro.config.js`, `eas.json` and `src/`; pass it to the
checker: `node check-crash-reporting.mjs . --app-dir apps/<app>`. The config plugin, Metro wrapper and
adapter belong to the app, never to a shared package (a package cannot know the app's DSN or
consent model).
