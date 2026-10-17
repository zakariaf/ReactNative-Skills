// src/features/oauth-redirect/use-oauth-redirect.ts
// What the oauth-redirect route does. On Android
// the provider's redirect (<scheme>://oauth-redirect?code=...) also reaches Expo Router as a deep link
// while expo-auth-session reads it from the Custom Tab; the route shows nothing and steps back to the
// screen that started sign-in. The code itself is never read here: the auth session owns it.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

/** True when there is a screen to go back to; otherwise the route redirects to the start. */
export function useOauthRedirect(): boolean {
  const router = useRouter();
  const canGoBack = router.canGoBack();
  useEffect(() => {
    if (canGoBack) router.back();
  }, [canGoBack, router]);
  return canGoBack;
}
