# Network layers: proving where the app talks to the network

## Contents

- The two profiles
- The six layers at a glance
- Layer A: source (lint and audit-repo)
- Layer B: the shipped JavaScript bundle
- Layer C: native modules
- Layer D: vendor SDKs (CocoaPods trunk and Gradle)
- Layer E: build configuration
- The runner: npm run audit:network
- Layer F: runtime (network guard and socket sampling)
- Baselines: NEW and STALE findings

## The two profiles

`contracts/privacy.json` `"profile"` says what the app's own code may do on the network. It is a
product decision, recorded once and checked everywhere.

| Profile | First-party requests | Remote URL literals | When |
|---|---|---|---|
| `api-port` (default) | only in the `ApiClient` folder (`src/api/**`, the transport is networking-and-server-state's `fetch-api-client.ts`) plus files listed in `"networkModules"` (a second transport, such as an upload adapter) | `src/config/` (the base URL from `EXPO_PUBLIC_API_URL`, links) and files listed in `"linkFiles"`; never `src/api/` (endpoints are paths on the base URL: networking-and-server-state's `base-url` rule) | the app has a server |
| `offline-only` | none at all; `networkModules` must be empty | only files listed in `"linkFiles"` (store page, privacy policy, `mailto:` links the OS opens) | the app has no server: no account, no sync, no remote config |

`offline-only` also requires `"offline-only"` in `contracts/dependency-policy.json` `"profiles"`
(dependency-management then bans OTA updates, the dev client, NetInfo, RevenueCat, Firebase, crash
reporters, Expo telemetry, push, analytics, web views and HTTP clients at install time),
`updates: { enabled: false }` in `app.config.ts`, and no App Transport Security or cleartext switch.
SDKs that go online by themselves (ads, store purchases) are still allowed in either profile, but
each is declared (references/sdk-inventory.md): the profile is about the app's own code.

Developer tooling (`scripts/`, Expo CLI, npm, EAS CLI) may use the network; the profiles cover what
ships in the app.

## The six layers at a glance

| Layer | Catches | Misses | Runs in |
|---|---|---|---|
| A. Source | first-party `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` (also `globalThis['fetch']()`, `new globalThis.WebSocket()`, a global taken as a value), expo-file-system transfers, imports of a request client (`expo/fetch`, axios, ky, …), remote URL literals, the test-only guard imported outside test code | code that ships without being in `src/`; a URL built at run time and handed to a package | ESLint (typescript-and-lint-rules owns the config) and `audit-repo.mjs` |
| B. JS bundle | every shipped module, first-party or package, that can open a connection or holds a remote URL | native code | `audit-bundle.mjs`, `npm run audit:network` |
| C. Native modules | HTTP stacks, sockets and web views in each autolinked iOS and Android module | binary `.xcframework` and `.aar` files | `npm run audit:network` |
| D. Vendor SDKs | trunk pods and Gradle families no declared SDK brings; pods from `:git`, `:http` or outside the repo | anything already declared | pods: `audit-repo.mjs` (after a prebuild) and `npm run audit:network`; Gradle: only `audit-repo.mjs --gradle-deps` (the runner has no Gradle layer) |
| E. Config | ATS `NSAllowsArbitraryLoads`, Android `usesCleartextTraffic`; offline-only: OTA updates | runtime behaviour | `audit-repo.mjs`, `npm run audit:network` |
| F. Runtime | any socket the app opens while an E2E flow runs | system daemons (StoreKit, Play Billing, push) | e2e-maestro's runner and socket sampler (policy: `contracts/e2e.json` `network`), plus the JS guard in test builds |

No layer alone proves anything: lint misses aliases, regex cannot see inside binaries, the runtime
guard misses native traffic, socket sampling misses system daemons. Together they leave no gap a
release can fall through silently.

## Layer A: source (lint and audit-repo)

