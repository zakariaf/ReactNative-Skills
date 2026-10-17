// scripts/i18n/app-languages.test.ts
import { join } from 'node:path';

import { I18N_DIR, parseAppLanguages, readAppLanguages } from './app-languages.ts';

// Exactly what Prettier (printWidth 100, trailingComma "all") writes for a longer list.
const PRETTIER_LONG_LIST = `export const LANGUAGES = [
  'en',
  'ar',
  'de',
  'es',
  'fa',
  'fr',
  'he',
  'hi',
  'ja',
  'ko',
  'pt-BR',
  'ru',
  'zh-Hans',
] as const;
export const SOURCE_LANGUAGE = 'en' satisfies Language;
`;

describe('readAppLanguages', () => {
  it('reads the i18n folder the checkers read (rn-skills.config.json "i18nDir")', () => {
    expect(I18N_DIR).toBe('src/i18n');
  });

  it('reads LANGUAGES and SOURCE_LANGUAGE from <I18N_DIR>/languages.ts', () => {
    expect(readAppLanguages(join(__dirname, '..', '..'))).toStrictEqual({
      languages: ['en', 'ar'],
      sourceLanguage: 'en',
    });
  });
});

describe('parseAppLanguages', () => {
  it('reads the multi-line list Prettier writes, trailing comma included', () => {
    const parsed = parseAppLanguages(PRETTIER_LONG_LIST);
    expect(parsed.languages).toHaveLength(13);
    expect(parsed.languages.slice(-3)).toStrictEqual(['pt-BR', 'ru', 'zh-Hans']);
    expect(parsed.sourceLanguage).toBe('en');
  });

  it('accepts double quotes', () => {
    const doubleQuoted =
      'export const LANGUAGES = ["en", "ar"] as const;\nexport const SOURCE_LANGUAGE = "ar";';
    expect(parseAppLanguages(doubleQuoted)).toStrictEqual({
      languages: ['en', 'ar'],
      sourceLanguage: 'ar',
    });
  });

  it('refuses a list that is not a literal, an empty list and a source outside the list', () => {
    expect(() => parseAppLanguages('export const LANGUAGES = BASE;')).toThrow('as a literal');
    expect(() => parseAppLanguages('export const LANGUAGES = [] as const;')).toThrow(
      'as a literal',
    );
    expect(() => parseAppLanguages('export const LANGUAGES = [...BASE, "ar"];')).toThrow(
      'as a literal',
    );
    const outside =
      "export const LANGUAGES = ['en'] as const;\nexport const SOURCE_LANGUAGE = 'ar'";
    expect(() => parseAppLanguages(outside)).toThrow('SOURCE_LANGUAGE');
  });
});
