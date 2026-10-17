// src/features/root-navigator/app-providers.tsx (shape only): AppRoot's dependency providers, outermost
// first: the ports, the data layer, then the settings store. An app with server state puts
// QueryProvider between AppDataProvider and SettingsStoreProvider, and its domain stores'
// StoresProvider after SettingsStoreProvider (contracts/startup.json appRootOrder).
import { AppDataProvider } from '@/data/app-data-context';
import { ServicesProvider } from '@/services/services-context';
import { SettingsStoreProvider } from '@/stores/settings/settings-store-context';

import type { AppData } from '@/data/app-data-context';
import type { Services } from '@/services/services-context';
import type { SettingsStore } from '@/stores/settings/settings-store';
import type { JSX, ReactNode } from 'react';

export type AppProvidersProps = {
  readonly services: Services;
  readonly data: AppData;
  readonly settings: SettingsStore;
  readonly children: ReactNode;
};

export function AppProviders({
  services,
  data,
  settings,
  children,
}: AppProvidersProps): JSX.Element {
  return (
    <ServicesProvider services={services}>
      <AppDataProvider data={data}>
        <SettingsStoreProvider store={settings}>{children}</SettingsStoreProvider>
      </AppDataProvider>
    </ServicesProvider>
  );
}
