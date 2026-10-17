// src/features/root-navigator/app-providers.tsx (example: the outer providers of AppRoot)
// The dependency providers, outermost first: the ports (ServicesProvider), the data layer, then the
// server-state cache (QueryProvider, which also wires TanStack's focus and online managers to AppState
// and the ConnectivityPort while it is mounted). Everything comes from AppRoot's one startApp run;
// nothing here creates a client or an adapter. app-startup-and-bootstrap's check-startup accepts
// AppProviders in place of ServicesProvider and checks the order inside it.
import { QueryProvider } from '@/api/query-provider';
import { AppDataProvider } from '@/data/app-data-context';
import { ServicesProvider } from '@/services/services-context';

import type { AppData } from '@/data/app-data-context';
import type { Services } from '@/services/services-context';
import type { QueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

export type AppProvidersProps = {
  readonly services: Services;
  readonly data: AppData;
  readonly queryClient: QueryClient;
  readonly children: ReactNode;
};

/** Ports, data and the query cache for everything below AppRoot. */
export function AppProviders({
  services,
  data,
  queryClient,
  children,
}: AppProvidersProps): JSX.Element {
  return (
    <ServicesProvider services={services}>
      <AppDataProvider data={data}>
        <QueryProvider client={queryClient} connectivity={services.connectivity}>
          {children}
        </QueryProvider>
      </AppDataProvider>
    </ServicesProvider>
  );
}
