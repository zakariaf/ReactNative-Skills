# Testing subscriptions: the routes, what each proves, and the human runs

Subscriptions have more states than a one-time unlock (renewal, cancellation, grace, billing retry,
refund, product change, transfer), and most of them happen on the store's clock. Each route below
proves a different layer; none replaces the others. Facts read on 2026-10-21 on RevenueCat's "Apple
App Store & TestFlight testing" and "Test Store" pages, the Expo installation page, and
developer.android.com/google/play/billing/test (re-verify by reading those pages).

## Contents

- The routes at a glance
- Tier 1: Jest (every commit)
- Expo Go: Preview API Mode
- RevenueCat Test Store
- StoreKit configuration file (iOS, Xcode)
- App Store sandbox and TestFlight
- Google Play license testers
- The webhook end to end
- The release checklist
- Human steps

## The routes at a glance

| Route | Runs | Proves | Cannot prove |
|---|---|---|---|
| Jest with the fake port and fake webhook deps | every commit | paywall states, identity sequence, error mapping, every webhook scenario, resolvePlan at boundaries | the native SDK, the stores |
| Expo Go (Preview API Mode) | while building screens | screens render, flows do not crash | any purchase |
| Test Store (RevenueCat key for its synthetic store) | development builds | the SDK end to end, CustomerInfo, entitlements, dashboard, sandbox webhooks | store sheets, real renewals |
| StoreKit configuration file | iOS app run from Xcode | sheets without App Store Connect, fast renewals, Ask to Buy, failures | anything RevenueCat cannot validate without the certificate |
| App Store sandbox / TestFlight | device builds | the real sheets, renewals on Apple's clock, refunds, restore on a second device | production money |
| Play license testers | internal testing track or a build with the release package name | Play Billing, test cards, grace period and account hold | iOS |

## Tier 1: Jest (every commit)

The templates ship their tests: `fake-subscription.test.ts`, `subscription-identity.test.ts` (configure
once, logIn on change, logOut on sign-out, nothing sold while a logIn is pending or failed, calls in
order), `subscription-price-text.test.ts`, `revenuecat-subscription-adapter.test.ts` (the root mock
`__mocks__/react-native-purchases.ts` re-exports the real `PURCHASES_ERROR_CODE` and `PACKAGE_TYPE`),
and on the server `revenuecat-webhook-handler.test.ts` (initial purchase, renewal, cancellation while
paid, uncancellation, refund, billing issue in grace, billing retry without grace, expiration, product
change, never subscribed, bad or missing Authorization, a retried event id, an expiration arriving
after a renewal, a transfer, a REST failure answered 500 with the claim released, TEST and anonymous
events, a malformed body), `entitlement-doc.test.ts` (every status at, before and after its
boundary; malformed records free) and `revenuecat-rest-subscriber-api.test.ts`.

```sh
npx jest src/services/subscription --ci --maxWorkers=2     # the app (its jest.config.js covers src/, scripts/, plugins/, test/)
npx jest src/subscriptions --ci                            # inside the server package (functions/ with Firebase)
```

The server tests are plain TypeScript with no React Native: any Jest 29 setup with a TypeScript
transform runs them (verified 2026-10-21 with jest 29.7.0 and babel-jest, 35 tests).

Replace the fixture bodies in `webhook-fixtures.ts` with recorded sandbox payloads once the app has
some (remove receipts, prices and attributes first).

## Expo Go: Preview API Mode

react-native-purchases 10.13.0 detects Expo Go and answers every call with JavaScript mock data
("real purchases will not function in this mode"). Use it for layout only; never record a purchase
there as evidence.

## RevenueCat Test Store

- Created in the RevenueCat project (Apps and providers -> Test configuration); it has its own API
  key. Supported from react-native-purchases 9.5.4.
- Test purchases update CustomerInfo and entitlements and appear in the dashboard as sandbox data.
- **The SDK crashes a release build on purpose when it finds a Test Store key**, and TestFlight and
  every Play testing track are release builds. Select the key per variant (app-variants-and-
  environment): the Test Store key only in the development variant, never in preview or production.
- Whether webhooks fire for Test Store purchases is not stated on the page (not verified); test the
  webhook with sandbox purchases.

## StoreKit configuration file (iOS, Xcode)

