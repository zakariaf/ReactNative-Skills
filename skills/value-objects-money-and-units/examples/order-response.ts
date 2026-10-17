// src/api/orders/order-response.ts
// Example: the API boundary. On the wire money is decimal text with its currency ("12.345", "KWD")
// or an integer of minor units, never a JSON float; an instant is ISO 8601 with Z or an offset. The
// valibot schema checks the shape; toOrderSummary converts once, so the app never holds wire text.
import * as v from 'valibot';

import { parseCurrencyCode } from '@/core/money/currency';
import { parseMoney } from '@/core/money/money-text';
import { err, ok } from '@/core/result';
import { parseIsoInstant } from '@/core/time/instant';

import type { Money } from '@/core/money/money';
import type { Result } from '@/core/result';

export const orderSummarySchema = v.object({
  id: v.string(),
  total: v.pipe(v.string(), v.regex(/^-?\d+(\.\d+)?$/)),
  currency: v.pipe(v.string(), v.length(3)),
  tip_minor: v.pipe(v.number(), v.safeInteger()),
  created_at: v.string(),
});

export type OrderSummary = {
  readonly id: string;
  readonly total: Money;
  readonly createdAtMs: number;
};

export type OrderSummaryFailure = { readonly kind: 'bad-order-summary'; readonly field: string };

const bad = (field: string): Result<never, OrderSummaryFailure> =>
  err({ kind: 'bad-order-summary', field });

export function toOrderSummary(
  wire: v.InferOutput<typeof orderSummarySchema>,
): Result<OrderSummary, OrderSummaryFailure> {
  const currency = parseCurrencyCode(wire.currency);
  if (!currency.ok) return bad('currency');
  const total = parseMoney(wire.total, currency.value);
  if (!total.ok) return bad('total');
  const createdAtMs = parseIsoInstant(wire.created_at);
  if (!createdAtMs.ok) return bad('created_at');
  return ok({ id: wire.id, total: total.value, createdAtMs: createdAtMs.value });
}
