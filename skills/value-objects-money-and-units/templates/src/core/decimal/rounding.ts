// src/core/decimal/rounding.ts
// The one rounding primitive of the value objects: an exact integer division with a named mode.
// Every place that turns a ratio into whole minor units (a rate, a conversion, a unit change) calls
// divideRounded once, so a rounding decision is written down and tested, never implied by a float.

/**
 * How an exact quotient becomes an integer. The names follow Intl.NumberFormat's roundingMode:
 * 'half-even' (banker's rounding: ties to the even neighbour, no bias over many roundings),
 * 'half-expand' (ties away from zero: what most receipts and tax tables print), 'floor', 'ceil',
 * 'trunc' (toward zero).
 */
export type RoundingMode = 'half-even' | 'half-expand' | 'floor' | 'ceil' | 'trunc';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function roundTie(quotient: bigint, away: bigint, mode: RoundingMode): bigint {
  if (mode === 'half-expand') return away;
  return quotient % TWO === ZERO ? quotient : away;
}

/** The quotient rounded at a remainder that is not zero. */
function roundInexact(
  parts: {
    readonly quotient: bigint;
    readonly twiceRest: bigint;
    readonly denominator: bigint;
  },
  isNegative: boolean,
  mode: RoundingMode,
): bigint {
  const { quotient, twiceRest, denominator } = parts;
  const away = isNegative ? quotient - ONE : quotient + ONE;
  switch (mode) {
    case 'trunc':
      return quotient;
    case 'floor':
      return isNegative ? away : quotient;
    case 'ceil':
      return isNegative ? quotient : away;
    case 'half-even':
    case 'half-expand':
      if (twiceRest === denominator) return roundTie(quotient, away, mode);
      return twiceRest > denominator ? away : quotient;
  }
}

/** numerator / denominator rounded to an integer by `mode`; exact at any size. denominator > 0. */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= ZERO) throw new RangeError('divideRounded needs a positive denominator');
  const quotient = numerator / denominator;
  const rest = numerator % denominator;
  if (rest === ZERO) return quotient;
  const isNegative = numerator < ZERO;
  const twiceRest = (isNegative ? -rest : rest) * TWO;
  return roundInexact({ quotient, twiceRest, denominator }, isNegative, mode);
}

/** A BigInt result back to a number; a value beyond Number.MAX_SAFE_INTEGER is a bug, not data. */
export function toSafeInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${value.toString()} is outside the safe integer range`);
  }
  return result;
}
