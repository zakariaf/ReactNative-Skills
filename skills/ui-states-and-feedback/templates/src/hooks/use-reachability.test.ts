// src/hooks/use-reachability.test.ts
// no-providers: the hook takes the port as its argument and reads no React context.
import { act, renderHook } from '@testing-library/react-native';

import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';

import { useReachability } from './use-reachability';

describe('useReachability', () => {
  it('follows the port and lets go of it on unmount', async () => {
    const connectivity = createFakeConnectivity(true);
    const view = await renderHook(() => useReachability(connectivity));
    expect(view.result.current).toBe('reachable');
    await act(() => {
      connectivity.setReachability('unvalidated');
    });
    expect(view.result.current).toBe('unvalidated');
    await act(() => {
      connectivity.setOnline(false);
    });
    expect(view.result.current).toBe('none');
    await view.unmount();
    expect(connectivity.listenerCount()).toBe(0);
  });
});
