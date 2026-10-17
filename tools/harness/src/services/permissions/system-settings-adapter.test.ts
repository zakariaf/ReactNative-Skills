// src/services/permissions/system-settings-adapter.test.ts — React Native's Jest setup mocks
// Linking with jest.fn() members; each test scripts openSettings through a spy and restores it.
import { Linking } from 'react-native';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createSystemSettingsAdapter } from './system-settings-adapter';

describe('createSystemSettingsAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens the app's page in the system Settings app", async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const errorLog = createFakeErrorLog();

    await createSystemSettingsAdapter({ errorLog }).openSettings();

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(errorLog.recorded).toStrictEqual([]);
  });

  it('records a failure instead of rejecting', async () => {
    const failure = new Error('Unable to open settings');
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(failure);
    const errorLog = createFakeErrorLog();

    await expect(createSystemSettingsAdapter({ errorLog }).openSettings()).resolves.toBeUndefined();

    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([failure]);
  });
});
