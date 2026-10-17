// src/theme/palette.test.ts
// The core floor: pairs no app may drop, in every scheme and variant. The app's full table (every
// pair its components paint) lives in contracts/contrast.json; write-palette.mjs and
// check-design-system.mjs judge the palette by that table plus this floor, and
// accessibility-as-code runs the same table in Jest.
import { contrastRatio } from './contrast';
import { PALETTE } from './palette';

import type { ColorTokens, Palette, SchemeColors } from './theme-types';

type Pair = readonly [keyof ColorTokens, keyof ColorTokens, number];

/** Text 4.5:1 (WCAG 1.4.3); the control edge and the focus indicator 3:1 (WCAG 1.4.11). */
const CORE_PAIRS: readonly Pair[] = [
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['border', 'background', 3],
  ['focus', 'background', 3],
];

function failures(where: string, colors: ColorTokens): string[] {
  return CORE_PAIRS.filter(([fg, bg, min]) => contrastRatio(colors[fg], colors[bg]) < min).map(
    ([fg, bg, min]) =>
      `${where}: ${fg} on ${bg} is ${contrastRatio(colors[fg], colors[bg]).toFixed(2)}:1 < ${String(min)}:1`,
  );
}

function setFailures(prefix: string, set: SchemeColors): string[] {
  return [...failures(`${prefix}light`, set.light), ...failures(`${prefix}dark`, set.dark)];
}

function paletteFailures(palette: Palette): readonly string[] {
  const variant = palette.colorBlind;
  return [...setFailures('', palette), ...(variant ? setFailures('colorBlind.', variant) : [])];
}

describe('the app palette', () => {
  it('keeps the core pairs readable in light and dark', () => {
    expect(paletteFailures(PALETTE)).toStrictEqual([]);
  });

  it('catches muted text that is too faint', () => {
    const faint: Palette = { ...PALETTE, light: { ...PALETTE.light, textMuted: '#A8AFBB' } };

    expect(paletteFailures(faint)).toContain('light: textMuted on background is 2.04:1 < 4.5:1');
  });

  it('checks a colour-blind variant like the standard schemes', () => {
    const variant: Palette = {
      ...PALETTE,
      colorBlind: { light: { ...PALETTE.light, focus: '#C9CED6' }, dark: PALETTE.dark },
    };

    expect(paletteFailures(variant)).toContain(
      'colorBlind.light: focus on background is 1.46:1 < 3:1',
    );
  });
});
