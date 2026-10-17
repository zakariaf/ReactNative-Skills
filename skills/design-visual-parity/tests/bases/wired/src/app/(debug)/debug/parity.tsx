// src/app/(debug)/debug/parity.tsx
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { TEST_ONLY } from '@/test-only';

import type { ReactNode } from 'react';

export default function ParityLaunchRoute(): ReactNode {
  const params = useLocalSearchParams();
  const ParityLaunchScreen = TEST_ONLY?.ParityLaunchScreen;
  if (ParityLaunchScreen === undefined) return <Redirect href="/" />;
  return <ParityLaunchScreen params={params} navigate={(href) => router.replace(href)} />;
}