The ESLint config (typescript-and-lint-rules) bans the network globals outside `src/api`, URL
literals outside `src/config`, and imports of HTTP clients. `audit-repo.mjs` repeats the checks
without depending on the lint config, so a weakened lint block cannot hide a violation, and it
applies the profile and `contracts/privacy.json` seams. It also reports the forms lint selectors miss:
`globalThis['fetch'](...)`, `new globalThis.WebSocket(...)`, `const Socket = WebSocket`,
`const send = globalThis.fetch`, a destructured global (`const { fetch } = globalThis`,
`const { WebSocket: Ws } = window`), and an import of a request client under any name
(`import { fetch as get } from 'expo/fetch'`; axios, ky, got, node-fetch, cross-fetch, undici,
superagent): the import itself is the finding, because an alias hides every call. Under `api-port`,
networking-and-server-state's `network-call` covers the same imports; under `offline-only` only this
audit does (`expo/fetch` belongs to the `expo` package, which no dependency policy can ban).
expo-file-system transfers (`File.downloadFileAsync`, the legacy `downloadAsync(url, …)`,
`uploadAsync`, `createDownloadResumable`, `createUploadTask`) count as requests too; a no-argument
`downloadAsync()` is expo-asset's copy of a bundled asset.

Limits, on purpose: these are source patterns, not a type checker. A request client re-exported
through the app's own module and called under a new name, a method looked up by a computed string
(`api[name](url)`), the global scope itself passed around (`const g = globalThis; new g.WebSocket(url)`),
a destructuring pattern with a default or a nested pattern, and a URL assembled at run time and
handed to a component (`<Image>` with `config.base + id`) pass layer A. Layer B looks for calls in the
bundle (`fetch(`, `new WebSocket(`), so it misses every aliased form, including
`const send = globalThis.fetch; send(url)` and `const { fetch: f } = globalThis; f(url)`, which only
layer A reports. Layer F sees the socket whatever the shape.

Two shapes the patterns treat specially. Layer A skips a member call (`repo.fetch('task-1')`,
`client?.fetch(id)`) unless the receiver is the global scope (`globalThis.fetch(url)`,
`window.fetch(url)` still fail), and skips a method signature with a typed parameter or an empty
parameter list followed by a type or a body (`fetch(id: string): Task`, `async fetch() {`). An
untyped JavaScript method `{ fetch(id) { … } }` still fails. Layer B reads minified code, where a
member call cannot be told from an aliased global (SDKs call `this.fetch(…)` on a stored
`globalThis.fetch`), so it keeps matching `.fetch(`: do not name a first-party method `fetch`. XML
namespace and schema identifiers (`http://www.w3.org/2000/svg`, `https://json-schema.org/…`) are not
requests and pass every URL pattern; put SVG markup in assets rather than strings anyway. Grow the seams, not the regexes: keep transports in `src/api` and `networkModules`, and
review a new import of `expo/fetch` or a transfer API in code review.

Remote images, fonts and downloads make requests without `fetch`
(`<Image source={{ uri: 'https://…' }} />`, `useFonts({ x: 'https://…' })`), which is why URL
literals count. Bundle the asset or move the URL into config and through the API.

Test files are not scanned: tests use fakes (`createFakeApiClient`, a fake `FetchLike`), never the
network. The walk skips every folder holding a `SKILL.md` (installed skills plant findings on
purpose).

## Layer B: the shipped JavaScript bundle

```sh
npm run export:audit    # APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production expo export --platform ios --platform android --source-maps --output-dir dist-audit
node ${CLAUDE_SKILL_DIR}/scripts/audit-bundle.mjs .
```

