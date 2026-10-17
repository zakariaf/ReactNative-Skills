// src/features/root-navigator/app-stack.tsx
// Device-only: covered by the app launch on a device (it only composes the tested guards, useScreenAnimation and the router's Stack)
// The root Stack, guarded by the session. The splash is not this file's business: app-startup-and-bootstrap
// holds it once in hold-splash.ts and releases it once in AppRoot (useStartupReady), after the startup
// gate's blocking task restoreSessionTask settled or its deadline passed. So the Stack always renders
// (never null): with the restore finished, exactly one of the signed-in group and the signed-out routes
// is open; when the restore missed the deadline (status restoring, or unavailable for a keychain
// locked since the restart) only the "checking your session" route is open, and the guards move on
// when the session settles. "(app)" has its own _layout.tsx, so the guard covers every screen inside
// it, deep links included; a guard that turns false drops that group's history. The animation comes
// from useScreenAnimation() (a cross-fade while motion is reduced).
import { Stack } from 'expo-router';

import { useSessionSnapshot } from '@/services/session/session-context';
import { sessionGuards } from '@/services/session/session-guards';
import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

export function AppStack(): React.JSX.Element {
  const animation = useScreenAnimation();
  const guards = sessionGuards(useSessionSnapshot());
  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Protected guard={guards.isRestoring}>
        <Stack.Screen name="checking-session" />
      </Stack.Protected>
      <Stack.Protected guard={guards.isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={guards.isSignedOut}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="oauth-redirect" />
    </Stack>
  );
}
