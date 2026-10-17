// src/features/root-navigator/app-root.tsx (shape only): the canonical AppRoot with the settings wired
// in (app-startup-and-bootstrap owns the order). startApp opens the settings store synchronously right
// after the data layer and the error net's sink, so the first frame has the saved theme and language;
// then the haptics gate connects to it and sound follows it. The tree renders SettingsStoreProvider
// (inside AppProviders, after the data layer) and PreferencesRoot in place of the fixed I18nProvider,
// AppThemeProvider and TextLocaleProvider values. PreferencesRoot provides the saved Reduce motion
// choice as the preference context; the canonical root stack's RootMotion turns it into the one
// MotionConfig (or a test build's motion slot), so root-stack.tsx stays unchanged.
import { useLocales } from 'expo-localization';
import { hide as hideSplash } from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { openDeviceData } from '@/data/open-device-database';
import { openDeviceSettings } from '@/data/open-device-settings';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { connectSoundSettings } from '@/features/settings-effects/connect-sound-settings';
import { PreferencesRoot } from '@/features/settings-effects/preferences-root';
import { DEFAULT_AUDIO_SETTINGS } from '@/services/audio/audio-port';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';

import { AppProviders } from './app-providers';
import { RootStack } from './root-stack';
import { createStartupGate } from './startup-gate';
import { useFlushOnBackground } from './use-flush-on-background';
import { useStartupReady } from './use-startup-ready';

import type { Flusher } from './background-flush';
import type { StartupGate } from './startup-gate';
import type { AppData } from '@/data/app-data-context';
import type { HapticsGate } from '@/features/settings-effects/haptics-gate';
import type { Services } from '@/services/services-context';
import type { SettingsStore } from '@/stores/settings/settings-store';

export type AppRootProps = { readonly services: Services; readonly hapticsGate: HapticsGate };

const STARTUP_DEADLINE_MS = 2000;

type StartedApp = {
  readonly data: AppData;
  readonly settings: SettingsStore;
  readonly gate: StartupGate;
  readonly flushers: readonly Flusher[];
};

function startApp(services: Services, hapticsGate: HapticsGate): StartedApp {
  const data = openDeviceData(services);
  appErrorNet.connect((report) => {
    data.errorLog.record(report.source, report.error);
  });
  const settings = openDeviceSettings(data.errorLog);
  hapticsGate.connect(settings);
  // Sound follows every change from now on through audio-and-haptics-feedback's AudioPort (volumes
  // 0..1; an app with a music row passes its own music setting the same way). It lives as long as
  // the app.
  connectSoundSettings(settings, (effects) => {
    services.audio.applySettings({ effects, music: DEFAULT_AUDIO_SETTINGS.music });
  });
  const gate = createStartupGate({
    blocking: [],
    deadlineMs: STARTUP_DEADLINE_MS,
    errorLog: data.errorLog,
  });
  gate.start();
  return { data, settings, gate, flushers: [] };
}

export function AppRoot({ services, hapticsGate }: AppRootProps): React.JSX.Element | null {
  const [app] = useState(() => startApp(services, hapticsGate));
  // useLocales, not getLocales: Android changes the system language without a restart, and "System"
  // then follows it.
  const deviceLocales = useLocales();
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
    <AppProviders services={services} data={app.data} settings={app.settings}>
      <PreferencesRoot deviceLocales={deviceLocales} onError={record}>
        <RootStack />
      </PreferencesRoot>
    </AppProviders>
  );
}
