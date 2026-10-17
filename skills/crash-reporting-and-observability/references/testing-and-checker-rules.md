# Testing, the checker and the device proof

How the skill's work is proven: the Jest tests the templates ship, every rule of
`check-crash-reporting.mjs` with its fix, the release-build proof on a named simulator and emulator,
and the pitfalls met while building it. Verified on 2026-10-14 in a wired copy of the reference app
(Expo SDK 57, Jest 29.7, jest-expo 57.0.5, React Native Testing Library 14.0.1). Re-verify:
`npx jest src/services/crash-reporter src/hooks src/config scripts/metro --ci --maxWorkers=2`.

## Contents

1. What the shipped tests prove
2. Testing app code that reports
3. The checker: rules, causes, fixes
4. Expected SKIP and NOT APPLICABLE lines
5. The device proof (a human-run release check)
6. Pitfalls met while building this skill

## 1. What the shipped tests prove

| Test | Proves |
|---|---|
| `sentry-crash-reporter-adapter.test.ts` | nothing starts on creation; one `init` on consent; queued items sent in order on consent and dropped on refusal; the queue keeps the newest 30; a refusal after start closes the SDK for the run; no DSN means never; an SDK failure goes to `onError`, never thrown; the option set (no release/dist, `sendDefaultPii: false`, the rejection-tracker integration, tracing only when sampled, profiles capped by traces); `beforeSend`/`beforeBreadcrumb` scrub |
| `crash-scrubber.test.ts` | every masked pattern, what stays readable (versions, dates, short numbers), sensitive keys at depth, the depth bound on a cyclic value, the breadcrumb allow-list, the event shape after scrubbing, no mutation of the input |
| `crash-forwarder.test.ts` | `render` and `unhandled-rejection` forwarded, `global-handler` never |
| `crash-reporting-root-kit.test.tsx` | the kit forwards only those two; with `fixedCrashConsent(false)` the effects apply a no and nothing is sent; a yes is applied after the effects mount, every change of the source follows, and the route breadcrumb names the pattern (through `renderRouterWithProviders`) |
| `fake-crash-reporter.test.ts` | the fake follows the adapter's consent rules: nothing before consent, the newest 30 kept while waiting, a refusal drops what waited, a refusal after reporting started keeps it off for the run, a refusal before it ever started does not (the adapter test asserts the two queue limits agree) |
| `crash-reporting-config.test.ts` | development never reports, production requires a DSN, malformed DSNs throw, sample rates in range; `readCrashReportingConfig()` reads the bundle's variant and DSN |
| `use-crash-reporting-consent.test.ts` | nothing applied before `isReady`, then the choice and every change |
| `use-route-breadcrumbs.test.tsx` | the breadcrumb names `tasks/[id]`, never `42` (through `renderRouterWithProviders`) |

## 2. Testing app code that reports

- Give the code a fake: the port arrives as a factory argument (the registry hands it to whatever
  reports a handled defect), so the test passes `createFakeCrashReporter()` there. Call `setConsent(true)` on the fake when the test asserts what
  was sent; `sent` and `breadcrumbs` hold what would have left the device.
