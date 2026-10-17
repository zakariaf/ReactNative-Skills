// src/ui/feedback/notice-timer.test.ts
import { AccessibilityInfo } from 'react-native';

import { flushMicrotasks } from '@test/flush-microtasks';

import { scheduleNoticeClose } from './notice-timer';

describe('scheduleNoticeClose', () => {
  beforeEach(() => {
    // setImmediate stays real: flushMicrotasks() waits on it while the notice timers are faked.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the recommended timeout when the person asked for more time', async () => {
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(20000);
    const close = jest.fn();
    scheduleNoticeClose(4000, close);
    await flushMicrotasks();
    jest.advanceTimersByTime(19999);
    expect(close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the floor, also when the lookup fails', async () => {
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockRejectedValue(new Error('no'));
    const close = jest.fn();
    scheduleNoticeClose(4000, close);
    await flushMicrotasks();
    jest.advanceTimersByTime(3999);
    expect(close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing once cancelled, before or after the answer arrived', async () => {
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(4000);
    const close = jest.fn();
    scheduleNoticeClose(4000, close)();
    const cancelLater = scheduleNoticeClose(4000, close);
    await flushMicrotasks();
    cancelLater();
    jest.advanceTimersByTime(10000);
    expect(close).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
