// src/stores/settings/settings-store.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';

import { encodeSettings } from './settings-codec';
import { DEFAULT_SETTINGS } from './settings-schema';
import { createSettingsStore } from './settings-store';

import type { FakeSettingsStorageOptions } from '@/services/settings-storage/fake-settings-storage';

function setup(options: FakeSettingsStorageOptions = {}) {
  const storage = createFakeSettingsStorage(options);
  const errorLog = createFakeErrorLog();
  return { storage, errorLog, store: createSettingsStore({ storage, errorLog }) };
}

describe('settings store', () => {
  it('starts from the saved settings, read before anything renders', () => {
    const { store } = setup({ text: encodeSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }) });

    expect(store.getState().settings.theme).toBe('dark');
    expect(store.getState().isPersistent).toBe(true);
  });

  it('saves a change before any subscriber sees it', () => {
    const { storage, store } = setup();
    const savedWhenPublished: (string | null)[] = [];
    store.subscribe(() => {
      savedWhenPublished.push(storage.saved());
    });

    store.getState().dispatch({ type: 'set-theme', theme: 'dark' });

    expect(savedWhenPublished).toStrictEqual([
      encodeSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }),
    ]);
    expect(store.getState().settings.theme).toBe('dark');
  });

  it('writes nothing for a change that changes nothing', () => {
    const { storage, store } = setup();

    store.getState().dispatch({ type: 'set-theme', theme: 'system' });

    expect(storage.writes).toStrictEqual([]);
  });

  it('publishes nothing when the write fails, and says so', () => {
    const { store } = setup({ isWriteFailing: true });

    store.getState().dispatch({ type: 'set-haptics', isOn: false });

    expect(store.getState().settings.hapticsEnabled).toBe(true);
    expect(store.getState().lastWriteFailure).toStrictEqual({ kind: 'settings-not-saved' });
  });

  it('keeps changes in memory and never writes when the saved settings cannot be read', () => {
    const { storage, store } = setup({ isReadFailing: true });

    store.getState().dispatch({ type: 'set-theme', theme: 'light' });

    expect(store.getState().isPersistent).toBe(false);
    expect(store.getState().settings.theme).toBe('light');
    expect(storage.writes).toStrictEqual([]);
  });

  it('records the fields that fell back to their defaults', () => {
    const { errorLog, store } = setup({ text: '{"theme":"sepia","soundVolume":30}' });

    expect(store.getState().settings).toStrictEqual({ ...DEFAULT_SETTINGS, soundVolume: 30 });
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'saved settings fell back to defaults: theme',
    ]);
  });

  it('clamps a volume before saving it', () => {
    const { storage, store } = setup();

    store.getState().dispatch({ type: 'set-sound', isOn: true, volume: 180 });

    expect(store.getState().settings.soundVolume).toBe(100);
    expect(storage.saved()).toContain('"soundVolume":100');
  });
});
