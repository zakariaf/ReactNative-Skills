# expo-iap, PurchasePort and the adapter

## Contents

- What Premium is (the default model)
- The server profile (opt-in)
- Facts that shape everything (iOS and Android)
- Versions, install and the config plugin
- Banned APIs, options and switches
- PurchasePort
- The expo-iap adapter
- Error codes -> paywall results
- Re-verify after an upgrade
- When multi-package

## What Premium is (the default model)

- One non-consumable product, "Premium", per app: one product id on the App Store and on Google Play.
  No subscription, consumable or second product in this skill (subscriptions need renewal, grace and
  billing-retry states and, realistically, a server: a different skill's job).
- It unlocks features the app decides (for example: ads off, unlimited lists in a Tasks app). Every
  feature reads one value, `selectIsPremium(state)` of the premium store.
- After a purchase the app saves "Premium = yes" in its own database (the protected `entitlements`
  table) and works offline from then on. When online it re-checks quietly at launch, on every return
  to the foreground and when the network comes back.
- Restore is required (App Review guideline 3.1.1) and lives on the paywall and in Settings. A
  reinstall or a new phone plus Restore gives Premium back.
- **No server by default.** StoreKit 2 verifies each transaction's signature on the device; Play
  Billing hands the app purchases it already verified. The app saves before it finishes, and only a
  dated revocation from the store turns Premium off.
- The price always comes from the store; the paywall never pushes itself with pop-ups.

## The server profile (opt-in)

Some apps verify purchases on their own backend (fraud checks, Android refunds, cross-device accounts).
That is a product decision, recorded in `contracts/in-app-purchases.json`:

- `allowedApis` lists the expo-iap server APIs the app uses (`verifyPurchase`,
  `verifyPurchaseWithProvider` for IAPKit, `kitApi`/`KitApiError`). `useIAP` and
  `andDangerouslyFinishTransactionAutomatically` can never be listed.
- Calls to the app's own backend go through networking-and-server-state's `ApiClient` port in
  `src/api/`, never `fetch` in the purchase service.
- The order does not change: verify -> `grantPremium` ok -> finish. A failed verification leaves the
  transaction open (the store delivers it again) and shows `save-failed`-style honesty, not "you were
  not charged".
- Android refunds become visible only through Google's Voided Purchases API on the server; the server
  then hands the app a dated revocation, which `revokePremium(revokedAtMs)` saves.

## Facts that shape everything (iOS and Android)

Verified with an Expo SDK 57 app on expo-iap 5.8.0 (StoreKit facts in the StoreKit harness on Xcode 26.6
and an iOS 26.5 simulator; Play facts read in openiap-google 3.6.0 and Google's testing guide, not run
on an emulator):

1. **StoreKit re-delivers transactions.** An unfinished purchase comes back at every launch, and even
   a finished, owned purchase was re-delivered through the update listener on relaunch. So every
   handler is idempotent, and Premium is saved before `finishTransaction`.
2. **Absence is not evidence.** A fresh purchase can be missing from `Transaction.currentEntitlements`
   for a moment, and the purchase sheet makes the app inactive and active again, which triggers a
   foreground re-check right after buying. Premium is revoked only when a verified transaction carries
   a revocation date.
3. **Failures arrive twice on iOS.** A failed or deferred `requestPurchase` both rejects and fires
   `purchaseErrorListener` with the same code. The paywall reducer ignores the repeat (failures count
   only while purchasing).
4. **Play never re-delivers an unacknowledged purchase.** `purchaseUpdatedListener` gets it once; if
   the app does not acknowledge it (`finishTransaction` acknowledges a non-consumable) Google refunds
   it after 3 days (3 minutes for license testers). `getAvailablePurchases()` still lists it with
   `isAcknowledgedAndroid: false`, which the adapter maps to `isUnfinished: true`, and the re-check and
   the restore finish it once Premium is saved.
5. **Play refunds leave no trace on the device.** A refunded or charged-back purchase disappears from
   `getAvailablePurchases()`; there is no revocation date. Absence is not evidence, so without the
   server profile Premium stays on after an Android refund.
6. **Pending purchases exist on both stores.** iOS Ask to Buy arrives as the error code
   `deferred-payment`; Play's delayed payment methods arrive as a purchase in state `pending`. Both
   show "waiting for approval"; the approval later arrives as a normal purchase (iOS: at the next launch
   when the app was closed).

## Versions, install and the config plugin

| Item | Version | Note |
|---|---|---|
| `expo-iap` | 5.8.0 exact | openiap-apple 3.6.0 (StoreKit 2), openiap-google 3.6.0 (Play Billing) |
| iOS deployment target | 16.4 | the Expo SDK 57 default |
| Android compile/target SDK | 36 | the Expo SDK 57 default |

Verified on 2026-10-10 (`npm view expo-iap version time --json`; the stack table pins 5.8.0, installed
under the 7-day release-age policy).

```sh
npm install -E expo-iap@5.8.0
npx expo prebuild --clean          # or let EAS Build prebuild
```

- The plugin entry in `app.config.ts` is the bare string `'expo-iap'`. On Android it declares
  `com.android.vending.BILLING` (the Play Billing library also merges it); on iOS it links the
  StoreKit 2 module. No iOS entitlement is needed for in-app purchase.
- expo-iap is a single-maintainer project with very frequent releases, hence the exact pin and the
  re-verification below before every upgrade (dependency-management owns the release-age policy).
- **When multi-package:** install in the app workspace (`npm install -E expo-iap@5.8.0 -w apps/<app>`).

## Banned APIs, options and switches

| Banned | Why |
|---|---|
| `kitApi`, `KitApiError`, `verifyPurchaseWithProvider` | call IAPKit at kit.openiap.dev, a third-party server (opt-in: `allowedApis`) |
| `verifyPurchase` | the Google branch needs a server token; iOS verification is already done by StoreKit 2 (opt-in) |
| `useIAP` | hides connection and finishing logic the service must own (never allowed) |
| `andDangerouslyFinishTransactionAutomatically` | finishing before saving loses purchases (never allowed) |
| any plugin options object (`iapkitApiKey`, `modules`, `ios.alternativeBilling`, `enableLocalDev`, `localPath`) | a server or another billing SDK |
| `ios.onside.enabled`, `EXPO_IAP_ONSIDE`, `modules.horizon`, `EXPO_IAP_HORIZON`, `modules.amazon.fireOS`, `EXPO_IAP_FIREOS`, `vegaOS`, `EXPO_IAP_VEGA` | switch the build to OnsideKit (iOS alternative billing), Meta Horizon or Amazon billing (opt-in: `allowedConfigWords`); 5.8.0 marks the `modules`/`EXPO_IAP_*` switches deprecated |
| `openiapStore` / `ORG_GRADLE_PROJECT_openiapStore` with any value but `play` (or an alias: `google`, `gplay`, `googleplay`, `google-play`, `gms`), and the legacy Gradle properties `horizonEnabled`, `fireOsEnabled`, `openiapPlatform` | the current 5.8.0 store pin (gradle.properties, or the env var in an `eas.json` profile or `.env`) and its deprecated predecessors: `horizon` or `amazon` links that store's billing SDK. `openiapStore=play` is allowed and is the safe pin |

**The store is picked at build time** (verified in source 2026-10-10, expo-iap 5.8.0,
`android/openiap-store.gradle`): an explicit property, then a store flavor in the task name
(`assembleHorizonRelease`), then, for debug builds only, the connected device (a Meta Quest or an
Amazon Fire device selects that store), and Play otherwise. So a local debug build run on a Quest or
Fire device links that store's billing SDK unless the build is pinned to Play (`openiapStore=play` in
`gradle.properties`, or `ORG_GRADLE_PROJECT_openiapStore=play` in the environment). Release and EAS
builds with no pin resolve to Play. check-purchases `plugin-options` scans the app config, `eas.json`,
`.env*`, `gradle.properties` and `android/gradle.properties` for the pin and the legacy switches.

