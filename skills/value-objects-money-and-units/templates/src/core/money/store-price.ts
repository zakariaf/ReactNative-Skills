// src/core/money/store-price.ts
// Prices that arrive from a vendor SDK in a lossy shape enter here, once, at the adapter:
// - micro-units as an integer string (Google Play Billing `priceAmountMicros`, 1,000,000 per unit;
//   expo-iap passes them only for Android subscription phases and discount offers);
// - a binary double (expo-iap's `price` on both platforms; StoreKit's Decimal 1.99 arrives as
//   1.9899999999999998).
// Both become Money in the store's currency or a typed failure. Nothing else in the app turns a
// float into money; show the store's own `displayPrice` string when no arithmetic is needed.
import { pow10 } from '@/core/decimal/decimal';
import { err, ok } from '@/core/result';

import { exponentOf } from './currency';
import { money } from './money';

import type { CurrencyCode } from './currency';
import type { Money } from './money';
import type { MoneyTextFailure } from './money-text';
import type { Result } from '@/core/result';

const MICROS_SCALE = 6;
const INTEGER_TEXT = /^-?\d+$/;
// Double noise on a price is far below a ten-thousandth of a minor unit; more means real digits.
const DOUBLE_TOLERANCE = 1e-4;

/** "1990000" EUR micros -> 199 cents. Micros that do not land on a whole minor unit fail. */
export function moneyFromMicros(
  micros: string,
  currency: CurrencyCode,
): Result<Money, MoneyTextFailure> {
  if (!INTEGER_TEXT.test(micros)) return err({ kind: 'not-a-decimal', text: micros });
  const exponent = exponentOf(currency);
  const divisor = pow10(MICROS_SCALE - Math.min(exponent, MICROS_SCALE));
  const units = BigInt(micros);
  if (units % divisor !== BigInt(0))
    return err({ kind: 'too-many-decimals', maxDecimals: exponent });
  const minor = Number(units / divisor);
  return Number.isSafeInteger(minor) ? ok(money(minor, currency)) : err({ kind: 'out-of-range' });
}

/**
 * A store's double price -> Money: 1.9899999999999998 EUR -> 199 cents. Only for vendor values
 * that are decimal prices carried as doubles; a double with real extra digits (1.999 USD) fails.
 */
export function moneyFromStoreDouble(
  price: number,
  currency: CurrencyCode,
): Result<Money, MoneyTextFailure> {
  if (!Number.isFinite(price)) return err({ kind: 'not-a-decimal', text: String(price) });
  const exponent = exponentOf(currency);
  const scaled = price * 10 ** exponent;
  const minor = Math.round(scaled);
  if (!Number.isSafeInteger(minor)) return err({ kind: 'out-of-range' });
  if (Math.abs(scaled - minor) > DOUBLE_TOLERANCE) {
    return err({ kind: 'too-many-decimals', maxDecimals: exponent });
  }
  return ok(money(minor, currency));
}
