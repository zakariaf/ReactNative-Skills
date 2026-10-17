// src/api/query-provider.test.tsx
// The provider under test is the wrapper itself, built with its own client and a fake port.
import { onlineManager, QueryClient, useQueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

import { createFakeConnectivity } from '@/services/connectivity/fake-connectivity';

import { QueryProvider } from './query-provider';

import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type { JSX, ReactNode } from 'react';

function wrapperFor(
  client: QueryClient,
  connectivity: ConnectivityPort,
): (props: { readonly children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }: { readonly children: ReactNode }): JSX.Element {
    return (
      <QueryProvider client={client} connectivity={connectivity}>
        {children}
      </QueryProvider>
    );
  };
}

describe('QueryProvider', () => {
  it('provides the client it was given', async () => {
    const client = new QueryClient();
    const { result } = await renderHook(() => useQueryClient(), {
      wrapper: wrapperFor(client, createFakeConnectivity(true)),
    });

    expect(result.current).toBe(client);
  });

  it('feeds the online manager while mounted and lets go on unmount', async () => {
    const connectivity = createFakeConnectivity(true);
    const view = await renderHook(() => null, {
      wrapper: wrapperFor(new QueryClient(), connectivity),
    });
    connectivity.setOnline(false);
    const isOnlineWhileMounted = onlineManager.isOnline();
    await view.unmount();

    expect([
      isOnlineWhileMounted,
      onlineManager.isOnline(),
      connectivity.listenerCount(),
    ]).toStrictEqual([false, true, 0]);
  });
});
