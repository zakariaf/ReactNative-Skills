// src/app/_layout.tsx
import { Stack } from 'expo-router';
import { useState } from 'react';

import { createDeviceServices } from '@/services/create-device-services';
import { ServicesProvider } from '@/services/services-context';
import { markJsEntry } from '@/services/perf/cold-start-marks';

import type { JSX } from 'react';

/** The startup decision: adapters only, no I/O; the JS entry mark of the launch. */
function decideStartup() {
  const services = createDeviceServices();
  markJsEntry(services.perf.epochMs());
  return services;
}

export default function RootLayout(): JSX.Element {
  const [services] = useState(decideStartup);
  return (
    <ServicesProvider services={services}>
      <Stack />
    </ServicesProvider>
  );
}
