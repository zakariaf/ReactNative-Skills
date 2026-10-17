# Testing purchases: three tiers, two stores

## Contents

- Tier 1: Jest (every commit)
- Tier 2, iOS: the hosted-XCTest StoreKit harness
- Tier 2 files and scenarios
- Running the StoreKit harness by hand
- What the harness runs taught
- Tier 2, Android: license testers
- Release-day order
- Gotchas
- Tier 3: humans on TestFlight and a Play testing track
- Keeping the harness out of shipped builds

## Tier 1: Jest (every commit)

The reducers, the evidence rule, the service and the store price text are tested without native code:

| Test file | Proves |
|---|---|
| `src/stores/paywall/paywall-reducer.test.ts` | every cases-table rule; every paywall view is reachable; the thank-you once; a repeated failure ignored; the four notices, the restored one once |
| `src/stores/paywall/paywall-transitions.test.ts` | BUY only from a quiet page with a price; each failure while purchasing, a repeat ignored; the thank-you only for a buyer; restore outcomes, never "nothing to restore" for an owner |
| `src/stores/paywall/paywall-store.test.ts` | the flow moves through the reducer; a no-op publishes nothing |
| `src/stores/premium/premium-reducer.test.ts` | the entitlement cases table; no revoke without a positive date (property); a second grant changes nothing (property) |
| `src/stores/premium/premium-store.test.ts` | hydration; saved before published; a failed save publishes nothing; a held grant writes nothing; dated and undated revokes; reload |
| `src/stores/premium/purchase-stores-context.test.tsx` | both stores reach subscribers; the hooks throw without the provider |
| `src/services/purchase/entitlement-evidence.test.ts` | absence -> `unknown`; refund -> `revoked`; a newer purchase after a refund -> `owned`; pending and other products ignored |
| `src/services/purchase/premium-service.test.ts` | Premium is on disk before the transaction is finished; a refused save leaves it open (`unsaved`); store unavailable (no product, or no price text); an owner never hears "nothing to restore"; a failed sync is "couldn't restore"; the launch re-check keeps Premium; a refund revokes with its date; a refused BUY asks nothing; an unacknowledged Android purchase is finished once saved, never while the save fails |
| `src/services/purchase/connectivity-gated-purchase.test.ts` | offline nothing reaches the store; online every call passes; `shouldReloadStore` never reloads mid-flow |
| `src/services/purchase/connect-premium-reloads.test.ts` | the price loads after an offline start; a refund is revoked once online; the foreground re-check; nothing reloads mid-purchase; the unsubscribe |
| `src/services/purchase/store-price-text.test.ts` | the store's `displayPrice` unchanged (never rebuilt from the double, digits and marks kept); null without text |
| `src/stores/premium/upsell-line.test.ts` (optional) | the upsell line at most once per local day, never for an owner, never without a store price |
| `src/services/purchase/fake-purchase.test.ts` | the fake answers and logs like the port |
| `test/sqlite/sqlite-entitlement-repository.test.ts` | real SQL through the app's open path: save, overwrite, reopen, survive "Delete all my data", refuse an invalid entitlement, log an unreadable row |
| `scripts/asc/premium-iap-payloads.test.ts`, `scripts/storekit/busy-note.test.ts` | the App Store Connect bodies and contract parsing; the busy-Mac note |

