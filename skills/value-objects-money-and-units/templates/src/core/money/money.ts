// src/core/money/money.ts
// Money is an integer count of minor units plus an ISO 4217 code, never a float, a major-unit
// number or a formatted string. The type is branded: the only ways to get one are money() and the
// functions of this folder, so every Money in the app holds a safe integer. Arithmetic across two
// currencies is a bug and throws; converting is an explicit step (convertMoney in rate.ts).
import type { CurrencyCode } from './currency';

declare const moneyBrand: unique symbol;

/** 12.345 KWD is { minor: 12345, currency: 'KWD' }; 125 JPY is { minor: 125, currency: 'JPY' }. */
export type Money = {
  readonly minor: number;
  readonly currency: CurrencyCode;
  readonly [moneyBrand]: true;
};

/** Builds Money from minor units; a fraction, NaN or an unsafe integer is a bug (RangeError). */
export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money needs a safe integer of minor units, got ${String(minor)}`);
  }
  // `minor + 0` turns -0 into 0, so equal amounts are equal under Object.is and in snapshots.
  return Object.freeze({ minor: minor + 0, currency }) as Money;
}

/** Zero in `currency`: the start of a sum, never a missing value. */
export function zeroMoney(currency: CurrencyCode): Money {
  return money(0, currency);
}

/** Throws when two amounts are in different currencies: adding EUR to USD is a bug, not data. */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new RangeError(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}

/** a + b in their shared currency; throws on mixed currencies or an unsafe sum. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

/** a − b in their shared currency; throws on mixed currencies or an unsafe result. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

/** The same amount with the opposite sign (a refund, a discount line). */
export function negateMoney(amount: Money): Money {
  return money(-amount.minor, amount.currency);
}

/** Unit price times a whole quantity (3 × 4.99). A fractional quantity is a rate: use applyRate. */
export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`multiplyMoney needs a whole quantity, got ${String(quantity)}`);
  }
  return money(amount.minor * quantity, amount.currency);
}

/** The sum of `amounts`, all in `currency`; zero for an empty list (so totals never need a guard). */
export function sumMoney(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce((total, amount) => addMoney(total, amount), zeroMoney(currency));
}

/** -1, 0 or 1; comparing two currencies is a bug and throws. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return Math.sign(a.minor - b.minor) as -1 | 0 | 1;
}

/** Value equality: same currency and same minor units (never `===` on two Money objects). */
export function equalsMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}
