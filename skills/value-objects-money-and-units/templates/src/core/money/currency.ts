// src/core/money/currency.ts
// Currency codes and their ISO 4217 exponents. A code from outside (a store, an API, a saved row)
// becomes a CurrencyCode only through parseCurrencyCode, so an unknown code is a typed failure and
// never silently gets two decimals (Intl formats an unknown but well-formed code such as 'ZZZ' with
// two decimals instead of refusing it).
import { err, ok } from '@/core/result';

import { CURRENCY_EXPONENTS } from './currency-exponents';

import type { Result } from '@/core/result';

/** An ISO 4217 code this app knows the exponent of: 'USD', 'JPY', 'KWD'. */
export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export type CurrencyFailure = {
  readonly kind: 'unknown-currency';
  readonly code: string;
};

// A Map, not `code in CURRENCY_EXPONENTS`: 'toString' is "in" every object.
const EXPONENTS: ReadonlyMap<string, number> = new Map(Object.entries(CURRENCY_EXPONENTS));

/** True when `code` is a known ISO 4217 code (exact, upper case). */
export function isCurrencyCode(code: string): code is CurrencyCode {
  return EXPONENTS.has(code);
}

/** The only way an outside string becomes a CurrencyCode. */
export function parseCurrencyCode(code: string): Result<CurrencyCode, CurrencyFailure> {
  return isCurrencyCode(code) ? ok(code) : err({ kind: 'unknown-currency', code });
}

/** Decimals of the currency's minor unit: JPY 0, USD 2, KWD 3, CLF 4. */
export function exponentOf(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency];
}