The root mock `__mocks__/expo-iap.ts` (canonical, unit-and-component-tests' policy) exports `jest.fn()`s
for the functions the adapter imports and re-exports the real `ErrorCode` from `expo-iap/build/types.js`
(no native code); the banned server APIs are deliberately not mocked. Service tests use
`test/purchase/create-premium-test-deps.ts`: the real premium and paywall stores over a fake store and
a fake entitlement repository. `flushMicrotasks` lets listener-driven work finish.

`check-purchase-behaviour.mjs` runs the same rules against the app's real modules, independently of the
Jest files, and runs the real adapter against a scripted expo-iap stand-in.

## Tier 2, iOS: the hosted-XCTest StoreKit harness

Before each release and after each expo-iap upgrade. What was found (Xcode 26.6, iOS 26.5 simulator):

- `SKTestSession` created in an XCUITest runner does not control the app under test, and a StoreKit
  configuration referenced from the scheme is not applied by `xcodebuild test`.
- A hosted unit-test bundle (`TEST_HOST` = the app) that creates
  `SKTestSession(configurationFileNamed: "Premium")` inside the app process arms the simulator's
  StoreKit test environment for that bundle id. The setting persists on that simulator, so the app
  launched afterwards (by `xcrun simctl launch` or Maestro) buys from the local `.storekit` file.
- The app must carry `get-task-allow`. Without it storekitd logs "not installed for development",
  `SKTestSession` logs `SKInternalErrorDomain Code=3`, and products come back empty, silently.
- Verified with a React Native app on expo-iap 5.8.0, in a Release simulator build and in a Debug build
  with Metro: the product with the configured price (as a binary double); a purchase without a dialog
  -> `purchased` -> `finishTransaction`; Ask to Buy -> `deferred-payment` (rejection + listener) ->
  approve -> the next launch received the purchase; refund -> the next launch saw `revocationDateIOS`
  in `Transaction.all` and an empty active list, with no listener event; fail mode -> code `unknown`;
  `restorePurchases` after a purchase -> success with the purchase listed.
- Not testable here: restore after a reinstall (uninstalling cleared the test transactions) and a
  user-cancelled sheet (dialogs are disabled). Tier 1 and Tier 3 cover both.

## Tier 2 files and scenarios

In `scripts/storekit/` (templates in this skill):

| File | Role |
|---|---|
| `Premium.storekit` | StoreKit configuration v2.0: one NonConsumable with the contract's product id, price point (`displayPrice`), Family Sharing and storefront (`check-purchases` holds them to the contract) |
| `storekit-harness.entitlements` | `get-task-allow = true`, referenced by the Debug configuration of a harness build only |
| `ArmTests.swift` | hosted tests: `testArmDefault`, `testArmAskToBuy`, `testArmFail`, `testApproveAll`, `testRefundAll` |
| `add-harness.rb` | adds the `StoreKitHarness` unit-test target to a freshly prebuilt project with the `xcodeproj` gem that ships with CocoaPods (idempotent; `PRODUCT_NAME = $(TARGET_NAME)` avoids "Multiple commands produce" for the `.xctest` in `PlugIns`; Debug-only entitlement) |
| `busy-note.ts` (+ test) | the note printed before the run and after a failed one when the 1-minute load average is above twice the cores |
| `storekit-harness.ts` | the runner: a fresh prebuild of the chosen variant, the harness files and target, a Debug `build-for-testing` against this run's own Metro port (`RCT_METRO_PORT`), Metro on that port, then per scenario: arm, run one Maestro flow through `maestroGlobalArgs` (the UDID and a free driver port for each flow) |

The flows live in `.maestro/storekit/` (declare the folder in naming-conventions' `contracts/naming.json`
`extraE2eFolders`, so the normal E2E run never picks them up) and call e2e-maestro's
`.maestro/subflows/debug-setup.yaml`, which opens the test-build debug link `<scheme>://debug/setup?<query>`
and waits for the screen root. debug-menu-and-test-hooks' registry ships `offline=1` but not the
purchase parameters: the app adds `premium=0|1` and the `paywall` value of `open=` (the screen
parameter; the contract refuses `screen`) to its registry (`src/features/debug/debug-links.ts` and
`contracts/debug-links.json`) with a test-only handler that
calls `grantPremium` / `revokePremium`, as examples/debug-premium-link.ts shows. Without them every
flow below fails at its first debug link (`debug-link-unknown-param premium`). Build the harness from a variant whose ads are off, so the flows see paywall states, not
banners.

In the runner's order (the refund needs the purchase, the approval the pending one):

| Flow | Arm | Debug query and steps | Expected |
|---|---|---|---|
| `01-buy.yaml` | `testArmDefault` | `premium=0&open=paywall`, tap `paywall.buy-button` | `paywall.state.success` |
| `02-refund-relaunch.yaml` | `testRefundAll` | relaunch, `open=paywall` | `paywall.buy-button` (Premium off after the launch re-check; waits up to 60 s) |
| `03-ask-to-buy.yaml` | `testArmAskToBuy` | `premium=0&open=paywall`, tap BUY | `paywall.state.pending` |
| `04-approval-relaunch.yaml` | `testApproveAll` | relaunch, `open=paywall` | `paywall.state.owned` without a tap (waits up to 60 s) |
| `05-restore.yaml` | `testArmDefault` | buy, `premium=0` again, tap `paywall.restore-button` | `paywall.state.owned` |
| `06-failure.yaml` | `testArmFail` | `premium=0&open=paywall`, tap BUY | `paywall.state.error` |
| `07-store-unavailable.yaml` | none | `premium=0&offline=1&open=paywall` | `paywall.state.unavailable` |

Flow 07 works only because the port is gated by `withConnectivity` and the simulated-offline switch
notifies ConnectivityPort subscribers: the armed test store itself is always reachable.

The relaunch flows start with `- launchApp` (Maestro stops the app first) and pass only `open=paywall`,
so the saved Premium from the previous flow is what the re-check must change. Never use
`launchApp: { clearState: true }` there: uninstalling cleared the test transactions.

## Running the StoreKit harness by hand

```sh
UDID=$(xcrun simctl create <project>-storekit "iPhone 17 Pro" com.apple.CoreSimulator.SimRuntime.iOS-26-5)
xcrun simctl boot "$UDID"
node scripts/storekit/storekit-harness.ts --device "$UDID" --variant development
xcrun simctl delete "$UDID"                               # the armed test store persists per simulator
```

The runner picks a free Maestro driver port for every flow and one free Metro port for the run;
`--driver-port <n>` and `--metro-port <n>` pin them. It refuses a non-UDID `--device` or a bad port
before it builds anything. Every Maestro call is `maestro --device <udid> --driver-host-port <port>
test <flow>` and its log line names both: a per-command `--udid` alone and the default driver port 7001
let a call reach whichever simulator's XCTest driver already listens there, and the default Metro port
8081 would load another session's bundle. `MAESTRO_BIN` points at e2e-maestro's pinned install
(`tools/maestro/bin/maestro`, written by its `scripts/e2e/install-maestro.sh`).

The equivalent steps, for debugging one arm:

```sh
# after the prebuild, the harness files and add-harness.rb:
xcodebuild build-for-testing -workspace ios/<App>.xcworkspace -scheme <App> \
  -configuration Debug -sdk iphonesimulator -destination id=$UDID -derivedDataPath build/storekit
CI=1 npx expo start --port <metro port> &                 # a Debug build loads JS from Metro
xcodebuild test-without-building -workspace ios/<App>.xcworkspace -scheme <App> \
  -configuration Debug -destination id=$UDID -derivedDataPath build/storekit \
  -only-testing:StoreKitHarness/ArmTests/testArmDefault
xcrun simctl launch "$UDID" <bundle id>
xcrun simctl spawn "$UDID" log show --last 2m --info --debug --style compact \
  --predicate 'eventMessage CONTAINS "TransactionQuery"'
```

## What the harness runs taught

| Finding | Cause and fix |
|---|---|
| 5 of 7 flows failed in the first run | the test build's network guard blocked Metro's HMR websocket and LogBox covered the app: a Debug build must reach its own Metro on loopback (e2e-maestro's guard allows loopback in a `__DEV__` build) |
| The refund flow kept Premium on | the launch re-check ran before the first network report, saw the store as unavailable and kept Premium; the online reload never re-checked. Fixed: the online reload is followed by `recheckPremium` (Jest: connect-premium-reloads.test.ts; checker rule `store-reloads`) |
| The refund flow failed with a correct app | the 15 s wait ended 2.6 s before the revocation: StoreKit answered the launch re-check only after a 28 s transaction-cache sync. Fixed: 60 s waits in both relaunch flows (`harness-relaunch-wait`) |
| 5 of 7 flows timed out on a busy Mac | not the app: at a load average of 450 to 630 on 12 cores StoreKit's test store took 26 to 173 s per request. The runner prints the busy note; rerun on a fresh simulator once the load is below twice the cores |
| A hierarchy call answered from another session's simulator | the per-command `--udid` with the shared default driver port. Fixed: `maestroGlobalArgs` with a free driver port for each flow (`harness-maestro`) |
| 7 of 7 passed | each flow on its own driver port, Metro on its own port, a fresh simulator, deleted afterwards, then `npx expo prebuild --platform ios --clean` (no harness target and no `.storekit` left) |

## Tier 2, Android: license testers

Play Billing has no local test store like a StoreKit file. Google's testing guide (read on 2026-10-10;
not run on an emulator for this skill):

- **License testers** (Play Console -> Settings -> License testing) can buy in a sideloaded or debug
  build, without a store upload, as long as the **package name matches the app configured in Play
  Console** and the device's Google account is a license tester. A dev variant with its own
  `applicationId` cannot buy the release product: build the variant that uses the release package name
  (or an internal-testing build) for this run.
- The product must exist and be active in Play Console, and the app must have been uploaded to a track
  once (an internal testing track works; it can take hours before testers see it).
- License testers pay with Google's test instruments. developer.android.com/google/play/billing/test
  (read on 2026-10-10) names them both ways: "Test instrument, always approves" / "Test instrument,
  always declines" and "Test card, always approves" / "Test card, always declines" (the page uses the
  card wording in its subscription section), plus "Slow test card, approves after a few minutes" and
  "Slow test card, declines after a few minutes" (pending purchases) and "Test card, approves then
  charges back". Pick the entry whose text the purchase dialog shows; the steps below name the card
  wording.
