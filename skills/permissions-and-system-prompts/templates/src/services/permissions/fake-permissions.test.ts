// src/services/permissions/fake-permissions.test.ts
import { createFakePermissionAccess, createFakePermissions } from './fake-permissions';

describe('createFakePermissionAccess', () => {
  it('starts undetermined and reads without a dialog', async () => {
    const access = createFakePermissionAccess({ platform: 'ios' });

    await expect(access.permission()).resolves.toBe('undetermined');
    expect(access.dialogs()).toBe(0);
  });

  it('shows iOS one dialog and keeps a refusal final', async () => {
    const access = createFakePermissionAccess({ platform: 'ios', answers: ['deny', 'allow'] });

    await expect(access.requestPermission()).resolves.toBe('blocked');
    await expect(access.requestPermission()).resolves.toBe('blocked');
    expect(access.dialogs()).toBe(1);
  });

  it('leaves Android denied after the first refusal and blocked after the second', async () => {
    const access = createFakePermissionAccess({ platform: 'android' });

    await expect(access.requestPermission()).resolves.toBe('denied');
    await expect(access.requestPermission()).resolves.toBe('blocked');
    await expect(access.requestPermission()).resolves.toBe('blocked');
    expect(access.dialogs()).toBe(2);
  });

  it("reports Expo's early 'blocked' when the first Android dialog is dismissed", async () => {
    const access = createFakePermissionAccess({ platform: 'android', answers: ['dismiss'] });

    await expect(access.requestPermission()).resolves.toBe('blocked');
  });

  it("stays 'denied' when the Android dialog after a refusal is dismissed", async () => {
    const access = createFakePermissionAccess({
      platform: 'android',
      state: 'denied',
      answers: ['dismiss'],
    });

    await expect(access.requestPermission()).resolves.toBe('denied');
  });

  it.each([
    ['allow', 'granted'],
    ['allow-limited', 'limited'],
  ] as const)('answers %s with %s', async (answer, expected) => {
    const access = createFakePermissionAccess({ platform: 'ios', answers: [answer] });

    await expect(access.requestPermission()).resolves.toBe(expected);
  });

  it.each(['granted', 'blocked', 'unavailable'] as const)(
    'shows no dialog while %s',
    async (state) => {
      const access = createFakePermissionAccess({ platform: 'android', state });

      await expect(access.requestPermission()).resolves.toBe(state);
      expect(access.dialogs()).toBe(0);
    },
  );

  it('follows a change made in Settings', async () => {
    const access = createFakePermissionAccess({ platform: 'ios', state: 'blocked' });

    access.setState('granted');

    await expect(access.permission()).resolves.toBe('granted');
  });
});

describe('createFakePermissions', () => {
  it('hands out the scripted permissions and counts trips to Settings', async () => {
    const camera = createFakePermissionAccess({ platform: 'ios' });
    const permissions = createFakePermissions({ camera });

    await permissions.openSettings();
    await permissions.openSettings();

    expect(permissions.access.camera).toBe(camera);
    expect(permissions.settingsOpened()).toBe(2);
  });
});
