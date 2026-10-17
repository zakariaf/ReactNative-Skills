// src/features/settings/settings-preference-actions.test.ts
import { DEFAULT_SETTINGS } from '@/stores/settings/settings-schema';

import { createPreferenceActions } from './settings-preference-actions';

import type { PreferenceInput } from './settings-preference-actions';
import type { SettingsAction } from '@/stores/settings/settings-reducer';

function setup(overrides: Partial<PreferenceInput> = {}) {
  const calls: string[] = [];
  const actions = createPreferenceActions({
    settings: DEFAULT_SETTINGS,
    isReduceMotionOn: false,
    dispatch: (action: SettingsAction) => {
      calls.push(action.type);
    },
    onToggled: () => {
      calls.push('feedback');
    },
    ...overrides,
  });
  return { actions, calls };
}

describe('createPreferenceActions', () => {
  it('dispatches one action per switch, then plays the feedback once', () => {
    const { actions, calls } = setup();

    actions.onToggleSound();
    actions.onToggleHaptics();
    actions.onToggleReduceMotion();

    expect(calls).toStrictEqual([
      'set-sound',
      'feedback',
      'set-haptics',
      'feedback',
      'set-reduce-motion',
      'feedback',
    ]);
  });

  it('plays no feedback for segments, the slider or the reset', () => {
    const { actions, calls } = setup();

    actions.onSelectTheme('dark');
    actions.onSelectDigits('latin');
    actions.onChangeSoundVolume(0.5);
    actions.onConfirmResetSettings();

    expect(calls).toStrictEqual(['set-theme', 'set-digits', 'set-sound', 'reset-settings']);
  });

  it('keeps the volume when the switch flips, and the switch when the volume moves', () => {
    const sent: SettingsAction[] = [];
    const { actions } = setup({
      dispatch: (action) => {
        sent.push(action);
      },
    });

    actions.onToggleSound();
    actions.onChangeSoundVolume(0.3);

    expect(sent).toStrictEqual([
      { type: 'set-sound', isOn: true, volume: 80 },
      { type: 'set-sound', isOn: false, volume: 30 },
    ]);
  });

  it('dispatches a drag step only when the whole percent changes', () => {
    const { actions, calls } = setup();

    actions.onChangeSoundVolume(0.801);
    actions.onChangeSoundVolume(0.804);

    expect(calls).toStrictEqual([]);
  });

  it('writes the opposite of what the Reduce motion switch shows, never "system"', () => {
    const sent: SettingsAction[] = [];
    const dispatch = (action: SettingsAction): void => {
      sent.push(action);
    };

    setup({ isReduceMotionOn: true, dispatch }).actions.onToggleReduceMotion();
    setup({ isReduceMotionOn: false, dispatch }).actions.onToggleReduceMotion();

    expect(sent).toStrictEqual([
      { type: 'set-reduce-motion', reduceMotion: 'off' },
      { type: 'set-reduce-motion', reduceMotion: 'on' },
    ]);
  });
});
