// src/services/permissions/expo-permission-access.test.ts
import { PermissionStatus } from 'expo';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createExpoPermissionAccess, toPermissionState } from './expo-permission-access';

import type { ExpoPermissionResponse } from './expo-permission-access';

function response(overrides: Partial<ExpoPermissionResponse>): ExpoPermissionResponse {
  return {
    status: PermissionStatus.UNDETERMINED,
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...overrides,
  };
}

const GRANTED = response({ status: PermissionStatus.GRANTED, granted: true });
const REFUSED_ONCE = response({ status: PermissionStatus.DENIED, canAskAgain: true });
const REFUSED_FOR_GOOD = response({ status: PermissionStatus.DENIED, canAskAgain: false });

describe('toPermissionState', () => {
  it('maps a never-asked permission to undetermined', () => {
    expect(toPermissionState(response({}))).toBe('undetermined');
  });

  it('maps a grant to granted', () => {
    expect(toPermissionState(GRANTED)).toBe('granted');
  });

  it('tells a refusal the OS asks about again (Android) from one only Settings undoes', () => {
    expect(toPermissionState(REFUSED_ONCE)).toBe('denied');
    expect(toPermissionState(REFUSED_FOR_GOOD)).toBe('blocked');
  });

  it.each([
    ['iOS Select Photos / Android partial access', { accessPrivileges: 'limited' as const }],
    ['iOS approximate location', { ios: { accuracy: 'reduced' as const } }],
    ['Android approximate location', { android: { accuracy: 'coarse' as const } }],
  ])('maps a partial grant to limited (%s)', (_label, extra) => {
    expect(toPermissionState({ ...GRANTED, ...extra })).toBe('limited');
  });

  it.each([
    ['full library', { accessPrivileges: 'all' as const }],
    ['precise iOS location', { ios: { accuracy: 'full' as const } }],
    ['precise Android location', { android: { accuracy: 'fine' as const } }],
  ])('keeps a full grant granted (%s)', (_label, extra) => {
    expect(toPermissionState({ ...GRANTED, ...extra })).toBe('granted');
  });
});

describe('createExpoPermissionAccess', () => {
  it('reads with read() and asks with request(), mapping each answer', async () => {
    const read = jest.fn(() => Promise.resolve(response({})));
    const request = jest.fn(() => Promise.resolve(REFUSED_FOR_GOOD));
    const access = createExpoPermissionAccess({ read, request, errorLog: createFakeErrorLog() });

    await expect(access.permission()).resolves.toBe('undetermined');
    expect(request).not.toHaveBeenCalled();
    await expect(access.requestPermission()).resolves.toBe('blocked');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('records a thrown call and answers unavailable instead of rejecting', async () => {
    const errorLog = createFakeErrorLog();
    const failure = new Error('Another permissions request is in progress');
    const access = createExpoPermissionAccess({
      read: () => Promise.reject(failure),
      request: () => Promise.reject(failure),
      errorLog,
    });

    await expect(access.permission()).resolves.toBe('unavailable');
    await expect(access.requestPermission()).resolves.toBe('unavailable');
    expect(errorLog.recorded.map((entry) => [entry.source, entry.error])).toStrictEqual([
      ['service', failure],
      ['service', failure],
    ]);
  });
});
