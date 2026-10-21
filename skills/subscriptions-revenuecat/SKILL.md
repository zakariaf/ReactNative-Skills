---
name: subscriptions-revenuecat
description: Sells RevenueCat subscriptions behind a port - offerings, store prices, restore, a server entitlement set by an idempotent webhook. Use when adding react-native-purchases, a renewing plan or its webhook. Not for an expo-iap unlock (in-app-purchases).
---

# Subscriptions with RevenueCat

Sells a Premium subscription (monthly and annual packages) through RevenueCat on iOS and Android, so
that the server, not the device, decides who is Premium: the SDK sits behind one port, the RevenueCat
user is the backend user, an authenticated and idempotent webhook writes the entitlement record from
RevenueCat's own state, and `check-revenuecat.mjs` proves it on the app's code.

**A fenced alternative to `in-app-purchases`.** `in-app-purchases` (expo-iap, no server) is the
library default. This skill replaces its expo-iap adapter, its save-before-finish order and its
no-server rules; the two SDKs never share an app. Load `in-app-purchases` only for its paywall-state,
restore, store-price-text and no-pop-up rules, which still apply here as written there.

## Rules that must hold

1. **`react-native-purchases` sits behind `SubscriptionPort`, with a fake.** Only
   `src/services/subscription/revenuecat-subscription-adapter.ts` imports it; screens, stores and
   services call the port; Jest and the dev build use `createFakeSubscription`. *Why:* tests then run
   without a native module, and the SDK's types and errors cannot leak into features
   (`sdk-outside-adapter`).
2. **The RevenueCat app user id is the backend user id.** Configure once with it, `logIn` on every
   account change, `logOut` on sign-out, never an anonymous `$RCAnonymousID`; sell nothing while a
   `logIn` is pending or failed. *Why:* the webhook can only write the record of a user it can name,
   and a purchase made under the previous user lands on the wrong account.
3. **The client entitlement drives the UI only.** Server decisions (quotas, premium-only endpoints)
   read the entitlement record through `resolvePlan(record, serverNowMs)`; no server code reads a
   plan, a Premium flag or `customerInfo` from a request. *Why:* anything the client sends can be
   forged, and the device's SDK cache can be stale (`client-entitlement-for-quota`).
4. **The webhook is authenticated before anything else.** The Authorization header is compared
   with the dashboard value in constant time (hash both, `timingSafeEqual`), and a wrong or missing
   one answers 401. *Why:* the endpoint is public and writes entitlements; `===` leaks timing
   (`webhook-unauthenticated`).
5. **The webhook is idempotent by event id.** Claim `event.id` create-if-absent before writing; a
   duplicate answers 200 without writing; a failure releases the claim and answers 500. *Why:*
   RevenueCat retries up to 5 times with the same id, and two deliveries can race
   (`webhook-not-idempotent`).
6. **The record comes from RevenueCat's REST state, never from the event body alone.** For every
   accepted event re-fetch each affected user (both sides of a `TRANSFER`) and derive `active`,
   `cancelled-active`, `grace`, `billing-retry`, `expired`, `refunded` or `none`; `resolvePlan`
   re-checks the times. *Why:* delivery order is not guaranteed, and a late expiration must never
   downgrade a renewed subscriber.
7. **After a purchase the app asks the server to sync.** A sync endpoint runs the same re-fetch for
   the caller; the UI shows "activating" until the record says Premium. *Why:* the webhook can take
   seconds to minutes, and a payer must not wait at a locked quota.
8. **Restore is always offered** on the paywall and in Settings, with in-app-purchases' honest
   outcomes ("couldn't restore" differs from "nothing to restore"). *Why:* App Review requires it, and
   a reinstall or a new phone needs it.
9. **Prices come from the store products, unchanged.** `priceString` and `pricePerMonthString`
   through `{priceText}` messages; never typed in code or catalogs, never divided or formatted from a
   number; no price string means "store unavailable". *Why:* each storefront has its own price and
   currency, and the paywall must match the purchase sheet (`hardcoded-price`).
10. **One purchase SDK.** No expo-iap, react-native-iap or another billing SDK beside RevenueCat, in
    a package.json, an import or the app config. *Why:* two SDKs both observe and finish store
    transactions (`mixed-purchase-sdks`).
11. **`react-native-purchases` is pinned exactly, with no config plugin, and real purchases run only
    in development or store builds.** 10.13.0 (verified 2026-10-21); the UI package, when used, on the
    same version; Expo Go runs a mock Preview API Mode. *Why:* RevenueCat ships often, and a "purchase"
    in Expo Go proves nothing.
