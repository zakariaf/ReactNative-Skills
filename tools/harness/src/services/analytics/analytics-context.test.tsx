// src/services/analytics/analytics-context.test.tsx
// no-providers: this file tests AnalyticsProvider itself, outside it and as the test's own wrapper.
import { renderHook } from '@testing-library/react-native';

import { AnalyticsProvider, useAnalytics } from './analytics-context';
import { createFakeAnalytics } from './fake-analytics';

import type { ReactNode } from 'react';

describe('useAnalytics', () => {
  it('returns the port the analytics kit provides', async () => {
    const analytics = createFakeAnalytics();
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <AnalyticsProvider analytics={analytics}>{props.children}</AnalyticsProvider>
    );
    const { result } = await renderHook(() => useAnalytics(), { wrapper });
    expect(result.current).toBe(analytics);
  });

  it('throws without the provider, naming the kit to register', async () => {
    await expect(renderHook(() => useAnalytics())).rejects.toThrow('createAnalyticsKit');
  });
});
