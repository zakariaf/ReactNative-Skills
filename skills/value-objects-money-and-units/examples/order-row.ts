// src/data/orders/order-row.ts
// Example: the repository boundary. A row holds plain integers and a currency code; the domain holds
// Money. Conversion happens here, once, through the constructors, so a corrupted row (an unknown
// currency, a fraction) becomes a typed failure instead of a wrong amount on screen.
import { parseCurrencyCode } from '@/core/money/currency';
import { money } from '@/core/money/money';
import { err, ok } from '@/core/result';

import type { CurrencyCode } from '@/core/money/currency';
import type { Money } from '@/core/money/money';
import type { Result } from '@/core/result';

/** What SQLite returns for one order line joined with its order's currency. */
export type OrderLineRow = {
  readonly id: number;
  readonly label: string;
  readonly unit_price_minor: number;
  readonly quantity: number;
  readonly currency: string;
  readonly created_at_ms: number;
};

export type StoredOrderLine = {
  readonly id: number;
  readonly label: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly createdAtMs: number;
};

export type OrderRowFailure =
  | { readonly kind: 'unknown-currency'; readonly code: string }
  | { readonly kind: 'corrupt-amount'; readonly column: string };

export function lineFromRow(row: OrderLineRow): Result<StoredOrderLine, OrderRowFailure> {
  const currency = parseCurrencyCode(row.currency);
  if (!currency.ok) return currency;
  if (!Number.isSafeInteger(row.unit_price_minor)) {
    return err({ kind: 'corrupt-amount', column: 'unit_price_minor' });
  }
  return ok({
    id: row.id,
    label: row.label,
    unitPrice: money(row.unit_price_minor, currency.value),
    quantity: row.quantity,
    createdAtMs: row.created_at_ms,
  });
}

/** The parameters of an INSERT: Money goes back to its integer, the currency to the order row. */
export function lineToParams(
  line: StoredOrderLine,
  orderCurrency: CurrencyCode,
): readonly (string | number)[] {
  if (line.unitPrice.currency !== orderCurrency)
    throw new RangeError('A line must use its order currency');
  return [line.id, line.label, line.unitPrice.minor, line.quantity, line.createdAtMs];
}
