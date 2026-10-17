// src/stores/settings/settings-reducer-cases.ts
// The settings rules as data: one case per action, the changes that change nothing (the store then
// writes nothing), and the volume clamp. settings-reducer.test.ts runs every case, and so does
// state-management-zustand's check-reducers. Plain data and type imports only, so a checker can load
// it without the app. The table type is written here (same shape as state-management-zustand's
// ReducerCases), so this file needs nothing but its own reducer.
import type { SettingsAction } from './settings-reducer';
import type { Settings } from './settings-schema';

type SettingsCase = {
  /** The kebab-case name of the rule the case pins; a failure names it. */
  readonly rule: string;
  /** The settings before the action; the table's `initial` when left out. */
  readonly state?: Settings;
  readonly action: SettingsAction;
} & ({ readonly same: true } | { readonly expect: Partial<Settings> });

type SettingsReducerCases = {
  readonly reducer: 'settingsReducer';
  readonly initial: Settings;
  readonly cases: readonly SettingsCase[];
};

/** DEFAULT_SETTINGS written out (a cases file holds data only); the test pins the two together. */
const FIRST_LAUNCH: Settings = {
  language: null,
  digits: 'automatic',
  theme: 'system',
  reduceMotion: 'system',
  hapticsEnabled: true,
  soundEnabled: false,
  soundVolume: 80,
};

const CHANGED: Settings = {
  ...FIRST_LAUNCH,
  language: 'ar',
  theme: 'dark',
  soundEnabled: true,
  soundVolume: 35,
};

export const SETTINGS_REDUCER_CASES: SettingsReducerCases = {
  reducer: 'settingsReducer',
  initial: FIRST_LAUNCH,
  cases: [
    {
      rule: 'set-language-saves-choice',
      action: { type: 'set-language', language: 'ar' },
      expect: { language: 'ar' },
    },
    {
      rule: 'set-language-null-is-system',
      state: CHANGED,
      action: { type: 'set-language', language: null },
      expect: { language: null },
    },
    {
      rule: 'set-digits',
      action: { type: 'set-digits', digits: 'latin' },
      expect: { digits: 'latin' },
    },
    {
      rule: 'set-theme',
      action: { type: 'set-theme', theme: 'dark' },
      expect: { theme: 'dark' },
    },
    {
      rule: 'set-theme-again-writes-nothing',
      action: { type: 'set-theme', theme: 'system' },
      same: true,
    },
    {
      rule: 'set-reduce-motion-explicit',
      action: { type: 'set-reduce-motion', reduceMotion: 'on' },
      expect: { reduceMotion: 'on' },
    },
    {
      rule: 'set-haptics-off',
      action: { type: 'set-haptics', isOn: false },
      expect: { hapticsEnabled: false },
    },
    {
      rule: 'set-sound-switch-and-volume-together',
      action: { type: 'set-sound', isOn: true, volume: 45 },
      expect: { soundEnabled: true, soundVolume: 45 },
    },
    {
      rule: 'volume-above-100-clamps',
      action: { type: 'set-sound', isOn: true, volume: 140 },
      expect: { soundVolume: 100 },
    },
    {
      rule: 'volume-rounds-to-whole-percent',
      action: { type: 'set-sound', isOn: true, volume: 12.6 },
      expect: { soundVolume: 13 },
    },
    {
      rule: 'volume-not-a-number-keeps-old',
      state: CHANGED,
      action: { type: 'set-sound', isOn: true, volume: Number.NaN },
      expect: { soundEnabled: true, soundVolume: 35 },
    },
    {
      rule: 'reset-settings-restores-first-launch',
      state: CHANGED,
      action: { type: 'reset-settings' },
      expect: FIRST_LAUNCH,
    },
    {
      rule: 'reset-settings-on-defaults-writes-nothing',
      action: { type: 'reset-settings' },
      same: true,
    },
  ],
};
