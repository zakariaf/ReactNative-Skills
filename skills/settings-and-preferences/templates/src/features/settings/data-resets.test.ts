// src/features/settings/data-resets.test.ts
// The data layer, its stores and updateAndPublish are stand-ins with the same contract as the real
// ones (persistence-and-migrations, state-management-zustand): the reset is one write, and only a
// write that landed makes every store re-read. The settings store and its storage are the real ones.
import { createStore } from 'zustand/vanilla';

import { attempt, err } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeSettingsStorage } from '@/services/settings-storage/fake-settings-storage';
import { encodeSettings } from '@/stores/settings/settings-codec';
import { DEFAULT_SETTINGS } from '@/stores/settings/settings-schema';
import { createSettingsStore } from '@/stores/settings/settings-store';

import { createDataResets } from './data-resets';

import type { DataResetFailure } from './data-resets';
import type { Result } from '@/core/result';

function setup(isResetFailing = false) {
  const disk = { tasks: ['Buy milk', 'Call Sam'] };
  const tasksStore = createStore(() => ({ tasks: [...disk.tasks] }));
  const reloadTasks = (): void => {
    tasksStore.setState({ tasks: [...disk.tasks] });
  };
  // The data layer's shape: void on success, a throw when the transaction did not commit.
  const resetAllData = (): void => {
    if (isResetFailing) throw new Error('SQLITE_BUSY');
    disk.tasks = [];
  };
  const errorLog = createFakeErrorLog();
  const updateAndPublish = (
    write: () => Result<void, DataResetFailure>,
  ): Result<void, DataResetFailure> => {
    const written = write();
    if (written.ok) reloadTasks();
    return written;
  };
  const savedText = encodeSettings({ ...DEFAULT_SETTINGS, theme: 'dark', soundEnabled: true });
  const storage = createFakeSettingsStorage({ text: savedText });
  const settingsStore = createSettingsStore({ storage, errorLog: createFakeErrorLog() });
  const refetchServerState = jest.fn();
  const resets = createDataResets({
    deleteAllData: () =>
      updateAndPublish(() =>
        attempt(resetAllData, (thrown): DataResetFailure => {
          errorLog.record('storage', thrown);
          return { kind: 'data-not-deleted' };
        }),
      ),
    refetchServerState,
  });
  return { resets, tasksStore, settingsStore, storage, savedText, refetchServerState, errorLog };
}

describe('createDataResets', () => {
  it('deletes the data, then every other store shows it gone and the server cache refetches', () => {
    const { resets, tasksStore, refetchServerState } = setup();

    expect(resets.onConfirmDeleteAllData().ok).toBe(true);
    expect(tasksStore.getState().tasks).toStrictEqual([]);
    expect(refetchServerState).toHaveBeenCalledTimes(1);
  });

  it('keeps every setting and the saved settings text as they were', () => {
    const { resets, settingsStore, storage, savedText } = setup();
    const before = settingsStore.getState().settings;

    resets.onConfirmDeleteAllData();

    expect(settingsStore.getState().settings).toBe(before);
    expect(settingsStore.getState().settings).toMatchObject({ theme: 'dark', soundEnabled: true });
    expect(storage.writes).toStrictEqual([]);
    expect(storage.saved()).toBe(savedText);
  });

  it('returns the failure, re-reads nothing and refetches nothing when the reset did not land', () => {
    const { resets, tasksStore, refetchServerState, errorLog } = setup(true);

    expect(resets.onConfirmDeleteAllData()).toStrictEqual(err({ kind: 'data-not-deleted' }));
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['storage']);
    expect(tasksStore.getState().tasks).toStrictEqual(['Buy milk', 'Call Sam']);
    expect(refetchServerState).not.toHaveBeenCalled();
  });
});
