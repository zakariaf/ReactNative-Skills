// src/features/settings-effects/read-saved-language.test.ts
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { encodeSettings } from '@/stores/settings/settings-codec';
import { DEFAULT_SETTINGS } from '@/stores/settings/settings-schema';

import { readSavedLanguage } from './read-saved-language';

describe('readSavedLanguage', () => {
  it('returns the saved choice', () => {
    const storage = createFakeSettingsStorage({
      text: encodeSettings({ ...DEFAULT_SETTINGS, language: 'ar' }),
    });

    expect(readSavedLanguage(storage)).toBe('ar');
  });

  it('returns null before the first save and while the phone language is followed', () => {
    expect(readSavedLanguage(createFakeSettingsStorage())).toBeNull();
    expect(
      readSavedLanguage(createFakeSettingsStorage({ text: encodeSettings(DEFAULT_SETTINGS) })),
    ).toBeNull();
  });

  it('returns null when the saved text cannot be read or is not a language', () => {
    expect(readSavedLanguage(createFakeSettingsStorage({ isReadFailing: true }))).toBeNull();
    expect(readSavedLanguage(createFakeSettingsStorage({ text: '{"language":"xx"}' }))).toBeNull();
    expect(readSavedLanguage(createFakeSettingsStorage({ text: 'not json' }))).toBeNull();
  });

  it('writes nothing', () => {
    const storage = createFakeSettingsStorage({ text: encodeSettings(DEFAULT_SETTINGS) });

    readSavedLanguage(storage);

    expect(storage.writes).toStrictEqual([]);
  });
});
