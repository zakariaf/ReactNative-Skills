// src/features/sign-in/use-sign-in-model.ts
// The only code of the sign-in feature that reads services
// and the session; the screen receives what it returns. Sign-in runs the provider's code flow, sends
// the provider's id token to the app's server (the session's one token issuer, so the session
// refreshes there whichever method signed in), and hands the server's tokens to the session, which
// stores them before it publishes "signed-in" (the root Stack then opens the app). A closed browser
// shows nothing. An app with no server and OAuth as its only sign-in skips the exchange: it passes
// grant.value and accountFromClaims(readIdTokenClaims(...)) and creates the session with the OAuth
// refresher.
import { useState } from 'react';

import { exchangeOauthIdToken, grantFromServerTokens } from '@/api/auth/auth-mutations';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useSessionManager } from '@/services/session/session-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

type Status = 'idle' | 'working' | 'failed';

/** What the sign-in screen renders. */
export type SignInModel = {
  readonly title: string;
  /** Translated; says "Signing in…" while the browser is open. */
  readonly continueLabel: string;
  /** Translated, or null while there is nothing to report (a cancelled sign-in reports nothing). */
  readonly errorText: string | null;
  readonly isWorking: boolean;
  readonly isReducedMotion: boolean;
  readonly onContinue: () => void;
};

export function useSignInModel(): SignInModel {
  const t = useT();
  // `api` is the plain ApiClient (networking-and-server-state): nobody is signed in yet.
  const { oauth, api, errorLog } = useServices();
  const session = useSessionManager();
  const isReducedMotion = useReduceMotion();
  const [status, setStatus] = useState<Status>('idle');
  const signIn = async (): Promise<Status> => {
    const grant = await oauth.signIn();
    if (!grant.ok) return grant.error.kind === 'cancelled' ? 'idle' : 'failed';
    const { idToken } = grant.value;
    if (idToken === undefined) {
      errorLog.record('service', new Error('sign-in: the provider sent no id token'));
      return 'failed';
    }
    const answer = await exchangeOauthIdToken(api, idToken);
    if (!answer.ok) return 'failed';
    const signedIn = await session.signIn({
      grant: grantFromServerTokens(answer.value),
      account: answer.value.account,
    });
    return signedIn.ok ? 'idle' : 'failed';
  };
  return {
    title: t('sign-in.title'),
    continueLabel: t(status === 'working' ? 'sign-in.working' : 'sign-in.continue'),
    errorText: status === 'failed' ? t('sign-in.failed') : null,
    isWorking: status === 'working',
    isReducedMotion,
    onContinue: () => {
      if (status === 'working') return;
      setStatus('working');
      signIn()
        .then(setStatus)
        .catch((error: unknown) => {
          errorLog.record('service', error);
          setStatus('failed');
        });
    },
  };
}
