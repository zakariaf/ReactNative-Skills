// src/core/money/allocate.ts
// The one way to divide money: largest remainder (Hamilton). Each part gets the floor of its exact
// share, then the minor units left over go one each to the largest remainders, ties to the lower
// index. The parts always sum to the whole, to the exact minor unit, for any input, and the same
// input always gives the same parts. Splitting a bill, prorating tax or a discount, instalments and
// "split evenly" all call it; nothing divides money and rounds each part on its own.
import { toSafeInteger } from '@/core/decimal/rounding';

import { money } from './money';

import type { Money } from './money';

const ZERO = BigInt(0);
const ONE = BigInt(1);

type Remainder = { readonly index: number; readonly rest: bigint };

function checkWeights(weights: readonly number[]): void {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`allocate weights are non-negative integers, got ${String(weight)}`);
    }
  }
}

function byLargestRest(a: Remainder, b: Remainder): number {
  if (a.rest === b.rest) return a.index - b.index;
  return a.rest > b.rest ? -1 : 1;
}

/** Splits a non-negative amount by positive-sum weights (BigInt, so amount × weight never rounds). */
function splitMagnitude(amount: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((sum, weight) => sum + weight, ZERO);
  const parts = weights.map((weight) => (amount * weight) / total);
  let leftover = amount - parts.reduce((sum, part) => sum + part, ZERO);
  const remainders = weights.map((weight, index) => ({
    index,
    rest: (amount * weight) % total,
  }));
  for (const { index } of [...remainders].sort(byLargestRest)) {
    if (leftover === ZERO) break;
    parts[index] = (parts[index] ?? ZERO) + ONE;
    leftover -= ONE;
  }
  return parts;
}

/**
 * Splits `amount` minor units in proportion to `weights` (non-negative integers, at least one).
 * The parts sum to `amount` exactly. All-zero weights split evenly; a negative amount (a refund, a
 * discount) splits like its magnitude, negated.
 */
export function allocateMinor(amount: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`allocate needs whole minor units, got ${String(amount)}`);
  }
  checkWeights(weights);
  const isAllZero = weights.every((weight) => weight === 0);
  const effective = weights.map((weight) => (isAllZero ? ONE : BigInt(weight)));
  const parts = splitMagnitude(BigInt(Math.abs(amount)), effective);
  return parts.map((part) => toSafeInteger(amount < 0 ? -part : part));
}

/** Splits Money in proportion to `weights`; the parts are in the same currency and sum to `total`. */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  return allocateMinor(total.minor, weights).map((minor) => money(minor, total.currency));
}

/** Splits Money into `count` parts that differ by at most one minor unit, larger parts first. */
export function splitEvenly(total: Money, count: number): Money[] {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`splitEvenly needs a positive whole count, got ${String(count)}`);
  }
  return allocate(
    total,
    Array.from({ length: count }, () => 1),
  );
}
