// src/ui/adaptive/use-measured-width.test.ts
// no-providers: the hook keeps one number from layout events and reads no context.
import { act, renderHook } from '@testing-library/react-native';

import { useMeasuredWidth } from './use-measured-width';

import type { LayoutChangeEvent } from 'react-native';

function layoutEvent(width: number): LayoutChangeEvent {
  return { nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } } as LayoutChangeEvent;
}

describe('useMeasuredWidth', () => {
  it('is null until the container has been laid out', async () => {
    const { result } = await renderHook(() => useMeasuredWidth());
    expect(result.current.width).toBeNull();
  });

  it('reports the container width in whole points, floored', async () => {
    const { result } = await renderHook(() => useMeasuredWidth());
    await act(() => {
      result.current.onLayout(layoutEvent(1055.67));
    });
    expect(result.current.width).toBe(1055);
  });

  it('follows the container when it is resized', async () => {
    const { result } = await renderHook(() => useMeasuredWidth());
    await act(() => {
      result.current.onLayout(layoutEvent(744));
    });
    await act(() => {
      result.current.onLayout(layoutEvent(423.2));
    });
    expect(result.current.width).toBe(423);
  });

  it('keeps the whole-point width when a layout pass moves it by a fraction', async () => {
    const { result } = await renderHook(() => useMeasuredWidth());
    await act(() => {
      result.current.onLayout(layoutEvent(600.2));
    });
    await act(() => {
      result.current.onLayout(layoutEvent(600.7));
    });
    expect(result.current.width).toBe(600);
  });
});
