// src/theme/use-text-style.test.tsx
import { renderHook } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { scriptFontFor } from './fonts';
import { TextLocaleProvider } from './text-locale';
import { TYPE_STYLES } from './type-styles';
import { TEXT_ALIGN, fontStyleOf, snapToPixels, useTextStyle } from './use-text-style';

import type { TextLocale } from './text-locale';
import type { TextStyleOptions } from './use-text-style';
import type { ReactNode } from 'react';
import type { TextStyle } from 'react-native';

const ROW_LABEL: TextStyleOptions = { style: TYPE_STYLES.rowLabel, align: 'start' };
/** The font part of a style, from the app's own SCRIPT_FONTS (a family, or a system weight). */
const fontIn = (language: string): TextStyle =>
  fontStyleOf(scriptFontFor(language, TYPE_STYLES.rowLabel));

/** The window React Native reports to useWindowDimensions (Jest's own default font scale is 2). */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

/** A phone at this pixel ratio with the system text size at this scale. */
function onDevice(pixelRatio: number, fontScale: number): void {
  mockWindow.fontScale = fontScale;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(pixelRatio);
}

async function styleIn(locale: TextLocale, options: TextStyleOptions): Promise<TextStyle> {
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TextLocaleProvider value={locale}>{children}</TextLocaleProvider>
  );
  const { result } = await renderHook(() => useTextStyle(options), { wrapper });
  return result.current;
}

const ENGLISH: TextLocale = { language: 'en', direction: 'ltr' };
const ARABIC: TextLocale = { language: 'ar', direction: 'rtl' };

describe('snapToPixels', () => {
  it('puts a line height on the nearest device pixel (3x), never on whole points', () => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);

    expect(snapToPixels(18.2)).toBe(55 / 3);
    expect(snapToPixels(22.44)).toBe(67 / 3);
    expect(snapToPixels(25.5)).toBe(77 / 3); // whole points would give 26
  });

  it('keeps a value that is already on the grid (2x)', () => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(2);

    expect(snapToPixels(25.5)).toBe(25.5);
    expect(snapToPixels(18.2)).toBe(18);
  });
});

describe('useTextStyle', () => {
  beforeEach(() => {
    onDevice(3, 1);
  });

  it('sets Latin text in the Latin font with the snapped base line height', async () => {
    expect(await styleIn(ENGLISH, ROW_LABEL)).toStrictEqual({
      ...fontIn('en'),
      fontSize: 17,
      lineHeight: 67 / 3,
      writingDirection: 'ltr',
      textAlign: TEXT_ALIGN.start,
    });
  });

  it('sets Arabic text in its own font with the snapped tall line height, right to left', async () => {
    expect(await styleIn(ARABIC, { ...ROW_LABEL, align: 'end' })).toStrictEqual({
      ...fontIn('ar'),
      fontSize: 17,
      lineHeight: 77 / 3,
      writingDirection: 'rtl',
      textAlign: TEXT_ALIGN.end,
    });
  });

  it('follows the language of the text, not of the UI (an autonym in a language list)', async () => {
    const style = await styleIn(ENGLISH, { ...ROW_LABEL, language: 'ar' });

    expect(style).toMatchObject({ ...fontIn('ar'), lineHeight: 77 / 3, writingDirection: 'ltr' });
  });

  it('tracks the brand name in Latin script only, and never a connected script', async () => {
    const brand: TextStyleOptions = { style: TYPE_STYLES.brandName, align: 'start' };

    expect((await styleIn(ENGLISH, brand)).letterSpacing).toBeCloseTo(0.22);
    expect(await styleIn(ARABIC, { ...brand, style: TYPE_STYLES.rowLabel })).not.toHaveProperty(
      'letterSpacing',
    );
  });
});

describe('useTextStyle with large text', () => {
  it('puts the scaled line box on the pixel grid at 200 % (React Native multiplies lineHeight)', async () => {
    onDevice(3, 2);

    const style = await styleIn(ENGLISH, ROW_LABEL);

    // 17 x 1.32 x 2 = 44.88 is drawn as 135/3 = 45 pt: the style passes 45 / 2.
    expect(style).toMatchObject({ fontSize: 17, lineHeight: 22.5 });
  });

  it('stops growing at the 200 % cap, like the text itself', async () => {
    onDevice(3, 3.1);

    expect((await styleIn(ENGLISH, ROW_LABEL)).lineHeight).toBe(22.5);
  });
});

describe('fontStyleOf', () => {
  it('names a bundled family and never sets fontWeight on it', () => {
    const bundled = {
      latin: {
        regular: 'Brand-Regular',
        medium: 'Brand-Medium',
        semibold: 'Brand-SemiBold',
        bold: 'Brand-Bold',
      },
      arabic: null,
    };

    expect(fontStyleOf(scriptFontFor('en', TYPE_STYLES.buttonLabel, bundled))).toStrictEqual({
      fontFamily: 'Brand-Bold',
    });
  });

  it('asks the system font for its weight when the script bundles no font', () => {
    const systemFont = { latin: null, arabic: null } as const;

    expect(fontStyleOf(scriptFontFor('en', TYPE_STYLES.buttonLabel, systemFont))).toStrictEqual({
      fontWeight: '700',
    });
    expect(fontStyleOf(scriptFontFor('en', TYPE_STYLES.rowLabel, systemFont))).toStrictEqual({
      fontWeight: '400',
    });
  });
});
