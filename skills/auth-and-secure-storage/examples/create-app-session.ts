// src/features/root-navigator/create-app-session.ts
// Creates the app's one SessionManager from the composition root's ports, with every sign-out step
// the app needs besides the token wipe. contracts/auth.json lists the step names and check-auth finds
// each one here: a cache that is not on this list keeps the last person's data after sign-out.
// AppRoot calls it once, in a useState initializer, and hands the session to RootStack.
// One session, one token issuer: the refresher is the app's server, because every sign-in method
// (OAuth's id token, Apple's credential) is exchanged there for the server's tokens. An app with no
// server and OAuth as its only sign-in passes `refresher: services.oauth` instead, never both.
import { createServerRefresher } from '@/api/auth/server-refresher';
import { createSessionManager } from '@/services/session/session-manager';
import { queryCacheStep, storeResetStep } from '@/services/session/sign-out-step-factories';

import type { Services } from '@/services/services-context';
import type { SessionManager } from '@/services/session/session-types';
import type { ClearableQueryCache } from '@/services/session/sign-out-step-factories';

/** What the person's data lives in besides the secure store (cleared in this order). */
export type AccountData = {
  /** The app's TanStack Query client (networking-and-server-state). */
  readonly queryCache: ClearableQueryCache;
  /** Puts the per-account store back to its initial state (state-management-zustand). */
  readonly resetAccountStore: () => void;
};

export function createAppSession(services: Services, data: AccountData): SessionManager {
  return createSessionManager({
    secureStorage: services.secureStorage,
    installMarker: services.installMarker,
    refresher: createServerRefresher(services.api),
    clock: services.clock,
    errorLog: services.errorLog,
    signOutSteps: [
      queryCacheStep(data.queryCache),
      storeResetStep('account-store', data.resetAccountStore),
    ],
    // Calls that need the still-valid session run first, on signOut('user'), under one deadline:
    // pushRegistrationStep(services.pushRegistration) (push-notifications; services.signedInApi)
    serverSignOutSteps: [],
  });
}
