# App integration: config, the UpdatesPort and testing

The `updates` settings and their defaults on SDK 57, what the native updater does at launch on iOS
and Android, the UpdatesPort and its adapter, the update checker and when the app applies an update,
and how to test all of it. Verified on 2026-10-14 against expo-updates 57.0.24
(`build/Updates.d.ts`, `build/Updates.types.d.ts`, `CHANGELOG.md`), `@expo/config-types` 57.0.2 and
docs.expo.dev/versions/v57.0.0/sdk/updates. Re-verify: read those files in `node_modules`.

## Contents

1. The config, in one helper
2. Every updates key and its default
3. What happens at launch
4. The UpdatesPort and the adapter
5. The update checker: foreground checks and applying
6. Wiring it into the app
7. Things not to do in app code
8. Bundle size, assets and diffs
9. Testing: Jest, release builds, both platforms
10. Debugging an update that does not arrive

## 1. The config, in one helper

`templates/src/config/updates-config.ts` returns `runtimeVersion: { policy: 'fingerprint' }` and
`updates: { enabled: true, url: 'https://u.expo.dev/<projectId>', checkAutomatically: 'ON_LOAD',
fallbackToCacheTimeout: 0 }`. It is pure and neutral, so `app.config.ts` imports it with the `.ts`
extension under Node type stripping; it throws on an id that is not a lowercase UUID, so a placeholder
never ships. `app.config.ts` keeps one `EAS_PROJECT_ID` constant for `extra.eas.projectId` and the URL
(`examples/app.config.ts`). Until the app wants OTA it says `updates: { enabled: false }` explicitly
(expo-project-bootstrap's skeleton does), because with `expo-updates` installed and no URL the
updater is silently disabled and knip and Expo's tools treat the package as used.

## 2. Every updates key and its default

| Key | Default | iOS (Expo.plist) / Android (meta-data) | This library |
|---|---|---|---|
| `enabled` | true | `EXUpdatesEnabled` / `expo.modules.updates.ENABLED` | true, or false for the whole app |
| `url` | none (required) | `EXUpdatesURL` / `EXPO_UPDATE_URL` | `https://u.expo.dev/<projectId>` |
| `runtimeVersion` (top level) | none (required) | `EXUpdatesRuntimeVersion` / `EXPO_RUNTIME_VERSION` | `{ policy: 'fingerprint' }` |
| `checkAutomatically` | `ON_LOAD` | `EXUpdatesCheckOnLaunch` / `EXPO_UPDATES_CHECK_ON_LAUNCH` | `ON_LOAD`: `NEVER` turns off error recovery's fix check; `ON_ERROR_RECOVERY` asks only after a crash at launch, so a fix for any other bug waits for the JS checks; `WIFI_ONLY` delays fixes on cellular |
| `fallbackToCacheTimeout` | 0 (0 to 300000 ms) | `EXUpdatesLaunchWaitMs` / `EXPO_UPDATES_LAUNCH_WAIT_MS` | 0 |
| `useEmbeddedUpdate` | true | `EXUpdatesHasEmbeddedUpdate` / `HAS_EMBEDDED_UPDATE` | true ("should not be used in production" when false) |
| `requestHeaders` | none | `EXUpdatesRequestHeaders` / `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` | only the channel header in the local lane |
| `codeSigningCertificate`, `codeSigningMetadata` | none | `EXUpdatesCodeSigningCertificate`… | optional (rollouts reference) |
| `assetPatternsToBeBundled` | all assets | n/a | default |
| `disableAntiBrickingMeasures` | false | `EXUpdatesDisableAntiBrickingMeasures` | false, never committed true |
| `useNativeDebug` | false | Podfile.properties / gradle.properties | false, never committed true |
| `enableBsdiffPatchSupport` | true (SDK 56+) | `EXUpdatesEnableBsdiffPatchSupport` | default |

## 3. What happens at launch

In a release build with the updater enabled, on both platforms: the native layer launches the newest
update on the device that matches its runtime (or the embedded bundle), and with `ON_LOAD` asks the
server in the background. With `fallbackToCacheTimeout: 0` the launch never waits; a downloaded update
runs at the next cold start (a kill from the app switcher or a reboot, not a background/foreground
switch). So a published update reaches a phone after two cold starts. Debug builds load JS from the
dev server and the updater does nothing (unless built with `useNativeDebug`).

Two different "off" states, both mapped to `{ kind: 'disabled' }` by the adapter
(`adapter-enabled-guard`):

- **`Updates.isEnabled` is false** when `enabled` is false, the URL is missing or invalid, the runtime
  version is missing, or storage failed at startup, and in Expo Go. Every method
  (`checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync`, `getExtraParamsAsync`) rejects then, so
  the adapter asks first.
- **A development build (dev client) reports `isEnabled` true.** Its dev launcher controller
  (`DevLauncherAppController.swift`, `UpdatesDevLauncherController.kt`, expo-updates 57.0.24) sets
  `isEnabled: true` and `shouldDeferToNativeForAPIMethodAvailabilityInDevelopment: true`, then rejects
  `checkForUpdateAsync` and `fetchUpdateAsync` with code `ERR_NOT_AVAILABLE_IN_DEV_CLIENT`; the JS
  layer rejects with `ERR_UPDATES_DISABLED` when `__DEV__` runs without the dev launcher. The adapter
  reads `code` from the rejection and returns `disabled` for both, so the development variant does
  not log a `check-failed` service error at every foreground check. `reloadAsync` works in a dev
  client (it reloads from the dev server).

## 4. The UpdatesPort and the adapter

`src/services/updates/updates-port.ts` is the app's whole view: `running()` (update id, channel,
runtime version, embedded or not, emergency launch and its reason, read once), `check()`
(`'none' | 'new-update' | 'roll-back-to-embedded'`), `download()` (`'ready' | 'nothing-new'`) and
`apply()` (reload onto the downloaded update). Each returns a `Result` from `src/core/result.ts`;
failures are `disabled` (`isEnabled` false, or a rejection with `ERR_NOT_AVAILABLE_IN_DEV_CLIENT` or
`ERR_UPDATES_DISABLED`: section 3), `check-failed`, `download-failed`, `apply-failed`.
`expo-updates-adapter.ts` is the one file that imports expo-updates (the canonical ESLint config lists
`expo-updates` among the vendor SDKs, architecture-and-boundaries' UpdatesPort). `fake-updates.ts`
scripts answers and records calls for tests.

`checkForUpdateAsync` resolves `{ isAvailable, isRollBackToEmbedded, manifest, reason }`;
`fetchUpdateAsync` resolves `{ isNew, isRollBackToEmbedded, manifest }`; a roll-back directive
downloads like an update and applies at the next launch. `useUpdates()` (a hook over the native state
machine) is not used: it would put vendor state in components; the checker's status replaces it.

## 5. The update checker: foreground checks and applying

`src/services/updates/update-checker.ts`, created once by the composition root:

- `reportLaunch()`: once, after the splash release; records `updates: emergency launch (<reason>)`
  to the error log as `startup`.
- `checkWhenDue()`: when the app returns to the foreground, at most once per hour by default
  (`DEFAULT_MIN_CHECK_INTERVAL_MS`; Expo asks for checks at launch and foreground, never a loop),
  never while one runs or an update waits; check, then download; failures other than `disabled` go
  to the error log as `service`; it never rejects (the effect that calls it owns no promise).
- `status()` / `subscribe()`: `idle | checking | downloading | ready`, for `useSyncExternalStore`.
- `applyNow()`: reload onto a ready update; only from the person's tap on "Restart to update"
  (`examples/restart-to-update-row.tsx`), never automatically: a reload drops unsaved input and
  navigation state. Nothing after `reloadAsync` is guaranteed to run, so work that must finish
  first goes in the optional `beforeApply` dep (crash-reporting-and-observability's
  `crashReporter.flush()`): awaited at most `BEFORE_APPLY_TIMEOUT_MS` (2 s, through async-safety's
  `withTimeout`); a rejection or a timeout is logged and the update still runs.

At a cold start two checks run: the native one (`ON_LOAD`), whose download only the next launch
uses, and one JS check, because the app root's foreground effect runs at mount with `isActive` true
(`use-update-checks.test.ts` expects `['check', 'download']` on mount). The JS check is deliberate:
it is how an update that is ready becomes visible to "Restart to update" in this session, it costs
one small manifest request, and the hour throttle starts there.
app-startup-and-bootstrap's rule: OTA checks are deferred work, started after the splash release from
their owner, never a startup-gate task, never awaited before the first frame.

Mandatory updates have no first-class support (docs, "Downloading updates"): an app that must block
old JS reads a minimum version from its own server (networking-and-server-state) and shows a blocking
screen with the restart button; never set `fallbackToCacheTimeout` for it.

## 6. Wiring it into the app

1. Composition root (architecture-and-boundaries owns the files): add `updates: UpdatesPort` and
   `updateChecker: UpdateChecker` to `Services`; `createDeviceServices` creates
   `createExpoUpdatesAdapter()` and `createUpdateChecker({ updates, clock, errorLog })`, plus
   `beforeApply: () => crashReporter.flush()` when crash reporting is wired;
   `createTestServices` uses `createFakeUpdates()` (`examples/composition-root.ts`).
2. App root (app-startup-and-bootstrap): `useUpdateChecks(services.updateChecker)` once, inside the
   tree that renders after the splash release (`examples/app-root-wiring.tsx`).
3. A settings row or banner: `useUpdateStatus(checker) === 'ready'` shows "Restart to update" with
   message keys from the app's catalogs (i18n-strings-and-catalogs).
4. Crash reports (crash-reporting-and-observability, when `@sentry/react-native` is installed): the
   update id, channel and runtime reach every event on their own (Sentry's Expo context); this
   skill's part is the flush before the reload (item 1) and the source maps of each update: every
   `eas update` script or job also uploads them (`&& npx sentry-expo-upload-sourcemaps dist` after a
   shell `eas update`, `upload_sentry_sourcemaps: true` in an EAS Workflows update job's `params`),
   which that skill's `ota-sourcemaps` rule checks.

## 7. Things not to do in app code

- Import expo-updates outside the adapter (lint), or call `reloadAsync` for a language or direction
  restart: that is `reloadAppAsync` from `expo` (rtl-and-direction), which restarts the same bundle.
- Await a check, a download or a reload in the root layout or app root (app-startup-and-bootstrap's
  `startup-await`).
- Show the update id or channel as user-facing text without a message key.
- Read the app version from `Constants.expoConfig.version` (it comes from the running update's
  manifest); use `expo-application`'s `nativeApplicationVersion`.

## 8. Bundle size, assets and diffs

The client downloads the manifest, then only assets it does not have; EAS Update serves bsdiff patches
of the bundle when the phone runs a published update (default since SDK 56; from the embedded bundle
on a fresh install since SDK 58). The September 2026 expo-updates patches fixed applying diffs
against the embedded bundle on both platforms and re-downloading assets of duplicate scales (the
package's CHANGELOG), so stay on the SDK's current patch (57.0.24 on 2026-10-14). Large new images in an update cost every phone a download; prefer them in a
store build. `eas update` warns when a group nears the server's asset cap.

## 9. Testing: Jest, release builds, both platforms

- Unit: the adapter test mocks `expo-updates` (it has no Jest mock; its native module exists only in
  a release build) with getters, so each test switches `isEnabled`, and rejects with the dev-client
  code to prove a development build reads as `disabled`; the checker and hook tests use
  `createFakeUpdates()`, `createFakeErrorLog()` and a plain clock; `fingerprint-config.test.ts` loads
  the root config; `update-plan.test.ts` covers channels, rollouts and runtime matching.
- Release build on both platforms, with the updater on: a preview build (EAS internal distribution,
  or the local lane: `npx expo run:ios --configuration Release --device <udid>` and
  `npx expo run:android --variant release --device <avd-name>`, on devices named
  `<project>-ota`, never the booted one). Publish to the preview channel, then force-close and
  reopen twice; the second launch runs the update (check `running().updateId` on a debug screen,
  debug-menu-and-test-hooks).
- Broken-update drill (preview only): publish an update that throws at module load, open twice, see
  the phone fall back (an emergency launch reported) and recover after a fixed update.
- `useNativeDebug: true` locally builds a Debug app that loads updates like a release build, to
  debug the updater with Xcode or Android Studio; never commit it.

## 10. Debugging an update that does not arrive

1. Runtime: does the update's runtime version (`eas update:view <groupId>`) equal the binary's
   (`running().runtimeVersion`, or `eas build:list --channel <c> --json` `runtime.version`)? If not,
   a native input or the environment differs (runtime reference, section 8).
2. Channel: is the binary on the channel you published to (`running().channel`, the build profile)?
3. Enabled: is this a release build with the updater on? A missing URL makes `isEnabled` false; a
   development build reports `isEnabled` true but never checks (section 3).
4. Two cold starts: the first downloads, the second runs it.
5. Logs: `Updates.readLogEntriesAsync()` returns the updater's recent log entries (codes such as
   `NoUpdatesAvailable`, `UpdateServerUnreachable`, `UpdateHasInvalidSignature`); show them on a
   debug screen.
