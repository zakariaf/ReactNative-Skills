# The money model

## Contents

1. Decisions and reasons
2. The Money API
3. Currencies and the ISO 4217 table
4. Where Intl/CLDR disagrees with ISO 4217
5. Safe ranges and BigInt
6. One currency per aggregate, and conversion
7. Store prices (expo-iap 5.8.0)
8. iOS and Android
9. Pitfalls and fixes

## 1. Decisions and reasons

| Decision | Reason |
|---|---|
| Money is `{ minor, currency }`: an integer count of the currency's minor unit and an ISO 4217 code | `0.1 + 0.2 !== 0.3` in binary floats; integers add exactly. The code says what the integer means. |
| The minor unit comes from the ISO 4217 exponent (`10^exponent` minor units per major unit) | JPY has no minor unit (exponent 0), KWD has fils (3), CLF has 4. "Cents" and `* 100` assume 2. |
| The exponent table is generated from ISO 4217, never from Intl or CLDR | CLDR's *display* digits differ for 16 codes (section 4); a stored amount must not change meaning when a library updates. |
| An unknown code is a typed failure | `Intl.NumberFormat` formats a well-formed unknown code (`ZZZ`) with two decimals instead of throwing; a silent default mis-scales by 10 or 100. |
| `Money` is a branded type built only by `money()` and the core functions | Every `Money` in the app then holds a safe integer; an object literal `{ minor: 1.5 }` does not compile. |
| Arithmetic across currencies throws (a `RangeError`) | It is a programmer error, like an array index out of range; an expected failure (bad input) is a `Result`. |
| Internal arithmetic is BigInt; results return as numbers within `Number.MAX_SAFE_INTEGER` | `amount × weight` and `amount × rate numerator` pass 2^53 long before the amount does. |
| Totals are derived, never stored | A stored total is stale after the next edit; a fact of record (the amount charged) is not a total and is named so (`chargedMinor`). |
| Formatting lives in `src/i18n/`, parsing of localized text too | The pure core never sees digits other than ASCII, so it runs in Node, Jest and the checker unchanged. |

## 2. The Money API

All in `src/core/money/` (templates), pure TypeScript:

| Function | Contract |
|---|---|
| `money(minor, currency)` | Throws `RangeError` unless `Number.isSafeInteger(minor)`; turns `-0` into `0`; returns a frozen object |
| `zeroMoney(currency)` | `money(0, currency)` |
| `addMoney(a, b)`, `subtractMoney(a, b)` | Same currency or `RangeError`; an unsafe result throws |
| `negateMoney(a)` | Refunds, discounts |
| `multiplyMoney(a, quantity)` | Whole quantities only (3 × 4.99); a fractional factor is a rate (`applyRate`) |
| `sumMoney(amounts, currency)` | Zero for an empty list, so totals need no guard |
| `compareMoney(a, b)` | `-1`, `0`, `1`; mixed currencies throw |
| `equalsMoney(a, b)` | Value equality; `false` across currencies (never `===` on two objects) |
| `parseCurrencyCode(code)` | `Result<CurrencyCode, { kind: 'unknown-currency', code }>`; a `Map` lookup, so `'toString'` is unknown |
| `exponentOf(currency)` | The ISO 4217 exponent |
| `allocate`, `allocateMinor`, `splitEvenly` | allocation-and-rates.md |
| `applyRate`, `includedTax`, `convertMoney`, `parsePercent`, `parseDecimalRate`, `basisPoints` | allocation-and-rates.md |
| `parseMoney(text, currency)`, `toDecimalString(amount)` | Canonical ASCII decimal text, exact; edge-formatting-and-input.md |
| `moneyFromMicros(micros, currency)`, `moneyFromStoreDouble(price, currency)` | Section 7 |

Equality in tests: `expect(a).toStrictEqual(money(150, 'USD'))` works (the brand is type-only).

## 3. Currencies and the ISO 4217 table

`currency-exponents.ts` is generated from SIX's "list one" (the ISO 4217 maintenance agency), published
2026-09-17, verified 2026-10-10: 165 active codes, 17 with exponent 0, 139 with 2, 7 with 3 (BHD, IQD,
JOD, KWD, LYD, OMR, TND), 2 with 4 (CLF, UYW). Codes whose minor unit is "N.A." (XAU, XAG, XPD, XPT, XDR,
XSU, XUA, XBA to XBD, XTS, XXX) are left out: they are not money an app charges.

