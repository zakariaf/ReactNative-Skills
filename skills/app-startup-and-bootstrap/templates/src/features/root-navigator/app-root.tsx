// src/features/root-navigator/app-root.tsx
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// Everything the app starts once DirectionGate kept this JS run, in the canonical order
// (app-startup-and-bootstrap). In one state initializer, synchronously: the registry's prepared ports
// (prepareRootKits: the same services, or a test build's with its simulated clock and network swapped
// in, which every reader below uses), the data layer (open, migrations, repositories, the SQLite error
// log), the error net's sink (it flushes what it buffered), then settings and stores when the app has
// them, then the optional kits from the app's registry (src/services/create-root-kits.ts), then the
// startup gate. Then the lifecycle hooks (flush before
// checkpoint), the system accessibility store, the splash release, and the providers, outermost
// first: services, data, i18n, theme, text locale, the root stack (whose RootKits slot mounts the
// kits' providers and effects). A kit plugs into these slots from the registry and never edits this
// file. A run that is about to restart for the layout direction never gets here, so it opens and
// writes nothing.
import { hide as hideSplash } from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { AppDataProvider } from '@/data/app-data-context';
import { openDeviceData } from '@/data/open-device-database';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { I18nProvider } from '@/i18n/i18n-provider';
import { directionOf } from '@/i18n/languages';
import { createRootKits, prepareRootKits } from '@/services/create-root-kits';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { createKitErrorSink, kitBlocking, kitFlushers } from '@/services/root-kits/root-kit';
import { ServicesProvider } from '@/services/services-context';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';

import { RootStack } from './root-stack';
import { createStartupGate } from './startup-gate';
import { useFlushOnBackground } from './use-flush-on-background';
import { useStartupReady } from './use-startup-ready';

import type { Flusher } from './background-flush';
import type { StartupGate } from './startup-gate';
import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';

export type AppRootProps = { readonly services: Services; readonly language: Language };

/** The longest the splash waits for blocking startup tasks (the checker allows up to 3000 ms). */
const STARTUP_DEADLINE_MS = 2000;

type StartedApp = {
  /** The ports every reader uses: prepareRootKits' (a test build's simulated clock and network). */
  readonly services: Services;
  readonly data: AppData;
  readonly kits: readonly RootKit[];
  readonly gate: StartupGate;
  readonly flushers: readonly Flusher[];
};

/** Once per JS run, in the first render's state initializer, in this order. */
function startApp(device: Services, language: Language): StartedApp {
  // The registry prepares the ports before anything reads them: a test build's kit swaps in its
  // simulated clock and network here (debug-menu-and-test-hooks); otherwise the same services.
  const prepared = prepareRootKits(device);
  const { services } = prepared;
  const data = openDeviceData(services);
  // Every report reaches the error log now; the kits that forward reports (crash reporting) get
  // them, those of the first moments included, once they are attached below.
  const errors = createKitErrorSink(data.errorLog);
  appErrorNet.connect(errors.sink);
  // The rest of the data and state join here, in this order, when the app has them: the QueryClient
  // (networking-and-server-state), openDeviceSettings(data.errorLog) (settings-and-preferences),
  // createStores({ tasks: data.tasks }) (state-management-zustand), then work that only starts
  // something, such as the sound bank load (audio-and-haptics-feedback). Their providers go in the
  // same order below: QueryProvider, SettingsStoreProvider, StoresProvider, PreferencesRoot (which then
  // replaces the fixed I18nProvider, AppThemeProvider and TextLocaleProvider, and hands the saved
  // reduce-motion choice to the root stack's RootMotion).
  // The optional kits, once per run, after the state they may read; with none, every slot is empty.
  const kits = createRootKits({ services, data, language, prepared });
  errors.attach(kits);
  const gate = createStartupGate({
    // Async work the first screen must wait for: only the kits' (storage and settings open
    // synchronously, fonts are embedded by the expo-font config plugin). Work that can wait starts
    // after the splash.
    blocking: kitBlocking(kits),
    deadlineMs: STARTUP_DEADLINE_MS,
    errorLog: data.errorLog,
  });
  gate.start();
  // Buffered writers hand their flush here; only the kits' yet, because every app write commits
  // synchronously.
  return { services, data, kits, gate, flushers: kitFlushers(kits) };
}

export function AppRoot({ services, language }: AppRootProps): React.JSX.Element | null {
  const [app] = useState(() => startApp(services, language));
  useFlushOnBackground(app.flushers, app.data.errorLog);
  useCheckpointOnBackground(app.data.database);
  // The phone's accessibility switches (Reduce Motion, Remove animations) and their live changes.
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
  // The held native splash covers this frame; the gate opens by its deadline at the latest.
  if (!isReady) return null;
  return (
    <ServicesProvider services={app.services}>
      <AppDataProvider data={app.data}>
        <I18nProvider language={language} digits="automatic" onError={handleI18nError}>
          <AppThemeProvider preference="system">
            <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
              <RootStack kits={app.kits} />
            </TextLocaleProvider>
          </AppThemeProvider>
        </I18nProvider>
      </AppDataProvider>
    </ServicesProvider>
  );
}
