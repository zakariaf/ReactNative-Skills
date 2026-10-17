// src/features/orders/use-amount-field.ts
// Example: a money input's model hook. The text the person types stays text (their digits, their
// separator) until it parses: normalizeDecimalInput (the edge, with the app's locale tag) then
// parseMoney (exact, in the order currency). A failure kind picks a catalog message; nothing is
// rounded or regrouped behind the person's back ('1.234' in German asks which one was meant). The
// screen renders forms-and-input's TextField with kind 'decimal' (the decimal pad) and a
// KeyboardDoneBar (the iOS decimal pad has no return key), never a raw TextInput. The five message
// keys below go into every catalog first (i18n-strings-and-catalogs).
import { useState } from 'react';

import { parseMoney } from '@/core/money/money-text';
import { normalizeDecimalInput } from '@/i18n/normalize-decimal-input';
import { useT } from '@/i18n/t-context';
import { useLocaleTag } from '@/i18n/use-locale-tag';

import type { CurrencyCode } from '@/core/money/currency';
import type { Money } from '@/core/money/money';
import type { MoneyTextFailure } from '@/core/money/money-text';
import type { MessageKey } from '@/i18n/messages';
import type { DecimalInputFailure } from '@/i18n/normalize-decimal-input';

const ERROR_KEYS = {
  'ambiguous-separator': 'orders.amount.error-ambiguous-separator',
  'misplaced-separator': 'orders.amount.error-misplaced-separator',
  'not-a-decimal': 'orders.amount.error-not-a-number',
  'too-many-decimals': 'orders.amount.error-too-many-decimals',
  'out-of-range': 'orders.amount.error-too-large',
} as const satisfies Record<(MoneyTextFailure | DecimalInputFailure)['kind'], MessageKey>;

export type AmountField = {
  readonly text: string;
  readonly onChangeText: (next: string) => void;
  /** The parsed amount, or null while the text is empty or invalid. */
  readonly value: Money | null;
  readonly errorText: string | null;
};

export function useAmountField(currency: CurrencyCode, initialText = ''): AmountField {
  const t = useT();
  const localeTag = useLocaleTag();
  const [text, setText] = useState(initialText);
  const normalized = text.trim() === '' ? null : normalizeDecimalInput(text, localeTag);
  const parsed = normalized?.ok === true ? parseMoney(normalized.value, currency) : normalized;
  return {
    text,
    onChangeText: setText,
    value: parsed?.ok === true ? parsed.value : null,
    errorText: parsed === null || parsed.ok ? null : t(ERROR_KEYS[parsed.error.kind]),
  };
}
