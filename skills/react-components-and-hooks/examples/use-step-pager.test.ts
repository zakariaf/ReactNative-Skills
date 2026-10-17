// Example (shape only, never copied into the app): the renderHook tests of use-step-pager.ts.
// no-providers: the pager takes only the step count and reads no store, catalog or port.
import { act, renderHook } from '@testing-library/react-native';

import { useStepPager } from './use-step-pager';

describe('useStepPager', () => {
  it('starts on the first of the steps', async () => {
    const { result } = await renderHook(() => useStepPager(4));
    expect(result.current).toMatchObject({ step: 1, total: 4, isFirst: true, isLast: false });
  });

  it('stops at the last step', async () => {
    const { result } = await renderHook(() => useStepPager(2));
    await act(() => {
      result.current.handleNext();
    });
    await act(() => {
      result.current.handleNext();
    });
    expect(result.current).toMatchObject({ step: 2, isLast: true });
  });

  it('moves two steps for two taps before a re-render', async () => {
    const { result } = await renderHook(() => useStepPager(5));
    await act(() => {
      result.current.handleNext();
      result.current.handleNext();
    });
    expect(result.current.step).toBe(3);
  });

  it('clamps the step when the list gets shorter', async () => {
    const { result, rerender } = await renderHook(
      ({ total }: { readonly total: number }) => useStepPager(total),
      { initialProps: { total: 5 } },
    );
    await act(() => {
      result.current.handleNext();
      result.current.handleNext();
    });
    await rerender({ total: 1 });
    expect(result.current).toMatchObject({ step: 1, isFirst: true, isLast: true });
  });
});
