// src/hooks/use-async-field-check.test.ts
// Fake timers drive the debounce and the deadline; a deferred fake check settles answers in the
// order a test chooses, so the race cases (out of order, unmount, a newer value) are proven.
import { act } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { renderHookWithProviders } from '@test/render-with-providers';

import { DEFAULT_FIELD_CHECK_TIMING, useAsyncFieldCheck } from './use-async-field-check';

import type { FieldCheck, FieldCheckVerdict } from './use-async-field-check';
import type { Result } from '@/core/result';

const { debounceMs, deadlineMs } = DEFAULT_FIELD_CHECK_TIMING;
type Answer = Result<FieldCheckVerdict, { readonly kind: string }>;

/** A check whose answers the test releases by value; it records every value and signal it got. */
function deferredCheck(): {
  check: FieldCheck;
  asked: string[];
  signals: AbortSignal[];
  answer: (value: string, result: Answer) => void;
} {
  const pending = new Map<string, (result: Answer) => void>();
  const asked: string[] = [];
  const signals: AbortSignal[] = [];
  const check: FieldCheck = (value, signal) => {
    asked.push(value);
    signals.push(signal);
    return new Promise((resolve) => {
      pending.set(value, resolve);
    });
  };
  const answer = (value: string, result: Answer): void => {
    pending.get(value)?.(result);
  };
  return { check, asked, signals, answer };
}

const PASSED: Answer = ok({ kind: 'passed' });
const TAKEN: Answer = ok({ kind: 'refused', messageKey: 'forms.field.invalid' });

async function renderCheck(check: FieldCheck) {
  return renderHookWithProviders(() => useAsyncFieldCheck(check), {
    services: { errorLog: createFakeErrorLog() },
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe('useAsyncFieldCheck', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for typing to pause, then asks once for the newest value', async () => {
    const fake = deferredCheck();
    const { result } = await renderCheck(fake.check);

    await act(() => {
      result.current.onValueChange('Ho', true);
      result.current.onValueChange('Home', true);
    });
    expect(result.current.state).toStrictEqual({ status: 'checking', value: 'Home' });
    await advance(debounceMs);

    expect(fake.asked).toStrictEqual(['Home']);
    await act(async () => {
      fake.answer('Home', PASSED);
      await Promise.resolve();
    });
    expect(result.current.hasPassed('Home')).toBe(true);
    expect(result.current.hasPassed('Ho')).toBe(false);
  });

  it('drops an older answer that arrives after a newer value was typed', async () => {
    const fake = deferredCheck();
    const { result } = await renderCheck(fake.check);
    await act(() => {
      result.current.onValueChange('Work', true);
    });
    await advance(debounceMs);
    await act(() => {
      result.current.onValueChange('Workshop', true);
    });
    await advance(debounceMs);

    await act(async () => {
      fake.answer('Workshop', TAKEN);
      fake.answer('Work', PASSED);
      await Promise.resolve();
    });

    expect(result.current.state).toStrictEqual({
      status: 'refused',
      value: 'Workshop',
      messageKey: 'forms.field.invalid',
    });
  });

  it('asks nothing about a value whose shape is invalid, and forgets the last answer', async () => {
    const fake = deferredCheck();
    const { result } = await renderCheck(fake.check);

    await act(() => {
      result.current.onValueChange('', false);
    });
    await advance(debounceMs);

    expect(fake.asked).toStrictEqual([]);
    expect(result.current.state).toStrictEqual({ status: 'idle' });
  });

  it('turns a check that hangs into unavailable at the deadline', async () => {
    const fake = deferredCheck();
    const { result } = await renderCheck(fake.check);
    await act(() => {
      result.current.onValueChange('Home', true);
    });

    await advance(debounceMs + deadlineMs);

    expect(result.current.state).toStrictEqual({ status: 'unavailable', value: 'Home' });
    expect(result.current.hasPassed('Home')).toBe(false);
  });

  it('asks nothing once the screen is gone, even after the pause', async () => {
    const fake = deferredCheck();
    const { result, unmount } = await renderCheck(fake.check);
    await act(() => {
      result.current.onValueChange('Home', true);
    });

    await act(async () => {
      await unmount();
    });
    await advance(debounceMs + deadlineMs);

    expect(fake.asked).toStrictEqual([]);
  });

  it('aborts the signal of a check still running when the screen goes', async () => {
    const fake = deferredCheck();
    const { result, unmount } = await renderCheck(fake.check);
    await act(() => {
      result.current.onValueChange('Home', true);
    });
    await advance(debounceMs);
    expect(fake.signals).toHaveLength(1);

    await act(async () => {
      await unmount();
    });

    expect(fake.signals[0]?.aborted).toBe(true);
  });
});
