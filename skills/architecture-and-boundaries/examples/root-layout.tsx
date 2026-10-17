// src/app/_layout.tsx (a shape to imitate, not a template)
// The root layout mounts the composition root once. createDeviceServices runs in a state initializer,
// so a re-render never creates a second set of adapters, and nothing runs at import time.
// Startup order around it (polyfills, storage, hydration, splash) belongs to app-startup-and-bootstrap;
// the data layer and the stores join the same initializer (persistence-and-migrations,
// state-management-zustand: createStores over the repositories, inside ServicesProvider).
import { Stack } from 'expo-router';
import { useState } from 'react';

import { createDeviceServices } from '@/services/create-device-services';
import { ServicesProvider } from '@/services/services-context';

import type { JSX } from 'react';

export default function RootLayout(): JSX.Element {
  const [services] = useState(createDeviceServices);
  return (
    <ServicesProvider services={services}>
      <Stack />
    </ServicesProvider>
  );
}
