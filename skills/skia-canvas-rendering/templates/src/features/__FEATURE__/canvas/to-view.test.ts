// src/features/__FEATURE__/canvas/to-view.test.ts
import { toView } from './to-view';

import type { __SURFACE_PASCAL__State } from './canvas-model';

const STATE: __SURFACE_PASCAL__State = {
  cols: 3,
  rows: 3,
  cells: [0, 1, 0, 1, 1, 1, 0, 1, 0],
  streakDays: 12,
};
/**
 * A fixed Arabic-Indic formatter: the test proves toView takes its digits from the app's ViewFormat.
 * Which digits a real Intl.NumberFormat writes depends on the Intl data the app loads: under the
 * forced FormatJS polyfills 'ar' and 'ar-EG' both write Latin digits, and only a tag that carries the
 * numbering system ('ar-u-nu-arab', from i18n's localeTagFor) writes these. That is the i18n layer's
 * test, not this surface's.
 */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ARABIC = {
  formatNumber: (value: number) =>
    String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit),
};

describe('toView', () => {
  it('keeps the grid and localises the streak length', () => {
    expect(toView(STATE, ARABIC)).toStrictEqual({
      cols: 3,
      rows: 3,
      cells: STATE.cells,
      streakText: '١٢',
    });
  });

  it('clamps a negative streak at zero', () => {
    expect(toView({ ...STATE, streakDays: -2 }, { formatNumber: String }).streakText).toBe('0');
  });
});