- An unacknowledged license-tester purchase is refunded after **3 minutes** (3 days for real users),
  which makes the unfinished-purchase path testable in a session.
- **Play Billing Lab** (an app from Google) changes the Play country and other test settings for the
  tester account; its settings expire after 2 hours. Clear the Play Store cache after a change.
- Drive the device by its serial only: `adb -s <serial> install -r <apk>`, `adb -s <serial> logcat -s
  ReactNativeJS`; an emulator is started by AVD name (`emulator -avd <project>-billing`), and a Maestro
  run gets `--device <serial>` like every other run.

The Android run, by hand, on a device or emulator with Google Play and a license-tester account:

1. Buy with "Test card, always approves": the thank-you, every locked feature opens, the purchase is acknowledged
   (it stays after 3 minutes).
2. Buy with "Test card, always declines": the error state, nothing charged.
3. Buy with "Slow test card, approves after a few minutes": the pending state; minutes later the
   purchase arrives and Premium turns on without a tap. With "Slow test card, declines after a few
   minutes": restart,
   Premium stays off.
4. Force a refused save (a test-only switch, or fill the disk on an emulator), buy, then fix it and
   relaunch: the re-check finishes the purchase before the 3-minute refund.
5. Clear the app's data, open the paywall, tap Restore: Premium returns.
6. Refund and revoke the test order in Play Console (Order management): Premium stays on the device
   without the server profile; with it, the server's dated revocation turns it off.