The source maps of a release export embed every module's source (`sourcesContent`) and name its
owner. Expo roots first-party sources at the project (`/src/api/fetch-api-client.ts`) and gives
packages their `node_modules` path, so every finding is attributed per module, never by grepping
the raw bundle (Hermes bytecode or minified text). Metro does not tree-shake: an SDK's unused HTTP
client (an IAP server kit, an ads SDK's test IDs) ships in every bundle, so attribution is the only
honest check.

- A first-party module with a finding outside the seams fails at once (`first-party-network`).
  First-party code is never baselined. Its comments are masked first: a JSDoc line that says "never
  calls fetch()" is no request.
- A package finding is covered by an SDK `contracts/privacy.json` declares (whatever it can do), or
  by the `"js"` section of `contracts/network-baseline.json` with its categories and a reason
  (`baseline-new`). Categories: `fetch`, `xhr`, `webSocket`, `eventSource`, `beacon`,
  `fileTransfer`, `remoteUrl`.
- Production only: Google's sample ad publisher outside the ads SDK (`sample-id`), StoreKit test
  code (`storekit-test-code`). The test-only sentinel is app-variants-and-environment's
  `check-variant-bundle`.

Verified on 2026-10-14 against two production exports: the canonical-stack reference app (expo
57.0.26, 3,612 modules over iOS and Android) and a fresh `npx create-expo-app --template
default@sdk-57` app (expo 57.0.29, expo-template-default 57.0.31, 3,109 modules). Package findings
fall exactly in the template baseline (react-native, whatwg-fetch, expo, @expo/metro-runtime,
@expo/devtools, expo-asset, expo-router, expo-linking, expo-image, expo-file-system,
react-native-worklets, react-native-reanimated; each app lacks a few, which are STALE notes;
expo-web-browser is a declared SDK instead, so its findings are covered by the declaration). The fresh app's only first-party finding is the template's demo screen
(`src/app/explore.tsx` links to docs.expo.dev): delete it (`npm run reset-project`) or move the links
into `linkFiles`. Re-verify: `npm run export:audit`, then the command above.

## Layer C: native modules

`network-native-layer.ts` lists every autolinked module of both platforms
(`npx expo-modules-autolinking react-native-config --platform ios|android --json` and
`resolve --platform apple|android --json`) and scans its sources: Swift and Objective-C for
`URLSession`, `NSURLConnection`, WebSocket classes, `CFSocket`/`NWConnection`/`getaddrinfo(` and
`WKWebView`/`SFSafariViewController`/`ASWebAuthenticationSession`; Java and Kotlin for
`HttpURLConnection`/OkHttp, `okhttp3.WebSocket`, `java.net.Socket`, `android.webkit.WebView` and
Custom Tabs. Findings go against the `"native"` baseline section.

Three walk rules, each from a real failure:

- **Resolve packages, never assume their folder.** npm may hoist `react-native` to the repo root
  (always in a multi-package repo): `createRequire(<app>/package.json).resolve('react-native/package.json')`.
- **A module's root is the folder with its package.json.** Autolinking reports the podspec or
  Gradle folder, which is `ios/` or `android/` for many modules.
- **Never follow symlinks.** Workspace links point back into the app and its `ios/Pods`, whose
  header links can dangle.

The template baseline's native section was checked the same day against the fresh default app:
`create-expo-app` ships `expo-image` (`urlSession`, `httpClient`), `@expo/ui` (`httpClient`) and
`expo-web-browser` (`webView`) on day one; the first two have reasoned entries, and expo-web-browser is
a network SDK the app declares (`network-sdk` asks for it), whose declaration covers its findings.

Debug-only modules are left out: Expo marks `expo-dev-launcher` and `expo-dev-menu` `debugOnly`
on Apple (Debug-only pods), and on Android they ship release stubs (`disableInRelease`). Verified
2026-10-14 on expo-dev-client 57.0.19.

## Layer D: vendor SDKs (CocoaPods trunk and Gradle)

`Podfile.lock` separates pods built from `node_modules` (`EXTERNAL SOURCES`, scanned by layer C)
from pods downloaded from the CocoaPods trunk (`SPEC REPOS: trunk:`), which are binaries. Every
trunk pod must be listed in the `"pods"` of a declared SDK (`vendor-pod`; `banned-pod` names the
usual family: Firebase, crash reporting, attribution, purchase servers, push, Facebook, mediation).
An external pod passes only when it comes from a folder inside the repo: a `:git` or `:http`
source, a remote `:podspec` or a `:path` outside the repo bypasses every other layer (`pod-source`).
`ios/` exists only after `npx expo prebuild --platform ios` (Continuous Native Generation keeps it out
of git), so without it the layer prints a SKIP line.

Android has no lockfile of native SDKs. Save the release classpath and pass it:

```sh
npx expo prebuild --platform android
(cd android && ./gradlew :app:dependencies --configuration releaseRuntimeClasspath) > reports/android-deps.txt
node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs . --gradle-deps reports/android-deps.txt
```

Any tracking, analytics, attribution, crash, push or purchase-server group (`com.google.firebase:`,
`io.sentry:`, `com.facebook.android:`, …) that no declared SDK lists in `"maven"` fails
(`vendor-maven`). The npm runner has no Gradle layer: this command is the only Android SDK check, so
run it whenever an Android build is at hand (release, CI with a Gradle step).

The canonical stack brings these groups transitively, and the SDK entries list them:

| Package | Groups in `releaseRuntimeClasspath` | Its `"maven"` |
|---|---|---|
| `expo-notifications` 57.0.21 | `com.google.firebase:firebase-messaging:25.0.1` (FCM, from its `build.gradle`), which pulls `firebase-common`, `firebase-installations`, `firebase-iid-interop`, `firebase-datatransport` and `com.google.android.gms:play-services-cloud-messaging` | `com.google.firebase:`, `com.google.android.gms:play-services-cloud-messaging` |
| `react-native-google-mobile-ads` 17.2.0 | `play-services-ads` 25.4.0, whose `play-services-ads-api` depends on `com.google.android.gms:play-services-measurement-sdk-api` (the measurement API shim, no measurement implementation); `com.google.android.ump:user-messaging-platform` 4.0.0 | `com.google.android.gms:play-services-ads`, `com.google.android.gms:play-services-measurement-sdk-api`, `com.google.android.ump:` |
| `@sentry/react-native` 7.11 | `io.sentry:sentry-android` 8.31.0 and its `io.sentry:` modules | `io.sentry:` |
| `expo-iap` 5.8.0 | `io.github.hyochan.openiap:openiap-google` (Play Billing) | `io.github.hyochan.openiap:` (not a watched family; listed for the record) |

Two families are strict: Firebase Analytics, Crashlytics and Performance
(`com.google.firebase:firebase-analytics`, `-crashlytics`, `-perf`, …) and Google Analytics for
Firebase (`com.google.android.gms:play-services-measurement*`) are covered only by an entry that names
the artifact. A bare group such as `com.google.firebase:` (which push needs) never covers them, so
push cannot hide an analytics SDK; the ads entry names `play-services-measurement-sdk-api` for that
reason. The fixture `tests/bases/repo/android-deps.txt` is an excerpt modelled on these
`build.gradle` declarations and POMs (transitive versions vary by resolution), not a saved Gradle run.

## Layer E: build configuration

- No `NSAllowsArbitraryLoads: true` and no Android `usesCleartextTraffic: true` in the production
  config. Prebuild writes `NSAllowsArbitraryLoads` false and `NSAllowsLocalNetworking` true
  (verified in expo-template-bare-minimum 57.0.30, 2026-10-14); the template's cleartext switch lives
  only in its debug manifests (Metro). Under `api-port` networking-and-server-state's `cleartext`
  rule owns the source check; `audit-repo.mjs` checks it for `offline-only`, the npm runner for both.
- `offline-only`: `updates.enabled` is `false` and no `expo-updates` plugin.
- **Trap:** `npx expo config --type introspect` without an `ios/` folder shows a placeholder
  Info.plist with `NSAllowsArbitraryLoads: true` and a localhost exception (from
  `@expo/config-plugins`' `withIosBaseMods`), which prebuild never writes. A native-config snapshot
  taken that way shows the placeholder too. Judge ATS from `--type prebuild`, the prebuilt
  `ios/<App>/Info.plist` or the built app.

## The runner: npm run audit:network

`scripts/audit/audit-network.ts` (template) runs layers B to E for the production variant (layer D:
pods only; Gradle stays with `audit-repo.mjs --gradle-deps`): it
exports both platforms into `dist-audit/` (the same export `npm run audit:licenses` reads; pass
`--skip-export` to reuse one), attributes the JavaScript, scans native modules, reads
`expo config --type prebuild`, and reads `ios/Podfile.lock` when a prebuild made one (otherwise a
`SKIPPED pods layer` note: Linux CI, a fresh clone). Findings of a declared SDK are covered in the JS
and native layers alike; STALE baseline entries are notes. Wire it in `package.json`
(`"audit:network": "node scripts/audit/audit-network.ts"`) and run it in CI and before every
release (quality-gates decides where).

## Layer F: runtime (network guard and socket sampling)

Both measurements run on a release build of a testing variant (`preview`) with ads off: ads and
development builds legitimately open sockets (a dev client talks to Metro), so they prove nothing.
This skill decides the policy; e2e-maestro owns the runner and the sampler.

1. **The policy** is `contracts/e2e.json` `"network"` (e2e-maestro's contract), set from the profile
   (`runtime-proof` in `audit-repo.mjs`; SKIP until e2e-maestro creates the file):

   | Profile | `network.mode` | `allowHosts` |
   |---|---|---|
   | `offline-only` | `"offline-only"`: any peer that is not loopback fails | none |
   | `api-port` | `"allowlist"` (or `"offline-only"` when E2E runs on a fake API) | the test build's API host, plus a crash or analytics host only if the test build enables that SDK |

   `"off"` fails here: it is a run without the proof this skill's definition of done needs.
2. **The JS network guard** (`src/services/test-hooks/network-guard.ts`, test builds only):
   replaces `fetch`, `XMLHttpRequest#open` and `WebSocket` with stubs that count and block every
   JavaScript request except `allowedHosts` (the same hosts as `allowHosts`) and a development
   build's own Metro on loopback (`localhost`, `127.0.0.1`, `[::1]`, the Android emulator's
   `10.0.2.2`). debug-menu-and-test-hooks' test-only entry does not carry it, so the app wires it
   by hand, in two places:

   ```ts
   // src/test-only-entry.ts (debug-menu-and-test-hooks' file): one more re-export
   export { installNetworkGuard } from '@/services/test-hooks/network-guard';
   ```

   ```ts
   // src/services/test-hooks/install-network-guard.ts: a side-effect module that src/app/_layout.tsx
   // imports right after the error net (app-startup-and-bootstrap keeps the error net first), so the
   // guard is in place before any module requests. TEST_ONLY is null in production: nothing runs.
   import { TEST_ONLY } from '@/test-only';

   TEST_ONLY?.installNetworkGuard(globalThis, {
     // The same hosts as contracts/e2e.json allowHosts (the test build's API host); [] offline-only.
     allowedHosts: [__TEST_API_HOST__],
     // Send each blocked attempt to the error log, so a flow can assert zero attempts.
     onAttempt: (attempt) => { /* the app's error log */ },
     isDev: __DEV__,
   });
   ```

   It cannot see native SDK traffic. `audit-repo.mjs` fails an import of it outside test-only code
   (`network-guard-import`): the entry, `src/services/test-hooks/` and `src/features/debug/` only.
3. **Socket sampling** (e2e-maestro's `scripts/e2e/sample-sockets.ts`, one process per named device,
   started by its runner before `maestro --device <id> test` and stopped after). What it measures
   (the Android commands verified 2026-10-14 on an API 35 emulator):
   - iOS simulator: the app is a macOS process, found with `pgrep -f 'Devices/<udid>/.*\.app/<App>( |$)'`
     (any bundle folder: Maestro's `clearState` reinstalls the app as `<bundle id>-<timestamp>.app`;
     only that simulator, because other sessions run the same app with ads on), then
     `lsof -nP -i -a -p <pid>` (no sudo for simulator processes).
   - Android emulator: the app's uid from `adb -s <serial> shell pm list packages -U <applicationId>`,
     then its established TCP peers from `adb -s <serial> shell cat /proc/net/tcp /proc/net/tcp6`
     (state `01`, the uid column; addresses are little-endian hex words). Both work from the shell uid
     without root.
   - A peer the policy does not allow is a line in the report and fails the run. An empty report is
     a proof only from a sampler that kept sampling to the end and found the app at least once; a
     sampler that never started, stopped early or never saw the app proves nothing, so the runner
     must check that, not just the report.

Store purchases, Play Billing and push run in system daemons and stay invisible to both, by design.
iOS simulators have no airplane mode: the debug "simulate offline" switch (debug-menu-and-test-hooks)
plus these measurements are the offline test; on Android also `adb -s <serial> shell svc wifi disable`
and `svc data disable`.

## Baselines: NEW and STALE findings

- `contracts/network-baseline.json` has a `"js"` and a `"native"` section; every entry names its
  categories and why the app cannot reach that code. The template holds what a fresh
  `create-expo-app --template default@sdk-57` app and the canonical stack ship (verified
  2026-10-14); an app adds entries for its own packages.
- A `NEW` finding fails. Find out why the package can connect. If the app uses it to go online, it
  is an SDK: declare it in `contracts/privacy.json` (sdk-inventory.md); the declaration covers its
  findings in `audit-bundle.mjs` and both runner layers, so it gets no baseline entry. In
  `audit-bundle.mjs` it also covers the packages the SDK installs (its dependencies and optional
  dependencies in `node_modules`, followed recursively, never its peers): `@sentry/react-native`
  covers `@sentry/core`, `@sentry/browser` and `@sentry-internal/*`. If the app
  never reaches that code, add an entry with the reason, commit it with a `Gate-Change:` trailer and
  stop for the reviewer's approval before pushing. Otherwise remove the package.
- The trailer is enforced only for gated paths: add `contracts/network-baseline.json` and
  `contracts/privacy.json` to `quality-gates.json` `gatedPaths` (quality-gates owns the file;
  `gated-paths` in `audit-repo.mjs` fails until both are covered, SKIP until the file exists).
- A `STALE` entry is a note: delete it when the package has left.
- Never baseline first-party code, never widen a category "to get green".
