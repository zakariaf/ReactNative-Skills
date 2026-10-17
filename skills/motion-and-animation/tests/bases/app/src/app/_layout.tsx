// src/app/_layout.tsx: the root layout. Expo Router reads its default export.
import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { MotionConfig } from '@/ui/a11y/motion-config';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';
import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

function reportError(error: unknown): void {
  console.warn(error);
}

function RootStack(): React.JSX.Element {
  const animation = useScreenAnimation();
  const sheetAnimation = useScreenAnimation('slide_from_bottom');
  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Screen name="task-sheet" options={{ animation: sheetAnimation }} />
    </Stack>
  );
}

export default function RootLayout(): React.JSX.Element {
  useEffect(() => watchSystemA11y(reportError), []);
  return (
    <MotionConfig preference="system">
      <RootStack />
    </MotionConfig>
  );
}