- Assert on the absence of content: `expect(JSON.stringify(fake.breadcrumbs)).not.toContain(title)`.
- Never `jest.mock('@sentry/react-native')` outside the adapter's test; never import the SDK in a
  test (unit-and-component-tests' `vendor-sdk-import`). The root mock makes any accidental import
  inert.
- A model hook that reports an unexpected handled error: assert the fake received `{ source,
  isFatal: false }` and that the error log recorded it too.

## 3. The checker: rules, causes, fixes

`node ${CLAUDE_SKILL_DIR}/scripts/check-crash-reporting.mjs . [--app-dir <dir>] [--contract <file>]`.
Each `FAIL` line names the file, line, rule and fix.

| Rule | Fails when | Fix |
|---|---|---|
| `sdk-package` | `sentry-expo` is installed | uninstall it; `npx expo install @sentry/react-native` |
| `sdk-import` | a non-test app file other than `<services>/<concern>/sentry-*-adapter.ts` imports `@sentry/*` (subpaths too); the root entry files count as app files (package.json `main` when it names a local file, every root `index.*` and `App.*`) | report through `services.crashReporter` |
| `adapter-single` | no adapter imports the SDK, or two do | one adapter, from the template |
| `init-scope` | `Sentry.init` is missing, runs at module scope, or runs directly in the body of the exported `create*Adapter` factory (also inside an `if`/`try` there) | start it in a function the factory defines that only `setConsent(true)` runs (`startSentry`) |
| `init-options` | the options passed to `init` cannot be read | an object literal, a local const or a local function returning one |
| `pii-default` | `sendDefaultPii: false` is not written | write it |
| `screen-capture` | screenshot, view hierarchy, replay, logs, failed-request capture or the feedback widget is on | remove it |
| `scrub-hooks` | `beforeSend`, `beforeSendTransaction` or `beforeBreadcrumb` is missing or calls no imported scrubber (`beforeSendTransaction` too while tracing is off: turning it on must not open a hole) | use `scrubEvent` / `filterBreadcrumb` |
| `environment-set` | no `environment` | `environment: config.environment` |
| `release-native` | `release` or `dist` in the options | remove them |
| `rejection-tracker` | no `reactNativeErrorHandlersIntegration({ onunhandledrejection: false })` | add it |
| `trace-rate` | a sample-rate literal above the contract cap, or a `tracesSampler` | lower it, or raise the cap with the reviewer |
| `no-wrap` | `Sentry.wrap` or `TouchEventBoundary` | remove; route breadcrumbs through the port |
| `no-user-identity` | the SDK's `setUser(...)` (`Sentry.setUser`, a named import, or `scope.setUser` in the file that imports the SDK) other than `setUser(null)`, or a `setUser` port member; a React state setter or store action named `setUser` is not flagged | remove the SDK call |
| `sink-forwarding` | no `FORWARDED_SOURCES`, or not exactly `render` + `unhandled-rejection` | the template's forwarder |
| `sink-connected` | no root kit sets `forward: createCrashForwarder(...)`, or the kit is defined but the registry never calls `createCrashReportingKit(...)` | copy the root kit template; register it in `src/services/create-root-kits.ts` |
| `capture-recorded` | outside the reporter files, a `captureException(...)` with no error-log `record(...)` before it in the same function: the report would be missing from the local log | record to `ErrorLogPort` first, then report (for the error net, the root sink records and the kit forwards) |
| `consent-applied` | nothing applies the choice (no `useCrashReportingConsent`, the kit's effects); the composition root, the root-kit registry, the root layout, a root entry file or `startApp` applies it; or a literal `setConsent(true)` / `isGranted: true` / `fixedCrashConsent(true)` ignores the saved choice. A `setConsent` call counts only when its receiver names the crash reporter or its argument is a boolean: analytics-and-consent's `analytics.setConsent('granted')` hands nothing to the reporter | the kit with a consent source over the settings field (or `fixedCrashConsent(false)` until the row exists) |
| `consent-default` | the settings default of `crashReportsEnabled` contradicts `consentModel` | align the default or the contract |
| `route-breadcrumbs` | a file that adds breadcrumbs reads `usePathname`, `useLocalSearchParams` or `useGlobalSearchParams` | `useSegments()` patterns |
| `metro-debug-ids` | no Metro config; a `metro.config` that composes the Metro slot (`readMetroKits`) while `scripts/metro/metro-kits.ts` is missing or lists no kit that builds with `getSentryExpoConfig` / `withSentryConfig`; or an own `metro.config` that does not use them | list Sentry's kit (`templates/scripts/metro/metro-kits.ts`), or wrap the own config |
| `config-plugin` | no `@sentry/react-native/expo` entry, or no `organization`/`project` | add them |
| `plugin-auth-token` | `authToken` in the entry, or the config reads `SENTRY_AUTH_TOKEN` | remove; EAS secret |
| `upload-not-disabled` | an upload profile (or a profile it extends) sets a Sentry disable/allow-failure switch to `true` | remove the switch from that profile |
| `optional-deps` | `.npmrc` or a script installs without optional dependencies | remove the flag |
| `ota-sourcemaps` | a script or workflow runs `eas update` (not `update:list`, `update:rollback` or another subcommand) without `sentry-expo-upload-sourcemaps`, or an `.eas/workflows` `type: update` job neither sets `upload_sentry_sourcemaps: true` nor uploads in `after_update` | append the upload; set the job param |
| `token-files` | a committed `.sentryclirc`/`sentry.properties` with a token, or an un-ignored `.env.sentry-build-plugin` | remove, rotate, ignore |
| `contract` | `contracts/crash-reporting.json` is missing or invalid | copy the template, fill the facts |
| `declaration` | a sample rate above 0 without `performance-data` declared | declare it and update the store answers |
| `privacy-sync` | `contracts/privacy.json` (privacy-and-store-declarations) lacks `@sentry/react-native`, or its `collects` types differ from `declarations.collects`, or a row is linked or tracking; SKIP until that file exists | copy the declared types into the privacy contract, not linked, not tracking |

**Heuristic limits** (the checker is a reader of masked text, not a TypeScript parser; review covers
these):

- **Options built by spreads.** Only the keys written in the options literal are read. A key added
  through a spread (`...(isPreview ? { attachScreenshot: true } : {})`, `...extraOptions`) is
  invisible to `pii-default`, `screen-capture`, `release-native` and `trace-rate`. The template's one
  spread, `...tracing`, holds only the sample rates, which `trace-rate` reads where they are written.
  Keep every other option a literal key.
- **Where `init` runs.** `init-scope` knows module scope and the exported factory's own body. An
  init reached through a helper that the factory body calls directly (`startNow()` in the body)
  passes; so does a factory that is not exported as `create*Adapter`.
- **Consent values.** `consent-applied` catches the literal `true`, `fixedCrashConsent(true)` and calls
  inside `startApp`; a
  constant that is always true (`const ALWAYS = true; setConsent(ALWAYS)`) or a call from another
  startup function is not caught. A crash reporter held under a name without "crash" and handed a
  non-boolean expression (`reporter.setConsent(choice === 'yes')`) is not counted as a caller.
- **Recorded first.** `capture-recorded` looks for a `record(` call in the text of the enclosing
  function before the report; a record made by a helper the function calls first is not seen (call
  `errorLog.record` directly beside the report).
- **Workflows.** `.eas/workflows` update jobs are read by indentation; anchors, aliases and flow
  mappings (`{ type: update }`) are not.
- **Entry files.** Only package.json `main` and root `index.*` / `App.*` are read outside `src/`; a
  file the entry imports from another root folder (`boot/sentry.ts`) is not. Keep startup code in
  `src/`.

What the checker reads: app source under `src/` (and a routes folder outside it), the root entry files
(package.json `main` when local, root `index.*` and `App.*`; `no-wrap` and `no-user-identity` apply
there too, because the ESLint vendor ban covers `src/**` only), `app.config.*` or
`app.json`, `metro.config.*`, `eas.json`, `package.json`, `.npmrc`, `.gitignore`,
`.github/workflows/*.yml`, `.eas/workflows/*.yml`, the contract. Installed skills (`.agents/`,
`.claude/`, `skills/`, any folder holding a `SKILL.md`) are never scanned. Layout keys come from
`rn-skills.config.json` through check-lib's `resolveLayout`; the one key this skill reads is
`"crashReportingContract"` (the contract's path).

## 4. Expected SKIP and NOT APPLICABLE lines

- `SKIP eas.json [upload-not-disabled] not yet created (eas-build-and-submit creates it)` while the
  app has no eas.json.
- `NOT APPLICABLE: @sentry/react-native is not in package.json`: the app has no crash reporting.
- `NOT APPLICABLE: @sentry/react-native is installed, but no app code, config plugin, Metro config or
  crash reporting contract uses it yet`: installed ahead of the work. As soon as one of those exists,
  every rule applies. (The library's reference app adopts the kit and prints `RESULT: PASS`.)

## 5. The device proof (a human-run release check)

Jest proves the wiring; only a release build proves the native side (upload, symbolication, the
fatal flush, native crash capture). Before the first store release, and after any change to the
plugin, Metro config or upload switches, the developer (or an agent with the developer's go-ahead,
since it sends data to their Sentry project) runs:

1. A **preview** build with the DSN and token in the preview EAS environment (eas-build-and-submit),
   or a local Release build (ios-simulator-build, android-emulator-build) with `SENTRY_AUTH_TOKEN`
   in the shell.
2. Install it on a **named** device created for the purpose, never "the booted one":

   ```sh
   xcrun simctl create tasks-crash-proof "iPhone 17" <runtime-id>      # prints the UDID
   xcrun simctl boot <udid> && xcrun simctl install <udid> <path/to/App.app>
   xcrun simctl launch <udid> <bundle-id>
   emulator -avd tasks-crash-proof -port 5584 -no-snapshot &            # an AVD created for this; serial emulator-5584
   adb -s emulator-5584 install -r <path/to/app.apk>
   adb -s emulator-5584 shell am start -n <application-id>/.MainActivity
   ```

3. Turn crash reports on in the app's settings; trigger the test-only JavaScript error, a rejection
   and a render error (debug-menu-and-test-hooks); relaunch the app (native and fatal events are sent
   on the next launch).
4. In Sentry: three issues, environment `preview`, release `<id>@<version>+<build>`: the uncaught
   error from Sentry's own handler (mechanism `onerror`), and two tagged `source: unhandled-rejection`
   and `source: render` from the sink; frames in TypeScript source; breadcrumbs show route patterns
   and app events, no console lines, no typed text; no user.
5. Turn crash reports off, trigger again, relaunch: nothing new arrives.
6. Delete the device: `xcrun simctl delete <udid>`; `adb -s emulator-5584 emu kill`.

## 6. Pitfalls met while building this skill

- **The real SDK in Jest leaks a timer.** Importing `@sentry/react-native` 7.11 starts a
  `setInterval`; any suite reaching the adapter left a worker that "failed to exit gracefully". The
  root mock `__mocks__/@sentry/react-native.ts` fixes it for every project.
- **Expo's default Metro config writes a debug ID that the app never reports.** The map has a
  `debugId`, the Hermes bytecode does not: only Sentry's serializer adds the runtime module.
- **The official snippet turns PII on.** Sentry's Expo setup page shows `sendDefaultPii: true`,
  `Sentry.wrap(RootLayout)` and replay sample rates; this library's defaults turn all three off, each
  with its reason above.
- **`eas env:set`, not `env:create`.** eas-cli 24.10 lists `env:set` (create or update); older guides
  name other commands.
- **Lint bans URL literals in tests.** Build URLs from a scheme and the rest (`url('https', ...)`), as
  the shipped tests do.
