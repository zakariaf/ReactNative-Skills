// src/app/_layout.tsx: the root layout. Expo Router reads its default export.
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// The direction is decided first: RootLayout creates the adapters (no I/O) and resolves the language,
// DirectionGate restarts once or renders AppRoot, and only AppRoot does work with effects (the
// database, the error net's sink) and mounts the providers. Nothing here runs at import time.
import '@/services/error-net/install-error-net';

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
  // The saved language goes in place of null once the settings store reads it before first paint.
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