12. **Keys stay where they belong.** The public SDK keys per platform and variant in
    `EXPO_PUBLIC_*`; the REST secret key and the webhook Authorization value only as server secrets;
    a Test Store key only in the development variant. *Why:* the secret key reads and deletes
    customers, and a Test Store key crashes a release build on purpose.
13. **Testing uses the routes that prove each layer:** Jest with the fakes, the Test Store or a
    StoreKit configuration file in development builds, App Store sandbox and TestFlight, Play license
    testers, and a webhook run on staging. *Why:* renewals, grace and refunds happen on the store's
    clock, and only sandbox runs show the real sheets.
14. **Humans do the console steps.** Agreements, products, prices, Family Sharing, the RevenueCat
    project, the restore behavior setting, the webhook settings and the secrets: ask in plain words
    and wait; never print a key.

## Workflow

1. Read [references/sdk-and-adapter.md](references/sdk-and-adapter.md). Ask the developer for the
   entitlement id, the product ids (naming-conventions' product-id grammar), Family Sharing and the
   restore behavior; copy `templates/contracts/` into `contracts/` and fill
   `contracts/subscriptions.json`, then `src/config/subscription-products.ts` with the same ids.
   From the repo root: `npm install -E react-native-purchases@10.13.0` and
   `npx expo install expo-dev-client` (re-verify the pin with
   `npm view react-native-purchases version time --json`). Remove expo-iap if the app had it.
2. Copy the client templates at the paths their first lines name: `templates/src/services/subscription/`,
   `templates/src/config/subscription-products.ts`, `templates/__mocks__/react-native-purchases.ts`
   and, when the repo lacks it, `templates/src/core/result.ts` (+ test). In the composition root create
   the adapter once with the platform's public key, and call `createSubscriptionIdentity(port)`'s
   `onUserChanged` from the auth listener (restore, sign-in, switch, sign-out).
3. Build the paywall with `in-app-purchases`' paywall-state, restore and no-pop-up rules on
   `SubscriptionPort`: offer from `getOffer`, prices from `packagePriceText` and
   `monthlyEquivalentText`, Restore, Terms, Privacy and the auto-renew notice; after a successful
   purchase call the sync endpoint and wait for the record.
4. Read [references/webhook.md](references/webhook.md). Copy `templates/server/src/subscriptions/` into
   the server folder named in the contract's `serverDirs`; implement the ledger and the record writer
   for the app's database. With Firebase, adapt
   [examples/firebase-revenuecat-webhook.ts](examples/firebase-revenuecat-webhook.ts) as the
   `onRequest` shell. Every quota and premium-only endpoint calls `resolvePlan`.
5. Run Tier 1: `npx jest src/services/subscription --ci --maxWorkers=2` in the app, and the
   `server/src/subscriptions/*.test.ts` files with the server project's own Jest (the app's
   `jest.config.js` tests `src/`, `scripts/`, `plugins/` and `test/` only; with Firebase, the `functions/` package).
6. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-revenuecat.mjs .`; fix every `FAIL` line (each names
   the file, the rule and the fix) and rerun until it prints `RESULT: PASS`. Its contract keys and
   the SKIP lines are in its `--help`.
7. Read [references/testing-routes.md](references/testing-routes.md); ask the developer for the
   console steps, then for the sandbox, StoreKit-file, TestFlight and license-tester runs and the
   staging webhook run, and report each result in plain words.

## Definition of done

- [ ] `react-native-purchases` is exactly 10.13.0 (or a newer verified pin), imported only by the adapter; no other purchase SDK in any package.json, import or app config.
- [ ] The SDK is configured once with the backend user id; `logIn`/`logOut` follow every account change; no anonymous app user id reaches the webhook.
- [ ] Every quota and premium-only endpoint resolves the plan from the entitlement record with server time; no request field or `customerInfo` decides it.
- [ ] The webhook answers 401 to a wrong or missing Authorization header (constant-time check), 200 once per event id, 500 with the claim released when RevenueCat's REST API fails, and writes both users of a transfer.
- [ ] The paywall shows the store's price strings unchanged, Restore is on the paywall and in Settings, and a successful purchase syncs the server.
- [ ] Tier 1 passes; the sandbox, TestFlight and license-tester runs and the staging webhook run were done by a person and recorded.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-revenuecat.mjs .` prints `RESULT: PASS`. Expected SKIP lines while the server does not exist yet: `<webhook file> [webhook-unauthenticated]` and `<webhook file> [webhook-not-idempotent]` (cloud-functions-backend creates it). An app without react-native-purchases prints `NOT APPLICABLE`.

## Anti-patterns

