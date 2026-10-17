// src/features/root-navigator/app-stack.tsx
// device-only: covered by the app launch on a device (it only composes the tested useScreenAnimation, kitsOpenDebugRoutes, RootKits and the router's Stack)
// The root Stack, the innermost piece of the canonical root (app-startup-and-bootstrap). Native stack
// transitions are not Reanimated animations, so the Stack takes its animation from
// useScreenAnimation(): a cross-fade instead of a slide while motion is reduced. It is a component of
// its own (and, under react/no-multi-comp, a file of its own) because React context flows down only:
// called in RootStack, which renders RootMotion (the app's MotionConfig), the hook would read the
// context from above the provider and ignore the in-app preference. The root route groups and their
// Stack.Protected guards go inside this Stack (navigation-and-routing). One guard is the skeleton's
// own: the test-build group `(debug)` (debug-menu-and-test-hooks) is registered only while a kit
// opens it (opensDebugRoutes), and only a test build's registry creates such a kit, so a production
// build never registers it (a production link to /debug lands on the first screen). With no such kit
// the guard is false, and Expo Router ignores a protected name the app has no route for. Around the
// Stack sits RootKits, the slot of the optional kits the app's registry creates
// (src/services/create-root-kits.ts): their providers wrap the Stack and their effect components
// (tap routers, consent appliers, screen views) mount beside it, below the navigator and after the
// splash release; a kit never edits this file. The moment catalog lists this file under
// screenPush.files.
import { Stack } from 'expo-router';

import { kitsOpenDebugRoutes } from '@/services/root-kits/root-kit';
import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

import { RootKits } from './root-kits';

import type { RootKit } from '@/services/root-kits/root-kit';

export type AppStackProps = {
  /** The kits AppRoot's startApp created (none: RootKits renders the Stack alone). */
  readonly kits: readonly RootKit[];
};

export function AppStack({ kits }: AppStackProps): React.JSX.Element {
  const animation = useScreenAnimation();
  const isTestBuild = kitsOpenDebugRoutes(kits);
  return (
    <RootKits kits={kits}>
      <Stack screenOptions={{ headerShown: false, animation }}>
        <Stack.Protected guard={isTestBuild}>
          <Stack.Screen name="(debug)" />
        </Stack.Protected>
      </Stack>
    </RootKits>
  );
}
