// src/app/_layout.tsx (shape only): the canonical root layout of a Tasks app with the settings wired
// in. app-startup-and-bootstrap owns the order, the error net import and the splash hold; only two
// things change. decideStartup creates the haptics gate before the composition root, because the
// haptics adapter asks gate.isEnabled at every pulse (it answers false until AppRoot connects the
// settings store). And the saved language decides the first render: readSavedLanguage reads the one
// settings value through the kv adapter (no store, no database), so rtl-and-direction's DirectionGate
// restarts for the saved direction before anything opens. AppRoot (app-root.tsx) opens the store.
import '@/services/error-net/install-error-net';
import '@/features/root-navigator/hold-splash';

import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import { useState } from 'react';

import { CrashFallback } from '@/features/crash-recovery/crash-fallback';
import { createRouteErrorBoundary } from '@/features/crash-recovery/create-route-error-boundary';
import { AppRoot } from '@/features/root-navigator/app-root';
import { createHapticsGate } from '@/features/settings-effects/haptics-gate';
import { readSavedLanguage } from '@/features/settings-effects/read-saved-language';
import { DirectionGate } from '@/i18n/direction-gate';
import { resolveLanguage } from '@/i18n/resolve-language';
import { createDeviceServices } from '@/services/create-device-services';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { createKvSettingsStorageAdapter } from '@/services/settings-storage/kv-settings-storage-adapter';

import type { HapticsGate } from '@/features/settings-effects/haptics-gate';
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

type Startup = {
  readonly services: Services;
  readonly language: Language;
  readonly hapticsGate: HapticsGate;
};

/** Once per JS run: the gate, the adapters (no I/O beyond one kv read) and the saved language. */
function decideStartup(): Startup {
  // architecture-and-boundaries ships createDeviceServices() with no parameters; this app extended
  // its own copy with the option it hands on to audio-and-haptics-feedback's
  // createExpoHapticsAdapter({ isEnabled, nowMs }). Keep the adapter's own name, isEnabled.
  const hapticsGate = createHapticsGate();
  const services = createDeviceServices({ haptics: { isEnabled: hapticsGate.isEnabled } });
  const saved = readSavedLanguage(createKvSettingsStorageAdapter(services.errorLog));
  return { services, language: resolveLanguage(saved, getLocales()), hapticsGate };
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
      <AppRoot services={startup.services} hapticsGate={startup.hapticsGate} />
    </DirectionGate>
  );
}
