// src/services/updates/expo-updates-adapter.test.ts
import { createExpoUpdatesAdapter } from './expo-updates-adapter';

type MockState = {
  isEnabled: boolean;
  check: jest.Mock;
  fetch: jest.Mock;
  reload: jest.Mock;
};

const mockState: MockState = {
  isEnabled: true,
  check: jest.fn(),
  fetch: jest.fn(),
  reload: jest.fn(),
};

// expo-updates has no Jest mock: its native module exists only in a release build. Getters defer
// every read to the test's state, so each test can switch the updater on or off.
jest.mock('expo-updates', () => ({
  __esModule: true,
  get isEnabled(): boolean {
    return mockState.isEnabled;
  },
  updateId: '0e1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  channel: 'production',
  runtimeVersion: 'c771bc775a1159b784a37f8698e0a8b7fd6e5ecc',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: true,
  emergencyLaunchReason: 'update 0e1a failed to launch',
  checkForUpdateAsync: (): unknown => mockState.check(),
  fetchUpdateAsync: (): unknown => mockState.fetch(),
  reloadAsync: (): unknown => mockState.reload(),
}));

describe('createExpoUpdatesAdapter', () => {
  beforeEach(() => {
    mockState.isEnabled = true;
    mockState.check.mockReset();
    mockState.fetch.mockReset();
    mockState.reload.mockReset();
  });

  it('reads the running update once, emergency launch included', () => {
    expect(createExpoUpdatesAdapter().running()).toStrictEqual({
      updateId: '0e1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      channel: 'production',
      runtimeVersion: 'c771bc775a1159b784a37f8698e0a8b7fd6e5ecc',
      isEmbeddedLaunch: false,
      isEmergencyLaunch: true,
      emergencyLaunchReason: 'update 0e1a failed to launch',
    });
  });

  it('returns disabled without calling expo-updates when the updater is off', async () => {
    mockState.isEnabled = false;
    const updates = createExpoUpdatesAdapter();
    const disabled = { ok: false, error: { kind: 'disabled' } };
    await expect(updates.check()).resolves.toStrictEqual(disabled);
    await expect(updates.download()).resolves.toStrictEqual(disabled);
    await expect(updates.apply()).resolves.toStrictEqual(disabled);
    expect(mockState.check).not.toHaveBeenCalled();
    expect(mockState.fetch).not.toHaveBeenCalled();
    expect(mockState.reload).not.toHaveBeenCalled();
  });

  it('maps the server answer to none, a new update or a roll-back directive', async () => {
    const updates = createExpoUpdatesAdapter();
    mockState.check.mockResolvedValueOnce({ isAvailable: false, isRollBackToEmbedded: false });
    await expect(updates.check()).resolves.toStrictEqual({ ok: true, value: 'none' });
    mockState.check.mockResolvedValueOnce({ isAvailable: true, isRollBackToEmbedded: false });
    await expect(updates.check()).resolves.toStrictEqual({ ok: true, value: 'new-update' });
    mockState.check.mockResolvedValueOnce({ isAvailable: false, isRollBackToEmbedded: true });
    await expect(updates.check()).resolves.toStrictEqual({
      ok: true,
      value: 'roll-back-to-embedded',
    });
  });

  it('returns disabled when a development build rejects with its dev-client code', async () => {
    // A dev client reports isEnabled true, then rejects every check and fetch with this code.
    const devClient = Object.assign(new Error('not supported in development builds'), {
      code: 'ERR_NOT_AVAILABLE_IN_DEV_CLIENT',
    });
    const updates = createExpoUpdatesAdapter();
    mockState.check.mockRejectedValueOnce(devClient);
    await expect(updates.check()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'disabled' },
    });
    mockState.fetch.mockRejectedValueOnce(devClient);
    await expect(updates.download()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'disabled' },
    });
    expect(mockState.check).toHaveBeenCalledTimes(1);
  });

  it('returns disabled for the JS layer development-mode code too', async () => {
    const devMode = Object.assign(new Error('You cannot check for updates in development mode.'), {
      code: 'ERR_UPDATES_DISABLED',
    });
    mockState.check.mockRejectedValueOnce(devMode);
    await expect(createExpoUpdatesAdapter().check()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'disabled' },
    });
  });

  it('turns a rejected check into a check-failed value', async () => {
    mockState.check.mockRejectedValueOnce(new Error('timeout'));
    await expect(createExpoUpdatesAdapter().check()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'check-failed', message: 'timeout' },
    });
  });

  it('reports a downloaded update or roll-back as ready and an old one as nothing new', async () => {
    const updates = createExpoUpdatesAdapter();
    mockState.fetch.mockResolvedValueOnce({ isNew: true, isRollBackToEmbedded: false });
    await expect(updates.download()).resolves.toStrictEqual({ ok: true, value: 'ready' });
    mockState.fetch.mockResolvedValueOnce({ isNew: false, isRollBackToEmbedded: true });
    await expect(updates.download()).resolves.toStrictEqual({ ok: true, value: 'ready' });
    mockState.fetch.mockResolvedValueOnce({ isNew: false, isRollBackToEmbedded: false });
    await expect(updates.download()).resolves.toStrictEqual({ ok: true, value: 'nothing-new' });
  });

  it('turns a rejected download into a download-failed value', async () => {
    mockState.fetch.mockRejectedValueOnce('offline');
    await expect(createExpoUpdatesAdapter().download()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'download-failed', message: 'offline' },
    });
  });

  it('reloads on apply and turns a rejected reload into apply-failed', async () => {
    const updates = createExpoUpdatesAdapter();
    mockState.reload.mockResolvedValueOnce(undefined);
    await expect(updates.apply()).resolves.toStrictEqual({ ok: true, value: undefined });
    mockState.reload.mockRejectedValueOnce(new Error('no runtime'));
    await expect(updates.apply()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'apply-failed', message: 'no runtime' },
    });
  });
});
