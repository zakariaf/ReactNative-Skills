# The checkers: rules, contract, config keys and SKIP lines

## Contents

- Running them
- check-purchases.mjs rules
- check-purchase-behaviour.mjs rules
- The contract (contracts/in-app-purchases.json)
- Layout and config keys
- NOT APPLICABLE and SKIP lines
- Verified

## Running them

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-purchases.mjs .            # static rules
node ${CLAUDE_SKILL_DIR}/scripts/check-purchase-behaviour.mjs .   # runs the app's modules in Node
```

The repo root is the optional positional argument (default `.`); `--json` adds one JSON line; exit 0
pass, 1 problems, 2 bad input. Both need Node 22.18 or newer (type stripping) and nothing installed:
expo-iap is replaced by `scripts/lib/stubs/expo-iap.mjs`, and the modules they load must stay pure
(types, other pure modules, `@/core/result`). The repo scan prunes installed skills (`.agents/`,
`.claude/`, `skills/`, any folder with a `SKILL.md`) and generated folders (`ios/`, `android/`, `build/`).

## check-purchases.mjs rules

| Rule | Fails when |
|---|---|
| `contract` | the contract is missing (once purchase code exists), lacks a required key, or `allowedApis` lists `useIAP`/auto-finishing |
| `required-file` | a template file of the skill is missing at its layout path |
| `sdk-pin` | any `package.json` lists expo-iap with another specifier than exactly `5.8.0` (also before the code is adopted) |
| `sdk-import` | a non-test file other than the adapter imports expo-iap |
| `sdk-api` | the adapter imports a name outside its allowlist |
| `banned-api` | app code (`src/`, not tests) uses a server API not opted in, `useIAP` or auto-finishing |
| `plugin-entry` | `app.config.*`/`app.json` has no `'expo-iap'` entry |
| `plugin-options` | the plugin gets an options object, or a banned switch (Onside, Horizon, Fire OS, Vega, alternative billing, IAPKit key, `EXPO_IAP_*`, `horizonEnabled`, `fireOsEnabled`, `openiapPlatform`) appears in the app config, `eas.json`, `.env*`, `gradle.properties`, `android/gradle.properties` or a package script, or `openiapStore`/`ORG_GRADLE_PROJECT_openiapStore` pins a store other than Play, unless `allowedConfigWords` lists it |
| `adapter-facts` | the adapter lacks `onlyIncludeActiveItemsIOS: false` or `isConsumable: false`, or reads active items only |
| `store-offline` | `createExpoIapPurchaseAdapter()` is called outside `withConnectivity(...)` |
| `entitlement-writers` | `grantPremium(`/`revokePremium(` is called outside the purchase service, the premium store folder, tests and `entitlementWritersAllowedIn` |
| `port-callers` | app code outside `src/services/purchase/`, tests and `entitlementWritersAllowedIn` calls `requestPurchase(`, `finish(`, `restore(` or `readTransactions(` on a receiver named like the port (`services.purchase`, `purchasePort`, `deps.purchase`), or `requestPurchase(`/`readTransactions(` on anything in a file that names `PurchasePort`. A port held under another name is not seen: wire every button through `buyPremium`/`restorePremium` |
| `product-id` | the contract's id breaks the grammar, or `PREMIUM_PRODUCT_ID` differs from it |
| `typed-price` | a price-like literal in `src/` (outside `src/i18n/` and tests), a price key without `{priceText}`, or a typed price in a paywall message |
| `catalog-keys` | a catalog in `src/i18n/catalogs/` lacks a contract key |
| `state-testids` | the paywall folder lacks a contract test ID |
| `harness-isolation` | a `*.storekit`/`*.xctest` outside `scripts/storekit/`, `get-task-allow` anywhere else, `SKTestSession`/`StoreKitTest` in `src/`, or a StoreKit flow outside `.maestro/storekit/` |
| `storekit-config` | a StoreKit configuration (`scripts/storekit/`, a leftover in `ios/`) is not exactly one NonConsumable with the contract's id, or the ASC payload is not `NON_CONSUMABLE` |
| `family-sharing` | a StoreKit configuration disagrees with `familyShareable`, or the ASC payload hard-codes `familySharable` |
| `price-target` | a StoreKit `displayPrice` or `_storefront` disagrees with the contract's price, or `create-premium-iap.ts` hard-codes a price or territory or does not read the contract |
| `harness-maestro` | `storekit-harness.ts` runs Maestro without `maestroGlobalArgs`, passes `--udid`, or reuses one driver port for every flow |
| `harness-relaunch-wait` | a wait in `02-refund-relaunch.yaml` or `04-approval-relaunch.yaml` allows less than 60000 ms |
| `harness-subflow` | SKIP only: the StoreKit flows exist but the debug sub-flow does not yet |

## check-purchase-behaviour.mjs rules

| Rule | Runs |
|---|---|
| `module-load` | each module exists and imports in Node |
| `paywall-states` | 25 action sequences against `paywallView`: every state, the thank-you only after a purchase, repeats ignored, BUY refused when owned or without a price |
| `restore-notices` | the four notices, the restored one once |
| `entitlement-reducer` | grant, the idempotent second grant, no undated revoke, a dated revoke, a purchase after a refund |
| `evidence` | owned beats revoked, absence is unknown, other products ignored, the latest date |
| `service-order` | save -> show -> finish; pending and other products; an unsaved purchase never finished; unacknowledged Android purchases finished once saved; a failing finish logged |
| `restore-flow` | failed sync, empty sync, owned, an owner whose good sync finds nothing (never "nothing to restore"), a read error, a refused save, already-owned |
| `revocation` | absence and read errors keep Premium; a refund revoked with its date; a newer purchase wins |
| `store-flow` | listen first; unavailable on an empty list, no connection, a connect error or a product without price text; BUY asks nothing when refused |
| `price-text` | `storePriceText` returns the store's `displayPrice` unchanged (never rebuilt from the double: HUF; digits and marks kept), null without text |
| `upsell-line` | only when `src/stores/premium/upsell-line.ts` exists: at most once per local day, never for an owner, never without a store price |
| `offline-gate` | the gated port offline and online; offline load, restore and re-check; the `shouldReloadStore` table |
| `store-reloads` | the reloads module (price after an offline start, re-check once online and on foreground, nothing mid-purchase, the unsubscribe) and the composition root calling `startPremium` and `connectPremiumReloads` |
| `adapter-errors` | the ErrorCode table through the listener and a rejected request |
| `adapter-restore` | a rejected restore is a store error, a resolved one ok |
| `adapter-transactions` | `Transaction.all` mapping (revocation, pending, unknown), unacknowledged Android purchases, listener events, the unsubscribe |
| `adapter-finish` | a purchase delivered through `purchaseUpdatedListener` is not finished until the port's `finish(tx)` runs (no hand-written auto-finish in the listener or anywhere else in the adapter) |
| `adapter-calls` | the call shapes of fetch, request and finish |
| `adapter-results` | a rejected connect, fetch, read or finish becomes a store error |

## The contract (contracts/in-app-purchases.json)

The template and its JSON schema ship in `templates/contracts/`. Required: `productId`,
`familyShareable`, `price` (`amount`, `currency`, `baseTerritory`), `storeTexts`, `paywallScreenDir`,
`catalogKeys`, `priceKeys`, `stateTestIds`. Optional: `reviewNote`, `allowedApis` (the server profile),
`allowedConfigWords` (another billing SDK), `entitlementWritersAllowedIn` (test-only globs or folders; the template
lists debug-menu-and-test-hooks' `src/services/test-hooks/` and `src/features/debug/`, where the debug
link's Premium handler lives: examples/debug-premium-link.ts).

## Layout and config keys

Paths come from check-lib's `resolveLayout(root)`: `servicesDir/purchase`, `storesDir/premium`,
`storesDir/paywall`, `dataDir/entitlements`, `configDir/purchase-products.ts`, `mocksDir/expo-iap.ts`,
`e2eDir/storekit`, `e2eDir/subflows/debug-setup.yaml`, `i18nDir/catalogs`, `contractsDir`. An optional
`rn-skills.config.json` moves any of them; the key `inAppPurchasesContract` moves the contract file.
The StoreKit harness lives in `scripts/storekit/` and the console tooling in `scripts/asc/`.

## NOT APPLICABLE and SKIP lines

- `NOT APPLICABLE: expo-iap is not in package.json and no code sells anything ...`: the app has no
  purchase folder and no import of expo-iap.
- `NOT APPLICABLE: expo-iap is installed but no code uses it yet ...`: the same, with expo-iap installed
  (the static checker still runs `sdk-pin` and `plugin-options` first and fails on them).
- `SKIP src/i18n/catalogs [catalog-keys] not yet created (i18n-strings-and-catalogs creates it)`
- `SKIP src/features/paywall [state-testids] not yet created (screen-contracts creates it)`
- `SKIP .maestro/subflows/debug-setup.yaml [harness-subflow] not yet created (e2e-maestro creates it)`

## Verified

On 2026-10-10 with Node 26.4: both checkers print `NOT APPLICABLE` on the reference app (expo-iap
installed, nothing sold yet) and `RESULT: PASS` on a copy of it with every template, the example root,
catalog keys, the plugin entry, the paywall test IDs, the debug sub-flow, the debug Premium handler
and a filled `Premium.storekit` added (no SKIP left); a planted finish-before-save, an ungated adapter,
a `finishTransaction` inside the purchase listener and a restore that ignores the saved Premium each
fail there. On that same copy value-objects-money-and-units' `check-value-code`, state-management-
zustand's `check-stores` (with `contracts/stores.json`) and tdd-workflow's `check-tests` pass too.
