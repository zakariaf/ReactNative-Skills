// src/api/query-provider.tsx
// Mounts the app's QueryClient and wires TanStack's focus and online managers to AppState and the
// ConnectivityPort for as long as it is mounted. The root layout renders it once, inside
// ServicesProvider, with the client its useState initializer created.
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { connectQueryManagers } from './query-managers';

import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type { QueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

export type QueryProviderProps = {
  readonly client: QueryClient;
  readonly connectivity: ConnectivityPort;
  readonly children: ReactNode;
};

/** The QueryClientProvider of the app, with React Native focus and online wiring. */
export function QueryProvider({ client, connectivity, children }: QueryProviderProps): JSX.Element {
  useEffect(() => connectQueryManagers({ appState: AppState, connectivity }), [connectivity]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
