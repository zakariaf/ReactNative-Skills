# The checkers

## Contents

1. check-value-code
2. check-value-core
3. How names are judged
4. The allow marker
5. Options and layout
6. Expected output
7. Troubleshooting
8. When multi-package

## 1. check-value-code

`node ${CLAUDE_SKILL_DIR}/scripts/check-value-code.mjs [repo-root]` scans every `.ts`/`.tsx` file under
the source folder (`src/`), tests left out. The money rules skip the money core (`src/core/money/`)
and `src/core/decimal/`, which implement the arithmetic, and `src/games/`, which holds game points,
not money.

| Rule | Fails on | Fix |
|---|---|---|
| `float-money` | A money name typed `number` (or `number[]`) without a `Minor`/`Micros` suffix; a money-named `const`/`let`/`var` or object key set to a decimal literal (`deliveryFee = 2.99`, `{ serviceFee: 1.5 }`, and `priceMinor: 19.99`, a fraction in a minor-unit name; the canonical lint's `no-inferrable-types` makes this untyped form the usual one), while rates and ratios (`taxRate = 0.0825`, `opacity`) stay silent; `parseFloat` on a line with a money name; a money-named schema key (`<what>Minor` included) whose value holds `v.number()`/`z.number()` without `v.safeInteger()`, `v.integer()`, `.int()` or `.safe()`, also inside `v.pipe`, `v.optional`, `v.nullable` | `Money`, or `<what>Minor`; `parseMoney`; `v.pipe(v.number(), v.safeInteger())` |
| `hard-coded-scale` | A money expression `* 100`, `/ 100`, `* 1000`, `/ 1000` (either side); `Number(...)`, `parseFloat(...)` times 100 or 1000 on a line with a money name (`const priceMinor = Math.round(Number(text) * 100)`); `.toFixed(` on a line with a money name or `.minor` | `parseMoney`, `toDecimalString`, `formatMoney` |
| `exponent-default` | `?? 2` or `\|\| 2` on a line about exponents, decimals or fraction digits | `parseCurrencyCode` and its failure |
| `money-division` | A money expression divided by something that is not money (a count, a number) | `allocate`, `splitEvenly` |
| `money-float-rate` | A money expression times a decimal literal or a name ending in `Rate`, `Percent`, `Pct`, `Ratio`, `Factor`, `Multiplier` | `applyRate` with an exact `Rate` |
| `raw-minor-arithmetic` | `+ - * / %` (and their `=` forms, unary minus) next to `.minor` | `addMoney`, `subtractMoney`, `negateMoney`, `multiplyMoney` |
| `currency-format-edge` | `style: 'currency'` outside `src/i18n/` | `formatMoney`, `useFormatMoney` |
| `currency-fraction-digits` | An `Intl.NumberFormat` with `style: 'currency'` lacking `minimumFractionDigits`/`maximumFractionDigits`, or setting them to a literal | `exponentOf(currency)` for both |
| `currency-symbol-literal` | A template literal with a currency symbol next to an interpolation (`` `$${x}` ``), or a symbol string joined with `+` | `formatMoney` |
| `core-formats` | `Intl.`, `toLocaleString(`, `toFixed(`, `toPrecision(` in `src/core/` | Format in `src/i18n/` |
| `unit-suffix` | In type declarations of `src/core`, `src/stores`, `src/data`, `src/services`, `src/api`: a number named with a physical word and no unit | `durationMs`, `distanceMm` |
| `instant-type` | In type declarations of `src/core`, `src/stores`, `src/data`, `src/services`: any `Date`; an instant name (`*At`, `*Timestamp`) typed `string`, or `number` without `Ms` | `<what>AtMs: number` |
| `money-column` | SQL in a string: a money-named column that is not an integer type, or not named `_minor`/`_micros` | `<name>_minor INTEGER NOT NULL` |
| `instant-column` | SQL in a string: `*_at`, `*_timestamp` not ending in `_ms`, or `*_at_ms` not `INTEGER` | `<name>_at_ms INTEGER` |
| `money-core` | The app handles money (a `Money` or money-named number, or currency formatting) but `src/core/money/money.ts` does not exist. A field whose line carries a `float-money` allow marker (a vendor's double mirrored in an adapter type) is not a signal on its own | Copy the core templates |
| `core-tests` | A module in `src/core/{money,units,time,decimal}/` without a sibling `.test.ts` (`currency-exponents.ts` excepted: `currency.test.ts` covers it) | Add the test |

## 2. check-value-core

`node ${CLAUDE_SKILL_DIR}/scripts/check-value-core.mjs [repo-root]` imports the app's own modules as
pure TypeScript (Node type stripping, tsconfig aliases) and runs the rules:

| Rule | Module | Checks |
|---|---|---|
| `missing-module` | the money core | Once any money module exists, all six exist: `currency.ts`, `currency-exponents.ts`, `money.ts`, `allocate.ts`, `rate.ts`, `money-text.ts` |
| `module-load` | any | The module loads without React Native, Expo or app layers |
| `exponent-table` | `currency-exponents.ts` | Every row is an ISO 4217 code with its ISO exponent (the bundled list, or `--iso-xml`) |
| `unknown-currency` | `currency.ts` | `ZZZ`, `usd`, `XAU`, `XXX`, `toString`, `''` are `unknown-currency` failures |
| `money-integer` | `money.ts` | `money()` refuses 1.5, NaN, Infinity, 2^53 |
| `cross-currency` | `money.ts` | Mixed currencies throw in add, subtract, compare, sum; an unsafe sum throws; equality by value |
| `allocate-vectors` | `allocate.ts` | The nine pinned vectors |
| `allocate-conservation` | `allocate.ts` | 400 seeded cases (half near zero, half near 4×10^15, weights up to 10^9): sums, one-unit bound in BigInt, negative mirror, repeatability |
| `allocate-refuses` | `allocate.ts` | No weights, a negative weight (`[2, -1]`), a fractional weight, a fractional amount |
| `apply-rate` | `rate.ts` | 19 % of 10.05 EUR, ties under half-even and half-expand, a negative tie, `parsePercent('8.25')`, a float numerator refused |
| `convert-money` | `rate.ts` | JPY to USD and USD to KWD across exponents |
| `parse-money` | `money-text.ts` | Eight parse vectors, extra decimals refused, seven malformed texts refused, the largest safe amount round-trips |
| `store-price` | `store-price.ts` (optional) | Micros exact or refused; StoreKit's 1.9899999999999998; 1.999 USD refused |
| `units-exact` | `units.ts` (optional) | Mile, inch, pound, gallon factors; half-even ties; comma text refused |
| `instant-parse` | `instant.ts` (optional) | Z and offset forms, milliseconds, date-only, missing offset, 29 February 2026, `toIsoInstant` |

With none of `src/core/money/money.ts`, `src/core/units/units.ts` and `src/core/time/instant.ts`
present, it prints `NOT APPLICABLE: no value-object core: ...` (an app with no money, quantities or
instants yet).

## 3. How names are judged

Both checkers split a name into lower-case segments (`totalPriceMinor` → total, price, minor;
`price_minor` → price, minor) and judge the words and the last segment (`scripts/lib/value-names.mjs`):

- **Money words**: price, amount, cost, subtotal, balance, fee, tax, tip, discount, refund, payment,
  payout, salary, wage, budget, revenue, spend/spent, earnings, fare, deposit, money, cash, cent (and
  plurals). `total`, `credit` and `charge` are left out on purpose (task totals, game credits,
  battery charge).
- **A `<what>Minor` or `<what>Micros` name is money whatever `<what>` is** (`totalMinor`,
  `chargedMinor`, `orderTotalMinor`, `total_minor`), because the skill names every plain money number
  that way: `Math.round(totalMinor / people)`, `(orderTotalMinor / 100).toFixed(2)`,
  `chargedMinor * 0.1` and a `total_minor REAL` column all fail. A bare `total` stays unjudged.
- **`amount` after a UI or motion word** is not money: `blurAmount`, `scrollAmount`, `shakeAmount`,
  `offsetAmount`, `rotationAmount`, `zoomAmount` and the like (the list is `NOT_MONEY_AMOUNT`).
- **Not an amount** when the last segment is a rate, count, id, key, label, text, name, index, type,
  kind, code, currency, display, formatted, title, description, mode, `at`/`ms`/date/day (an instant
  or a day), level, step, tier, url, sku, status, category, string, enabled, visible, shown, error,
  failure, message or schema: `taxRate`, `priceLabel`, `paymentAtMs`, `tipCount` pass.
- **Minor units**: a last segment `minor` or `micros`.
- **Units**: a physical word (duration, timeout, delay, interval, elapsed, ttl, age, distance,
  weight, mass, temperature, speed, altitude, elevation) needs a last segment that names a unit
  (`ms`, `s`, `min`, `h`, `days`, `weeks`, `months`, `years`, `mm`, `m`, `km`, `g`, `kg`, `ml`,
  `bytes`, `c`, `deg`, `mps`, ...) or says it has none (`count`, `ratio`, `index`): `ageYears` passes.
- **Instants**: a last segment `at` with a prefix (`createdAt`; a bare `at`, a step or version, is not
  one), `timestamp`, or `at` + `ms` (`createdAtMs`, `at_ms`).

## 4. The allow marker

A line, or the line above it, holding `// value-objects-allow <rule>[, <rule>]: <reason>` is exempt
from those rules in check-value-code. The reason is required: a marker without one exempts nothing.
Use it for a vendor's own field (expo-iap's `price` double mirrored in the adapter type, converted on
the next line), a chart axis in major units, or a domain word that is not money in this app. A marker
is a reviewed exception; prefer renaming.

### Known limits of the scanner

check-value-code reads names and expression shapes, not types, so it has blind spots that a review
covers. Each is a deliberate trade against false alarms:

- **Unnamed money**: `Math.round(total / people)` with a bare `total`, or `x * 100` where `x` holds
  money under a neutral name, passes. Name money (`totalMinor`, `Money`) and the rules see it.
- **Indirect values**: a rate in a variable without a rate-like suffix (`const k = 0.0825;
  priceMinor * k`) or a scale through a constant (`priceMinor / CENTS_PER_UNIT`) is a division or a
  multiplication by a name the checker cannot judge; `money-division` still catches the division.
- **Schemas**: the schema check reads a `key: v.…` or `key: z.…` property up to its closing comma.
  A schema built elsewhere and referenced by name (`price: moneyNumber`) is judged where
  `moneyNumber` is declared only if that declaration has a money name.
- **Parsed scales**: `Number(...) * 100` counts only on a line that names money, so a percent or a
  seconds-to-milliseconds conversion (`Number(text) * 1000` for a `timeoutMs`) is not a finding.
- **Interfaces**: `unit-suffix` and `instant-type` read `type X = { ... }` aliases and annotated
  declarations, not `interface X { ... }` bodies (the shared scanner has no interface region yet).
  The canonical lint (`consistent-type-definitions: type`) makes every declaration a `type`; an app
  adopting the skill with interfaces converts them, or the fields go unchecked.
- **Other words**: an app whose domain uses a money word for something else (an `amount` of items, a
  `tip` of a pen) renames or adds the allow marker with the reason (section 4).

## 5. Options and layout

Both checkers take the repo root as an optional positional argument (default `.`) and resolve folders
through `rn-skills.config.json` and the tsconfig aliases (`srcDir`, `coreDir`, `i18nDir`, `storesDir`,
`dataDir`, `servicesDir`, `apiDir`). Options:

| Option | Checker | Meaning |
|---|---|---|
| `--money-dir <dir>` | both | The money core folder (default `<coreDir>/money`) |
| `--units-file <file>` | check-value-core | The units module (default `<coreDir>/units/units.ts`) |
| `--instant-file <file>` | check-value-core | The instant module (default `<coreDir>/time/instant.ts`) |
| `--iso-xml <file>` | check-value-core | Compare with a downloaded ISO 4217 list one instead of the bundled copy |
| `--json` | both | Also print the problems as one JSON line |

## 6. Expected output

```
check-value-core: 13 checks checked, 0 problems
RESULT: PASS
check-value-code: 168 files checked, 0 problems
RESULT: PASS
```

Neither checker prints SKIP lines. check-value-core prints NOT APPLICABLE as described in section 2; a
root without `src/` is exit 2 for both.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `module-load ... plain Node cannot load` | A core module imports React Native, Expo, a `.tsx` file or uses an enum or namespace; keep the core pure |
| `module-load ... imports @/core/result ... which does not exist` | Copy `src/core/result.ts` (error-handling-typed-results; a synced copy is in this skill's templates) |
| `float-money` on a vendor type | Mirror the vendor field with the allow marker and convert it on the next line |
| `float-money` on a word that is not money in this app (`amount` of items) | Rename (`itemCount`) or add the allow marker with the reason |
| `money-division` on a ratio | Name both sides as money (`spentMinor / budgetMinor`) so the checker sees a ratio |
| `exponent-table` after an SDK or library update | Exponents do not come from libraries; restore the generated table |
| `allocate-conservation` only | Shares computed with floats: multiply and divide in BigInt |
| A FAIL in a file a template wrote | The template changed in the app; compare with this skill's template and its test |

## 8. When multi-package

Run both checkers once per app, with the app folder as the root
(`node ${CLAUDE_SKILL_DIR}/scripts/check-value-code.mjs apps/mobile`). A shared core package
(`packages/core/src/money/`) is checked by pointing
`--money-dir` at it from the app that imports it, or by running check-value-core with that package as
the root when it has its own `tsconfig.json` with the `@/*` alias.
