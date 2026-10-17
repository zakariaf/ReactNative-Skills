// src/ui/feedback/delayed-flag.test.ts
import { createDelayedFlag, scheduleTimeout } from './delayed-flag';

import type { Schedule } from './delayed-flag';

const TIMING = { showDelayMs: 300, minVisibleMs: 500 };

type ManualSchedule = {
  readonly schedule: Schedule;
  readonly advance: (ms: number) => void;
  readonly pending: () => number;
};

/** A scheduler the test advances by hand, running due tasks in time order: no fake timers. */
function createManualSchedule(): ManualSchedule {
  let now = 0;
  let tasks: { at: number; task: () => void }[] = [];
  const nextDue = (until: number): { at: number; task: () => void } | undefined =>
    tasks.filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at)[0];
  return {
    schedule: (task, delayMs) => {
      const entry = { at: now + delayMs, task };
      tasks.push(entry);
      return () => {
        tasks = tasks.filter((candidate) => candidate !== entry);
      };
    },
    advance: (ms) => {
      const until = now + ms;
      for (let due = nextDue(until); due !== undefined; due = nextDue(until)) {
        const { at, task } = due;
        tasks = tasks.filter((entry) => entry !== due);
        now = at;
        task();
      }
      now = until;
    },
    pending: () => tasks.length,
  };
}

describe('createDelayedFlag', () => {
  it('shows nothing for work that ends before the show delay', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    flag.set(true);
    clock.advance(299);
    flag.set(false);
    clock.advance(1000);
    expect(flag.isVisible()).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it('turns visible at the show delay and tells its listeners once', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    const listener = jest.fn();
    flag.subscribe(listener);
    flag.set(true);
    clock.advance(300);
    expect(flag.isVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('holds a shown placeholder for the minimum time, then hides it', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    flag.set(true);
    clock.advance(300);
    flag.set(false);
    clock.advance(499);
    expect(flag.isVisible()).toBe(true);
    clock.advance(1);
    expect(flag.isVisible()).toBe(false);
  });

  it('hides at once when the work ends after the hold', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    flag.set(true);
    clock.advance(2000);
    flag.set(false);
    expect(flag.isVisible()).toBe(false);
  });

  it('stays visible when the work restarts during the hold', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    flag.set(true);
    clock.advance(300);
    flag.set(false);
    flag.set(true);
    clock.advance(600);
    expect(flag.isVisible()).toBe(true);
  });

  it('starts over after cancel, as a remount does, and stops calling unsubscribed listeners', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    const listener = jest.fn();
    const unsubscribe = flag.subscribe(listener);
    flag.set(true);
    flag.cancel();
    expect(clock.pending()).toBe(0);
    unsubscribe();
    flag.set(true);
    clock.advance(300);
    expect(flag.isVisible()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('hides a placeholder that lost its hold at the next stop', () => {
    const clock = createManualSchedule();
    const flag = createDelayedFlag(TIMING, clock.schedule);
    flag.set(true);
    clock.advance(300);
    flag.cancel();
    flag.set(true);
    flag.set(false);
    expect(flag.isVisible()).toBe(false);
  });

  it('runs and cancels real timers through scheduleTimeout', () => {
    jest.useFakeTimers();
    const task = jest.fn();
    scheduleTimeout(task, 100)();
    jest.advanceTimersByTime(200);
    expect(task).not.toHaveBeenCalled();
    scheduleTimeout(task, 100);
    jest.advanceTimersByTime(100);
    expect(task).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
