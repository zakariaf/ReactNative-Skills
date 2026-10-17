// src/app/oauth-redirect.tsx
// Where <scheme>://oauth-redirect lands when the router sees it (Android
// delivers the provider's redirect as a deep link too); without this route the not-found screen would
// flash. It renders nothing and leaves.
import { Redirect } from 'expo-router';

import { useOauthRedirect } from '@/features/oauth-redirect/use-oauth-redirect';

export default function OauthRedirectRoute(): React.JSX.Element | null {
  const canGoBack = useOauthRedirect();
  return canGoBack ? null : <Redirect href="/" />;
}
