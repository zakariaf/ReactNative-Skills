// src/stores/settings/settings-codec.test.ts
import fc from 'fast-check';

import { LANGUAGES } from '@/i18n/languages';

import { decodeSettings, encodeSettings, SETTING_KEYS } from './settings-codec';
import { DEFAULT_SETTINGS } from './settings-schema';

import type { Settings } from './settings-schema';

const anySettings: fc.Arbitrary<Settings> = fc.record({
  language: fc.constantFrom(null, ...LANGUAGES),
  digits: fc.constantFrom('automatic', 'latin', 'local'),
  theme: fc.constantFrom('system', 'light', 'dark'),
  reduceMotion: fc.constantFrom('system', 'on', 'off'),
  hapticsEnabled: fc.boolean(),
  soundEnabled: fc.boolean(),
  soundVolume: fc.integer({ min: 0, max: 100 }),
});

/**
 * Frozen: the text an earlier version saved, before `digits` existed and while it still saved
 * `musicEnabled`. Never edit it; a new shape adds a new sample.
 */
const EARLIER_TEXT =
  '{"language":"ar","theme":"dark","reduceMotion":"on","hapticsEnabled":false,"soundEnabled":true,"soundVolume":35,"musicEnabled":true}';

describe('decodeSettings', () => {
  it('returns the defaults on the first launch', () => {
    expect(decodeSettings(null)).toStrictEqual({ settings: DEFAULT_SETTINGS, repairedKeys: [] });
  });

  it('decodes whatever it encoded', () => {
    fc.assert(
      fc.property(anySettings, (settings) => {
        // fast-check builds records without a prototype; compare plain copies.
        expect(decodeSettings(encodeSettings(settings))).toStrictEqual({
          settings: { ...settings },
          repairedKeys: [],
        });
      }),
    );
  });

  it('loads the text an earlier version saved: a missing field takes its default quietly', () => {
    expect(decodeSettings(EARLIER_TEXT)).toStrictEqual({
      settings: {
        language: 'ar',
        digits: 'automatic',
        theme: 'dark',
        reduceMotion: 'on',
        hapticsEnabled: false,
        soundEnabled: true,
        soundVolume: 35,
      },
      repairedKeys: [],
    });
  });

  it('repairs one unreadable field alone and keeps the rest', () => {
    const text = encodeSettings({ ...DEFAULT_SETTINGS, theme: 'dark', soundVolume: 30 });
    const decoded = decodeSettings(text.replace('"dark"', '"sepia"'));

    expect(decoded.settings).toStrictEqual({ ...DEFAULT_SETTINGS, soundVolume: 30 });
    expect(decoded.repairedKeys).toStrictEqual(['theme']);
  });

  it('falls back to every default when the text is not a JSON object', () => {
    for (const text of ['{"theme":', '[1,2]', '"dark"']) {
      expect(decodeSettings(text)).toStrictEqual({
        settings: DEFAULT_SETTINGS,
        repairedKeys: SETTING_KEYS,
      });
    }
  });
});

describe('SETTING_KEYS', () => {
  it('lists every field of the defaults, in schema order', () => {
    expect(SETTING_KEYS).toStrictEqual(Object.keys(DEFAULT_SETTINGS));
  });
});
