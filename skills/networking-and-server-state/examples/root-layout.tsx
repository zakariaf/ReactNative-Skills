// src/app/_layout.tsx (example: the canonical root layout with the server-state layer added; Expo
// Router reads the default export)
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// The only change to the canonical root layout (app-startup-and-bootstrap owns the order, the error
// net import and the splash hold): decideStartup reads the checked public environment and hands it to
// the composition root, so a missing EXPO_PUBLIC_API_URL throws here, on the first launch of a
// misconfigured build, before anything opens. The QueryClient is created in AppRoot (app-root.tsx),
// after the data layer and the error net's sink.
import '@/services/error-net/install-error-net';
import '@/features/root-navigator/hold-splash';

import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import { useState } from 'react';

import { readPublicEnvironment } from '@/config/environment';
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

export const ErrorBoundary = createRouteErrorBoundary({
  record: (error) => {
    appErrorNet.report({ source: 'render', error, isFatal: false });
  },
  Fallback: CrashFallback,
  restart: () => reloadAppAsync('crash-recovery'),
});

type Startup = { readonly services: Services; readonly language: Language };

/** Runs once per JS run: the checked environment, the adapters (no I/O) and the language. */
function decideStartup(): Startup {
  const services = createDeviceServices(readPublicEnvironment());
  return { services, language: resolveLanguage(null, getLocales()) };
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
