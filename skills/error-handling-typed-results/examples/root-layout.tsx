// src/app/_layout.tsx (example: a shape to imitate, never copied)
// Only the error-net lines of the root layout. app-startup-and-bootstrap owns the full startup order
// (polyfills, config, storage, i18n, theme, providers). The installer is the first app import:
// imports are evaluated in order and before this file's body, so every module below is covered,
// even one that throws while loading. The composition root connects the error log before any
// provider renders, so a render error anywhere below it, the layout's providers included, is kept.
import '@/services/error-net/install-error-net';

import { reloadAppAsync } from 'expo';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { CrashFallback } from '@/features/crash-recovery/crash-fallback';
import { createRouteErrorBoundary } from '@/features/crash-recovery/create-route-error-boundary';
import { createDeviceServices } from '@/services/create-device-services';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { connectErrorLog } from '@/services/error-net/connect-error-log';
import { ServicesProvider } from '@/services/services-context';

import type { Services } from '@/services/services-context';

/** Expo Router wraps this layout (so the whole app) in a boundary that renders this on a render error. */
export const ErrorBoundary = createRouteErrorBoundary({
  record: (error) => {
    appErrorNet.report({ source: 'render', error, isFatal: false });
  },
  Fallback: CrashFallback,
  // The root fallback replaces the whole navigator: reloading the bundle is the dependable way out.
  // The record above ran when the fallback mounted and the sink writes synchronously, so the entry
  // is committed before the user can press the button.
  restart: () => reloadAppAsync('crash-recovery'),
});

/**
 * The composition root (architecture-and-boundaries' createDeviceServices), then the error log:
 * the reports the net buffered since the installer ran flush into it, oldest first.
 */
function startServices(): Services {
  const services = createDeviceServices();
  connectErrorLog(appErrorNet, services.errorLog);
  return services;
}

export default function RootLayout(): React.JSX.Element {
  // A useState initializer runs once, in the first render, before any provider below renders.
  const [services] = useState(startServices);
  return (
    <ServicesProvider services={services}>
      <Stack />
    </ServicesProvider>
  );
}
