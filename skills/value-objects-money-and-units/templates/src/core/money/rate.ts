// src/core/money/rate.ts
// Rates (tax, tip, discount, interest, an exchange rate) are exact ratios of integers, never floats:
// 8.25 % is 825 / 10 000. applyRate and convertMoney are the second rounding site next to allocate():
// each rounds exactly once, with a mode the caller names, at the total it is given.
import { parseDecimal, pow10 } from '@/core/decimal/decimal';
import { divideRounded, toSafeInteger } from '@/core/decimal/rounding';
import { err, ok } from '@/core/result';

import { exponentOf } from './currency';
import { money } from './money';

import type { CurrencyCode } from './currency';
import type { Money } from './money';
import type { RoundingMode } from '@/core/decimal/rounding';
import type { Result } from '@/core/result';

/** numerator / denominator, both integers, denominator > 0: 19 % is { numerator: 19, denominator: 100 }. */
export type Rate = { readonly numerator: number; readonly denominator: number };

export type RateFailure = {
  readonly kind: 'not-a-rate';
  readonly text: string;
};

function rate(numerator: bigint, denominator: bigint): Rate {
  return {
    numerator: toSafeInteger(numerator),
    denominator: toSafeInteger(denominator),
  };
}

/** A rate in basis points (hundredths of a percent): 825 is 8.25 %. */
export function basisPoints(points: number): Rate {
  if (!Number.isSafeInteger(points))
    throw new RangeError(`basis points are whole, got ${String(points)}`);
  return { numerator: points, denominator: 10_000 };
}

/** "1.0834" -> 10834 / 10000 (an exchange rate, a multiplier). ASCII decimal text only. */
export function parseDecimalRate(text: string): Result<Rate, RateFailure> {
  const value = parseDecimal(text);
  return value === null
    ? err({ kind: 'not-a-rate', text })
    : ok(rate(value.units, pow10(value.scale)));
}

/** "8.25" (percent) -> 825 / 10000. ASCII decimal text only. */
export function parsePercent(text: string): Result<Rate, RateFailure> {
  const value = parseDecimal(text);
  if (value === null) return err({ kind: 'not-a-rate', text });
  return ok(rate(value.units, pow10(value.scale) * BigInt(100)));
}

function checkRate(value: Rate): void {
  if (!Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator)) {
    throw new RangeError('a Rate holds whole numbers');
  }
  if (value.denominator <= 0) throw new RangeError('a Rate needs a positive denominator');
}

/** amount × rate, rounded once by `rounding`: 19 % of 10.05 EUR at half-even is 1.91 EUR. */
export function applyRate(amount: Money, value: Rate, rounding: RoundingMode): Money {
  checkRate(value);
  const scaled = BigInt(amount.minor) * BigInt(value.numerator);
  return money(
    toSafeInteger(divideRounded(scaled, BigInt(value.denominator), rounding)),
    amount.currency,
  );
}

/**
 * The tax inside a tax-inclusive price: gross − gross / (1 + rate), rounded once. 11.90 EUR at
 * 19 % holds 1.90 EUR. The net is then subtractMoney(gross, tax), so net + tax is the gross exactly.
 */
export function includedTax(gross: Money, value: Rate, rounding: RoundingMode): Money {
  checkRate(value);
  const denominator = BigInt(value.denominator);
  const net = divideRounded(
    BigInt(gross.minor) * denominator,
    denominator + BigInt(value.numerator),
    rounding,
  );
  return money(gross.minor - toSafeInteger(net), gross.currency);
}

/**
 * Converts at `perUnit` (how many major units of `to` one major unit of `amount` buys), rounding
 * once. Exponents differ, so 1000 JPY at 0.0067 USD per JPY is 670 US cents: minor units scale by
 * 10^(exponent of to − exponent of from) inside the same exact division.
 */
export function convertMoney(
  amount: Money,
  conversion: { readonly to: CurrencyCode; readonly perUnit: Rate },
  rounding: RoundingMode,
): Money {
  const { to, perUnit } = conversion;
  checkRate(perUnit);
  const numerator = BigInt(amount.minor) * BigInt(perUnit.numerator) * pow10(exponentOf(to));
  const denominator = BigInt(perUnit.denominator) * pow10(exponentOf(amount.currency));
  return money(toSafeInteger(divideRounded(numerator, denominator, rounding)), to);
}
