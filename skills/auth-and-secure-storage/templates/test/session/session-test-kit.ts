// test/session/session-test-kit.ts
// A real SessionManager over the in-memory fakes, for tests of code that uses a session (screens,
// route guards, request helpers). Seed it signed in or signed out; drive the fakes it returns.
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeInstallMarker } from '@/services/install-marker/fake-install-marker';
import { createFakeOauth } from '@/services/oauth/fake-oauth';
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';
import { createSessionManager } from '@/services/session/session-manager';

import type { Account } from '@/core/session/token-set';
import type { FakeClock } from '@/services/clock/fake-clock';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';
import type { FakeOAuth } from '@/services/oauth/fake-oauth';
import type { FakeSecureStore } from '@/services/secure-storage/fake-secure-storage';
import type {
  ServerSignOutStep,
  SessionManager,
  SignOutStep,
} from '@/services/session/session-types';

/** The epoch ms the kit's fake clock starts at. */
export const TEST_NOW_MS = 1_700_000_000_000;
export const TEST_ACCOUNT: Account = { id: 'account-1', displayName: 'Robin' };

export type SessionTestKitOptions = {
  /** Start with a stored session for TEST_ACCOUNT (access-1 / refresh-1, valid for an hour). */
  readonly isSignedIn?: boolean;
  readonly signOutSteps?: readonly SignOutStep[];
  /** Server steps run before the wipe on signOut('user'), with the token. */
  readonly serverSignOutSteps?: readonly ServerSignOutStep[];
};

export type SessionTestKit = {
  readonly session: SessionManager;
  readonly secureStorage: FakeSecureStore;
  readonly oauth: FakeOAuth;
  readonly clock: FakeClock;
  readonly errorLog: FakeErrorLog;
};

export function createSessionTestKit({
  isSignedIn = false,
  signOutSteps = [],
  serverSignOutSteps = [],
}: SessionTestKitOptions = {}): SessionTestKit {
  const meta = JSON.stringify({
    version: 1,
    expiresAtMs: TEST_NOW_MS + 3_600_000,
    account: TEST_ACCOUNT,
  });
  const secureStorage = createFakeSecureStorage(
    isSignedIn
      ? {
          'auth.access-token': 'access-1',
          'auth.refresh-token': 'refresh-1',
          'auth.session-meta': meta,
        }
      : {},
  );
  const oauth = createFakeOauth();
  const clock = createFakeClock({ nowMs: TEST_NOW_MS, today: '2026-10-10' });
  const errorLog = createFakeErrorLog();
  const session = createSessionManager({
    secureStorage,
    installMarker: createFakeInstallMarker(),
    refresher: oauth,
    clock,
    errorLog,
    signOutSteps,
    serverSignOutSteps,
  });
  return { session, secureStorage, oauth, clock, errorLog };
}
