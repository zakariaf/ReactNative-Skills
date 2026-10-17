// src/app/_layout.tsx: the root layout mounts the composition root once.
import { Stack } from 'expo-router';
import { useState } from 'react';

import { createDeviceServices } from '@/services/create-device-services';
import { ServicesProvider } from '@/services/services-context';

export default function RootLayout() {
  const [services] = useState(createDeviceServices);
  return (
    <ServicesProvider services={services}>
      <Stack />
    </ServicesProvider>
  );
}
