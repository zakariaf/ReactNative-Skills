# The entitlement, the paywall flow and every paywall state

## Contents

- Files and who owns what
- The entitlement: table, repository, store
- The paywall flow and its actions
- Every paywall state: view, test ID and message keys
- Restore outcomes: the notices
- The purchase service: save, pending, restore, revocation
- Wiring and timing
- The paywall route (Expo Router) and the React Navigation appendix
- Offline and edge cases
- Price display
- Entry points and texts

## Files and who owns what

| File | Job |
|---|---|
| `src/data/entitlements/entitlement-repository.ts` | `PremiumEntitlement`, `NOT_OWNED`, `EntitlementFailure`, the `EntitlementRepository` port |
| `src/data/entitlements/sqlite-entitlement-repository.ts` | the `entitlements` table: validated upsert, a row that fails its schema reads as not owned (logged) |
| `src/stores/premium/premium-reducer.ts` (+ cases) | `replace-entitlement`, `grant-premium`, `revoke-premium`; the same object back when nothing changes |
| `src/stores/premium/premium-store.ts` | `createPremiumStore({ entitlements })`: `grantPremium`, `revokePremium`, `reload`; `usePremiumStore(selector)` |
| `src/stores/premium/premium-selectors.ts` | `selectIsPremium`: the one value every feature reads |
| `src/stores/premium/open-purchase-stores.ts` | `openPurchaseStores({ entitlements })`: the one caller of both store factories |
| `src/stores/premium/purchase-stores-context.tsx` | `PurchaseStoresProvider` (both stores, created once by the composition root) |
| `src/stores/paywall/paywall-state.ts` | `PaywallFlow`, `PaywallState`, `PaywallAction`, `INITIAL_PAYWALL_STATE`, `priceOf` |
| `src/stores/paywall/paywall-transitions.ts` | BUY, failure, purchase finished, restore finished |
| `src/stores/paywall/paywall-reducer.ts` (+ cases) | `paywallReducer(state, action)` |
| `src/stores/paywall/paywall-view.ts` | `paywallView(state, isPremium)`: one value per paywall state |
| `src/stores/paywall/paywall-notice.ts` | `paywallNotice(state)`: the restore notices |
| `src/stores/paywall/paywall-store.ts` | the memory-only paywall store; `usePaywallStore(selector)` |
| `src/services/purchase/premium-service.ts` | save -> show -> finish; restore; re-check; revocation |
| `src/services/purchase/premium-store-flow.ts` | `loadStore`, `startPremium` (listen first), `buyPremium`, `shouldReloadStore` |
| `src/services/purchase/connect-premium-reloads.ts` | the connectivity and foreground subscriptions after startup |
| `src/services/purchase/connectivity-gated-purchase.ts` | `withConnectivity(port, isOnline)` |
| `src/services/purchase/store-price-text.ts` | `storePriceText(product)`: the store's own `displayPrice`, or null |
| `src/stores/premium/upsell-line.ts` (optional) | `upsellPrice(...)`: the in-context upsell line, at most once a day, never for an owner |

## The entitlement: table, repository, store

