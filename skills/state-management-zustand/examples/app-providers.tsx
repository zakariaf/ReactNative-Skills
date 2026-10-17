// src/features/root-navigator/app-providers.tsx (a shape to imitate): AppRoot's dependency providers,
// outermost first: the ports, the data layer, then the stores (StoresProvider). Everything comes from
// AppRoot's one startApp run; nothing here creates a store. An app with server state or settings adds
// QueryProvider and SettingsStoreProvider between AppDataProvider and StoresProvider, in that order.
import { AppDataProvider } from '@/data/app-data-context';
import { ServicesProvider } from '@/services/services-context';
import { StoresProvider } from '@/stores/stores-context';

import type { AppData } from '@/data/app-data-context';
import type { Services } from '@/services/services-context';
import type { Stores } from '@/stores/stores-context';
import type { JSX, ReactNode } from 'react';

export type AppProvidersProps = {
  readonly services: Services;
  readonly data: AppData;
  readonly stores: Stores;
  readonly children: ReactNode;
};

export function AppProviders({ services, data, stores, children }: AppProvidersProps): JSX.Element {
  return (
    <ServicesProvider services={services}>
      <AppDataProvider data={data}>
        <StoresProvider stores={stores}>{children}</StoresProvider>
      </AppDataProvider>
    </ServicesProvider>
  );
}
