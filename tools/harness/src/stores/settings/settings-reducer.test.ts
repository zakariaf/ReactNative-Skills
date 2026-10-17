// src/stores/settings/settings-reducer.test.ts
import fc from 'fast-check';

import { clampPercent, settingsReducer } from './settings-reducer';
import { SETTINGS_REDUCER_CASES } from './settings-reducer-cases';
import { DEFAULT_SETTINGS } from './settings-schema';

const { initial, cases } = SETTINGS_REDUCER_CASES;
const CHANGES = cases.flatMap((item) =>
  'expect' in item
    ? [
        {
          rule: item.rule,
          before: item.state ?? initial,
          action: item.action,
          expected: item.expect,
        },
      ]
    : [],
);
const NO_OPS = cases.flatMap((item) =>
  'same' in item ? [{ rule: item.rule, before: item.state ?? initial, action: item.action }] : [],
);

describe('settingsReducer', () => {
  it('starts the cases table from the first-launch values', () => {
    expect(initial).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('has a case for every action, and one that changes nothing', () => {
    const actions = new Set(cases.map((item) => item.action.type));

    expect([...actions].sort()).toStrictEqual([
      'reset-settings',
      'set-digits',
      'set-haptics',
      'set-language',
      'set-reduce-motion',
      'set-sound',
      'set-theme',
    ]);
    expect(NO_OPS.length).toBeGreaterThan(0);
  });

  it.each(CHANGES)('keeps $rule', ({ before, action, expected }) => {
    expect(settingsReducer(before, action)).toMatchObject(expected);
  });

  it.each(NO_OPS)(
    'returns the same object for $rule, so nothing is written',
    ({ before, action }) => {
      expect(settingsReducer(before, action)).toBe(before);
    },
  );

  it('keeps the stored volume an integer between 0 and 100 for any input', () => {
    fc.assert(
      fc.property(fc.double(), (volume) => {
        const { soundVolume } = settingsReducer(DEFAULT_SETTINGS, {
          type: 'set-sound',
          isOn: true,
          volume,
        });
        return Number.isInteger(soundVolume) && soundVolume >= 0 && soundVolume <= 100;
      }),
    );
  });

  it('leaves the settings it receives untouched', () => {
    const frozen = Object.freeze({ ...DEFAULT_SETTINGS });

    expect(settingsReducer(frozen, { type: 'set-theme', theme: 'light' }).theme).toBe('light');
    expect(frozen.theme).toBe('system');
  });
});

describe('clampPercent', () => {
  it('rounds, clamps, and keeps the fallback for a value that is not a number', () => {
    expect([49.5, -3, 180].map((value) => clampPercent(value, 60))).toStrictEqual([50, 0, 100]);
    expect([Number.NaN, Infinity].map((value) => clampPercent(value, 60))).toStrictEqual([60, 60]);
  });
});