- Create `<Name>.storekit` in Xcode with the subscription group and both products, using the contract's
  product ids and Family Sharing value. Products must also exist in RevenueCat (not in App Store
  Connect).
- In Xcode: Editor -> Save Public Certificate, then upload it in RevenueCat (Project Settings -> Apps
  -> the iOS app -> StoreKit testing framework). For subscription offers, also export the
  Subscription Offers Key (.p8) from Xcode and upload it.
- Duplicate the scheme and set the StoreKit configuration on the copy. "StoreKit testing only works
  if you are running your app directly through Xcode": with Expo, run `npx expo prebuild`, open
  `ios/<App>.xcworkspace` and run the duplicated scheme on a simulator of your own
  (`<project>-storekit`), never "the booted one". iOS 14+ simulators work.
- Cancellations and refunds made in Xcode's Manage Transactions window are not in the receipt and do
  not reach the dashboard; the SDK removes the entitlement after an app restart. Test refunds on the
  server through sandbox or the Jest scenarios.
- Keep `*.storekit` out of store builds (in-app-purchases' harness-isolation idea): it lives in a
  tooling folder and never ships.

## App Store sandbox and TestFlight

- Sandbox testers: App Store Connect -> Users and Access -> Sandbox Testers (a real, verifiable
  email; set the storefront to test a territory).
- Accelerated renewals in sandbox: 1 month renews every **5 minutes**, 1 year every **1 hour**, at
  most **12 renewals a day**; the dashboard may miss some. TestFlight renews every **24 hours**
  whatever the period (since December 2024).
- Refunds in sandbox: request one from the device's sandbox account settings or with StoreKit's
  refund request; watch for a `CANCELLATION` with `cancel_reason: CUSTOMER_SUPPORT`.

## Google Play license testers

- Play Console -> Settings -> License testing; the build must use the release package name and have
  been uploaded to a testing track once. RevenueCat needs the Play service credentials (a dashboard
  step) to validate Android purchases.
- Test renewals: 1 week and 1 month renew every **5 minutes**, 3 months every 10, 6 months every 15,
  1 year every **30 minutes**; a test subscription renews at most **6 times**. Grace period lasts
  **5 minutes**, account hold **10 minutes** (developer.android.com, read 2026-10-21; Google calls the
  times approximate).
- Test instruments: "Test card, always approves" / "always declines" (also worded "Test instrument,
  ..."), "Slow test card, approves after a few minutes" / "declines after a few minutes" (pending), and
  "Test card, approves then charges back".
- Devices are named: `adb -s <serial> install -r <apk>`, `adb -s <serial> logcat -s ReactNativeJS`.

## The webhook end to end

1. Deploy to a staging backend; set the webhook URL and the Authorization value in the RevenueCat
   project's staging (or sandbox-only) integration.
2. Send the dashboard's test event: expect a `test` log line and no write.
3. Send it again with a wrong value (a curl against the endpoint): expect 401.
4. Buy in sandbox: expect `INITIAL_PURCHASE`, a written record with `isSandbox: true`, and the quota
   unlocked; then cancel, let it expire (5 minutes for monthly in sandbox), refund, restore on a second
   device signed into the same account, and restore after a reinstall into a new user id (watch for
   `TRANSFER`). Record each event, the record's status and the gate's answer.

## The release checklist

- [ ] Jest Tier 1 passes; `check-revenuecat.mjs` prints `RESULT: PASS`.
- [ ] No Test Store key in any preview or production variant; no `*.storekit` in the store build.
- [ ] Sandbox runs: buy monthly, buy annual, upgrade, cancel then expire, refund, billing issue
      (Play: test card declines at renewal), restore on a second device, Ask to Buy pending.
- [ ] The paywall shows the store's price strings, Restore, Terms, Privacy and the auto-renew notice
      (in-app-purchases' paywall rules and App Review guideline 3.1.2).

## Human steps

Ask in plain words and wait; never submit or print a key:

- Paid Apps Agreement, tax and banking (App Store Connect); payments profile (Play Console).
- The subscription group, products, prices and Family Sharing in both consoles; the RevenueCat
  project, apps, entitlement, offering and packages; the App Store Connect shared secret or In-App
  Purchase key and the Play service credentials uploaded to RevenueCat.
- The restore behavior setting (transfer or keep).
- The webhook URL and Authorization value in the dashboard; the server secrets.
- The sandbox and TestFlight runs above, on real devices.
