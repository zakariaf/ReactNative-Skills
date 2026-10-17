// src/features/settings/settings-preference-actions.ts
// Pure: the handler of every Settings row that changes a preference. Each one dispatches exactly
// one settings action, and the store saves it before the screen sees it, so there is no Save
// button. A switch then plays its feedback once, after the dispatch, so turning sound or haptics off
// is already silent: the feedback reads the settings at call time.
import type { SettingsAction } from '@/stores/settings/settings-reducer';
import type { Settings } from '@/stores/settings/settings-schema';

export type PreferenceInput = {
  readonly settings: Settings;
  /** What the Reduce motion switch shows: the explicit choice, or the phone's switch while 'system'. */
  readonly isReduceMotionOn: boolean;
  readonly dispatch: (action: SettingsAction) => void;
  /** Runs once after every switch flip (the toggle moment); sliders and segments never call it. */
  readonly onToggled: () => void;
};

export type PreferenceActions = {
  readonly onSelectDigits: (digits: Settings['digits']) => void;
  readonly onSelectTheme: (theme: Settings['theme']) => void;
  readonly onToggleReduceMotion: () => void;
  readonly onToggleSound: () => void;
  /** The slider's 0..1 value, on every drag step: dispatches only when the whole percent changes. */
  readonly onChangeSoundVolume: (volumeRate: number) => void;
  readonly onToggleHaptics: () => void;
  /** After the "Reset settings" confirmation: every setting back to its first-launch value. */
  readonly onConfirmResetSettings: () => void;
};

export function createPreferenceActions(input: PreferenceInput): PreferenceActions {
  const { settings, isReduceMotionOn, dispatch, onToggled } = input;
  const { soundEnabled: isSoundOn, soundVolume, hapticsEnabled: isHapticsOn } = settings;
  const flip = (action: SettingsAction): void => {
    dispatch(action);
    onToggled();
  };
  return {
    onSelectDigits: (digits) => {
      dispatch({ type: 'set-digits', digits });
    },
    onSelectTheme: (theme) => {
      dispatch({ type: 'set-theme', theme });
    },
    // Reduce motion is stored as 'system' | 'on' | 'off': the switch writes the opposite of what it shows.
    onToggleReduceMotion: () => {
      flip({ type: 'set-reduce-motion', reduceMotion: isReduceMotionOn ? 'off' : 'on' });
    },
    onToggleSound: () => {
      flip({ type: 'set-sound', isOn: !isSoundOn, volume: soundVolume });
    },
    onChangeSoundVolume: (volumeRate) => {
      const volume = Math.round(volumeRate * 100);
      if (volume !== soundVolume) dispatch({ type: 'set-sound', isOn: isSoundOn, volume });
    },
    onToggleHaptics: () => {
      flip({ type: 'set-haptics', isOn: !isHapticsOn });
    },
    onConfirmResetSettings: () => {
      dispatch({ type: 'reset-settings' });
    },
  };
}