- **Unlocking a server feature because the app sent `isPremium: true`.** Read the record the webhook wrote; the client's word is a claim.
- **Writing the record from `event.expiration_at_ms`.** A late or replayed event then downgrades a renewed subscriber; re-fetch the subscriber.
- **`if (req.headers.authorization !== secret)`.** It leaks timing; hash both and use `timingSafeEqual`.
- **Deduplicating on `app_user_id + type`.** Two renewals collide and retries still double-process; claim `event.id`.
- **Answering 500 on a duplicate or a TEST event.** RevenueCat retries for 80 minutes; answer 200.
- **`Purchases.configure({ apiKey })` without `appUserID`, then `logIn` later.** The first purchase may land on an anonymous id; configure with the backend user id.
- **Keeping expo-iap "for the restore button".** RevenueCat restores; two SDKs fight over transactions.
- **"Only $4.99/month" in a catalog, or `price / 12` for the annual line.** Use `{priceText}` and `pricePerMonthString`.
- **Calling a purchase in Expo Go a test.** Preview API Mode returns mock data; use a development build.
- **A Test Store key in the preview variant.** TestFlight builds are release builds and crash on it.
- **Logging the webhook body.** It carries transaction ids, prices and attributes; log the event id, type and outcome.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/sdk-and-adapter.md](references/sdk-and-adapter.md) | Dated versions, install, Expo Go and dev builds, identity, the port and adapter facts, error codes, the listener, prices, RevenueCat Paywalls, what in-app-purchases still owns, multi-package | Workflow steps 1 to 3 |
| [references/webhook.md](references/webhook.md) | The flow, the Authorization header and HMAC signature, the event-id ledger, retries and timing, every event type, payload fields, REST derivation table, the record, transfers, sync, With Firebase | Workflow step 4, when a webhook FAIL line needs context |
| [references/testing-routes.md](references/testing-routes.md) | Jest, Expo Go, Test Store, StoreKit configuration file, sandbox and TestFlight, Play license testers, the webhook end to end, release checklist, human steps | Workflow steps 5 and 7 |
| [examples/firebase-revenuecat-webhook.ts](examples/firebase-revenuecat-webhook.ts) | With Firebase: the Cloud Functions `onRequest` shell, secrets, Firestore ledger and record writer | Workflow step 4, on Firebase |
| `templates/src/services/subscription/` | `SubscriptionPort`, the RevenueCat adapter (+ test), the fake (+ test), the identity sync (+ test), the price text helpers (+ test) | Workflow step 2 |
| `templates/src/config/subscription-products.ts` | `PREMIUM_ENTITLEMENT_ID` and the package ids, equal to the contract | Workflow step 1 |
| `templates/__mocks__/react-native-purchases.ts` | The root Jest mock with the real error and package enums | Workflow step 2 |
| `templates/server/src/subscriptions/` | Server-agnostic webhook handler (+ test), event parser, REST subscriber client (+ test), derivation, record and `resolvePlan` (+ test), ports, fakes, fixtures | Workflow step 4 |
| `templates/contracts/` | `subscriptions.json` (ids, server folders, webhook files) and its schema | Workflow step 1 |
| `templates/src/core/` | The canonical `result.ts` with its test (synced; do not edit here) | When the repo lacks it |
| `assets/template-placeholders.json` | Sample values for the template placeholders | When verifying templates |
| `assets/shared.json` | Declares the synced files | When adding a shared file |
| `scripts/check-revenuecat.mjs` | The checker: six rules, contract keys, SKIP and NOT APPLICABLE lines in its `--help` | Workflow step 6 and the definition of done |
| `scripts/selftest.mjs` | Proves the checker on the templates and every planted bug | After changing the checker, a template or a fixture |
| `scripts/lib/source-scan.mjs` | Shared TypeScript scanner, synced (do not edit here) | Never by hand |
| `scripts/check-lib.mjs` | Shared script helper, synced (do not edit here) | Never by hand |
| `tests/` | `bases/app`, `bases/bare` and the overlay cases in `fixtures/CASES.json` | When adding a rule |

## Related skills

- `in-app-purchases` - the library default (expo-iap, no server); its paywall-state, restore, store-price-text and no-pop-up rules apply here.
- `cloud-functions-backend` - the server project, secrets, instance limits and the sync callable's shell.
- `firestore-rules-and-emulator-tests` - rules that deny every client write to the entitlement record.
- `firebase-rnfb` - the app-side listener on the entitlement record.
- `app-variants-and-environment` - the public SDK keys per variant and the Test Store key in development only.
- `dependency-management` - the exact pin and the 7-day release age.
- `privacy-and-store-declarations` - the SDK row (purchase history) in the privacy contract.
- `error-handling-typed-results` - `Result` and the adapter boundary.
- `screen-contracts` - the paywall screen and its states.
- `naming-conventions` - the product-id grammar.
