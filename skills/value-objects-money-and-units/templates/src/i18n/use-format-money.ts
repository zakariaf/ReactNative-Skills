// src/i18n/use-format-money.ts
// Model hooks format money through this hook: it takes the locale tag (language and digits) from
// the provider, so a price and the sentence around it always show the same digits, and a language
// or digits change re-renders every amount.
import { formatMoney } from './format-money';
import { useLocaleTag } from './use-locale-tag';

import type { MoneyFormatOptions } from './format-money';
import type { Money } from '@/core/money/money';

export type FormatMoney = (amount: Money, options?: MoneyFormatOptions) => string;

/** `const formatMoney = useFormatMoney(); formatMoney(order.total)` -> '$19.99' / '١٩٫٩٩ US$'. */
export function useFormatMoney(): FormatMoney {
  const localeTag = useLocaleTag();
  return (amount, options) => formatMoney(amount, localeTag, options);
}
