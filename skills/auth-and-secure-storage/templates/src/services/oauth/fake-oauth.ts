// src/services/oauth/fake-oauth.ts
// Scripted OauthPort for tests: queue the answers sign-in and refresh give, hold a refresh open to
// test concurrent callers, and read back every call. An unscripted sign-in or refresh rejects, so a
// test never passes on an answer it did not choose. Revoke answers ok unless told otherwise.
import { ok } from '@/core/result';

import type { OauthFailure, OauthPort } from './oauth-port';
import type { Result } from '@/core/result';
import type { RefreshFailure, TokenGrant } from '@/core/session/token-set';

export type FakeOauthCall =
  | { readonly method: 'sign-in' }
  | { readonly method: 'refresh' | 'revoke'; readonly refreshToken: string };

type RefreshAnswer = Result<TokenGrant, RefreshFailure>;

export type FakeOAuth = OauthPort & {
  readonly calls: readonly FakeOauthCall[];
  readonly answerSignIn: (answer: Result<TokenGrant, OauthFailure>) => void;
  readonly answerRefresh: (answer: RefreshAnswer) => void;
  /** The next refresh waits until the returned function is called with its answer. */
  readonly deferRefresh: () => (answer: RefreshAnswer) => void;
  readonly answerRevoke: (answer: Result<void, OauthFailure>) => void;
};

function unscripted(method: string): Promise<never> {
  return Promise.reject(new Error(`fake OAuth: no ${method} answer was scripted`));
}

export function createFakeOauth(): FakeOAuth {
  const calls: FakeOauthCall[] = [];
  const signIns: Result<TokenGrant, OauthFailure>[] = [];
  const refreshes: Promise<RefreshAnswer>[] = [];
  let revokeAnswer: Result<void, OauthFailure> = ok(undefined);
  return {
    calls,
    answerSignIn: (answer) => signIns.push(answer),
    answerRefresh: (answer) => refreshes.push(Promise.resolve(answer)),
    deferRefresh: () => {
      let answer: (value: RefreshAnswer) => void = () => undefined;
      refreshes.push(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      return (value) => {
        answer(value);
      };
    },
    answerRevoke: (answer) => {
      revokeAnswer = answer;
    },
    signIn: () => {
      calls.push({ method: 'sign-in' });
      const answer = signIns.shift();
      return answer === undefined ? unscripted('sign-in') : Promise.resolve(answer);
    },
    refresh: (refreshToken) => {
      calls.push({ method: 'refresh', refreshToken });
      return refreshes.shift() ?? unscripted('refresh');
    },
    revoke: (refreshToken) => {
      calls.push({ method: 'revoke', refreshToken });
      return Promise.resolve(revokeAnswer);
    },
  };
}
