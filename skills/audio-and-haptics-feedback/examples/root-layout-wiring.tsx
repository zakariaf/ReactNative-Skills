// src/app/_layout.tsx (example: a shape to imitate, never copied)
// The root layout of a Tasks app with sound and haptic feedback wired in. Only the feedback lines are
// shown; the app's other providers (data, i18n, theme) stay where they are. The composition root
// (createDeviceServices) already creates the audio and haptics adapters: architecture-and-boundaries
// owns it, and the audio-engine reference lists the one line each port adds there.
import { reloadAppAsync } from 'expo';
import { useState } from 'react';

import { createRouteErrorBoundary } from '@/features/crash-recovery/create-route-error-boundary';
import { CrashFallback } from '@/features/crash-recovery/crash-fallback';
import { RootStack } from '@/features/root-navigator/root-stack';
import { TASKS_SOUNDS } from '@/features/tasks/sounds/tasks-sounds';
import { composeSoundBank } from '@/services/audio/compose-sound-bank';
import { useAudioLifecycle } from '@/services/audio/use-audio-lifecycle';
import { createDeviceServices } from '@/services/create-device-services';
import { ServicesProvider } from '@/services/services-context';

import type { Services } from '@/services/services-context';

export const ErrorBoundary = createRouteErrorBoundary({
  record: () => undefined,
  Fallback: CrashFallback,
  // audio-dispose-exempt: the root error boundary renders outside the services it would dispose.
  restart: () => reloadAppAsync('crash-recovery'),
});

/**
 * Once, in the first render's state initializer: never at module level (a reload re-runs modules).
 * With rtl-and-direction's DirectionGate (the root layout's first element, which may restart the JS
 * run before the app mounts), the root layout keeps only what the gate needs and the two feedback
 * lines move into AppRoot, the gate's child, so a restart run never creates an AudioContext:
 *   function AppRoot(props: { readonly services: Services }): React.JSX.Element {
 *     useState(() => { props.services.audio.load(composeSoundBank(TASKS_SOUNDS)); });
 *     useAudioLifecycle({ audio: props.services.audio, isInterrupted: false, reportError });
 *     ...
 *   }
 * DirectionRestart may still pass () => services.audio.dispose() as its beforeReload: before load it
 * closes nothing.
 */
function startApp(): Services {
  // With settings-and-preferences, the haptics gate comes first and the composition root hands its
  // isEnabled to the haptics adapter: createDeviceServices({ haptics: { isEnabled: gate.isEnabled } }).
  const services = createDeviceServices();
  // One composed bank: the UI sounds plus every feature's (and game's) bank.
  services.audio.load(composeSoundBank(TASKS_SOUNDS));
  return services;
}

export default function RootLayout(): React.JSX.Element {
  const [services] = useState(startApp);
  // Once for the whole app: suspended while the app is in the background or a full-screen video plays.
  useAudioLifecycle({
    audio: services.audio,
    isInterrupted: false,
    reportError: (error) => {
      services.errorLog.record('service', error);
    },
  });
  // The settings glue (settings-and-preferences) calls services.audio.applySettings(...) after the
  // store restores and on every change. A tap-sound app also renders, inside ServicesProvider:
  //   <PressFeedbackProvider playsSound onPress={() => { playUiFeedback(services, 'tap'); }}>
  // playsSound makes the canonical PressableSurface pass android_disableSound, so Android's system
  // click does not play on top of the tap sound.
  return (
    <ServicesProvider services={services}>
      <RootStack />
    </ServicesProvider>
  );
}

// A model that reloads the bundle (a language change) closes the engine first:
export async function restartForLanguage(services: Services): Promise<void> {
  await services.audio.dispose();
  await reloadAppAsync('language');
}

// With React Navigation's static API instead of Expo Router, the same lines live in the component
// that renders <Navigation /> (App.tsx): startApp in its useState initializer, useAudioLifecycle once.
