// src/services/updates/update-checker.test.ts
import { err, ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakeUpdates } from './fake-updates';
import {
  BEFORE_APPLY_TIMEOUT_MS,
  DEFAULT_MIN_CHECK_INTERVAL_MS,
  createUpdateChecker,
} from './update-checker';

import type { FakeUpdatesAnswers } from './fake-updates';
import type { UpdateCheckerDeps } from './update-checker';
import type { RunningUpdate } from './updates-port';

type Setup = {
  readonly running?: Partial<RunningUpdate>;
  readonly answers?: Partial<FakeUpdatesAnswers>;
  readonly beforeApply?: UpdateCheckerDeps['beforeApply'];
};

function setup({ running = {}, answers = {}, beforeApply }: Setup = {}) {
  let nowMs = 1_000;
  const updates = createFakeUpdates(running, answers);
  const errorLog = createFakeErrorLog();
  const clock = { nowMs: () => nowMs };
  const checker = createUpdateChecker({
    updates,
    clock,
    errorLog,
    ...(beforeApply === undefined ? {} : { beforeApply }),
  });
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  return { updates, errorLog, checker, advance };
}

const NEW_UPDATE = { check: ok('new-update' as const), download: ok('ready' as const) };

describe('createUpdateChecker', () => {
  it('checks, finds nothing and stays idle', async () => {
    const { updates, checker } = setup();
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(updates.calls).toStrictEqual(['check']);
    expect(checker.status()).toBe('idle');
  });

  it('downloads a new update and waits for the next launch without reloading', async () => {
    const { updates, checker } = setup({ answers: NEW_UPDATE });
    const seen: string[] = [];
    checker.subscribe(() => seen.push(checker.status()));
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(seen).toStrictEqual(['checking', 'downloading', 'ready']);
    expect(updates.calls).toStrictEqual(['check', 'download']);
  });

  it('treats a roll-back directive like an update to download', async () => {
    const { checker } = setup({
      answers: { check: ok('roll-back-to-embedded'), download: ok('ready') },
    });
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(checker.status()).toBe('ready');
  });

  it('checks at most once per interval and never while one is running', async () => {
    const { updates, checker, advance } = setup();
    checker.checkWhenDue();
    checker.checkWhenDue();
    await flushMicrotasks();
    advance(DEFAULT_MIN_CHECK_INTERVAL_MS - 1);
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(updates.calls).toStrictEqual(['check']);
    advance(1);
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(updates.calls).toStrictEqual(['check', 'check']);
  });

  it('stops checking once an update is ready', async () => {
    const { updates, checker, advance } = setup({ answers: NEW_UPDATE });
    checker.checkWhenDue();
    await flushMicrotasks();
    advance(DEFAULT_MIN_CHECK_INTERVAL_MS);
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(updates.calls).toStrictEqual(['check', 'download']);
  });

  it('records a failed check or download, and stays quiet for a disabled updater', async () => {
    const failing = setup({
      answers: { check: err({ kind: 'check-failed', message: 'offline' }) },
    });
    failing.checker.checkWhenDue();
    await flushMicrotasks();
    expect(failing.errorLog.recorded.map((entry) => entry.source)).toStrictEqual(['service']);
    expect(failing.checker.status()).toBe('idle');

    const downloadFails = setup({
      answers: { ...NEW_UPDATE, download: err({ kind: 'download-failed', message: 'offline' }) },
    });
    downloadFails.checker.checkWhenDue();
    await flushMicrotasks();
    expect(downloadFails.errorLog.recorded).toHaveLength(1);
    expect(downloadFails.checker.status()).toBe('idle');

    const disabled = setup({ answers: { check: err({ kind: 'disabled' }) } });
    disabled.checker.checkWhenDue();
    await flushMicrotasks();
    expect(disabled.errorLog.recorded).toStrictEqual([]);
  });

  it('logs a listener that throws and returns to idle', async () => {
    const { checker, errorLog } = setup();
    checker.subscribe(() => {
      throw new Error('listener broke');
    });
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(errorLog.recorded.map((entry) => entry.source)).toContain('service');
  });

  it('logs a port that rejects against its contract and returns to idle', async () => {
    const updates = createFakeUpdates();
    const errorLog = createFakeErrorLog();
    const broken = { ...updates, check: () => Promise.reject(new Error('broken port')) };
    const checker = createUpdateChecker({ updates: broken, clock: { nowMs: () => 0 }, errorLog });
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(String(errorLog.recorded[0]?.error)).toContain('broken port');
    expect(checker.status()).toBe('idle');
  });

  it('reports an emergency launch once, with its reason', () => {
    const { checker, errorLog } = setup({
      running: { isEmergencyLaunch: true, emergencyLaunchReason: 'update failed to launch' },
    });
    checker.reportLaunch();
    checker.reportLaunch();
    expect(errorLog.recorded).toHaveLength(1);
    expect(errorLog.recorded[0]?.source).toBe('startup');
    expect(String(errorLog.recorded[0]?.error)).toContain('update failed to launch');
  });

  it('reports nothing for a normal launch, and says when no reason was given', () => {
    const normal = setup();
    normal.checker.reportLaunch();
    expect(normal.errorLog.recorded).toStrictEqual([]);
    const silent = setup({ running: { isEmergencyLaunch: true, emergencyLaunchReason: null } });
    silent.checker.reportLaunch();
    expect(String(silent.errorLog.recorded[0]?.error)).toContain('no reason given');
  });

  it('applies only a ready update', async () => {
    const { updates, checker } = setup({ answers: NEW_UPDATE });
    await expect(checker.applyNow()).resolves.toStrictEqual(err({ kind: 'not-ready' }));
    checker.checkWhenDue();
    await flushMicrotasks();
    await expect(checker.applyNow()).resolves.toStrictEqual(ok(undefined));
    expect(updates.calls).toStrictEqual(['check', 'download', 'apply']);
  });

  it('awaits beforeApply (the crash reporter flush) before the restart', async () => {
    const order: string[] = [];
    const { updates, checker } = setup({
      answers: NEW_UPDATE,
      beforeApply: async () => {
        await flushMicrotasks();
        order.push(`flushed after ${updates.calls.join(',')}`);
      },
    });
    checker.checkWhenDue();
    await flushMicrotasks();
    await expect(checker.applyNow()).resolves.toStrictEqual(ok(undefined));
    expect(order).toStrictEqual(['flushed after check,download']);
    expect(updates.calls).toStrictEqual(['check', 'download', 'apply']);
  });

  it('restarts even when beforeApply rejects, and logs it', async () => {
    const { updates, errorLog, checker } = setup({
      answers: NEW_UPDATE,
      beforeApply: () => Promise.reject(new Error('flush failed')),
    });
    checker.checkWhenDue();
    await flushMicrotasks();
    await expect(checker.applyNow()).resolves.toStrictEqual(ok(undefined));
    expect(updates.calls.at(-1)).toBe('apply');
    expect(errorLog.entries().map((entry) => entry.message)).toContain('flush failed');
  });

  it('restarts after the deadline when beforeApply never settles', async () => {
    const { updates, errorLog, checker } = setup({
      answers: NEW_UPDATE,
      beforeApply: () => new Promise<never>(() => undefined),
    });
    checker.checkWhenDue();
    await flushMicrotasks();
    jest.useFakeTimers();
    try {
      const applied = checker.applyNow();
      await jest.advanceTimersByTimeAsync(BEFORE_APPLY_TIMEOUT_MS);
      await expect(applied).resolves.toStrictEqual(ok(undefined));
      expect(updates.calls.at(-1)).toBe('apply');
      expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
        'updates: beforeApply timed out; restarting anyway',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const { checker } = setup();
    const listener = jest.fn();
    const unsubscribe = checker.subscribe(listener);
    unsubscribe();
    checker.checkWhenDue();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();
  });
});
