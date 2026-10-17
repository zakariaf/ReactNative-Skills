// src/services/oauth/fake-oauth.test.ts
import { err, ok } from '@/core/result';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakeOauth } from './fake-oauth';

describe('createFakeOauth', () => {
  it('answers sign-in and refresh in the order they were scripted, and logs the calls', async () => {
    const oauth = createFakeOauth();
    oauth.answerSignIn(ok({ accessToken: 'a1', refreshToken: 'r1' }));
    oauth.answerRefresh(err({ kind: 'invalid-grant' }));

    const signedIn = await oauth.signIn();
    const refreshed = await oauth.refresh('r1');
    const revoked = await oauth.revoke('r1');

    expect([signedIn, refreshed, revoked]).toStrictEqual([
      { ok: true, value: { accessToken: 'a1', refreshToken: 'r1' } },
      { ok: false, error: { kind: 'invalid-grant' } },
      { ok: true, value: undefined },
    ]);
    expect(oauth.calls).toStrictEqual([
      { method: 'sign-in' },
      { method: 'refresh', refreshToken: 'r1' },
      { method: 'revoke', refreshToken: 'r1' },
    ]);
  });

  it('holds a deferred refresh until it is answered', async () => {
    const oauth = createFakeOauth();
    const answer = oauth.deferRefresh();
    let settled: unknown = null;

    const pending = oauth.refresh('r1').then((result) => {
      settled = result;
    });
    await flushMicrotasks();
    const before = settled;
    answer(ok({ accessToken: 'a2' }));
    await pending;

    expect([before, settled]).toStrictEqual([null, { ok: true, value: { accessToken: 'a2' } }]);
  });

  it('rejects an unscripted sign-in or refresh, and revokes as told', async () => {
    const oauth = createFakeOauth();
    oauth.answerRevoke(err({ kind: 'network-unavailable' }));

    await expect(oauth.signIn()).rejects.toThrow('no sign-in answer');
    await expect(oauth.refresh('r')).rejects.toThrow('no refresh answer');
    await expect(oauth.revoke('r')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'network-unavailable' },
    });
  });
});
