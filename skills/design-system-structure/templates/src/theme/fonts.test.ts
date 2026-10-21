// src/theme/fonts.test.ts
import { scriptFontFor, scriptOf } from './fonts';

import type { FontWeightToken, TypeFace } from './tokens';

const SYSTEM_FONT = { latin: null, arabic: null } as const;

/** A fixed table, so these cases test the selection, not the app's choice of fonts. */
const BUNDLED = {
  latin: {
    regular: 'Latin-Regular',
    medium: 'Latin-Medium',
    semibold: 'Latin-SemiBold',
    bold: 'Latin-Bold',
  },
  arabic: {
    regular: 'Arabic-Regular',
    medium: 'Arabic-Medium',
    semibold: 'Arabic-SemiBold',
    bold: 'Arabic-Bold',
  },
} as const;

describe('scriptFontFor', () => {
  it.each([
    { language: 'en', weight: 'regular', face: 'text', family: 'Latin-Regular' },
    { language: 'en-GB', weight: 'semibold', face: 'text', family: 'Latin-SemiBold' },
    { language: 'en', weight: 'regular', face: 'display', family: 'Latin-Bold' },
    { language: 'ar', weight: 'medium', face: 'text', family: 'Arabic-Medium' },
    { language: 'ar-EG', weight: 'regular', face: 'display', family: 'Arabic-Bold' },
    { language: 'ar', weight: 'bold', face: 'brand', family: 'Latin-Bold' },
  ] as const)('picks $family for $language $face $weight', ({ language, weight, face, family }) => {
    expect(scriptFontFor(language, { weight, face }, BUNDLED).fontFamily).toBe(family);
  });

  it('marks Arabic text as tall and keeps the brand name Latin', () => {
    expect(scriptFontFor('ar', { weight: 'regular', face: 'text' }, BUNDLED).isTallScript).toBe(
      true,
    );
    expect(scriptFontFor('ar', { weight: 'bold', face: 'brand' }, BUNDLED).isTallScript).toBe(
      false,
    );
  });

  it('names no family for a script on the system font', () => {
    const mixed = { latin: BUNDLED.latin, arabic: null };

    expect(scriptFontFor('en', { weight: 'bold', face: 'text' }, mixed).fontFamily).toBe(
      'Latin-Bold',
    );
    expect(scriptFontFor('ar', { weight: 'bold', face: 'text' }, mixed).fontFamily).toBeNull();
  });

  it('falls back to Latin for a language the app lists no script for', () => {
    expect(scriptOf('de-AT')).toBe('latin');
    expect(scriptOf('FA')).toBe('arabic');
  });
});

describe('scriptFontFor with a display face', () => {
  const display = {
    latin: {
      regular: 'LatinDisplay-Bold',
      medium: 'LatinDisplay-Bold',
      semibold: 'LatinDisplay-Bold',
      bold: 'LatinDisplay-Bold',
    },
  } as const;

  it.each([
    { language: 'en', weight: 'regular', face: 'display', family: 'LatinDisplay-Bold' },
    { language: 'ar', weight: 'bold', face: 'brand', family: 'LatinDisplay-Bold' },
    { language: 'en', weight: 'semibold', face: 'text', family: 'Latin-SemiBold' },
    { language: 'ar', weight: 'regular', face: 'display', family: 'Arabic-Bold' },
  ] as const)('picks $family for $language $face $weight', ({ language, weight, face, family }) => {
    expect(
      scriptFontFor(language, { weight, face }, { scripts: BUNDLED, display }).fontFamily,
    ).toBe(family);
  });

  it('draws display text in the display face over a system text font', () => {
    const tables = { scripts: SYSTEM_FONT, display };

    expect(scriptFontFor('en', { weight: 'bold', face: 'display' }, tables).fontFamily).toBe(
      'LatinDisplay-Bold',
    );
    expect(scriptFontFor('en', { weight: 'bold', face: 'text' }, tables).fontFamily).toBeNull();
  });
});

describe('scriptFontFor with the system font', () => {
  it.each([
    { weight: 'regular', face: 'text', fontWeight: '400' },
    { weight: 'medium', face: 'text', fontWeight: '500' },
    { weight: 'semibold', face: 'text', fontWeight: '600' },
    { weight: 'regular', face: 'display', fontWeight: '700' },
  ] as const satisfies readonly { weight: FontWeightToken; face: TypeFace; fontWeight: string }[])(
    'names no family and asks for weight $fontWeight ($face $weight)',
    ({ weight, face, fontWeight }) => {
      expect(scriptFontFor('en', { weight, face }, SYSTEM_FONT)).toStrictEqual({
        fontFamily: null,
        fontWeight,
        isTallScript: false,
      });
    },
  );

  it('keeps tall-script line heights for Arabic on the system font', () => {
    expect(scriptFontFor('ar', { weight: 'regular', face: 'text' }, SYSTEM_FONT).isTallScript).toBe(
      true,
    );
  });
});
