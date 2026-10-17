// src/theme/shadow-styles.test.ts
import { PALETTE } from './palette';
import { focusRing, ring, shadow } from './shadow-styles';

const { shadow: shadowColor, focus, surface } = PALETTE.light;

describe('shadow styles', () => {
  it('draws a static shadow straight down, crisp unless a blur is asked for', () => {
    expect(shadow(8, shadowColor)).toStrictEqual({
      boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 0, spreadDistance: 0, color: shadowColor }],
    });
    expect(shadow(2, shadowColor, 6).boxShadow).toMatchObject([{ blurRadius: 6 }]);
  });

  it('draws a ring as a spread with no offset', () => {
    expect(ring(3, surface)).toStrictEqual({
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 3, color: surface }],
    });
  });

  it('draws the focus indicator 3 pt wide and 2 pt away', () => {
    expect(focusRing(focus)).toStrictEqual({
      outlineWidth: 3,
      outlineStyle: 'solid',
      outlineOffset: 2,
      outlineColor: focus,
    });
  });
});