- **An app may delete rows** it never accepts (a smaller table, a smaller `CurrencyCode` union). It
  never edits an exponent and never adds a non-ISO code. Points, credits and crypto amounts are their
  own value objects with their own scale; `check-value-core.mjs` fails a code that is not in ISO 4217.
- **Refresh** when SIX publishes an amendment (a new currency such as ZWG in 2024, or a removed one):

  ```sh
  curl -sSLo list-one.xml https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
  node ${CLAUDE_SKILL_DIR}/scripts/check-value-core.mjs . --iso-xml list-one.xml
  ```

  A `FAIL [exponent-table]` names each code that changed; update the table rows, rerun the tests,
  then the plain check (which compares with the copy in `assets/iso-4217.json`).
- **Persist the code, not the exponent,** next to the amount (on the aggregate row): the exponent is a
  property of the code, and a code is three upper-case ASCII letters (`CHECK (length(currency) = 3)`).

## 4. Where Intl/CLDR disagrees with ISO 4217

`new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits`
under the forced FormatJS polyfill (`@formatjs/intl-numberformat` 9.4.3) and under Node 26.4's ICU
gives the same answer, and differs from ISO 4217 for these codes (verified 2026-10-10):

| CLDR shows | Codes (ISO exponent) |
|---|---|
| 0 decimals | IQD (3); AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP, YER (2) |

So 12345 IQD minor units are 12.345 dinars, and a formatter left at CLDR's digits prints "IQD 12".
`formatMoney` therefore sets `minimumFractionDigits` and `maximumFractionDigits` to the exponent
(`currency-fraction-digits`). Prices people pay in these currencies are often whole numbers anyway;
that is a display choice the app may make explicitly, never a storage rule.

