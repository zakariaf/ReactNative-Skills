// src/hooks/use-done-bar-space.test.ts
// no-providers: the hook holds one number in local state and reads no context.
import { act, renderHook } from '@testing-library/react-native';

import { KEYBOARD_DONE_BAR_MIN_HEIGHT } from '@/ui/form/keyboard-done-bar';

import { DONE_BAR_GAP, useDoneBarSpace } from './use-done-bar-space';

describe('useDoneBarSpace', () => {
  it('keeps room for the bar at the default text size before it is measured', async () => {
    const { result } = await renderHook(() => useDoneBarSpace());

    expect(result.current.bottomOffset).toBe(KEYBOARD_DONE_BAR_MIN_HEIGHT + DONE_BAR_GAP);
    expect(result.current.extraKeyboardSpace).toBe(KEYBOARD_DONE_BAR_MIN_HEIGHT);
  });

  it('keeps the focused field above a bar that grew with large text', async () => {
    const { result } = await renderHook(() => useDoneBarSpace());

    await act(() => {
      result.current.onBarHeightChange(96.4);
    });

    expect(result.current.bottomOffset).toBe(97 + DONE_BAR_GAP);
    expect(result.current.extraKeyboardSpace).toBe(97);
  });
});
