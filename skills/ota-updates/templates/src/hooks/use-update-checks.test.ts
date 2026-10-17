// src/hooks/use-update-checks.test.ts
import { act, renderHook } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeUpdates } from '@/services/updates/fake-updates';
import { createUpdateChecker } from '@/services/updates/update-checker';
import { flushMicrotasks } from '@test/flush-microtasks';

import { useUpdateChecks, useUpdateStatus } from './use-update-checks';

const mockForeground = { isActive: true };

jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: (): boolean => mockForeground.isActive,
}));

function createChecker(nowMs: { value: number }) {
  const updates = createFakeUpdates(
    { isEmergencyLaunch: true, emergencyLaunchReason: 'update failed to launch' },
    { check: ok('new-update'), download: ok('ready') },
  );
  const errorLog = createFakeErrorLog();
  const clock = { nowMs: () => nowMs.value };
  return { updates, errorLog, checker: createUpdateChecker({ updates, clock, errorLog }) };
}

describe('useUpdateChecks', () => {
  beforeEach(() => {
    mockForeground.isActive = true;
  });

  it('reports the launch once and checks while the app is in the foreground', async () => {
    const { updates, errorLog, checker } = createChecker({ value: 0 });
    await renderHook(() => {
      useUpdateChecks(checker);
    });
    await act(flushMicrotasks);
    expect(errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['startup']);
    expect(updates.calls).toStrictEqual(['check', 'download']);
  });

  it('waits for the foreground before it checks', async () => {
    mockForeground.isActive = false;
    const { updates, checker } = createChecker({ value: 0 });
    const { rerender } = await renderHook(() => {
      useUpdateChecks(checker);
    });
    expect(updates.calls).toStrictEqual([]);
    mockForeground.isActive = true;
    await rerender(undefined);
    await act(flushMicrotasks);
    expect(updates.calls).toStrictEqual(['check', 'download']);
  });
});

describe('useUpdateStatus', () => {
  it('follows the checker until an update is ready', async () => {
    const { checker } = createChecker({ value: 0 });
    const { result } = await renderHook(() => useUpdateStatus(checker));
    expect(result.current).toBe('idle');
    await act(async () => {
      checker.checkWhenDue();
      await flushMicrotasks();
    });
    expect(result.current).toBe('ready');
  });
});
