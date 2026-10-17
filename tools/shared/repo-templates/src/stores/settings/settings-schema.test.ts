// src/stores/settings/settings-schema.test.ts
import * as v from 'valibot';

import { DEFAULT_SETTINGS, PERCENT, SETTINGS_SCHEMA } from './settings-schema';

describe('settings schema', () => {
  it('pins the first-launch values', () => {
    expect(DEFAULT_SETTINGS).toStrictEqual({
      language: null,
      digits: 'automatic',
      theme: 'system',
      reduceMotion: 'system',
      hapticsEnabled: true,
      soundEnabled: false,
      soundVolume: 80,
    });
  });

  it('accepts the first-launch values', () => {
    expect(v.is(SETTINGS_SCHEMA, DEFAULT_SETTINGS)).toBe(true);
  });

  it('rejects an unknown field, so a typo never saves', () => {
    expect(v.is(SETTINGS_SCHEMA, { ...DEFAULT_SETTINGS, fontScale: 120 })).toBe(false);
  });

  it('keeps a percent an integer between 0 and 100', () => {
    expect([0, 100].map((value) => v.is(PERCENT, value))).toStrictEqual([true, true]);
    expect([-1, 101, 50.5].map((value) => v.is(PERCENT, value))).toStrictEqual([
      false,
      false,
      false,
    ]);
  });
});
