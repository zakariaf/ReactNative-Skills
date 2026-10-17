// src/i18n/direction.test.ts
import { NativeModules } from 'react-native';

import { createFakeDirectionGuard } from '@/services/direction-guard/fake-direction-guard';

import { forceLayoutDirection, readLayoutDirection, restartForDirection } from './direction';

/** The native I18nManager the React Native Jest preset mocks; the lint keeps I18nManager in direction.ts. */
type NativeI18nManager = { readonly allowRTL: jest.Mock; readonly forceRTL: jest.Mock };
const nativeI18n = NativeModules['I18nManager'] as NativeI18nManager;

/** expo's reloadAppAsync calls the global expo object; spy there instead of mocking the package. */
function spyOnReload(): jest.SpyInstance {
  return jest.spyOn(globalThis.expo, 'reloadAppAsync').mockResolvedValue(undefined);
}

describe('readLayoutDirection', () => {
  it('reads the layout direction of this JS run (Jest reports left to right)', () => {
    expect(readLayoutDirection()).toBe('ltr');
  });
});

describe('forceLayoutDirection', () => {
  it('sets allowRTL and forceRTL together, in both directions', () => {
    nativeI18n.allowRTL.mockClear();
    nativeI18n.forceRTL.mockClear();

    forceLayoutDirection('rtl');
    forceLayoutDirection('ltr');

    expect(nativeI18n.allowRTL.mock.calls).toStrictEqual([[true], [false]]);
    expect(nativeI18n.forceRTL.mock.calls).toStrictEqual([[true], [false]]);
  });
});

describe('restartForDirection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records the pending direction, then reloads once with a reason', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard();

    const result = await restartForDirection('rtl', guard);

    expect(result.ok).toBe(true);
    expect(guard.writes).toStrictEqual(['rtl']);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith('layout direction -> rtl');
  });

  it('awaits beforeReload after the flip and before the reload', async () => {
    const steps: string[] = [];
    jest.spyOn(globalThis.expo, 'reloadAppAsync').mockImplementation(() => {
      steps.push('reload');
      return Promise.resolve();
    });
    nativeI18n.forceRTL.mockImplementationOnce(() => {
      steps.push('flip');
    });

    await restartForDirection('rtl', createFakeDirectionGuard(), async () => {
      await Promise.resolve();
      steps.push('before-reload');
    });

    expect(steps).toStrictEqual(['flip', 'before-reload', 'reload']);
  });

  it('reloads even when beforeReload rejects, then passes the rejection on', async () => {
    const reload = spyOnReload();
    const failure = new Error('dispose failed');

    await expect(
      restartForDirection('rtl', createFakeDirectionGuard(), () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('skips the flip, the hook and the reload when the record cannot be written', async () => {
    const reload = spyOnReload();
    const beforeReload = jest.fn(() => Promise.resolve());
    nativeI18n.forceRTL.mockClear();

    const result = await restartForDirection(
      'rtl',
      createFakeDirectionGuard({ isWriteFailing: true }),
      beforeReload,
    );

    expect(result).toStrictEqual({ ok: false, error: { kind: 'direction-guard-not-saved' } });
    expect(nativeI18n.forceRTL).not.toHaveBeenCalled();
    expect(beforeReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
