// src/features/orders/order-split.ts
// Example (a shape to imitate, never copied): an Order shared between Accounts, split in three
// passes, each closed by allocate(): line items to subtotals, the tax to the subtotals, the tip to
// the subtotals. Every whole-order figure is distributed, so the per-account totals sum to the order
// total to the exact minor unit, for any input. Nothing here is stored: totals are derived on read.
import { allocate } from '@/core/money/allocate';
import { addMoney, multiplyMoney, sumMoney, zeroMoney } from '@/core/money/money';
import { applyRate } from '@/core/money/rate';

import type { CurrencyCode } from '@/core/money/currency';
import type { Money } from '@/core/money/money';
import type { Rate } from '@/core/money/rate';

/** One line of an Order: a unit price, a whole quantity and the accounts that share it (ids). */
export type OrderLine = {
  readonly id: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly sharedBy: readonly string[];
};

/** A tip is a rate of the subtotal or a fixed amount: the one place a percent becomes money. */
export type TipChoice =
  | { readonly kind: 'rate'; readonly rate: Rate }
  | { readonly kind: 'fixed'; readonly amount: Money };

/** What is stored: inputs only. The currency belongs to the Order, so its lines cannot mix. */
export type Order = {
  readonly currency: CurrencyCode;
  readonly accountIds: readonly string[];
  readonly lines: readonly OrderLine[];
  readonly taxRate: Rate;
  readonly tip: TipChoice;
};

export type AccountShare = {
  readonly subtotal: Money;
  readonly tax: Money;
  readonly tip: Money;
  readonly total: Money;
};

/** Derived, never stored. `unassigned` is shown to the person; it is never charged silently. */
export type OrderSplit = {
  readonly byAccount: ReadonlyMap<string, AccountShare>;
  readonly unassigned: Money;
  readonly total: Money;
};

function lineSubtotals(order: Order): {
  readonly byAccount: Map<string, Money>;
  readonly unassigned: Money;
} {
  const byAccount = new Map(order.accountIds.map((id) => [id, zeroMoney(order.currency)]));
  let unassigned = zeroMoney(order.currency);
  for (const line of order.lines) {
    const lineTotal = multiplyMoney(line.unitPrice, line.quantity);
    const sharers = line.sharedBy.filter((id) => byAccount.has(id));
    if (sharers.length === 0) {
      unassigned = addMoney(unassigned, lineTotal);
      continue;
    }
    allocate(
      lineTotal,
      sharers.map(() => 1),
    ).forEach((part, index) => {
      const id = sharers[index] ?? '';
      byAccount.set(id, addMoney(byAccount.get(id) ?? zeroMoney(order.currency), part));
    });
  }
  return { byAccount, unassigned };
}

/** Splits an Order: subtotals, then allocate(tax), then allocate(tip), each by the subtotals. */
export function splitOrder(order: Order): OrderSplit {
  const { byAccount, unassigned } = lineSubtotals(order);
  const subtotals = [...byAccount.values()];
  const assigned = sumMoney(subtotals, order.currency);
  // Rounding site 2: each rate becomes minor units once, at the whole, before it is split.
  const tax = applyRate(assigned, order.taxRate, 'half-even');
  const tip =
    order.tip.kind === 'rate' ? applyRate(assigned, order.tip.rate, 'half-even') : order.tip.amount;
  const weights = subtotals.map((subtotal) => subtotal.minor);
  const taxParts = allocate(tax, weights);
  const tipParts = allocate(tip, weights);
  const shares = new Map<string, AccountShare>();
  [...byAccount.keys()].forEach((id, index) => {
    const subtotal = subtotals[index] ?? zeroMoney(order.currency);
    const taxPart = taxParts[index] ?? zeroMoney(order.currency);
    const tipPart = tipParts[index] ?? zeroMoney(order.currency);
    shares.set(id, {
      subtotal,
      tax: taxPart,
      tip: tipPart,
      total: sumMoney([subtotal, taxPart, tipPart], order.currency),
    });
  });
  return { byAccount: shares, unassigned, total: sumMoney([assigned, tax, tip], order.currency) };
}
