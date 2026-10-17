// src/core/decimal/decimal.ts
// Exact decimal text <-> scaled integers for the value objects (money, rates, quantities). Pure
// TypeScript on BigInt: no floats, no Intl. The text here is canonical ASCII ("-12.345"); localized
// input is normalized at the edge first (src/i18n/normalize-decimal-input.ts).

/** A decimal number as an integer and a scale: "-12.345" is { units: -12345n, scale: 3 }. */
export type ScaledDecimal = { readonly units: bigint; readonly scale: number };

const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

/** 10^exponent as a BigInt (exponent is a small non-negative integer: a scale or an exponent). */
export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`pow10 needs a non-negative integer, got ${String(exponent)}`);
  }
  return BigInt(10) ** BigInt(exponent);
}

/** Parses canonical ASCII decimal text ("12", "-0.05", "12.345"); null for anything else. */
export function parseDecimal(text: string): ScaledDecimal | null {
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return null;
  const sign = match[1] ?? '';
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  const magnitude = BigInt(`${whole}${fraction}`);
  return {
    units: sign === '-' ? -magnitude : magnitude,
    scale: fraction.length,
  };
}

/**
 * The same value with exactly `scale` decimals, or null when that would drop non-zero digits
 * ("1.230" to scale 2 is 123n; "1.234" to scale 2 is null): the caller refuses or rounds explicitly.
 */
export function rescaleExact(value: ScaledDecimal, scale: number): bigint | null {
  if (scale >= value.scale) return value.units * pow10(scale - value.scale);
  const divisor = pow10(value.scale - scale);
  return value.units % divisor === BigInt(0) ? value.units / divisor : null;
}

/** units / 10^scale as canonical ASCII text with exactly `scale` decimals: (-5n, 2) -> "-0.05". */
export function formatScaled(units: bigint, scale: number): `${number}` {
  const isNegative = units < BigInt(0);
  const digits = (isNegative ? -units : units).toString().padStart(scale + 1, '0');
  const cut = digits.length - scale;
  const text = scale === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return (isNegative ? `-${text}` : text) as `${number}`;
}
