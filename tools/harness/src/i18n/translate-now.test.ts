// src/i18n/translate-now.test.ts
import { createTranslateNow, languageNow, recordShownLanguage } from './translate-now';

import type { DeviceLocale } from './resolve-language';

const mockDeviceLocales: DeviceLocale[] = [];

jest.mock('expo-localization', () => ({ getLocales: () => mockDeviceLocales }));

function failOnError(error: Error): never {
  throw error;
}

function deviceSpeaks(...tags: string[]): void {
  mockDeviceLocales.splice(
    0,
    mockDeviceLocales.length,
    ...tags.map((languageTag) => ({
      languageTag,
      languageCode: languageTag.split('-')[0] ?? null,
      languageScriptCode: null,
    })),
  );
}

describe('createTranslateNow', () => {
  beforeEach(() => {
    recordShownLanguage(null);
  });

  it("follows the device's languages, then the source, until a provider has shown one", () => {
    deviceSpeaks('fr-FR', 'ar-EG');
    expect(languageNow()).toStrictEqual({ language: 'ar', digits: 'automatic' });
    expect(createTranslateNow(failOnError)('tasks.summary.open', { openCount: 3 })).toBe(
      '٣ مهام مفتوحة',
    );
    deviceSpeaks('fr-FR');
    expect(createTranslateNow(failOnError)('tasks.summary.open', { openCount: 3 })).toBe(
      '3 open tasks',
    );
  });

  it('keeps the language and digits I18nProvider showed last, whatever the device says', () => {
    deviceSpeaks('en-US');
    recordShownLanguage({ language: 'ar', digits: 'latin' });
    expect(createTranslateNow(failOnError)('tasks.summary.open', { openCount: 3 })).toBe(
      '3 مهام مفتوحة',
    );
    recordShownLanguage({ language: 'ar', digits: 'automatic' });
    expect(createTranslateNow(failOnError)('tasks.summary.open', { openCount: 11 })).toBe(
      '١١ مهمة مفتوحة',
    );
  });

  it('reports a problem to onError and still returns text', () => {
    deviceSpeaks('en-US');
    const onError = jest.fn();
    expect(createTranslateNow(onError)('tasks.moved', { listName: 3 })).toContain('Moved to');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('listName') }),
    );
  });
});
