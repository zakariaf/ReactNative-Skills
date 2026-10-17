// src/features/root-navigator/app-stack.tsx: the root Stack and the flows it guards.
import { Stack } from 'expo-router';

import { isTestBuild } from '@/features/debug/test-build';
import { useIsSignedIn } from '@/stores/session/session-selectors';

export function AppStack(): React.JSX.Element {
  const isSignedIn = useIsSignedIn();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={isTestBuild}>
        <Stack.Screen name="debug" />
      </Stack.Protected>
    </Stack>
  );
}
