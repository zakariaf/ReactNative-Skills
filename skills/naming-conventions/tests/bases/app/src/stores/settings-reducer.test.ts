// src/stores/settings-reducer.test.ts
import { DEFAULT_SETTINGS, settingsReducer } from './settings-reducer';

describe('settingsReducer', () => {
  describe('when the theme is set', () => {
    it('stores the new theme', () => {
      expect(settingsReducer(DEFAULT_SETTINGS, { type: 'set-theme', theme: 'dark' }).theme).toBe('dark');
    });
  });
});
