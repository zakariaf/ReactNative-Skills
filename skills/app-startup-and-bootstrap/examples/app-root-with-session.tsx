// src/features/root-navigator/app-root.tsx (a shape to imitate, not a template)
// The template's AppRoot after a Tasks app added sign-in, settings, stores, the server-state cache
// and a buffered draft writer. What changed, in the canonical order:
// - startApp: data, sink, QueryClient, settings, stores, the draft buffer, the session, the optional
//   kits from the registry (handed the settings and the session they read; errors.attach replays the
//   first moments' reports to them), then the gate with ONE blocking task of the app's own: the
//   session restore, because the first screen differs for a signed-in
//   person. The session and its storage follow auth-and-secure-storage: every secure-store read is
//   async behind its SecureStoragePort, so restore() is a non-interactive async read and belongs in
//   the gate, under the deadline. restore() never rejects; when it misses the deadline the session
//   is still "restoring", SessionProvider restores again, and the first screen shows that state
//   instead of the splash waiting longer.
// - restoreSessionTask lives in its own file (restore-session-task.ts), because the root files hold no
//   promise code (startup-await): { name: 'session-restore', run: async () => { await
//   session.restore(); return ok(undefined); } }. restore() never rejects; every outcome is a snapshot.
// - Not a gate task: a biometric unlock (Face ID, Touch ID, Android BiometricPrompt) waits for the
//   person, so no deadline can bound it: it is a lock screen or route guard after the splash release.
// - providers: AppProviders (services, data, query) > SettingsStoreProvider > StoresProvider >
//   PreferencesRoot (settings-driven i18n, theme, MotionConfig, text locale) > RootStack, which
//   renders SessionProvider inside the navigation theme (auth-and-secure-storage's root stack;
//   rootStackOrder already lists SessionProvider). RootStack no longer renders its fixed
//   MotionConfig (provider-once), and still hands the kits to AppStack's RootKits slot.
// - The splash: still held once in hold-splash.ts and released once here through useStartupReady;
//   AppStack never calls SplashScreen.hide() itself.
import { getLocales } from 'expo-localization';
import { hide as hideSplash } from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/create-query-client';
import { openDeviceData } from '@/data/open-device-database';
import { openDeviceSettings } from '@/data/open-device-settings';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { PreferencesRoot } from '@/features/settings-effects/preferences-root';
import { createTaskDraftBuffer } from '@/features/task-editor/task-draft-buffer';
import { createRootKits } from '@/services/create-root-kits';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { createKitErrorSink, kitBlocking, kitFlushers } from '@/services/root-kits/root-kit';
import { createStores } from '@/stores/create-stores';
import { StoresProvider } from '@/stores/stores-context';
import { SettingsStoreProvider } from '@/stores/settings/settings-store-context';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';

import { AppProviders } from './app-providers';
import { createAppSession } from './create-app-session';
import { RootStack } from './root-stack';
import { restoreSessionTask } from './restore-session-task';
import { createStartupGate } from './startup-gate';
import { useFlushOnBackground } from './use-flush-on-background';
import { useStartupReady } from './use-startup-ready';

import type { Language } from '@/i18n/languages';
import type { Services } from '@/services/services-context';

export type AppRootProps = { readonly services: Services; readonly language: Language };

/** The splash waits at most this long for the session restore (check-startup allows up to 3000 ms). */
const STARTUP_DEADLINE_MS = 1500;

function startApp(services: Services, language: Language) {
  const data = openDeviceData(services);
  const errors = createKitErrorSink(data.errorLog);
  appErrorNet.connect(errors.sink);
  const queryClient = createQueryClient({ errorLog: data.errorLog });
  const settings = openDeviceSettings(data.errorLog);
  const stores = createStores({ tasks: data.tasks });
  const drafts = createTaskDraftBuffer({ save: data.drafts.save });
  // auth-and-secure-storage's createAppSession: the one SessionManager, with its sign-out steps.
  const session = createAppSession(services, {
    queryCache: queryClient,
    resetAccountStore: stores.resetAccount,
  });
  // The optional kits (the app's RootKitsInput adds what they read: crash consent from the settings,
  // the push account from the session).
  const kits = createRootKits({ services, data, language, settings, session });
  errors.attach(kits);
  const gate = createStartupGate({
    blocking: [restoreSessionTask(session), ...kitBlocking(kits)],
    deadlineMs: STARTUP_DEADLINE_MS,
    errorLog: data.errorLog,
  });
  gate.start();
  const flushers = [drafts.flusher, ...kitFlushers(kits)];
  return { data, queryClient, settings, stores, drafts, session, kits, gate, flushers };
}

export function AppRoot({ services, language }: AppRootProps): React.JSX.Element | null {
  const [app] = useState(() => startApp(services, language));
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
  const record = (error: unknown): void => {
    app.data.errorLog.record('i18n', error);
  };
  if (!isReady) return null;
  return (
    <AppProviders services={services} data={app.data} queryClient={app.queryClient}>
      <SettingsStoreProvider store={app.settings}>
        <StoresProvider stores={app.stores}>
          <PreferencesRoot deviceLocales={getLocales()} onError={record}>
            <RootStack session={app.session} kits={app.kits} />
          </PreferencesRoot>
        </StoresProvider>
      </SettingsStoreProvider>
    </AppProviders>
  );
}
