// src/services/session/send-with-session.test.ts
import { err, ok } from '@/core/result';
import { createSessionTestKit } from '@test/session/session-test-kit';

import { sendWithSession, sessionHeaders } from './send-with-session';

import type { Result } from '@/core/result';

type Failure = { readonly kind: 'unauthorized' } | { readonly kind: 'not-found' };

/** A request that answers in turn from `answers` and records the Authorization header it sent. */
function scripted(
  headers: () => Promise<Readonly<Record<string, string>>>,
  answers: readonly Result<string, Failure>[],
) {
  const sent: (string | undefined)[] = [];
  const queue = [...answers];
  const send = async (): Promise<Result<string, Failure>> => {
    sent.push((await headers())['Authorization']);
    return queue.shift() ?? err({ kind: 'not-found' });
  };
  return { send, sent };
}

async function signedInKit() {
  const kit = createSessionTestKit({ isSignedIn: true });
  await kit.session.restore();
  return kit;
}

describe('sendWithSession', () => {
  it('sends once with the current token when the server accepts it', async () => {
    const { session } = await signedInKit();
    const request = scripted(sessionHeaders(session), [ok('tasks')]);

    await expect(sendWithSession(session, request.send)).resolves.toStrictEqual(ok('tasks'));
    expect(request.sent).toStrictEqual(['Bearer access-1']);
  });

  it('renews the rejected token once and sends again after a 401', async () => {
    const { session, oauth } = await signedInKit();
    oauth.answerRefresh(ok({ accessToken: 'access-2' }));
    const request = scripted(sessionHeaders(session), [err({ kind: 'unauthorized' }), ok('tasks')]);

    await expect(sendWithSession(session, request.send)).resolves.toStrictEqual(ok('tasks'));
    expect(request.sent).toStrictEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('signs out after a second 401', async () => {
    const { session, oauth } = await signedInKit();
    oauth.answerRefresh(ok({ accessToken: 'access-2' }));
    const request = scripted(sessionHeaders(session), [
      err({ kind: 'unauthorized' }),
      err({ kind: 'unauthorized' }),
    ]);

    await expect(sendWithSession(session, request.send)).resolves.toStrictEqual(
      err({ kind: 'unauthorized' }),
    );
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-out', reason: 'unauthorized' });
  });

  it('passes other failures through and sends nothing while signed out', async () => {
    const { session } = await signedInKit();
    const missing = scripted(sessionHeaders(session), [err({ kind: 'not-found' })]);
    const notFound = await sendWithSession(session, missing.send);
    await session.signOut('user');
    const later = scripted(sessionHeaders(session), [ok('tasks')]);
    const signedOut = await sendWithSession(session, later.send);

    expect([notFound, signedOut]).toStrictEqual([
      err({ kind: 'not-found' }),
      err({ kind: 'signed-out' }),
    ]);
    expect(later.sent).toStrictEqual([]);
  });
});

describe('sessionHeaders', () => {
  it('sends no Authorization header while signed out', async () => {
    const { session } = createSessionTestKit();
    await session.restore();

    await expect(sessionHeaders(session)()).resolves.toStrictEqual({});
    expect(session.getSnapshot()).toStrictEqual({ status: 'signed-out', reason: null });
  });
});
