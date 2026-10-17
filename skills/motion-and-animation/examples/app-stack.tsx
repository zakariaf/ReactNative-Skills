// src/features/root-navigator/app-stack.tsx
// Example (a shape to imitate): the root Stack, rendered by examples/root-stack.tsx BELOW
// <MotionConfig>. Native stack transitions are not Reanimated animations, so every Stack takes its
// animation from useScreenAnimation(): a cross-fade instead of a slide while motion is reduced.
// It is a component of its own (and, under react/no-multi-comp, a file of its own) because React
// context flows down only: called in the component that renders <MotionConfig>, the hook would
// read the context from above the provider (the 'system' default) and ignore the in-app setting.
// The moment catalog lists this file under screenPush.files (it cannot take timingOf(...)).
import { Stack } from 'expo-router';

import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

export function AppStack(): React.JSX.Element {
  const animation = useScreenAnimation();
  const sheetAnimation = useScreenAnimation('slide_from_bottom');
  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Screen name="task-sheet" options={{ presentation: 'modal', animation: sheetAnimation }} />
    </Stack>
  );
}
