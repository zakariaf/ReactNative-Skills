# Storage, the wire and tests

## Contents

1. SQLite columns
2. What SQLite does with numbers (verified)
3. JSON and API shapes
4. Validation at the boundary
5. Client state
6. Exports
7. Test recipes
8. Mutation testing

## 1. SQLite columns

Tables are STRICT and migrations hold literal SQL (persistence-and-migrations owns both). For values:

| Value | Column | Notes |
|---|---|---|
| Money | `<name>_minor INTEGER NOT NULL` | Plus `currency TEXT NOT NULL CHECK (length(currency) = 3)` once on the aggregate row |
| A rate | `<name>_bps INTEGER` | Basis points; or decimal text in a `TEXT` column when more precision is needed |
| An instant | `<name>_at_ms INTEGER` | Epoch milliseconds |
| A local day | `<name>_on TEXT` | A DateKey `YYYY-MM-DD` (dates-streaks-and-statistics) |
| A quantity | `<name>_<unit> INTEGER` | `distance_mm`, `duration_ms`, `size_bytes` |
| A total | none | Derived on read; a fact of record (`charged_minor`) is not a total |

`check-value-code.mjs` reads column definitions in string literals that hold `CREATE TABLE` or `ALTER
TABLE`: a money-named column must be an integer type named `_minor` (or `_micros`) (`money-column`); a
column named `*_at`, `*_timestamp` or `*_at_ms` must be `*_at_ms` and `INTEGER` (`instant-column`).

## 2. What SQLite does with numbers (verified)

Verified with `node:sqlite` (SQLite 3.53.2) on 2026-10-10; expo-sqlite bundles the same engine family:

| Statement | Result |
|---|---|
| `CREATE TABLE a (x DECIMAL) STRICT` | Error: `unknown datatype for a.x: "DECIMAL"`; STRICT allows INT, INTEGER, REAL, TEXT, BLOB, ANY |
| Inserting `19.99` into an `INTEGER` column of a STRICT table | Error: `cannot store REAL value in INTEGER column` |
| `sum(price_minor)` over integers | An integer (`typeof` is `integer`) |
| `sum()` past 2^63 − 1 | Error: `integer overflow` |
| `avg(price_minor)` | A real, even when the mean is whole |
| `total(price_minor)` | A real |
| `7/2` | `3` (integer division truncates) |
| `sum(r)` over REAL 0.1 and 0.2 | `0.30000000000000004` |

So aggregate money in SQL with `sum()` only, and do averages, shares and rates in TypeScript with the
core (`allocate`, `applyRate`). Values come back from expo-sqlite as JS numbers; build Money from them
with `money()` in the repository, which refuses a corrupted row instead of showing it
(`examples/order-row.ts`).

## 3. JSON and API shapes

On the wire, money is one of:

- **Decimal text and a code**: `{ "total": "12.345", "currency": "KWD" }`. Parse with
  `parseCurrencyCode` then `parseMoney` (exact, refuses extra decimals).
- **Integer minor units and a code**: `{ "total_minor": 12345, "currency": "KWD" }`. Validate as a
  safe integer, then `money()`.

Never a JSON number with a fraction (`"total": 12.345`): `JSON.parse` turns it into a double before
any code can see the text. If a third-party API sends one anyway, read the response as text and parse
that field as decimal text, or accept the double through a single, named conversion with a tolerance
check like `moneyFromStoreDouble`, marked with the allow marker and its reason.

Instants on the wire are ISO 8601 with `Z` or an offset (units-and-instants.md); quantities are
integers in a documented unit or decimal text with a unit field.

## 4. Validation at the boundary

valibot (the canonical stack) checks the shape; the core converts the values:

```ts
const orderSummarySchema = v.object({
  total: v.pipe(v.string(), v.regex(/^-?\d+(\.\d+)?$/)), // decimal text
  currency: v.pipe(v.string(), v.length(3)),
  tip_minor: v.pipe(v.number(), v.safeInteger()), // integer minor units
  created_at: v.string(), // ISO 8601, parsed by parseIsoInstant
});
```

`check-value-code.mjs` fails a money-named field that is a bare `v.number()` (or `z.number()`)
(`float-money`). The conversion function returns a `Result` with a kebab-case failure kind
(error-handling-typed-results), as `examples/order-response.ts` shows.
networking-and-server-state owns the ApiClient and where this runs.

## 5. Client state

Zustand stores hold `Money` values (plain frozen objects, safe to persist as JSON: `{ "minor": 1999,
"currency": "USD" }`), unit-named integers and epoch milliseconds. On rehydration from storage, rebuild
each amount with `money()` (and the code with `parseCurrencyCode`) in the store's codec, so a
corrupted or hand-edited value becomes a failure, not a wrong total. Totals are selectors over the
stored inputs (state-management-zustand), never state of their own.

## 6. Exports

A data export (data-export-and-restore) writes the canonical forms: decimal text with the code, or
minor units with the code; epoch milliseconds or ISO 8601 with `Z`. A CSV meant for a spreadsheet may
add a formatted column for people, never instead of the canonical one; import reads only the canonical
one.

## 7. Test recipes

- **Pinned vectors**: allocation (allocation-and-rates.md section 3), parsing per exponent
  (`'1.50'` USD → 150, `'125.00'` KWD → 125000, `'125'` JPY → 125, `'0.001'` OMR → 1, `'12.345'` IQD →
  12345), conversion across exponents, rates on a tie.
- **Properties** with fast-check: allocation conservation (with amounts near the safe limit and
  weights up to 10^9), decimal-text round trip for every currency (`parseMoney(toDecimalString(m))`
  equals `m`), unit round trip, instant round trip, the pipeline sum
  (`examples/order-split.test.ts`).
- **Refusals**: every failure kind has a case; a refusal test is what catches a parser that silently
  rounds or guesses.
- **Formatting**: exact strings under the forced polyfill (edge-formatting-and-input.md section 10).
- **Hooks**: `renderHookWithProviders(() => useFormatMoney(), { language: 'ar' })` from
  unit-and-component-tests' helpers.
- **The checker as a test**: `check-value-core.mjs` imports the app's own modules and runs the same
  rules in Node; run it in CI next to Jest.

## 8. Mutation testing

The core is the place where Stryker pays off (unit-and-component-tests runs it): a surviving mutant in
`allocate.ts` or `rounding.ts` means a rounding branch no test pins. Target
`npx stryker run --mutate src/core/money/allocate.ts --concurrency 2`; the template tests kill the
boundary and tie-break mutants because they pin ties (0.667 versus 0.667, index order) and run the
properties.
