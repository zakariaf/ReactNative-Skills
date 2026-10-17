// src/features/orders/order-split.test.ts
// Example test: one pinned case worked by hand, and the property that matters (the shares always
// add up to the order total) over random orders.
import fc from 'fast-check';

import { money, sumMoney } from '@/core/money/money';
import { basisPoints } from '@/core/money/rate';

import { splitOrder } from './order-split';

import type { Order } from './order-split';

const ORDER: Order = {
  currency: 'USD',
  accountIds: ['ana', 'ben', 'cy'],
  lines: [
    { id: 'pizza', unitPrice: money(1800, 'USD'), quantity: 1, sharedBy: ['ana', 'ben', 'cy'] },
    { id: 'salad', unitPrice: money(950, 'USD'), quantity: 1, sharedBy: ['ben'] },
    { id: 'juice', unitPrice: money(399, 'USD'), quantity: 2, sharedBy: ['cy'] },
  ],
  taxRate: basisPoints(825),
  tip: { kind: 'rate', rate: basisPoints(1800) },
};

describe('splitOrder', () => {
  it('splits a worked example to the cent', () => {
    const split = splitOrder(ORDER);
    // Subtotals 600 / 1550 / 1398 (sum 3548); tax 8.25 % = 292.71 -> 293; tip 18 % = 638.64 -> 639.
    expect(split.total).toStrictEqual(money(4480, 'USD'));
    expect(split.byAccount.get('ana')).toStrictEqual({
      subtotal: money(600, 'USD'),
      tax: money(50, 'USD'),
      tip: money(108, 'USD'),
      total: money(758, 'USD'),
    });
  });

  it('always sums the shares to the order total', () => {
    const line = fc.record({
      id: fc.string(),
      unitPrice: fc.integer({ min: 0, max: 100_000 }).map((minor) => money(minor, 'EUR')),
      quantity: fc.integer({ min: 1, max: 5 }),
      sharedBy: fc.subarray(['a', 'b', 'c', 'd'], { minLength: 1 }),
    });
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 6 }), fc.nat(3000), (lines, bps) => {
        const order: Order = {
          currency: 'EUR',
          accountIds: ['a', 'b', 'c', 'd'],
          lines,
          taxRate: basisPoints(bps),
          tip: { kind: 'fixed', amount: money(500, 'EUR') },
        };
        const split = splitOrder(order);
        const totals = [...split.byAccount.values()].map((share) => share.total);
        expect(sumMoney(totals, 'EUR')).toStrictEqual(split.total);
      }),
    );
  });
});
