# react-native-purchases: versions, Expo, the port and the adapter

What the client side needs: the verified versions and how they install in an Expo SDK 57 app, how the
SDK runs in Expo Go and in a development build, the identity rules, the SubscriptionPort and the
adapter's facts, the error-code table, the customer info listener and RevenueCat's own paywall UI.

## Contents

- Verified facts (dated, with re-verify commands)
- Install in an Expo app
- Expo Go, development builds and the web
- Identity: the backend user id is the app user id
- SubscriptionPort and the adapter
- Error codes -> failure kinds
- The customer info listener
- Prices
- RevenueCat Paywalls (react-native-purchases-ui)
- What in-app-purchases still owns
- When multi-package

## Verified facts (dated, with re-verify commands)

| Fact | Value | Verified | Re-verify |
|---|---|---|---|
| Latest `react-native-purchases` | 10.15.0, published 2026-10-19 | 2026-10-21 | `npm view react-native-purchases version time --json` |
| Version to pin under the 7-day release-age policy | **10.13.0** (published 2026-10-12; 10.13.1, 10.14.0 and 10.15.0 were younger than 7 days) | 2026-10-21 | the same command; pick the newest version at least 7 days old |
| Peer dependencies of 10.13.0 | `react >= 16.6.3`, `react-native >= 0.73.0`, `react-native-web *` | 2026-10-21 | `npm view react-native-purchases@10.13.0 peerDependencies --json` |
| Its internal packages | `@revenuecat/purchases-typescript-internal` 19.11.0, `@revenuecat/purchases-js-hybrid-mappings` 19.11.0 (installed with it) | 2026-10-21 | `npm view react-native-purchases@10.13.0 dependencies --json` |
| `react-native-purchases-ui` | same version line; 10.13.0 peers on `react-native-purchases` **exactly** 10.13.0 | 2026-10-21 | `npm view react-native-purchases-ui@10.13.0 peerDependencies --json` |
| Config plugin | **none**: neither tarball ships `app.plugin.js`, and RevenueCat's Expo guide adds no plugin entry (only a Podfile hook for Xcode 27 on Expo SDK 56 or older) | 2026-10-21 (tarball listing and the Expo installation page) | `npm pack react-native-purchases@<v> && tar tzf react-native-purchases-<v>.tgz \| grep app.plugin` |
| Expo Go | the SDK detects Expo Go (no `RNPurchases` native module, `globalThis.expo.modules.ExpoGo` set) and switches to a JavaScript "Preview API Mode": calls succeed with mock data, **real purchases never happen** | 2026-10-21 (source `dist/utils/environment.js` of 10.13.0, and the Expo installation page) | read `dist/utils/environment.js` in the new tarball |
| Real purchases | need a development build (`expo-dev-client`) or a store build | 2026-10-21 | RevenueCat's Expo installation page |
| Test Store (RevenueCat's own synthetic store) | supported from react-native-purchases 9.5.4; its API key makes a **release** build crash on purpose | 2026-10-21 | RevenueCat's "Test Store" docs page |

Read on 2026-10-21: RevenueCat's docs pages "Installation: Expo", "Test Store", "Apple App Store &
TestFlight testing", "Webhooks" and "Event types and fields", and the 10.13.0 type definitions
(`purchases.d.ts`, `customerInfo.d.ts`, `offerings.d.ts`, `generated/error-codes.d.ts`). Not run on a
device for this skill: the store sheets and sandbox renewals are Tier 3 (references/testing-routes.md).

## Install in an Expo app

```sh
npm install -E react-native-purchases@10.13.0              # add react-native-purchases-ui@10.13.0 only for RevenueCat Paywalls
npx expo install expo-dev-client                           # real purchases need a development build
npx expo prebuild --clean                                  # or let EAS Build prebuild
```

- Pin exactly (dependency-management's policy: outside the Expo module map, exact pins, 7 days old).
  `npx expo install react-native-purchases` would write a caret range: RevenueCat is not in Expo's
  module map, so Expo picks no version for it.
- Keep `react-native-purchases-ui` on the same version as the core package; its peer range is exact.
- No `app.config.ts` plugin entry. iOS needs the In-App Purchase capability only in the App Store
  Connect app record (automatic); Android gets `com.android.vending.BILLING` from the Play Billing
  library the SDK merges.
- The public SDK keys are per platform (`appl_...`, `goog_...`) and are public by design:
  `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` per variant
  (app-variants-and-environment). The REST secret key (`sk_...`) and the webhook Authorization value
  are server secrets and never enter the app or the repo.

## Expo Go, development builds and the web

- **Expo Go:** Preview API Mode. Good for screens and flows; every purchase result is mock data.
  Never treat a "purchase" there as evidence.
- **Development build / simulator:** the real native SDK; purchases go to the App Store sandbox, a
  StoreKit configuration file, or the Test Store, depending on the key and the Xcode scheme.
- **Web:** RevenueCat Billing (Stripe) only; this skill covers iOS and Android.

## Identity: the backend user id is the app user id

1. Configure the SDK **once**, after the auth state is restored, with the backend user id:
   `Purchases.configure({ apiKey, appUserID: userId })`. Configuring without an id creates an
   anonymous id (`$RCAnonymousID:...`) that the server cannot map to a user.
2. Every later change of the signed-in user (sign-in to another account, a merge into an existing
   account, an account switch) calls `Purchases.logIn(newUserId)`; sign-out calls `Purchases.logOut()`.
   `subscription-identity.ts` serialises these calls and keeps no current user while a `logIn` is
   pending or failed, so the paywall never sells for the previous user.
3. An app with anonymous backend accounts (for example Firebase anonymous auth) still has a backend
   user id from the first launch: use it. Linking a provider keeps the id, so nothing changes in
   RevenueCat.
4. Restore under a different user id follows the project's restore behavior setting in the
   RevenueCat dashboard: "Transfer to new App User ID" (the default), "Transfer if there are no active
   subscriptions", "Keep with original App User ID" (and a legacy "Share between App User IDs").
   It is a product decision: ask the developer and record the answer. A transfer arrives as a
   `TRANSFER` webhook event with `transferred_from` and `transferred_to` (event-types page); the
   restore-behavior page itself does not mention webhooks (both read on 2026-10-21; re-verify on
   RevenueCat's "Restore behavior" and "Event types and fields" pages).

## SubscriptionPort and the adapter

`templates/src/services/subscription/subscription-port.ts` is the app's only view of subscriptions:
`configure`, `logIn`, `logOut`, `getOffer`, `purchase(packageId)`, `restore`, `getEntitlement`,
`onEntitlementChange`, `managementUrl`. Every call resolves to a `Result`; none rejects. The
composition root creates `createRevenueCatSubscriptionAdapter({ apiKey, entitlementId })` once (the
platform's key from config) and tests use `createFakeSubscription(script)`.

Adapter facts (10.13.0 types):

- `getOfferings()` returns `{ all, current }`; `current` is null when no offering is current. The
  adapter answers `ok(null)` for no offering or no packages: the paywall shows "store unavailable".
- `PurchasesPackage`: `identifier` (`$rc_monthly`, `$rc_annual`), `packageType` (`PACKAGE_TYPE.MONTHLY`,
  `ANNUAL`, ...), `product.priceString` and `product.pricePerMonthString` (null when not computable).
- `purchasePackage(pkg)` resolves `{ customerInfo, productIdentifier, transaction }`; the SDK finishes
  the store transaction itself (unlike expo-iap, there is no finish step for the app).
- `restorePurchases()`, `getCustomerInfo()` and `logOut()` resolve a `CustomerInfo`; `logIn(id)`
  resolves `{ customerInfo, created }`.
- `CustomerInfo.entitlements.active[<id>]`: `isActive`, `productIdentifier`, `expirationDateMillis`,
  `willRenew`, `billingIssueDetectedAtMillis`, `periodType`; `managementURL` is the store's page.

## Error codes -> failure kinds

`PURCHASES_ERROR_CODE` values are numeric strings (`'1'` is `PURCHASE_CANCELLED_ERROR`). The adapter maps:

| Codes | Kind | Paywall |
|---|---|---|
| `PURCHASE_CANCELLED_ERROR` | `cancelled` | back to the page quietly |
| `PAYMENT_PENDING_ERROR` | `pending` | "waiting for approval" (Ask to Buy, slow cards) |
| `NETWORK_ERROR`, `OFFLINE_CONNECTION_ERROR` | `network` | "connect to the internet" |
| `STORE_PROBLEM_ERROR`, `PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR`, `PRODUCT_REQUEST_TIMED_OUT_ERROR` | `store-unavailable` | store unavailable |
| `PURCHASE_NOT_ALLOWED_ERROR`, `INSUFFICIENT_PERMISSIONS_ERROR` | `not-allowed` | purchases disabled on this device |
| `PRODUCT_ALREADY_PURCHASED_ERROR`, `RECEIPT_ALREADY_IN_USE_ERROR`, `RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR` | `already-owned` | run Restore |
| `CONFIGURATION_ERROR`, `INVALID_CREDENTIALS_ERROR` | `not-configured` | store unavailable; log it (a setup bug) |
| anything else | `unknown` | "couldn't complete, you were not charged" |

Re-read `generated/error-codes.d.ts` of `@revenuecat/purchases-typescript-internal` after every
upgrade; the root mock re-exports the real enum, so Jest follows on its own.

## The customer info listener

`Purchases.addCustomerInfoUpdateListener(listener)` fires on purchases, restores, renewals the SDK
notices and `logIn`; `removeCustomerInfoUpdateListener(listener)` (the same function) stops it. The
adapter wraps both behind `onEntitlementChange`, which returns the unsubscribe. Use it as a **hint**:
when the client entitlement turns active, ask the server to sync (a `syncEntitlement` endpoint that
re-fetches the subscriber like the webhook does), then let the UI follow the server's record. Never
write a "Premium" flag from it that a server decision reads.

## Prices

Show `product.priceString` unchanged through a catalog message with `{priceText}`
(`packagePriceText`), and the per-month line only from `pricePerMonthString`
(`monthlyEquivalentText`), never computed. No price string means "store unavailable". This is
in-app-purchases' store-price-text rule applied to RevenueCat's fields; `check-revenuecat.mjs`
(`hardcoded-price`) enforces it.

## RevenueCat Paywalls (react-native-purchases-ui)

`RevenueCatUI.presentPaywall({ offering })`, `presentPaywallIfNeeded({ requiredEntitlementIdentifier })`,
the `<RevenueCatUI.Paywall />` component and `presentCustomerCenter()` render paywalls designed in the
RevenueCat dashboard (10.13.0 type definitions, read 2026-10-21). They are optional. The default here
is the app's own paywall on SubscriptionPort, because its states, texts and accessibility are then
the app's (in-app-purchases' paywall-state rule). When the developer chooses RevenueCat Paywalls:
install the UI package at the same version, render it from one file listed in the contract's
`sdkImportersAllowed`, keep Restore, Terms and Privacy reachable, and still sync the server after a
purchase. Remote-designed paywall text bypasses the app's catalogs: the developer must review every
locale in the dashboard.

## What in-app-purchases still owns

Load `in-app-purchases` for its rules, not its code: the paywall-state rule (every state designed and
tested), the restore rule ("couldn't restore" vs "nothing to restore", Restore on the paywall and in
Settings), the store-price-text rule and the no-pop-up rule. Its expo-iap adapter, its save-before-
finish order and its no-server default do not apply: RevenueCat finishes transactions and the server
decides. The two SDKs never share an app (`mixed-purchase-sdks`).

## When multi-package

Install the SDK in the app workspace (`npm install -E react-native-purchases@10.13.0 -w apps/<app>`) and
run the checker with that workspace as the root. Server code in its own package is named in the
contract's `serverDirs` relative to that root (or run the checker from the repo root with
`rn-skills.config.json` moving the layout).
