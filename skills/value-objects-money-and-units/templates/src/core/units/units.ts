// src/core/units/units.ts
// Physical quantities are stored as integers in one canonical unit per dimension, and the name says
// which (`distanceMm`, `weightG`, `volumeMl`, `durationMs`, `sizeBytes`). The person's unit system
// (expo-localization's measurementSystem, or a setting) changes only what is shown: a value typed in
// miles and one typed in kilometres are the same stored integer. Every factor is exact (a mile is
// 1,609,344 mm by definition), and input rounds once, half-even, into the canonical unit. Unit keys
// are Intl.NumberFormat's unit identifiers, so the edge formats them with style: 'unit'.
import { parseDecimal, pow10 } from '@/core/decimal/decimal';
import { divideRounded, toSafeInteger } from '@/core/decimal/rounding';
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** Canonical units per one display unit, as an exact ratio [numerator, denominator]. */
export type Factor = readonly [numerator: number, denominator: number];

export type Dimension<TUnit extends string> = {
  readonly canonical: TUnit;
  readonly factors: Readonly<Record<TUnit, Factor>>;
};

export type QuantityFailure =
  { readonly kind: 'not-a-decimal'; readonly text: string } | { readonly kind: 'out-of-range' };

/** Length in whole millimetres. Inch, foot, yard and mile are exact by the 1959 definitions. */
export const LENGTH = {
  canonical: 'millimeter',
  factors: {
    millimeter: [1, 1],
    centimeter: [10, 1],
    meter: [1000, 1],
    kilometer: [1_000_000, 1],
    inch: [254, 10],
    foot: [3048, 10],
    yard: [9144, 10],
    mile: [1_609_344, 1],
  },
} as const satisfies Dimension<string>;

/** Mass in whole grams (pick milligrams instead for doses). Pound and ounce are exact. */
export const MASS = {
  canonical: 'gram',
  factors: {
    gram: [1, 1],
    kilogram: [1000, 1],
    ounce: [28_349_523_125, 1_000_000_000],
    pound: [45_359_237, 100_000],
    stone: [635_029_318, 100_000],
  },
} as const satisfies Dimension<string>;

/** Volume in whole millilitres. Intl's 'gallon' and 'fluid-ounce' are the US units. */
export const VOLUME = {
  canonical: 'milliliter',
  factors: {
    milliliter: [1, 1],
    liter: [1000, 1],
    'fluid-ounce': [295_735_295_625, 10_000_000_000],
    gallon: [3_785_411_784, 1_000_000],
  },
} as const satisfies Dimension<string>;

/** Durations in whole milliseconds (a length of time; a calendar day is a DateKey, not 24 h). */
export const DURATION = {
  canonical: 'millisecond',
  factors: {
    millisecond: [1, 1],
    second: [1000, 1],
    minute: [60_000, 1],
    hour: [3_600_000, 1],
  },
} as const satisfies Dimension<string>;

/** Data sizes in whole bytes, SI prefixes (1 kB = 1000 B, as Android 8+ and Apple file sizes show). */
export const DATA = {
  canonical: 'byte',
  factors: {
    byte: [1, 1],
    kilobyte: [1000, 1],
    megabyte: [1_000_000, 1],
    gigabyte: [1e9, 1],
  },
} as const satisfies Dimension<string>;

/** "5.5" kilometer -> 5_500_000 (millimetres); rounds half-even once into the canonical unit. */
export function quantityFromDecimal<TUnit extends string>(
  dimension: Dimension<TUnit>,
  text: string,
  unit: TUnit,
): Result<number, QuantityFailure> {
  const value = parseDecimal(text);
  if (value === null) return err({ kind: 'not-a-decimal', text });
  const [numerator, denominator] = dimension.factors[unit];
  const scaled = divideRounded(
    value.units * BigInt(numerator),
    pow10(value.scale) * BigInt(denominator),
    'half-even',
  );
  const canonical = Number(scaled);
  return Number.isSafeInteger(canonical) ? ok(canonical) : err({ kind: 'out-of-range' });
}

/** A measured float (a sensor, a map SDK) -> the canonical integer, rounded half-even once. */
export function quantityFromMeasurement<TUnit extends string>(
  dimension: Dimension<TUnit>,
  measured: number,
  unit: TUnit,
): number {
  const [numerator, denominator] = dimension.factors[unit];
  const exact = (measured * numerator) / denominator;
  const nearest = Math.round(exact);
  const isTie = Math.abs(exact - Math.trunc(exact)) === 0.5;
  return toSafeInteger(BigInt(isTie && nearest % 2 !== 0 ? nearest - 1 : nearest));
}

/** The canonical integer in a display unit, as a float for the formatter only (never stored). */
export function quantityToDisplay<TUnit extends string>(
  dimension: Dimension<TUnit>,
  canonical: number,
  unit: TUnit,
): number {
  const [numerator, denominator] = dimension.factors[unit];
  return (canonical * denominator) / numerator;
}
