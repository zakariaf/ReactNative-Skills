// src/i18n/format-quantity.ts
// A stored quantity (an integer in its dimension's canonical unit) shown in the unit the person
// wants, with the locale tag's digits: 5_500_000 mm as '5.5 km', '3.4 mi' or '٥٫٥ كم'. Converting
// happens here, at the edge, from the canonical integer; nothing converted is ever stored back.
import { quantityToDisplay } from '@/core/units/units';

import type { Dimension } from '@/core/units/units';

export type QuantityDisplay<TUnit extends string> = {
  readonly unit: TUnit;
  readonly localeTag: string;
  /** Decimals to show at most (default 1): display rounding, never a stored rounding. */
  readonly maximumFractionDigits?: number;
  readonly unitDisplay?: 'short' | 'long' | 'narrow';
};

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(display: QuantityDisplay<string>): Intl.NumberFormat {
  const digits = display.maximumFractionDigits ?? 1;
  const unitDisplay = display.unitDisplay ?? 'short';
  const key = [display.localeTag, display.unit, digits, unitDisplay].join('|');
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.NumberFormat(display.localeTag, {
    style: 'unit',
    unit: display.unit,
    unitDisplay,
    maximumFractionDigits: digits,
  });
  formatters.set(key, created);
  return created;
}

/** formatQuantity(LENGTH, 5_500_000, { unit: 'kilometer', localeTag: 'en' }) -> '5.5 km'. */
export function formatQuantity<TUnit extends string>(
  dimension: Dimension<TUnit>,
  canonical: number,
  display: QuantityDisplay<TUnit>,
): string {
  return formatterFor(display).format(quantityToDisplay(dimension, canonical, display.unit));
}
