// scripts/i18n/native-locales.test.ts
import { join } from 'node:path';

import { nativeLocale, nativeLocales, sourceText } from './native-locales.ts';

const ROOT = join(__dirname, '..', '..');
const KEYS = {
  displayName: 'app.name',
  usageDescriptions: { NSCameraUsageDescription: 'permissions.camera.usage-description' },
};

describe('nativeLocales', () => {
  it('reads the app name and the purpose strings of every language from the catalogs', () => {
    const locales = nativeLocales(ROOT, KEYS);
    expect(Object.keys(locales)).toStrictEqual(['en', 'ar']);
    expect(locales['ar']?.ios['CFBundleDisplayName']).toBe('المهام');
    expect(locales['en']?.android).toStrictEqual({ app_name: 'Tasks' });
    expect(locales['en']?.ios['NSCameraUsageDescription']).toMatch(/^Lets you add a photo/);
  });

  it('keeps the variant label of a development build in every language', () => {
    const locales = nativeLocales(ROOT, KEYS, { variantName: (name) => `${name} (Dev)` });
    expect(locales['ar']?.ios['CFBundleDisplayName']).toBe('المهام (Dev)');
    expect(locales['en']?.android).toStrictEqual({ app_name: 'Tasks (Dev)' });
    expect(locales['en']?.ios['NSCameraUsageDescription']).toMatch(/^Lets you add a photo/);
  });
});

describe('nativeLocale', () => {
  it('refuses a missing key and ICU syntax, which no system dialog formats', () => {
    const tasks = { 'app.name': 'Tasks' };
    expect(() => nativeLocale(tasks, KEYS, { language: 'en' })).toThrow(
      'the en catalog lacks permissions.camera.usage-description',
    );
    const withBraces = { 'app.name': '{appName}', 'permissions.camera.usage-description': 'x' };
    expect(() => nativeLocale(withBraces, KEYS, { language: 'en' })).toThrow(
      'system texts are plain',
    );
  });
});

describe('sourceText', () => {
  it('gives a config plugin the source-language text of a catalog key', () => {
    expect(sourceText(ROOT, 'permissions.camera.usage-description')).toMatch(
      /^Lets you add a photo/,
    );
    expect(() => sourceText(ROOT, 'permissions.microphone.usage-description')).toThrow(
      'the en catalog lacks',
    );
  });
});