- The table is persistence-and-migrations' `entitlements` (`product TEXT PRIMARY KEY, is_owned 0|1,
  owned_since_ms, revoked_at_ms`, STRICT), created by a migration and named in
  `contracts/persistence.json` `protectedTables`: "Delete all my data" never touches it. Premium ends
  only with a dated revocation from the store.
- `savePremium` validates first (an owned entitlement has its date and no revocation) and returns
  `entitlement-invalid` without writing; storage errors become `storage-full`, `storage-busy` or
  `storage-unavailable` (the raw error logged).
- The premium store follows state-management-zustand's rule for service-fed state: the store owns the
  write. `grantPremium({ ownedSinceMs })` reduces (already owned: the same object, no write, ok),
  writes through `entitlements.savePremium`, returns the failure before it publishes, then publishes.
  `revokePremium(revokedAtMs)` does the same; a revoke without a positive date changes nothing.
- A failed read at startup starts as not owned; the launch re-check restores Premium from the store's
  evidence when online.
- The store has its own context (like the settings store), so it does not join `createStores`; the
  composition root creates it once, after the data layer opened.

## The paywall flow and its actions

`PaywallState = { flow, didJustPurchase, didJustRestore }`, memory only (re-read from the store at every
launch). `flow` is `loading`, `unavailable`, `ready`, `purchasing`, `pending`, `failed`, `unsaved`,
`restoring`, `restore-empty` or `restore-failed`, carrying the store's price text where one is known.

| Action | Effect |
|---|---|
| `start-loading` | flow -> `loading` |
| `mark-store-unavailable` | flow -> `unavailable` |
| `set-price` | `loading` -> `ready` with the price; ignored in any other flow |
| `start-purchase` | -> `purchasing` only from `ready`, `failed`, `restore-empty`, `restore-failed`, with a price, and not when `isPremium` |
| `record-purchase-failure` | only while `purchasing` (repeats are no-ops): cancelled -> `ready`; deferred -> `pending`; already-owned -> `restoring` (the service runs restore); unavailable -> `unavailable`; failed -> `failed` |
| `mark-purchase-pending` | `purchasing` -> `pending` |
| `finish-purchase` | after the grant was saved: the thank-you (`didJustPurchase`) only when the flow was `purchasing` or `pending`; a launch delivery changes nothing |
| `record-save-failure` | paid, not saved: flow -> `unsaved`, no thank-you |
| `start-restore` | -> `restoring` |
| `finish-restore` | `sync-failed` -> `restore-failed`; `owned` -> `didJustRestore` (never the thank-you); `revoked` -> the quiet page; `unknown` -> `restore-empty` unless `isPremium` |
| `clear-thanks` / `clear-restore-notice` | clear the one-shot flags (the same object when already clear) |

The names are imperative commands (state-management-zustand's `action-name` rule).

## Every paywall state: view, test ID and message keys

`paywallView(state, isPremium)` returns `success` or `already-owned` whenever `isPremium`, otherwise
the flow's view. Test IDs and keys are the template contract's defaults (`stateTestIds`,
`catalogKeys`); an app may rename them in its contract, and the checker follows.

| State | `PaywallView` | Reached by | What the page shows (keys) | Test ID |
|---|---|---|---|---|
| Loading the price | `loading-price` | `start-loading` | BUY busy (`paywall.loading`); Restore enabled | `paywall.state.loading` |
| Store unavailable / offline | `store-unavailable` | empty product list, connect failure, `unavailable` failure | note `paywall.store-unavailable`; BUY disabled; Restore disabled | `paywall.state.unavailable` |
| The page | `ready` | `set-price`, cancelled | `paywall.buy-button` ("Buy for {priceText}"), Restore (`paywall.restore-button`) | `paywall.buy-button`, `paywall.restore-button` |
| Purchase in progress | `purchase-in-progress` | `start-purchase` | BUY busy (`paywall.purchasing`); Restore disabled | `paywall.state.purchasing` |
| Pending | `pending` | deferred failure or pending purchase | note `paywall.pending`; Restore enabled | `paywall.state.pending` |
| Success | `success` | `finish-purchase` while buying or pending | `paywall.success.title`; then `clear-thanks` | `paywall.state.success` |
| Error | `error` | failed | note `paywall.error` + `paywall.try-again` | `paywall.state.error`, `paywall.try-again-button` |
| Saved nowhere | `save-failed` | `record-save-failure` | note `paywall.save-failed` ("Your purchase is safe; it will be applied the next time the app starts"); Restore retries | `paywall.state.save-failed` |
| Already owned | `already-owned` | saved Premium, restore or re-check evidence | `paywall.owned`, Restore | `paywall.state.owned` |

The screen also needs a root test ID (`paywall.screen`, which the StoreKit flows wait for). The
Settings row reads `settings.premium.buy` ("Remove ads – {priceText}", or the app's own unlock) or
`settings.premium.no-price` while the price is unknown, and `paywall.owned` once owned. The layout is
the app's design (screen-contracts); this table is the logic contract it renders.

## Restore outcomes: the notices

| Notice | When | Test ID | Key |
|---|---|---|---|
| `restoring` | flow `restoring` | `paywall.restoring-notice` | `paywall.restoring` |
| `restore-success` | `didJustRestore` (then `clear-restore-notice`) | `paywall.restore-success-notice` | `paywall.restore-success` |
| `restore-empty` | flow `restore-empty` (good sync, no evidence) | `paywall.restore-empty-notice` | `paywall.restore-empty` |
| `restore-failed` | flow `restore-failed` (failed sync or read) | `paywall.restore-failed-notice` | `paywall.restore-failed` |

Show a notice when `paywallNotice` changes to a new value (remember the last one in component state),
not on every render; announce it to VoiceOver and TalkBack (accessibility-as-code's `useAnnounce`).
BUY and Restore stay usable underneath.

## The purchase service: save, pending, restore, revocation

`PremiumServiceDeps = { port, productId, premium, paywall, nowMs, formatPrice, onError }` (`formatPrice`
is `storePriceText`; `onError` records with the `'service'` source of the error log).

- **`processTransaction(deps, tx)`** ignores other products. A `pending` purchase dispatches
  `mark-purchase-pending`. A transaction with a revocation date runs `recheckPremium` (a newer valid
  purchase still wins) and is then finished. A purchase runs, in this order: `grantPremium` (a
  synchronous SQLite write) -> `finish-purchase` -> `finish`. A failed grant logs the failure,
  dispatches `record-save-failure` and returns: the transaction stays open, so StoreKit delivers it
  again at the next launch (Android: the next re-check finishes it once the save works).
- **`recheckPremium(deps)`** (launch, foreground, reconnect, revocation): reads the transactions,
  applies explicit evidence only (`owned` -> `grantPremium`, `revoked` -> `revokePremium(latest date)`
  and `clear-thanks`), then finishes every owned transaction still `isUnfinished`, only when the grant
  returned ok. A read failure is logged and keeps the saved state.
- **`entitlementEvidence`**: `owned` when a purchased transaction has no revocation date; `revoked`
  when only revoked ones exist; `unknown` otherwise.
- **`restorePremium(deps)`**: `start-restore` -> `port.restore()`; a failed sync ends in
  `finish-restore: sync-failed` without reading; otherwise read, apply evidence, dispatch
  `finish-restore` with the evidence and `isPremium` (or `record-save-failure` when the owned grant
  failed), then finish the unfinished ones.
- **`processPurchaseEvent`**: a failure dispatches `record-purchase-failure`; `already-owned` then runs
  `restorePremium`.
- **`buyPremium`** dispatches `start-purchase` and asks the store only when the flow became
  `purchasing`.

## Wiring and timing

- `createDeviceServices()` (examples/create-device-services.ts) creates the one ConnectivityPort and
  the gated purchase port, the only call of `createExpoIapPurchaseAdapter()`; `createTestServices` hands
  tests `createFakeConnectivity` and `createFakePurchase`.
- The startup piece (examples/purchase-root.tsx, rendered by AppRoot inside the services and data
  providers, around the root stack) calls `openPurchaseStores({ entitlements: data.entitlements })` and
  builds the deps once, in a `useState` initializer (state-management-zustand's created-once rule).
- `startPremium(deps)` runs after the first frame, never awaited: subscribe first, then `loadStore`
  (connect -> product -> `set-price` or `mark-store-unavailable`), then `recheckPremium`. Offline it ends
  in "store unavailable" quickly; the saved Premium already controls every feature.
- The port is `services.purchase`, built as `withConnectivity(createExpoIapPurchaseAdapter(), connectivity.isOnline)`. While
  ConnectivityPort says offline (an outage, or a test build's simulated-offline switch), `connect`
  answers `ok(false)`, `fetchProduct` `ok(null)`, `restore` a store error and `readTransactions`
  `ok([])`, all without calling the store. Only `isOnline()` decides: Android's `unvalidated`
  reachability can still reach Play, so it never blocks a purchase.
- `connectPremiumReloads({ connectivity, onAppActive, service })`, right after `startPremium`: on every
  connectivity change, `loadStore` when `shouldReloadStore(flow, isOnline)` (back online on an
  "unavailable" page, or gone offline from a quiet page; never while loading, buying, pending or
  restoring), then `recheckPremium` when the change was to online (the launch re-check ran offline,
  where absence is not evidence, so a refund would wait for the next foreground: the StoreKit harness
  caught exactly that). On every return to the foreground while online, `recheckPremium`.
  `onAppActive` is built on `AppState` in the composition root, so the module stays pure and testable.
- Test builds only: the app adds `premium=0|1` and the `paywall` screen value to
  debug-menu-and-test-hooks' debug-link registry (its template ships `offline`, `date`, `lang` and
  more, but nothing about purchases). The link's Premium step calls `grantPremium` /
  `revokePremium(clock.nowMs())` from a test-only folder (`src/services/test-hooks/`, listed in
  `entitlementWritersAllowedIn`), never the store directly; examples/debug-premium-link.ts shows the
  registry entries, the contract rows and the handler. `offline=1` flips the simulated connectivity,
  which notifies its subscribers.

## The paywall route (Expo Router) and the React Navigation appendix

- The route file is thin: `src/app/(app)/paywall.tsx` renders `PaywallScreen` from
  `src/features/paywall/`, and a model hook (`use-paywall-model.ts`) reads `usePaywallStore`,
  `usePremiumStore(selectIsPremium)` and the service deps from a context the composition root provides.
- Present it as a modal from Settings or a feature gate (`router.push('/paywall')`); a successful
  purchase shows the thank-you, then the page turns into "Premium is active". Never redirect into the
  paywall on launch.
- React Navigation 7 static API (appendix): register `Paywall: { screen: PaywallScreen, options: {
  presentation: 'modal' } }` in the root stack and navigate with `navigation.navigate('Paywall')`; the
  model hook and the state table do not change. Android's predictive back closes the modal like any
  screen; nothing in the purchase flow depends on the paywall staying open (the outcome arrives through
  the store's listener and updates the stores wherever the user is).

## Offline and edge cases

| Case | Behaviour |
|---|---|
| Premium owned, offline | every feature unlocked (saved); paywall shows "Premium is active"; Restore ends in the restore-failed notice |
| Not owned, offline | "store unavailable" at once, BUY disabled |
| Purchase sheet open, app killed | the store keeps the transaction; next launch: delivered -> saved -> finished |
| Crash between save and finish | delivered again at the next launch; saving again is a no-op |
| Disk full at purchase time | `save-failed`; the transaction stays open and the save is retried at the next launch (iOS) or re-check (Android) |
| Ask to Buy approved while the app is closed | delivered at the next launch; no thank-you (the flow was not buying) |
| iOS refund | the launch, reconnect or foreground re-check sees the revocation date in `Transaction.all`; Premium turns off. In the harness a refund produced no listener event |
| Android refund | no trace on the device: Premium stays (server profile to detect it) |
| A dev variant's bundle id or package | the stores sell its products only to the app record they belong to: test with the StoreKit file (iOS) and a license tester on the release package name (Android) |
| Clock changes | irrelevant: the app compares no dates of its own |
| "Delete all my data" | Premium kept (protected table) |
| New phone or reinstall | Restore; the re-check also restores it when online |

## Price display

The price to pay is the store's own `displayPrice`, shown unchanged: `storePriceText(product)` returns
it, or null when the store sent no text (the flow then says "store unavailable": nothing is sold
without a price). StoreKit formats it with the device's locale and the storefront's currency, Play
Billing with the device's locale (`formattedPrice`); either way it is the text the purchase sheet
shows. That is the same rule value-objects-money-and-units states (rule 6, "the price shown to pay is
the store's own displayPrice"), so both skills' checkers pass on one app.

Why not reformat `product.price` with `Intl.NumberFormat(..., { style: 'currency' })`: the double
(`1.9899999999999998` for 1.99) has to be rounded, Intl's fraction digits differ from the store's for
some currencies (HUF `1 190 Ft` in the store, `1 190,00 Ft` with the ISO 4217 exponent), and a
paywall price that disagrees with the sheet reads as a bait. value-objects-money-and-units'
check-value-code also reports `style: 'currency'` outside `src/i18n/`.

When the app's digits follow an in-app setting rather than the device (an app whose language
setting differs from the system's), hand the deps a different `formatPrice` that lives in `src/i18n/`: value-objects-money-and-units'
`productPrice(product)` (its examples: `parseCurrencyCode`, then `moneyFromStoreDouble`), then
`formatMoney(money, localeTag)` on success and `storePriceText(product)` on any failure. Keep the
null for a product without text, which keeps the "no price, nothing sold" rule.

`PurchasePort`'s `price` field mirrors expo-iap's double with a `value-objects-allow float-money`
marker and is never shown. The text fills `{priceText}`, which the translation helper isolates for
bidirectional text (i18n-strings-and-catalogs). Tests and fixtures may type `'$2.99'`; product code
and catalogs never do (`typed-price`).

## Entry points and texts

- Entry points: the paywall route, the Settings row, and the features that are locked (a quiet "Premium"
  badge that opens the paywall). No pop-up on launch or after a failure.
- An in-context upsell line (optional template `src/stores/premium/upsell-line.ts`): one line beside a
  feature ("Remove ads for {priceText}" under a finished list), never a dialog. `upsellPrice({
  isPremium, priceText, lastShownOn, today })` returns the price text or null: null for an owner, null
  without the store's price, and null when it already showed on this local day (`today` is
  `clock.today()`; the model hook saves it as `lastShownOn` through the app's settings store when the
  line shows). A frequency cap is the general default: a line on every result reads as nagging, and
  App Review rejects apps that push purchases too hard. `check-purchase-behaviour` (`upsell-line`)
  holds the cap when the file exists.
- All paywall text comes from the app's catalogs in every locale (`catalogKeys`); App Store Connect and
  Play Console product texts exist only for the store listings and are never shown in the app.
