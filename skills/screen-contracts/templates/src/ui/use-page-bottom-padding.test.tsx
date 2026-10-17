// src/ui/use-page-bottom-padding.test.tsx
// no-providers: the hook reads only the safe-area context, which each test supplies or leaves out on purpose.
import { renderHook } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { PAGE_BOTTOM_PADDING, usePageBottomPadding } from './use-page-bottom-padding';

import type { ReactNode } from 'react';

function insetsWrapper(bottom: number): (props: { readonly children: ReactNode }) => ReactNode {
  return function InsetsWrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <SafeAreaInsetsContext value={{ top: 59, right: 0, bottom, left: 0 }}>
        {children}
      </SafeAreaInsetsContext>
    );
  };
}

describe('usePageBottomPadding', () => {
  it('returns the page padding when the frame keeps its bottom edge', async () => {
    const { result } = await renderHook(() => usePageBottomPadding(false), {
      wrapper: insetsWrapper(34),
    });

    expect(result.current).toBe(PAGE_BOTTOM_PADDING);
  });

  it('returns the bottom inset when it is taller than the page padding', async () => {
    const { result } = await renderHook(() => usePageBottomPadding(true), {
      wrapper: insetsWrapper(48),
    });

    expect(result.current).toBe(48);
  });

  it('keeps the page padding above a shorter inset', async () => {
    const { result } = await renderHook(() => usePageBottomPadding(true), {
      wrapper: insetsWrapper(PAGE_BOTTOM_PADDING - 10),
    });

    expect(result.current).toBe(PAGE_BOTTOM_PADDING);
  });

  it('treats a missing safe-area provider as no inset', async () => {
    const { result } = await renderHook(() => usePageBottomPadding(true));

    expect(result.current).toBe(PAGE_BOTTOM_PADDING);
  });
});
