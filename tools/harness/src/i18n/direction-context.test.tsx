// src/i18n/direction-context.test.tsx
// no-providers: these tests cover DirectionProvider itself and the default without it.
import { renderHook } from '@testing-library/react-native';

import { DirectionProvider, useDirection } from './direction-context';

import type { ReactNode } from 'react';

function RightToLeft({ children }: { readonly children: ReactNode }): ReactNode {
  return <DirectionProvider direction="rtl">{children}</DirectionProvider>;
}

describe('useDirection', () => {
  it('reads the direction the nearest provider gives', async () => {
    const { result } = await renderHook(() => useDirection(), { wrapper: RightToLeft });

    expect(result.current).toBe('rtl');
  });

  it('is left to right without a provider', async () => {
    const { result } = await renderHook(() => useDirection());

    expect(result.current).toBe('ltr');
  });
});
