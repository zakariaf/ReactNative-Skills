// src/features/root-navigator/create-app-session.ts
// The session with the push registration removed at sign-out (auth-and-secure-storage). The step
// runs in the server phase, before the token wipe, with the still-valid access token and one shared
// deadline (ServerSignOutContext); contracts/auth.json lists it:
// "serverSignOutSteps": ["push-registration"]. As a local step it would run signed out and fail
// silently, and the next person on this phone would get this person's notifications. Right after
// the session exists it is attached to push.signedInApi, the client the push registrar signs its
// calls with (the push parts exist before the session, examples/create-app-push.ts, so the
// registration cannot take the session itself). startApp calls this after createAppPush and passes
// both to the root-kit registry.
import { createServerRefresher } from '@/api/auth/server-refresher';
import { pushRegistrationStep } from '@/services/push/push-registration';
import { createSessionManager } from '@/services/session/session-manager';
import { queryCacheStep } from '@/services/session/sign-out-step-factories';

import type { AppPush } from '@/services/push/create-app-push';
import type { Services } from '@/services/services-context';
import type { SessionManager } from '@/services/session/session-types';
import type { ClearableQueryCache } from '@/services/session/sign-out-step-factories';

export function createAppSession(
  services: Services,
  push: AppPush,
  queryCache: ClearableQueryCache,
): SessionManager {
  const session = createSessionManager({
    secureStorage: services.secureStorage,
    installMarker: services.installMarker,
    // The refresher talks to the token endpoint over the plain client (it sends its own refresh token).
    refresher: createServerRefresher(services.api),
    clock: services.clock,
    errorLog: services.errorLog,
    signOutSteps: [queryCacheStep(queryCache)],
    serverSignOutSteps: [pushRegistrationStep(push.registration)],
  });
  push.signedInApi.attach(session);
  return session;
}