Metro does not tree-shake, so the IAPKit client is in every bundle through expo-iap's index
re-export; banning the entry points (the canonical ESLint config and this skill's checker) keeps it
unused. The ESLint config bans `expo-iap` everywhere except the adapter and keeps the server names
banned inside it.

## PurchasePort

```ts
export type StoreFailure = { readonly kind: 'store-error'; readonly code: string };
export type StoreResult<TValue> = Result<TValue, StoreFailure>;

export type PurchasePort = {
  readonly connect: () => Promise<StoreResult<boolean>>;                     // ok(false): not reachable
  readonly fetchProduct: (productId: string) => Promise<StoreResult<StoreProduct | null>>; // ok(null): store returned []
  readonly requestPurchase: (productId: string) => Promise<void>;           // outcome arrives via subscribe()
  readonly finish: (transaction: StoreTransaction) => Promise<StoreResult<void>>;
  readonly restore: () => Promise<StoreResult<void>>;                        // err: the sync failed
  readonly readTransactions: () => Promise<StoreResult<readonly StoreTransaction[]>>; // Transaction.all
  readonly subscribe: (listener: (event: PurchaseEvent) => void) => () => void;
};
```

`StoreTransaction` is `{ productId, transactionId, state: 'purchased' | 'pending', revocationDateMs,
handle, isUnfinished? }`; `PurchaseFailure` is `cancelled | deferred | already-owned | unavailable |
failed`. `fake-purchase.ts` scripts the store for Jest (connection, product or `null`, restore and read
failures, transactions, `emit(event)`) and logs every call in order (`connect`, `finish:t1`, ...).

## The expo-iap adapter

`expo-iap-purchase-adapter.ts` is the only file that imports `expo-iap`. Facts behind it (5.8.0 source,
openiap, and the StoreKit harness):

- `fetchProducts({ skus: [id], type: 'in-app' })` returns `[]` instead of throwing when the store cannot
  resolve the product: `fetchProduct` answers `ok(null)`, which the flow shows as "store unavailable".
- `getAvailablePurchases()` defaults to `onlyIncludeActiveItemsIOS: true` (`Transaction.currentEntitlements`);
  the adapter passes `false` to read `Transaction.all`, which still holds refunded purchases with
  `revocationDateIOS`. On Android it returns the owned purchases with `isAcknowledgedAndroid`.
- `restorePurchases()` returns `void` (it runs `AppStore.sync()` and reads purchases) and throws
  `ErrorCode.SyncError` when the sync does not complete (a cancelled account prompt, offline); the
  adapter answers a store error and the service then reads the transactions itself.
- `requestPurchase({ request: { apple: { sku }, google: { skus: [sku] } }, type: 'in-app' })`; a
  rejection is emitted as a failure event (it may repeat the listener's).
- `finishTransaction({ purchase, isConsumable: false })` (acknowledges on Android).
- A purchase with `purchaseState === 'unknown'` is dropped; `transactionId ?? id` is the id.
- StoreKit's `Product.price` arrives as a binary double (`1.9899999999999998` for 1.99). The port
  mirrors it (with a `value-objects-allow float-money` marker) but the paywall never shows it: the
  price shown is `displayPrice` (references/paywall-states.md, "Price display"); arithmetic converts the
  double once with value-objects-money-and-units' `moneyFromStoreDouble`.
- Each vendor call runs inside `attemptAsync(..., storeFailure)`: a rejection becomes
  `{ kind: 'store-error', code }` and never escapes (error-handling-typed-results' adapter boundary).

## Error codes -> paywall results

Codes are the string values of expo-iap 5.8.0's `ErrorCode`:

| `ErrorCode` value | `PurchaseFailure` | Paywall |
|---|---|---|
| `user-cancelled` | `cancelled` | quietly back to the page, no message |
| `deferred-payment`, `pending` | `deferred` | pending: "Waiting for approval" |
| `already-owned` | `already-owned` | runs Restore automatically |
| `network-error`, `service-error`, `service-disconnected`, `service-timeout`, `billing-unavailable`, `iap-not-available`, `init-connection`, `connection-closed`, `not-prepared` | `unavailable` | "Connect to the internet to buy or restore." |
| anything else (`unknown`, `purchase-error`, `item-unavailable`, `sku-not-found`, `query-product`, ...) | `failed` | "The purchase couldn't be completed. You were not charged." + Try again |
| `sync-error` (from `restorePurchases` only) | none | the restore-failed notice |

The paywall never shows a store error text; only the app's catalog messages.

## Re-verify after an upgrade

1. `npm view expo-iap version time --json`: the new version must be at least 7 days old; read the
   release notes and the tarball's `openiap-versions.json`.
2. Re-read `ErrorCode` (`build/types.js`), `getAvailablePurchases`, `restorePurchases` and the plugin
   options in the new source; update the error table, `assets/purchase-facts.json` and the stand-in
   `scripts/lib/stubs/expo-iap.mjs` if anything moved. The root mock re-exports the real `ErrorCode`,
   so Jest follows on its own.
3. Rerun Tier 1, the StoreKit harness and the Android license-tester run, and ask for a Tier 3 run on
   both stores before shipping the upgrade (references/testing-tiers.md).

## When multi-package

Run both checkers with the app workspace as the root
(`node ${CLAUDE_SKILL_DIR}/scripts/check-purchases.mjs apps/mobile`): every path they read (`package.json`,
`app.config.ts`, `src/`, `contracts/`, `scripts/storekit/`, `.maestro/`) is relative to that folder, and
`rn-skills.config.json` there moves any layout folder. The purchase code stays in the app workspace;
a shared package may hold the pure pieces (evidence, reducers) if two apps sell the same Premium, each
with its own product id.
