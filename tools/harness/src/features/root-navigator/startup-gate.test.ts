// src/features/root-navigator/startup-gate.test.ts
// The gate opens with no task at once, after every task otherwise, and never later than its deadline;
// failures are noted, the unexpected is recorded, and a second start runs nothing twice.
import { err, ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createStartupGate } from './startup-gate';

import type { StartupGate, StartupTask } from './startup-gate';

/** Resolves when the gate becomes ready (at once when it already is). */
function whenReady(gate: StartupGate): Promise<void> {
  return new Promise((resolve) => {
    if (gate.isReady()) {
      resolve();
      return;
    }
    const unsubscribe = gate.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

/** A task whose promise the test settles by hand. */
function manualTask(name: string): { readonly task: StartupTask; readonly finish: () => void } {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { task: { name, run: () => done.then(() => ok(undefined)) }, finish };
}

describe('createStartupGate', () => {
  it('is ready at creation when nothing blocks the first screen', () => {
    const gate = createStartupGate({
      blocking: [],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    expect(gate.isReady()).toBe(true);
    expect(gate.misses()).toStrictEqual([]);
  });

  it('opens only after every blocking task finished', async () => {
    const first = manualTask('session');
    const second = manualTask('remote-config');
    const gate = createStartupGate({
      blocking: [first.task, second.task],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    gate.start();
    first.finish();
    await Promise.resolve();
    expect(gate.isReady()).toBe(false);
    second.finish();
    await whenReady(gate);
    expect(gate.misses()).toStrictEqual([]);
  });

  it('notes an expected failure without recording it, and still opens', async () => {
    const errorLog = createFakeErrorLog();
    const failing: StartupTask = {
      name: 'session',
      run: () => Promise.resolve(err({ kind: 'session-unreadable' })),
    };
    const gate = createStartupGate({ blocking: [failing], deadlineMs: 2000, errorLog });
    gate.start();
    await whenReady(gate);
    expect(gate.misses()).toStrictEqual([{ task: 'session', kind: 'session-unreadable' }]);
    expect(errorLog.entries()).toStrictEqual([]);
  });

  it('opens at the deadline when a task hangs, records it and aborts its signal', async () => {
    const errorLog = createFakeErrorLog();
    const signals: AbortSignal[] = [];
    const hanging: StartupTask = {
      name: 'slow-read',
      run: (signal) => {
        signals.push(signal);
        return new Promise(() => undefined);
      },
    };
    const gate = createStartupGate({ blocking: [hanging], deadlineMs: 1, errorLog });
    gate.start();
    await whenReady(gate);
    expect(gate.misses()).toStrictEqual([{ task: 'slow-read', kind: 'timed-out' }]);
    expect(signals[0]?.aborted).toBe(true);
    expect(errorLog.entries()[0]?.message).toContain('slow-read ran out of 1 ms');
  });

  it('records a task that throws as a bug and opens anyway', async () => {
    const errorLog = createFakeErrorLog();
    const throwing: StartupTask = { name: 'broken', run: () => Promise.reject(new Error('boom')) };
    const gate = createStartupGate({ blocking: [throwing], deadlineMs: 2000, errorLog });
    gate.start();
    await whenReady(gate);
    expect(gate.misses()).toStrictEqual([{ task: 'broken', kind: 'threw' }]);
    expect(errorLog.entries()).toHaveLength(1);
  });

  it('runs each task once however often start is called', async () => {
    const run = jest.fn(() => Promise.resolve(ok(undefined)));
    const gate = createStartupGate({
      blocking: [{ name: 'once', run }],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    gate.start();
    gate.start();
    await whenReady(gate);
    gate.start();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener that unsubscribed', async () => {
    const pending = manualTask('session');
    const gate = createStartupGate({
      blocking: [pending.task],
      deadlineMs: 2000,
      errorLog: createFakeErrorLog(),
    });
    const listener = jest.fn();
    gate.subscribe(listener)();
    gate.start();
    pending.finish();
    await whenReady(gate);
    expect(listener).not.toHaveBeenCalled();
  });

  it('records a listener that throws and still tells the others', async () => {
    const errorLog = createFakeErrorLog();
    const pending = manualTask('session');
    const gate = createStartupGate({ blocking: [pending.task], deadlineMs: 2000, errorLog });
    const after = jest.fn();
    gate.subscribe(() => {
      throw new Error('broken subscriber');
    });
    gate.subscribe(after);
    gate.start();
    pending.finish();
    await whenReady(gate);
    expect(after).toHaveBeenCalledTimes(1);
    expect(errorLog.entries()[0]?.message).toBe('a startup gate listener threw');
  });
});