## Release-day order

E2E, the StoreKit harness and the store build share `ios/`, and the harness leaves a Debug project
with its test target, `Premium.storekit` and the Debug `get-task-allow` in it. On a release day:

1. The E2E evidence run (e2e-maestro: a clean prebuild and a Release test build).
2. The StoreKit harness on its own simulator (its fresh prebuild replaces `ios/`).
3. `xcrun simctl delete <that udid>`: the armed test store persists per simulator.
4. `npx expo prebuild --platform ios --clean` before any local Release or store build (EAS Build starts
   from a clean checkout and never sees the harness); the store-artifact gate still checks the IPA.
5. The Android license-tester run on the release package name.

## Gotchas

- `failTransactionsEnabled = false` alone did not leave fail mode; `testArmDefault` calls
  `resetToDefaultState()` for that.
- `failTransactionsEnabled` is deprecated since iOS 17 ("Use simulatedError(forAPI:)"); Xcode warns but
  it still worked on iOS 26.5. If it stops working, `testArmFail` becomes
  `try await s.setSimulatedError(.generic(.unknown), forAPI: .purchase)` (not verified).
- Once, after a reinstall, the simulated "Sign in with Apple Account ... [Environment: Xcode]" alert
  appeared during a StoreKit call; Maestro `tapOn: "OK"` (or `"Cancel"`) dismisses it.
- A relaunch flow failing on `paywall.buy-button` (flow 02) or `paywall.state.owned` (flow 04) while the
  screen shows the previous state usually waited too little: read the simulator log for
  `TransactionQuery(kind: all` and the next `Finished iterating transaction batches`; the gap is the
  sync. Keep the 60 s wait and rerun on a fresh simulator; only a state still wrong after 60 s is a bug.
- Maestro 2.10 has `--include-tags`/`--exclude-tags`, not `--tags`; `JAVA_HOME` must point at Java 17.
- Product metadata changes can take up to an hour to reach the App Store sandbox and several hours to
  reach Play testers.

## Tier 3: humans on TestFlight and a Play testing track

Once per app and after an expo-iap upgrade (a human step; explain it in plain words and wait):

1. **iOS, TestFlight build (sandbox, not charged):** buy, check the locked features open; delete and
   reinstall, tap Restore, Premium returns; start a purchase and cancel it, the page returns quietly.
2. **Android, internal testing track with a license tester:** the same three steps, plus a slow-card
   pending purchase.

This is the only test of the real purchase sheets, the account prompts and restore after a reinstall.

## Keeping the harness out of shipped builds

Harness builds are Debug simulator builds from a separate prebuild and are never uploaded. The next
local build starts with `npx expo prebuild --platform ios --clean`, which removes the harness target, the
`.storekit` file and the Debug entitlement; EAS builds never contain them. The store-artifact gate on
the exported IPA (ios-release-testflight) still asserts no `*.storekit`, no `*.xctest` and no
`get-task-allow`; `check-purchases` keeps them out of the repository's app folders.
