// src/i18n/format-money.ts
// The one place money becomes text for a person. Three things make it exact on every phone:
// - the locale tag carries the digits (localeTagFor(language, digits): 'ar-u-nu-arab'), and the
//   forced FormatJS NumberFormat polyfill formats it the same in Jest, on iOS and on Android;
// - the fraction digits are the ISO 4217 exponent, set explicitly: CLDR's display digits differ for
//   16 currencies (IQD shows 0 decimals in CLDR, 3 in ISO 4217, so 12.345 IQD would print "IQD 12");
// - the value goes in as exact decimal text, never as a float.
// Formatters are cached per tag and options: building one under the polyfill is the slow part.
import { exponentOf } from '@/core/money/currency';
import { toDecimalString } from '@/core/money/money-text';

import type { Money } from '@/core/money/money';

export type MoneyFormatOptions = {
  /** 'symbol' ($, US$), 'narrow-symbol' ($), 'code' (USD) or 'name' (US dollars). Default 'symbol'. */
  readonly display?: 'symbol' | 'narrow-symbol' | 'code' | 'name';
  /** Negative amounts in parentheses where the locale does so (statements, balances). */
  readonly isAccounting?: boolean;
};

const DISPLAY = {
  symbol: 'symbol',
  'narrow-symbol': 'narrowSymbol',
  code: 'code',
  name: 'name',
} as const;

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(
  localeTag: string,
  amount: Money,
  options: MoneyFormatOptions,
): Intl.NumberFormat {
  const display = options.display ?? 'symbol';
  const sign = options.isAccounting === true ? 'accounting' : 'standard';
  const key = [localeTag, amount.currency, display, sign].join('|');
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  const digits = exponentOf(amount.currency);
  const created = new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: amount.currency,
    currencyDisplay: DISPLAY[display],
    currencySign: sign,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  formatters.set(key, created);
  return created;
}

/**
 * 1999 USD in 'en' -> '$19.99'; 12345 KWD in 'en' -> 'KWD 12.345'; in 'ar-u-nu-arab' the digits
 * and the separators are Arabic-Indic. Pass the tag from localeTagFor(language, digits), or call
 * useFormatMoney() in a model hook, which reads it from the provider.
 */
export function formatMoney(
  amount: Money,
  localeTag: string,
  options: MoneyFormatOptions = {},
): string {
  return formatterFor(localeTag, amount, options).format(toDecimalString(amount));
}
