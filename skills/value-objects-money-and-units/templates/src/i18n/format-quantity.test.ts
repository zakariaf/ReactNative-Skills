// src/i18n/format-quantity.test.ts
import { DATA, LENGTH, MASS } from '@/core/units/units';

import { formatQuantity } from './format-quantity';

describe('formatQuantity', () => {
  it('shows the canonical integer in the unit the person picked', () => {
    expect(formatQuantity(LENGTH, 5_500_000, { unit: 'kilometer', localeTag: 'en' })).toBe(
      '5.5 km',
    );
    expect(formatQuantity(LENGTH, 5_500_000, { unit: 'mile', localeTag: 'en' })).toBe('3.4 mi');
    expect(formatQuantity(DATA, 1_500_000, { unit: 'megabyte', localeTag: 'en' })).toBe('1.5 MB');
    // The second call with the same options reuses the cached formatter.
    expect(formatQuantity(LENGTH, 1_000_000, { unit: 'kilometer', localeTag: 'en' })).toBe('1 km');
  });

  it('takes display digits and the long unit name', () => {
    const display = {
      unit: 'kilogram',
      localeTag: 'en',
      unitDisplay: 'long',
      maximumFractionDigits: 2,
    } as const;
    expect(formatQuantity(MASS, 2_506, display)).toBe('2.51 kilograms');
  });

  it('uses the digits the locale tag carries', () => {
    expect(
      formatQuantity(LENGTH, 5_500_000, {
        unit: 'kilometer',
        localeTag: 'ar-u-nu-arab',
      }),
    ).toBe('٥٫٥ كم');
  });
});
