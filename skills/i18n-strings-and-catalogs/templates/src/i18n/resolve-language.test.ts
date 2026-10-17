// src/i18n/resolve-language.test.ts
import { LANGUAGE_AUTONYMS } from './languages';
import { deviceTagCandidates, matchDeviceLocale, resolveLanguage } from './resolve-language';

import type { DeviceLocale } from './resolve-language';

/** A getLocales() entry: languageTag as the platform reports it, languageCode from it. */
function device(languageTag: string, languageScriptCode: string | null = null): DeviceLocale {
  const languageCode = languageTag === '' ? null : (languageTag.split(/[-_]/)[0] ?? null);
  return { languageTag, languageCode, languageScriptCode };
}

describe('resolveLanguage', () => {
  it('keeps the saved choice whatever the phone says', () => {
    expect(resolveLanguage('en', [device('ar-EG')])).toBe('en');
  });

  it.each([
    { locales: [device('ar')], expected: 'ar' },
    { locales: [device('ar-EG')], expected: 'ar' },
    { locales: [device('AR', 'Arab')], expected: 'ar' },
    { locales: [device('arb')], expected: 'ar' },
    { locales: [device('fr-FR'), device('ar-SA')], expected: 'ar' },
    { locales: [device(''), device('en-US')], expected: 'en' },
    { locales: [device('fr')], expected: 'en' },
    { locales: [], expected: 'en' },
  ] as const)('picks $expected for the device list', ({ locales, expected }) => {
    expect(resolveLanguage(null, locales)).toBe(expected);
  });
});

describe('matchDeviceLocale (regional and script languages)', () => {
  const languages = ['en', 'en-GB', 'pt-BR', 'es-419', 'zh-Hant', 'ckb'];
  const aliases = { 'es-MX': 'es-419', 'zh-TW': 'zh-Hant', 'ku-Arab': 'ckb' };

  it.each([
    { locale: device('pt-BR'), expected: 'pt-BR' },
    { locale: device('PT_br'), expected: 'pt-BR' },
    { locale: device('en-GB'), expected: 'en-GB' },
    { locale: device('en-US'), expected: 'en' },
    { locale: device('en-US-u-fw-mon'), expected: 'en' },
    { locale: device('es-419'), expected: 'es-419' },
    { locale: device('es-MX'), expected: 'es-419' },
    { locale: device('zh-Hant-TW', 'Hant'), expected: 'zh-Hant' },
    { locale: device('zh-HK', 'Hant'), expected: 'zh-Hant' },
    { locale: device('zh-TW'), expected: 'zh-Hant' },
    { locale: device('zh-Hans-CN', 'Hans'), expected: null },
    { locale: device('pt-PT'), expected: null },
    { locale: device('ku-Arab-IQ', 'Arab'), expected: 'ckb' },
    { locale: device('ku-Latn-TR', 'Latn'), expected: null },
  ])('maps $locale.languageTag to $expected', ({ locale, expected }) => {
    expect(matchDeviceLocale(locale, languages, aliases)).toBe(expected);
  });

  it('tries the full tag, then language-Script, then the language', () => {
    expect(deviceTagCandidates(device('zh-Hant-TW', 'Hant'))).toStrictEqual([
      'zh-Hant-TW',
      'zh-Hant',
      'zh',
    ]);
    expect(deviceTagCandidates(device('pt-BR'))).toStrictEqual(['pt-BR', 'pt']);
  });
});

describe('LANGUAGE_AUTONYMS', () => {
  it('pins each language name in its own script (never translated)', () => {
    expect(LANGUAGE_AUTONYMS).toStrictEqual({ en: 'English', ar: 'العربية' });
  });
});
