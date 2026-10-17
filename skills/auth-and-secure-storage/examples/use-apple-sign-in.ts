// src/features/sign-in/use-apple-sign-in.ts
// Shape (it builds on networking-and-server-state): the Apple half of the sign-in model. Apple's
// credential goes to the app's server (exchangeAppleCredential), which verifies the identity token
// (Apple's keys, aud = the bundle id, nonce = SHA-256 of rawNonce), stores the name and email Apple
// sends only on the first sign-in, keeps Apple's refresh token for revocation at account deletion, and
// answers with the app's own tokens. The session stores those before it publishes "signed-in" and
// later refreshes them at the same server (server-refresher.ts): one session, one token issuer. No
// useMutation here: its cache would keep the credential and the tokens after the call.
import { useEffect, useState } from 'react';

import { exchangeAppleCredential, grantFromServerTokens } from '@/api/auth/auth-mutations';
import { useServices } from '@/services/services-context';
import { useSessionManager } from '@/services/session/session-context';

import type { ApiClient } from '@/api/api-client';
import type { AppleSignInPort } from '@/services/apple-sign-in/apple-sign-in-port';

type Outcome = 'signed-in' | 'cancelled' | 'failed';

export type AppleSignIn = {
  /** False on Android, web and old iOS: the screen leaves the Apple button out. */
  readonly isAvailable: boolean;
  readonly Button: AppleSignInPort['Button'];
  /** Runs the whole flow; resolves with how it ended (never rejects). */
  readonly signIn: () => Promise<Outcome>;
};

/** `api` is the plain ApiClient (not the authorized one: nobody is signed in yet). */
export function useAppleSignIn(api: ApiClient): AppleSignIn {
  const { appleSignIn, errorLog } = useServices();
  const session = useSessionManager();
  const [isAvailable, setIsAvailable] = useState(false);
  useEffect(() => {
    let isActive = true;
    appleSignIn
      .isAvailable()
      .then((isNativeAvailable) => {
        if (isActive) setIsAvailable(isNativeAvailable);
      })
      .catch((error: unknown) => {
        errorLog.record('service', error);
      });
    return () => {
      isActive = false;
    };
  }, [appleSignIn, errorLog]);
  const signIn = async (): Promise<Outcome> => {
    const credential = await appleSignIn.signIn();
    if (!credential.ok) return credential.error.kind === 'cancelled' ? 'cancelled' : 'failed';
    const answer = await exchangeAppleCredential(api, credential.value);
    if (!answer.ok) return 'failed';
    const grant = grantFromServerTokens(answer.value);
    const signedIn = await session.signIn({ grant, account: answer.value.account });
    return signedIn.ok ? 'signed-in' : 'failed';
  };
  return { isAvailable, Button: appleSignIn.Button, signIn };
}
