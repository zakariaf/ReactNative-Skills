// src/ui/use-hold-to-confirm.test.ts
// no-providers: the hook reads only Reanimated and its arguments.
import { act, renderHook } from '@testing-library/react-native';

import { HOLD_TO_CONFIRM_MS, useHoldToConfirm } from './use-hold-to-confirm';

const PAST_THE_HOLD_MS = HOLD_TO_CONFIRM_MS + 500;

describe('useHoldToConfirm', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('confirms once the finger has stayed down for the whole hold', async () => {
    const onConfirm = jest.fn();
    const { result } = await renderHook(() => useHoldToConfirm(onConfirm));
    expect(result.current.progress.get()).toBe(0);

    await act(() => {
      result.current.handlePressIn();
      jest.advanceTimersByTime(PAST_THE_HOLD_MS);
    });

    expect(result.current.progress.get()).toBe(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('empties without confirming when the finger lifts early', async () => {
    const onConfirm = jest.fn();
    const { result } = await renderHook(() => useHoldToConfirm(onConfirm));

    await act(() => {
      result.current.handlePressIn();
      jest.advanceTimersByTime(HOLD_TO_CONFIRM_MS / 2);
      result.current.handlePressOut();
      jest.advanceTimersByTime(PAST_THE_HOLD_MS);
    });

    expect(result.current.progress.get()).toBe(0);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('holds a frozen fill still and runs no timer', async () => {
    const onConfirm = jest.fn();
    const { result } = await renderHook(() => useHoldToConfirm(onConfirm, 0.4));

    await act(() => {
      result.current.handlePressIn();
      jest.advanceTimersByTime(PAST_THE_HOLD_MS);
      result.current.handlePressOut();
    });

    expect(result.current.progress.get()).toBe(0.4);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps a frozen fill between empty and full', async () => {
    const { result: over } = await renderHook(() => useHoldToConfirm(jest.fn(), 1.7));
    const { result: under } = await renderHook(() => useHoldToConfirm(jest.fn(), -0.2));

    expect(over.current.progress.get()).toBe(1);
    expect(under.current.progress.get()).toBe(0);
  });
});
