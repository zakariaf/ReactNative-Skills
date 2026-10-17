// src/core/money/money-text.ts
// Money to and from canonical ASCII decimal text ("12.345"), exactly: no float ever holds an amount.
// The text is what an API sends and receives, what an export writes, and what Intl formats at the
// edge (Intl.NumberFormat formats a decimal string exactly; a double such as 90071992547409.93 comes
// out a cent off). Localized input is normalized first (src/i18n/normalize-decimal-input.ts).
import { formatScaled, parseDecimal, rescaleExact } from '@/core/decimal/decimal';
import { err, ok } from '@/core/result';

import { exponentOf } from './currency';
import { money } from './money';

import type { CurrencyCode } from './currency';
import type { Money } from './money';
import type { Result } from '@/core/result';

export type MoneyTextFailure =
  | { readonly kind: 'not-a-decimal'; readonly text: string }
  | { readonly kind: 'too-many-decimals'; readonly maxDecimals: number }
  | { readonly kind: 'out-of-range' };

/**
 * "12.345" in KWD -> 12345 minor units; "1.5" in USD -> 150; "125" in JPY -> 125. More decimals than
 * the currency has ("1.234" USD) is a failure, never a silent rounding: the person typed something
 * the currency cannot hold. Trailing zeros are fine ("1.50" USD, "125.00" JPY).
 */
export function parseMoney(text: string, currency: CurrencyCode): Result<Money, MoneyTextFailure> {
  const value = parseDecimal(text);
  if (value === null) return err({ kind: 'not-a-decimal', text });
  const exponent = exponentOf(currency);
  const minor = rescaleExact(value, exponent);
  if (minor === null) return err({ kind: 'too-many-decimals', maxDecimals: exponent });
  const result = Number(minor);
  if (!Number.isSafeInteger(result)) return err({ kind: 'out-of-range' });
  return ok(money(result, currency));
}

/** 12345 KWD minor units -> "12.345"; -5 USD -> "-0.05"; 125 JPY -> "125". Exact, ASCII, no symbol. */
export function toDecimalString(amount: Money): `${number}` {
  return formatScaled(BigInt(amount.minor), exponentOf(amount.currency));
}
