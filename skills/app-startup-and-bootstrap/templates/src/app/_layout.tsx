// src/app/_layout.tsx: the root layout. Expo Router reads its default export.
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// The startup order (app-startup-and-bootstrap): index.ts loaded the Intl polyfills and then
// expo-router/entry. Here the error net comes first (the first app import), then the splash hold (the
// native splash stays up until AppRoot releases it). On the first render RootLayout only creates the
// adapters (no I/O) and resolves the language; DirectionGate restarts once or renders AppRoot, and
// only AppRoot opens storage, connects the error net's sink, mounts the providers and releases the
// splash. Nothing else here runs at import time.
import '@/services/error-net/install-error-net';
import '@/features/root-navigator/hold-splash';

import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import { useState } from 'react';

import { CrashFallback } from '@/features/crash-recovery/crash-fallback';
import { createRouteErrorBoundary } from '@/features/crash-recovery/create-route-error-boundary';
import { AppRoot } from '@/features/root-navigator/app-root';
import { DirectionGate } from '@/i18n/direction-gate';
import { resolveLanguage } from '@/i18n/resolve-language';
import { createDeviceServices } from '@/services/create-device-services';
import { appErrorNet } from '@/services/error-net/app-error-net';

import type { DirectionGiveUp } from '@/i18n/direction-gate';
import type { Language } from '@/i18n/languages';
import type { DirectionGuardFailure } from '@/services/direction-guard/direction-guard-port';
import type { Services } from '@/services/services-context';

/** Expo Router wraps this layout (so the whole app) in a boundary that renders this on a render error. */
export const ErrorBoundary = createRouteErrorBoundary({
  record: (error) => {
    appErrorNet.report({ source: 'render', error, isFatal: false });
  },
  Fallback: CrashFallback,
  // The root fallback replaces the whole navigator: reloading the bundle is the dependable way out.
  restart: () => reloadAppAsync('crash-recovery'),
});

type Startup = { readonly services: Services; readonly language: Language };

/** Runs once per JS run, in a state initializer: adapters only (no I/O) and the language. */
function decideStartup(): Startup {
  // The device services as they are: a test build's simulated clock and network are swapped in by
  // the registry's prepareRootKits at the start of AppRoot's startApp (debug-menu-and-test-hooks).
  // No settings store yet: the phone's language decides (settings-and-preferences' readSavedLanguage
  // takes the place of null once the app saves a language choice).
  return { services: createDeviceServices(), language: resolveLanguage(null, getLocales()) };
}

export default function RootLayout(): React.JSX.Element {
  const [startup] = useState(decideStartup);
  const handleGiveUp = (giveUp: DirectionGiveUp): void => {
    startup.services.errorLog.record(
      'startup',
      new Error(`layout direction ${giveUp.reason}: ${giveUp.layout} -> ${giveUp.wanted}`),
    );
  };
  const handleGuardFailure = (failure: DirectionGuardFailure): void => {
    startup.services.errorLog.record('startup', new Error(`layout direction ${failure.kind}`));
  };
  return (
    <DirectionGate
      language={startup.language}
      guard={startup.services.directionGuard}
      onGiveUp={handleGiveUp}
      onGuardFailure={handleGuardFailure}
    >
      <AppRoot services={startup.services} language={startup.language} />
    </DirectionGate>
  );
}
