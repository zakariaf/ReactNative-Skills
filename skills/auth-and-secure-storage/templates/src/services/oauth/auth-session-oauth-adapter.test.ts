// src/services/oauth/auth-session-oauth-adapter.test.ts
// allow-fake-timers: the token calls run under withTimeout; one test moves its deadline clock.
// Drives the adapter against Jest's automock of expo-auth-session (read with a typed requireMock).
import {
  createAuthSessionOauthAdapter,
  OAUTH_TIMEOUT_MS,
  refreshFailureOf,
} from './auth-session-oauth-adapter';

jest.mock('expo-auth-session');

type PromptAnswer = { readonly type: string; readonly params: Record<string, string> };
type FakeRequest = {
  readonly codeVerifier: string;
  readonly promptAsync: jest.Mock<Promise<PromptAnswer>, [object, object]>;
};
type MockedAuthSession = {
  readonly AuthRequest: jest.Mock<FakeRequest, [Record<string, unknown>]>;
  readonly fetchDiscoveryAsync: jest.Mock<Promise<object>, [string]>;
  readonly exchangeCodeAsync: jest.Mock<Promise<object>, [Record<string, unknown>, object]>;
  readonly refreshAsync: jest.Mock<Promise<object>, [Record<string, unknown>, object]>;
  readonly revokeAsync: jest.Mock<Promise<boolean>, [Record<string, unknown>, object]>;
  readonly makeRedirectUri: jest.Mock<string, [Record<string, unknown>]>;
};

const authSession = jest.requireMock<MockedAuthSession>('expo-auth-session');
const DISCOVERY = { authorizationEndpoint: 'auth', tokenEndpoint: 'token' };
const CONFIG = {
  issuer: 'issuer',
  clientId: 'tasks-app',
  scheme: 'tasks',
  scopes: ['openid', 'offline_access'],
};

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function promptAnswers(answer: PromptAnswer): FakeRequest {
  const request = { codeVerifier: 'verifier-1', promptAsync: jest.fn().mockResolvedValue(answer) };
  authSession.AuthRequest.mockImplementationOnce(() => request);
  return request;
}

function answerDiscovery(): void {
  authSession.fetchDiscoveryAsync.mockResolvedValue(DISCOVERY);
  authSession.makeRedirectUri.mockReturnValue('tasks://oauth-redirect');
}

describe('createAuthSessionOauthAdapter sign-in', () => {
  beforeEach(answerDiscovery);

  it('runs the code flow with PKCE S256 in an ephemeral browser session', async () => {
    const request = promptAnswers({ type: 'success', params: { code: 'code-1' } });
    authSession.exchangeCodeAsync.mockResolvedValueOnce({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresIn: 3600,
    });

    const signedIn = await createAuthSessionOauthAdapter(CONFIG).signIn();

    expect(signedIn).toStrictEqual({
      ok: true,
      value: { accessToken: 'a1', refreshToken: 'r1', expiresInSeconds: 3600 },
    });
    expect(authSession.AuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({ responseType: 'code', usePKCE: true, codeChallengeMethod: 'S256' }),
    );
    expect(request.promptAsync).toHaveBeenCalledWith(DISCOVERY, { preferEphemeralSession: true });
    expect(authSession.makeRedirectUri).toHaveBeenCalledWith({
      scheme: 'tasks',
      path: 'oauth-redirect',
    });
    expect(authSession.AuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'tasks://oauth-redirect' }),
    );
    expect(authSession.exchangeCodeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1', extraParams: { code_verifier: 'verifier-1' } }),
      DISCOVERY,
    );
  });

  it('reports a closed browser as cancelled and a provider error as denied', async () => {
    const oauth = createAuthSessionOauthAdapter(CONFIG);
    promptAnswers({ type: 'cancel', params: {} });
    const cancelled = await oauth.signIn();
    promptAnswers({ type: 'error', params: { error: 'access_denied' } });
    const denied = await oauth.signIn();

    expect([cancelled, denied]).toStrictEqual([
      { ok: false, error: { kind: 'cancelled' } },
      { ok: false, error: { kind: 'denied', code: 'access_denied' } },
    ]);
  });

  it('tells a refused code exchange from a failed connection', async () => {
    const oauth = createAuthSessionOauthAdapter(CONFIG);
    promptAnswers({ type: 'success', params: { code: 'c' } });
    authSession.exchangeCodeAsync.mockRejectedValueOnce(codedError('invalid_grant'));
    const refused = await oauth.signIn();
    promptAnswers({ type: 'success', params: { code: 'c' } });
    authSession.exchangeCodeAsync.mockRejectedValueOnce(new Error('fetch failed: offline'));
    const offline = await oauth.signIn();

    expect([refused, offline]).toStrictEqual([
      { ok: false, error: { kind: 'denied', code: 'invalid_grant' } },
      { ok: false, error: { kind: 'network-unavailable' } },
    ]);
  });

  it('fetches discovery once, and again after a failed fetch', async () => {
    authSession.fetchDiscoveryAsync.mockReset();
    authSession.fetchDiscoveryAsync.mockRejectedValueOnce(new Error('offline'));
    authSession.fetchDiscoveryAsync.mockResolvedValue(DISCOVERY);
    authSession.refreshAsync.mockResolvedValue({ accessToken: 'a' });
    const oauth = createAuthSessionOauthAdapter(CONFIG);

    const first = await oauth.refresh('r');
    await oauth.refresh('r');
    await oauth.refresh('r');

    expect(first).toStrictEqual({ ok: false, error: { kind: 'network-unavailable' } });
    expect(authSession.fetchDiscoveryAsync).toHaveBeenCalledTimes(2);
  });
});

