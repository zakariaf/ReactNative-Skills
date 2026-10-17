// src/stores/settings-reducer.ts: <Domain>State, <Domain>Action with imperative kebab-case types.
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type SettingsState = {
  readonly theme: ThemePreference;
  readonly isSoundOn: boolean;
};

export type SettingsAction =
  | { readonly type: 'set-theme'; readonly theme: ThemePreference }
  | { readonly type: 'toggle-sound' };

export const DEFAULT_SETTINGS: SettingsState = { theme: 'system', isSoundOn: true };

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'set-theme':
      return { ...state, theme: action.theme };
    case 'toggle-sound':
      return { ...state, isSoundOn: !state.isSoundOn };
  }
}
