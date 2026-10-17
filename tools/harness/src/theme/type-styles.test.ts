// src/theme/type-styles.test.ts
import { TYPE_SCALE } from './tokens';
import { TYPE_STYLES, lineHeightOf, snapToGrid, typeStyleOf } from './type-styles';

describe('type styles', () => {
  it('resolves roles and component styles through one lookup', () => {
    expect(typeStyleOf('heading')).toBe(TYPE_SCALE.heading);
    expect(typeStyleOf('badge')).toBe(TYPE_STYLES.badge);
  });

  it('tracks only the brand name', () => {
    const tracked = Object.entries(TYPE_STYLES)
      .filter(([, style]) => 'letterSpacingEm' in style)
      .map(([name]) => name);
    expect(tracked).toStrictEqual(['brandName']);
  });

  it('keeps the strong row label at the row line heights, in bold', () => {
    expect(TYPE_STYLES.rowLabelStrong).toStrictEqual({ ...TYPE_STYLES.rowLabel, weight: 'bold' });
  });

  it('gives no tall script a tighter line box than the base script', () => {
    const tighter = Object.entries({ ...TYPE_SCALE, ...TYPE_STYLES })
      .filter(([, style]) => style.lineHeight.tall < style.lineHeight.base)
      .map(([name]) => name);
    expect(tighter).toStrictEqual([]);
  });
});

describe('line heights on the pixel grid', () => {
  it('snaps to the nearest device pixel at 3x, never to whole points', () => {
    expect(lineHeightOf('rowDescription', 'base', 3)).toBe(55 / 3); // 14 x 1.3 = 18.2
    expect(lineHeightOf('rowLabel', 'base', 3)).toBe(67 / 3); // 17 x 1.32 = 22.44
    expect(lineHeightOf('rowLabel', 'tall', 3)).toBe(77 / 3); // 17 x 1.5 = 25.5, not 26
    expect(lineHeightOf('caption', 'base', 3)).toBe(55 / 3); // 13 x 1.4 = 18.2
  });

  it('gives tall-script counts a box that holds their digits', () => {
    expect(lineHeightOf('statValue', 'base', 3)).toBe(33); // 30 x 1.1
    expect(lineHeightOf('statValue', 'tall', 3)).toBe(131 / 3); // 30 x 1.45 = 43.5
  });

  it('keeps values that are already on the grid, at 2x and at fractional Android densities', () => {
    expect(snapToGrid(25.5, 2)).toBe(25.5);
    expect(snapToGrid(18.2, 2)).toBe(18);
    expect(snapToGrid(22.44, 2.625)).toBe(59 / 2.625); // a 420 dpi Android phone
  });
});
