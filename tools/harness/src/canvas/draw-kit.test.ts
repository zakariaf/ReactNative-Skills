// src/canvas/draw-kit.test.ts
import { makeCanvasColors, makeDrawKit } from './draw-kit';

import type { SkiaApi } from './canvas-types';
import type { PaletteSet } from './draw-kit';
import type { SkTypeface } from '@shopify/react-native-skia';

const PALETTES: PaletteSet<'ink'> = { light: { ink: '#111111' }, dark: { ink: '#eeeeee' } };

/** An opt-in set (the app offers a colour-blind setting). */
const WITH_CVD: PaletteSet<'ink', 'light' | 'dark' | 'colorBlindDark'> = {
  ...PALETTES,
  colorBlindDark: { ink: '#56b4e9' },
};

type PaintCall = [string, unknown];

/** The few Skia factories the kit calls, recording what it asks for. */
function fakeSkia(): { skia: SkiaApi; paints: PaintCall[][] } {
  const paints: PaintCall[][] = [];
  const color = (hex: string): string => `color(${hex})`;
  const paint = (): unknown => {
    const calls: PaintCall[] = [];
    paints.push(calls);
    return {
      setAntiAlias: (isOn: boolean) => calls.push(['antiAlias', isOn]),
      setStyle: (style: number) => calls.push(['style', style]),
    };
  };
  const font = (typeface: unknown, size: number): unknown => ({ typeface, size });
  // Skia's factory names are PascalCase; the stand-ins are assigned, not declared, under them.
  const skia = { Color: color, Paint: paint, Font: font } as unknown as SkiaApi;
  return { skia, paints };
}

describe('makeCanvasColors', () => {
  it('resolves every token of the chosen set once', () => {
    const { skia } = fakeSkia();
    expect(makeCanvasColors(skia, PALETTES, 'dark')).toStrictEqual({
      set: 'dark',
      color: { ink: 'color(#eeeeee)' },
    });
  });

  it('resolves an opt-in set the same way', () => {
    const { skia } = fakeSkia();
    expect(makeCanvasColors(skia, WITH_CVD, 'colorBlindDark').color.ink).toBe('color(#56b4e9)');
  });
});

describe('makeDrawKit', () => {
  it('builds one anti-aliased fill, one stroke and the number font', () => {
    const { skia, paints } = fakeSkia();
    const typeface = { name: 'Inter' } as unknown as SkTypeface;
    const kit = makeDrawKit(skia, { paths: {}, numberTypeface: typeface, numberSize: 18 });
    expect(paints).toStrictEqual([
      [['antiAlias', true]],
      [
        ['antiAlias', true],
        ['style', 1],
      ],
    ]);
    expect(kit.numberFont).toStrictEqual({ typeface, size: 18 });
    expect(kit.labels).toStrictEqual({});
  });

  it('has no number font without a typeface', () => {
    const { skia } = fakeSkia();
    expect(
      makeDrawKit(skia, { paths: {}, numberTypeface: null, numberSize: 18 }).numberFont,
    ).toBeNull();
  });
});
