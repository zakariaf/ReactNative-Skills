// src/features/root-navigator/app-root.tsx (example: the canonical AppRoot with the server-state layer
// added)
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// The only changes to the canonical AppRoot (app-startup-and-bootstrap owns the order): startApp
// creates the QueryClient once, right after the error net's sink (the client records bugs through the
// error log), and the outer providers move into AppProviders (app-providers.tsx), which adds
// QueryProvider right after AppDataProvider: QueryProvider reads the ConnectivityPort, and every
// screen below can call useQuery in its model hook. Moving them keeps the tree within jsx-max-depth.
import { hide as hideSplash } from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/create-query-client';
import { openDeviceData } from '@/data/open-device-database';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { I18nProvider } from '@/i18n/i18n-provider';
import { directionOf } from '@/i18n/languages';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';

import { AppProviders } from './app-providers';
import { RootStack } from './root-stack';
import { createStartupGate } from './startup-gate';
import { useFlushOnBackground } from './use-flush-on-background';
import { useStartupReady } from './use-startup-ready';

import type { Flusher } from './background-flush';
import type { StartupGate } from './startup-gate';
import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { Services } from '@/services/services-context';
import type { QueryClient } from '@tanstack/react-query';

export type AppRootProps = { readonly services: Services; readonly language: Language };

const STARTUP_DEADLINE_MS = 2000;

type StartedApp = {
  readonly data: AppData;
  readonly queryClient: QueryClient;
  readonly gate: StartupGate;
  readonly flushers: readonly Flusher[];
};

/** Once per JS run, in the first render's state initializer: data, the error sink, the QueryClient. */
function startApp(services: Services): StartedApp {
  const data = openDeviceData(services);
  appErrorNet.connect((report) => {
    data.errorLog.record(report.source, report.error);
  });
  const queryClient = createQueryClient({ errorLog: services.errorLog });
  const gate = createStartupGate({
    blocking: [],
    deadlineMs: STARTUP_DEADLINE_MS,
    errorLog: data.errorLog,
  });
  gate.start();
  return { data, queryClient, gate, flushers: [] };
}

export function AppRoot({ services, language }: AppRootProps): React.JSX.Element | null {
  const [app] = useState(() => startApp(services));
  useFlushOnBackground(app.flushers, app.data.errorLog);
  useCheckpointOnBackground(app.data.database);
  useEffect(
    () =>
      watchSystemA11y((error: unknown) => {
        app.data.errorLog.record('startup', error);
      }),
    [app],
  );
  const isReady = useStartupReady(app.gate, hideSplash);
  const handleI18nError = (error: Error): void => {
    app.data.errorLog.record('i18n', error);
  };
  if (!isReady) return null;
  return (
    <AppProviders services={services} data={app.data} queryClient={app.queryClient}>
      <I18nProvider language={language} digits="automatic" onError={handleI18nError}>
        <AppThemeProvider preference="system">
          <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
            <RootStack />
          </TextLocaleProvider>
        </AppThemeProvider>
      </I18nProvider>
    </AppProviders>
  );
}
