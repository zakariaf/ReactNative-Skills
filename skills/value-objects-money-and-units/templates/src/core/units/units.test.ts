// src/core/units/units.test.ts
import fc from 'fast-check';

import {
  DATA,
  DURATION,
  LENGTH,
  MASS,
  VOLUME,
  quantityFromDecimal,
  quantityFromMeasurement,
  quantityToDisplay,
} from './units';

describe('units', () => {
  it('uses the exact definitions', () => {
    expect(quantityFromDecimal(LENGTH, '1', 'mile')).toStrictEqual({
      ok: true,
      value: 1_609_344,
    });
    expect(quantityFromDecimal(LENGTH, '1', 'inch')).toStrictEqual({
      ok: true,
      value: 25,
    });
    expect(quantityFromDecimal(LENGTH, '10', 'inch')).toStrictEqual({
      ok: true,
      value: 254,
    });
    expect(quantityFromDecimal(MASS, '1', 'pound')).toStrictEqual({
      ok: true,
      value: 454,
    });
    expect(quantityFromDecimal(MASS, '100', 'pound')).toStrictEqual({
      ok: true,
      value: 45_359,
    });
    expect(quantityFromDecimal(VOLUME, '1', 'gallon')).toStrictEqual({
      ok: true,
      value: 3785,
    });
    expect(quantityFromDecimal(DURATION, '1.5', 'hour')).toStrictEqual({
      ok: true,
      value: 5_400_000,
    });
    expect(quantityFromDecimal(DATA, '1.5', 'megabyte')).toStrictEqual({
      ok: true,
      value: 1_500_000,
    });
  });

  it('rounds half-even once into the canonical unit', () => {
    expect(quantityFromDecimal(LENGTH, '0.25', 'centimeter')).toStrictEqual({
      ok: true,
      value: 2,
    });
    expect(quantityFromDecimal(LENGTH, '0.35', 'centimeter')).toStrictEqual({
      ok: true,
      value: 4,
    });
    expect(quantityFromMeasurement(LENGTH, 2.5, 'millimeter')).toBe(2);
    expect(quantityFromMeasurement(LENGTH, 3.5, 'millimeter')).toBe(4);
    expect(quantityFromMeasurement(LENGTH, -2.5, 'millimeter')).toBe(-2);
    expect(quantityFromMeasurement(LENGTH, -3.5, 'millimeter')).toBe(-4);
    expect(quantityFromMeasurement(LENGTH, 1234.5678, 'meter')).toBe(1_234_568);
  });

  it('refuses text that is not canonical decimal, and values past the safe range', () => {
    expect(quantityFromDecimal(LENGTH, '1,5', 'meter')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-decimal', text: '1,5' },
    });
    expect(quantityFromDecimal(LENGTH, '1e20', 'mile').ok).toBe(false);
    expect(quantityFromDecimal(LENGTH, '99999999999999', 'mile')).toStrictEqual({
      ok: false,
      error: { kind: 'out-of-range' },
    });
  });

  it('shows a canonical integer in any unit, and a whole canonical value round-trips', () => {
    expect(quantityToDisplay(LENGTH, 5_500_000, 'kilometer')).toBe(5.5);
    expect(quantityToDisplay(LENGTH, 1_609_344, 'mile')).toBe(1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (millimeters) => {
        const meters = quantityToDisplay(LENGTH, millimeters, 'meter');
        expect(quantityFromMeasurement(LENGTH, meters, 'meter')).toBe(millimeters);
      }),
    );
  });
});
