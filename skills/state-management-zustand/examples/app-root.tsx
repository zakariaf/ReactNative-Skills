// src/features/root-navigator/app-root.tsx (a shape to imitate, not a template): where the stores join
// the startup. Only the store lines are this skill's: app-startup-and-bootstrap owns the canonical
// AppRoot and its order, persistence-and-migrations the data layer. createStores runs once, in the
// first render's state initializer, after openDeviceData and the error net's sink (each store reads its
// rows before the first frame), never at import time: Fast Refresh re-runs an edited module while
// components keep their state, which would put a second store beside the one on screen. Its provider
// goes right after the data layer's (and after SettingsStoreProvider when the app has settings), inside
// AppProviders so the tree stays within jsx-max-depth.
import { hide as hideSplash } from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { openDeviceData } from '@/data/open-device-database';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { I18nProvider } from '@/i18n/i18n-provider';
import { directionOf } from '@/i18n/languages';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { createStores } from '@/stores/create-stores';
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
import type { Stores } from '@/stores/stores-context';

export type AppRootProps = { readonly services: Services; readonly language: Language };

const STARTUP_DEADLINE_MS = 2000;

type StartedApp = {
  readonly data: AppData;
  readonly stores: Stores;
  readonly gate: StartupGate;
  readonly flushers: readonly Flusher[];
};

/** The data layer, the error sink, then the stores: each reads its rows before the first frame. */
function startApp(services: Services): StartedApp {
  const data = openDeviceData(services);
  appErrorNet.connect((report) => {
    data.errorLog.record(report.source, report.error);
  });
  const stores = createStores({ tasks: data.tasks });
  const gate = createStartupGate({
    blocking: [],
    deadlineMs: STARTUP_DEADLINE_MS,
    errorLog: data.errorLog,
  });
  gate.start();
  return { data, stores, gate, flushers: [] };
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
    <AppProviders services={services} data={app.data} stores={app.stores}>
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