Re-verify: `node -e "for (const c of ['IQD','HUF','COP']) console.log(c, new Intl.NumberFormat('en',{style:'currency',currency:c}).resolvedOptions().maximumFractionDigits)"`
(Node's ICU), and the same after `require` of the polyfill files listed in `src/i18n/intl-polyfills.ts`.

## 5. Safe ranges and BigInt

`Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 minor units: about 90 trillion in a 2-decimal
currency, 9 trillion in KWD, 900 billion in CLF. `money()` refuses anything beyond; the sum functions
throw before precision is lost. Intermediate products use BigInt:

- **Hermes supports BigInt** (Hermes "Language Features": BigInt is listed as supported; React Native
  0.86 ships Hermes by default). TypeScript's target is ESNext in the Expo base config, so `BigInt` and
  `bigint` type-check. The templates call `BigInt(0)` rather than writing `0n` literals, which keeps
  every toolchain (Babel, Metro, Node type stripping) on the plain call.
- **JSON has no BigInt.** `JSON.stringify(1n)` throws; the core returns numbers, and BigInt never
  leaves a function.
- **SQLite INTEGER is 64-bit** and expo-sqlite returns numbers: a value beyond 2^53 would round on
  read, which `money()` would then refuse rather than show.

## 6. One currency per aggregate, and conversion

The currency is a fact of the aggregate (an Order, an Account, a wallet), stored once on its row;
its lines hold `Money` in that currency, so mixing is caught at the first `addMoney`. An app with
several currencies keeps a total per currency (`Map<CurrencyCode, Money>`), never one number.

Converting is a business event with a rate that has a source and a time:

```ts
type ExchangeRate = {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly perUnit: Rate; // parseDecimalRate('0.0067'): major units of `to` per major unit of `from`
  readonly asOfMs: number; // when the provider quoted it
  readonly source: string; // which provider
};
const usd = convertMoney(priceJpy, { to: 'USD', perUnit: rate.perUnit }, 'half-even');
```

`convertMoney` scales minor units by `10^(exponent of to − exponent of from)` inside one exact
division and rounds once: 1000 JPY at 0.0067 is 670 US cents; 19.99 USD at 0.3074 is 6.145 KWD (6145).
Store the converted amount together with the rate used when it is a fact of record (an invoice);
recompute it when it is a preview. A rate older than the app's limit is shown as stale, from the
injected clock, never `Date.now()` (dates-streaks-and-statistics owns the clock).

## 7. Store prices (expo-iap 5.8.0)

Read in `node_modules/expo-iap/build/types.d.ts` (5.8.0, 2026-10-10):

| Field | Type | Meaning |
|---|---|---|
| `displayPrice` | `string` | The store's own localized price text ("€1.99", "1,99 €"): the price to show for buying |
| `price` | `number \| null` (optional) | The price as a binary double, on `ProductIOS` and `ProductAndroid` alike |
| `currency` | `string` | The ISO 4217 code of the storefront |
| Android `subscriptionOffers[].pricingPhasesAndroid.pricingPhaseList[].priceAmountMicros` | `string` | A subscription phase's price in millionths of the currency unit, an integer string; the last phase is the recurring price |
| Android `discountOffers[].fullPriceMicrosAndroid`, `discountAmountMicrosAndroid` | `string \| null` | A one-time product's discount offer (Play Billing 8): the full price before the discount and the discount, in micros |

**A one-time product has no top-level micros in expo-iap 5.8.0.** `ProductAndroid` carries only
`price` (a double) and `displayPrice`, the same as iOS; Play Billing's own
`oneTimePurchaseOfferDetails.priceAmountMicros` is not in its type. So a one-time product (the
Premium unlock) converts the double with `moneyFromStoreDouble` on both platforms, and the exact
micros path applies to Android subscriptions (and, for a strikethrough "was" price, to a discount
offer's `fullPriceMicrosAndroid`). `examples/product-price.ts` reads the micros of the first
subscription offer's last phase and falls back to the double.

- On iOS, StoreKit's `Product.price` is a `Decimal`; through the bridge it becomes a JS number, and
  1.99 arrived as `1.9899999999999998` (seen on an iOS simulator with a StoreKit configuration).
  `moneyFromStoreDouble` rounds to the nearest minor unit only when the difference is double noise
  (below 1e-4 minor units) and refuses a real extra digit.
- On Android, micros are exact where expo-iap gives them (subscription phases, discount offers):
  `moneyFromMicros('1990000', 'EUR')` is 199 cents; micros that fall between two minor units are
  refused. A one-time Android product's `price` is a double like iOS's and takes the same path.
- **Show `displayPrice` for the price to pay**: it is what the store charges, in the storefront's
  format. Use the Money value for arithmetic ("save 40 % with yearly", comparing two products) and
  format such derived amounts with `formatMoney`.
- The storefront currency is not the device locale's currency (a German phone in a US storefront pays
  USD): always take `currency` from the product.
- in-app-purchases owns the purchase flow and the adapter; this skill owns only the conversion.

## 8. iOS and Android

| Topic | iOS | Android |
|---|---|---|
| Device currency (`getLocales()[0].currencyCode`, expo-localization SDK 57) | From the Region setting under Language & Region | The currency of the locale in the list (no separate region setting) |
| `currencyCode` on web | — | — (null on web; use a table by region) |
| Store price (expo-iap 5.8.0) | StoreKit `Decimal` → JS double (`price`) | One-time products: the double `price` only; subscriptions: phase micros (exact) and the double |
| Decimal keyboard (forms-and-input's `TextField` kind `'decimal'`, the decimal pad) | Shows the locale's decimal separator | Depends on the keyboard app; some show only `.`: accept both (edge-formatting-and-input.md) |
| BigInt, Intl formatting | Hermes BigInt; formatting from the forced FormatJS polyfill, identical on both | Same |

The device currency is at most a default for a new aggregate; it never re-labels stored money.

## 9. Pitfalls and fixes

| Pitfall | Fix |
|---|---|
| `price: number` holding 19.99 | `Money`, or `priceMinor: number` holding 1999 |
| `cents` in names | `minor`: JPY has no cents and KWD has 1000 fils |
| `exponentOf(code) ?? 2` for a code from an API | `parseCurrencyCode` and handle `unknown-currency` |
| Taking digits from `resolvedOptions()` | The exponent table (section 4) |
| `a.minor + b.minor` | `addMoney(a, b)`; it checks the currency and the range |
| One `total` number across currencies | A total per currency |
| Converting at display time with a live rate and storing the result | Store the amount in its own currency; convert with a dated rate only when the conversion is a fact |
| `JSON.stringify` of a BigInt | BigInt never leaves the core |
| Formatting `productPrice` as the price to pay | `displayPrice` |
