# Allocation and rates

## Contents

1. Why one division path
2. Largest remainder, step by step
3. Verified vectors
4. Edge policies
5. The split pipeline
6. The second rounding site: rates
7. Rounding modes
8. Tax-inclusive prices, discounts and refunds
9. Tests

## 1. Why one division path

Dividing money is the only operation that creates a rounding problem the person can check by hand:
three people splitting 10.00 must pay 10.00 between them. If every place that divides money calls
one primitive, "the parts sum to the whole" is proven once (by tests and by `check-value-core.mjs`),
not hoped for at twenty call sites. `check-value-code.mjs` fails a money name divided by anything other
than a money name (`money-division`); a money name divided by another (`spentMinor / budgetMinor`) is a
ratio for a progress bar and passes.

## 2. Largest remainder, step by step

`allocateMinor(amount, weights)` (Hamilton's method):

1. Check the input: at least one weight, each a non-negative safe integer; a whole amount. Each
   failure is a `RangeError` (a bug: money would vanish or appear).
2. If every weight is zero, use equal weights (an all-comped order still splits a service charge).
3. Work on the magnitude of the amount; a negative amount is split like its magnitude and negated, so
   a refund mirrors the charge exactly.
4. In BigInt: `floor(amount × weight / total)` for each part, and the remainder `amount × weight mod
   total`. Multiplying first keeps everything integer; BigInt keeps `amount × weight` exact past 2^53.
5. The leftover `amount − Σ floors` is always between 0 and n − 1. Give one minor unit each to the
   parts with the largest remainders; ties go to the lower index, so the same input always gives the
   same parts.
6. Convert each part back with a safe-integer check.

## 3. Verified vectors

Computed by hand with the rule above and cross-checked with an independent BigInt implementation
(2026-10-10); the template test and the checker pin them:

| amount | weights | parts |
|---|---|---|
| 1001 | 1, 1, 1 | 334, 334, 333 |
| 660 | 1584, 4033, 1933 | 138, 353, 169 |
| 1510 | 1584, 4033, 1933 | 317, 807, 386 |
| 100 | 1, 2, 3 | 17, 33, 50 |
| 999 | 333, 333, 334 | 333, 333, 333 |
| 5 | seven 1s | 1, 1, 1, 1, 1, 0, 0 |
| −1001 | 1, 1, 1 | −334, −334, −333 |
| 90 | 0, 0, 0 | 30, 30, 30 |
| 10 | 0, 1 | 0, 10 |

The 999 row is worth reading: the floors are 332, 332, 333 and the two leftover units go to the two
largest remainders (0.667 each), not to the largest weight, so the parts come out equal.

## 4. Edge policies

| Case | Policy | Why |
|---|---|---|
| No weights | `RangeError` | Allocating to nobody would lose the amount |
| Negative weight | `RangeError` | It would hand out more than the whole to one part and a negative to another |
| All weights zero | Equal split | "Everyone comped" still shares a fee |
| Zero amount | All zeros | |
| Negative amount | Mirror of the positive split | A refund reverses the charge part by part |
| Item with no sharer | Not allocated; shown as unassigned | Never charge someone silently |

## 5. The split pipeline

The neutral case: an Order of lines shared by Accounts, with a tax rate and a tip
(`examples/order-split.ts`). Each pass closes with `allocate()`:

1. **Line subtotals.** A line's total (`multiplyMoney(unitPrice, quantity)`) goes wholly to a single
   sharer, or is allocated over its sharers with equal weights in a stable order. Each account's
   subtotal is the sum of its parts.
2. **Tax.** The tax is computed once on the assigned subtotal (`applyRate(assigned, taxRate,
   'half-even')`), or taken as printed on the receipt, then `allocate(tax, subtotals)`.
3. **Tip.** A rate becomes minor units once (`applyRate`), a fixed tip is already Money; then
   `allocate(tip, subtotals)`.

Each account's total is subtotal + tax part + tip part; because every whole-order figure is
allocated, the account totals sum to `assigned + tax + tip` exactly. The worked example in the example
test: subtotals 6.00, 15.50, 13.98 (35.48), tax 8.25 % = 2.9271 → 2.93, tip 18 % = 6.3864 → 6.39,
total 44.80; the first account pays 6.00 + 0.50 + 1.08 = 7.58.

## 6. The second rounding site: rates

`allocate()` handles the division. A *rate* (tax, tip, discount, interest, a fee percentage, an
exchange rate) is the second place a value is rounded, and allocate tests never see it:

- Keep the rate exact: `parsePercent('8.25')` is 825/10 000, `basisPoints(825)` the same,
  `parseDecimalRate('1.0834')` is 10 834/10 000. A rate stored in SQLite is integer basis points
  (`tax_rate_bps INTEGER`) or decimal text, never REAL.
- Apply it once, at the total: `applyRate(subtotal, rate, mode)` multiplies in BigInt and divides with
  `divideRounded`, which rounds exactly once with the named mode.
- Never multiply money by a float (`subtotalMinor * 0.0825`, `price * taxRate`): `money-float-rate`.
- Never recompute a tax the source states (a receipt, an invoice from the server): the stated figure
  is ground truth; recomputing reintroduces a rounding disagreement with the record.

## 7. Rounding modes

`RoundingMode` follows the names of `Intl.NumberFormat`'s `roundingMode`:

| Mode | 2.5 | 3.5 | −2.5 | Use |
|---|---|---|---|---|
| `half-even` | 2 | 4 | −2 | The default: no upward bias over many roundings (banking, statistics) |
| `half-expand` | 3 | 4 | −3 | Most receipts and many tax rules ("round half up" away from zero) |
| `floor` | 2 | 3 | −3 | Never overcharge the person |
| `ceil` | 3 | 4 | −2 | Never undercharge (minimum fees) |
| `trunc` | 2 | 3 | −2 | Toward zero |

The jurisdiction or the business decides the tax rounding (per line or per invoice, half-up or
half-even); write the choice in the code that applies the rate, test it with a tie (an amount that
lands exactly on .5 of a minor unit), and never round an intermediate sum.

## 8. Tax-inclusive prices, discounts and refunds

- **Tax-inclusive prices** (VAT in most of Europe): `includedTax(gross, rate, mode)` computes
  `gross − gross / (1 + rate)` with one rounding, and the net is `subtractMoney(gross, tax)`, so net +
  tax is the gross exactly. 11.90 EUR at 19 % holds 1.90 EUR; 9.99 EUR at 7 % holds 0.65 EUR.
- **A discount on the whole order** is a negative amount allocated by the subtotals (or a rate applied
  to the total, then allocated); never a percentage taken off each line separately.
- **A refund** mirrors the original split: `allocate(negateMoney(refund), originalWeights)`.
- **Instalments**: `splitEvenly(total, 3)` gives parts that differ by at most one minor unit, larger
  first (10.00 → 3.34, 3.33, 3.33). If the first instalment must be the larger or the smaller, reorder
  explicitly.

## 9. Tests

- Pin the vectors of section 3 (the template test does).
- Property: for random amounts (near zero and near the safe limit) and weights, the parts sum to the
  amount, each part is within one minor unit of its exact share (compare in BigInt:
  `|part × total − amount × weight| < total`), the negative amount mirrors, and a repeat gives the same
  parts. `check-value-core.mjs` runs 400 seeded cases with weights up to 10^9, where a float share
  loses digits.
- Rates: one case per mode on a tie (12.5 cents), a negative amount, a conversion across exponents.
- The pipeline: the sum of account totals equals the order total for random orders
  (`examples/order-split.test.ts`).