describe('createAuthSessionOauthAdapter refresh and revoke', () => {
  beforeEach(answerDiscovery);

  it('refreshes with the refresh grant and keeps only the fields the server sent', async () => {
    authSession.refreshAsync.mockResolvedValueOnce({ accessToken: 'a2', idToken: 'id-2' });

    const refreshed = await createAuthSessionOauthAdapter(CONFIG).refresh('r1');

    expect(refreshed).toStrictEqual({ ok: true, value: { accessToken: 'a2', idToken: 'id-2' } });
    expect(authSession.refreshAsync).toHaveBeenLastCalledWith(
      { clientId: 'tasks-app', refreshToken: 'r1' },
      DISCOVERY,
    );
  });

  it('gives up waiting after the deadline', async () => {
    jest.useFakeTimers();
    authSession.refreshAsync.mockReturnValueOnce(new Promise(() => undefined));
    const oauth = createAuthSessionOauthAdapter(CONFIG);

    const pending = oauth.refresh('r1');
    await jest.advanceTimersByTimeAsync(OAUTH_TIMEOUT_MS);

    await expect(pending).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timed-out', afterMs: OAUTH_TIMEOUT_MS },
    });
    jest.useRealTimers();
  });

  it('revokes the refresh token and reports a failure without throwing', async () => {
    const oauth = createAuthSessionOauthAdapter(CONFIG);
    authSession.revokeAsync.mockResolvedValueOnce(true);
    const revoked = await oauth.revoke('r1');
    authSession.revokeAsync.mockRejectedValueOnce(new Error('offline'));
    const failed = await oauth.revoke('r1');

    expect([revoked, failed]).toStrictEqual([
      { ok: true, value: undefined },
      { ok: false, error: { kind: 'network-unavailable' } },
    ]);
    expect(authSession.revokeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'r1', tokenTypeHint: 'refresh_token' }),
      DISCOVERY,
    );
  });
});

describe('refreshFailureOf', () => {
  it('ends the session only on a refused grant or client', () => {
    const failures = [
      codedError('invalid_grant'),
      codedError('invalid_client'),
      codedError('temporarily_unavailable'),
      codedError('server_error'),
      new Error('fetch failed'),
      new SyntaxError('Unexpected token <'),
      null,
    ].map(refreshFailureOf);

    expect(failures).toStrictEqual([
      { kind: 'invalid-grant' },
      { kind: 'rejected', code: 'invalid_client' },
      { kind: 'server-unavailable' },
      { kind: 'server-unavailable' },
      { kind: 'network-unavailable' },
      { kind: 'network-unavailable' },
      { kind: 'network-unavailable' },
    ]);
  });
});
