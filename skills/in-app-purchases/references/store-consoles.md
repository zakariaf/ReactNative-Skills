# The product in App Store Connect and Play Console

## Contents

- Product rules
- The developer's decisions (the contract)
- Creating the iOS product with the API
- Remaining App Store Connect steps
- Play Console
- Human steps

## Product rules

- One non-consumable product per app, the same id on both stores: usually `<bundle id>.premium`
  (`com.example.tasks.premium`). The id follows naming-conventions' product-id grammar: lowercase
  letters, digits, `.` and `_`, a letter or digit first, at most 40 characters, never `android.test*`.
  Apple also accepts uppercase and `-`, Play does not, so the grammar is the intersection.
- Product ids can never be changed or reused, in App Store Connect even after deletion and in Play
  Console after creation. Choose it once, write it in `contracts/in-app-purchases.json` `productId` and
  `src/config/purchase-products.ts`, and never "fix" a live one (naming-conventions'
  `publishedProductIds` records one that already exists in another shape).
- iOS type `NON_CONSUMABLE`, reference name "Premium"; Play: a one-time product (in Play Console's
  current model, a one-time product with a buy option).
- Store texts (display name 2-30 characters, description at most 45 on App Store Connect) live in the
  contract's `storeTexts`; the app never shows them.
- The first non-consumable must be submitted with a new app version (App Store Connect: select it on
  the version page before "Submit for Review").

## The developer's decisions (the contract)

`contracts/in-app-purchases.json` holds what only the developer decides; the agent asks, writes the
answer, and never guesses:

| Key | Decision | Who reads it |
|---|---|---|
| `productId` | the id (see above) | the checker, the StoreKit file, `create-premium-iap.ts` |
| `price.amount`, `price.currency`, `price.baseTerritory` | the price point in the base territory (for example `2.99` USD in `USA`); the stores equalise the other territories, and the app always shows the price the store reports | the StoreKit file (`displayPrice`, `_storefront`), `create-premium-iap.ts` |
| `familyShareable` | Family Sharing (default `false`). Once turned on in App Store Connect it can never be turned off for that product; if on, a family member's access can be revoked, which the evidence rule handles like a refund | the StoreKit file, `create-premium-iap.ts` |
| `storeTexts`, `reviewNote` | the console texts and what App Review reads | `create-premium-iap.ts` |
| `allowedApis`, `allowedConfigWords` | the server profile or another billing SDK, if the developer chose one | the checker |

The price can change later in the consoles without an app update; change the contract and the StoreKit
file with it so the test store keeps matching.

## Creating the iOS product with the API

The App Store Connect API can create the in-app purchase, its localizations, price schedule,
availability, review screenshot and submission; it cannot create the app record (a human step).
Templates in `scripts/asc/`:

- `iap-contract.ts`: reads and validates the contract (id grammar, price, store-text limits).
- `premium-iap-payloads.ts`: pure request bodies: `createIapBody(appId, contract)` (`NON_CONSUMABLE`,
  `familySharable` from the contract), `localizationBody(iapId, storeText)`,
  `closestPricePoints(points, target)`, `priceScheduleBody(iapId, pricePointId, territory)` (the
  `'${price-0}'` string is JSON:API local-id syntax, not a template), `availabilityBody`,
  `screenshotReserveBody`, `screenshotCommitBody`.
- `create-premium-iap.ts <bundleId>`: finds the app by bundle id, finds or creates the product
  (`GET /v1/apps/{id}/inAppPurchasesV2?filter[productId]=...`, `POST /v2/inAppPurchases`), adds missing
  localizations (`POST /v1/inAppPurchaseLocalizations`), reads the base territory's price points
  (`GET /v2/inAppPurchases/{id}/pricePoints?filter[territory]=<territory>&limit=8000`, one page holds
  them all), takes the exact contract price or stops with the three nearest, and posts the price
  schedule (`POST /v1/inAppPurchasePriceSchedules`, which replaces an existing one). Re-running is safe.
- `asc-jwt.ts`, `asc-credentials.ts`, `asc-client.ts`: the ES256 JWT (15-minute lifetime; Apple rejects
  more than 20), the key loader and the fetch client. If the repo already has them (the iOS release
  work), keep the existing files. `scripts/clock/system-clock.ts` (canonical) is the only tooling module
  that reads the wall clock.

Credentials: the tools read `ASC_KEY_ID` and `ASC_ISSUER_ID` from the environment (the developer's
shell profile, never the repo); only `asc-credentials.ts` reads
`~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, into memory. Never open, print, copy or log the
key or a JWT made from it; error messages carry the API's error body only. A team key with the App
Manager role is enough.

Schemas were read from Apple's API reference; the script has not run against the live API for this
skill (it needs the developer's key): its first run is part of the first store step, after the
developer said yes.

## Remaining App Store Connect steps

| Step | Endpoint | Body | Note |
|---|---|---|---|
| Availability | `POST /v1/inAppPurchaseAvailabilities` | `availabilityBody(iapId, territories)` | territory ids from `GET /v1/territories?limit=200` (follow `links.next`); `availableInNewTerritories: true` |
| Review screenshot | `POST /v1/inAppPurchaseAppStoreReviewScreenshots` -> PUT the bytes to each upload operation -> `PATCH` the reserved screenshot | `screenshotReserveBody`, then `screenshotCommitBody` (md5 hex) | a paywall screenshot at an App Store screenshot size; used for review only |
| Submission | with the first app version | none | the developer selects Premium on the version page; later products can use `POST /v1/inAppPurchaseSubmissions` |

Add availability and the screenshot as two more steps of `create-premium-iap.ts` with the same `call`
helper (read the current state first and skip what exists, so re-runs stay safe).

## Play Console

There is no script here: Play Console products are created by hand (the Play Developer API can create
them too, which a later script may use with the same contract).

1. The app exists in Play Console with the release package name, and one build was uploaded to a track
   (internal testing is enough) after the Play Billing library was added: Play shows the products page
   only then.
2. Monetize -> Products -> One-time products -> Create: product id = the contract's `productId`, name and
   description from `storeTexts`, the price from the contract (Play converts other countries), then
   activate it.
3. Settings -> License testing: add the testers' Google accounts (references/testing-tiers.md).
4. Data safety: payment data that Google Play's billing system collects is exempt (Data safety help,
   answer 10787469). Without the server profile the Premium flag never leaves the device, so there is
   nothing to declare. With the server profile, declare Financial info > Purchase history
   (privacy-and-store-declarations audits it).

## Human steps

Ask the developer, in plain words, and wait:

- **Once per developer account:** the Paid Apps Agreement, tax and banking in App Store Connect; the
  payments profile in Play Console. Without them the product cannot be sold or reliably tested.
- **Per app:** create the App Store Connect app record (no API for it) and the Play Console app with the
  release ids.
- **Per app:** decide the price point, the base territory and Family Sharing (write them in the
  contract); approve running `create-premium-iap.ts`, or create the product in the web UI
  (Monetization -> In-App Purchases -> + -> Non-Consumable) with exactly the contract's values; create
  the Play product.
- **First release:** add Premium under "In-App Purchases and Subscriptions" on the version page before
  submitting.
- **Per app and after an expo-iap upgrade:** the Tier 3 runs on TestFlight and a Play testing track.
