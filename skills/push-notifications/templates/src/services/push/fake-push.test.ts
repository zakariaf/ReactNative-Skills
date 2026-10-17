// src/services/push/fake-push.test.ts
import { err } from '@/core/result';

import { createFakePush, FAKE_PUSH_TOKEN } from './fake-push';

const TAP = { id: 'n1', action: 'open', data: { kind: 'announcement' } };

describe('createFakePush', () => {
  it('answers the prompt and then issues its token', async () => {
    const push = createFakePush();
    expect(await push.token()).toStrictEqual(err({ kind: 'not-allowed' }));
    expect(await push.requestPermission()).toBe('granted');
    expect(await push.token()).toStrictEqual({ ok: true, value: FAKE_PUSH_TOKEN });
  });

  it('keeps a blocked permission blocked', async () => {
    const push = createFakePush({ permission: 'blocked' });
    expect(await push.requestPermission()).toBe('blocked');
  });

  it('keeps the channels and the order of calls', async () => {
    const push = createFakePush();
    const channel = {
      id: 'general',
      name: 'General',
      description: '',
      importance: 'default',
    } as const;
    await push.syncChannels([channel]);
    await push.permission();
    expect(push.channels()).toStrictEqual([channel]);
    expect(push.calls).toStrictEqual(['syncChannels', 'permission']);
  });

  it('tells token listeners until they unsubscribe', () => {
    const push = createFakePush();
    const seen: string[] = [];
    const stop = push.onTokenChange((token) => seen.push(token.value));
    push.rotateToken({ ...FAKE_PUSH_TOKEN, value: 'a' });
    stop();
    push.rotateToken({ ...FAKE_PUSH_TOKEN, value: 'b' });
    expect(seen).toStrictEqual(['a']);
  });

  it('delivers taps, remembers the last one until cleared', () => {
    const push = createFakePush({ lastResponse: TAP });
    const seen: string[] = [];
    const stop = push.onResponse((response) => seen.push(response.id));
    push.tap({ ...TAP, id: 'n2' });
    stop();
    push.tap({ ...TAP, id: 'n3' });
    expect(seen).toStrictEqual(['n2']);
    expect(push.lastResponse()?.id).toBe('n3');
    push.clearLastResponse();
    expect(push.lastResponse()).toBeNull();
  });

  it('can be given a failing token', async () => {
    const push = createFakePush({ permission: 'granted' });
    push.setToken(err({ kind: 'network-unavailable' }));
    expect(await push.token()).toStrictEqual(err({ kind: 'network-unavailable' }));
    push.setPermission('denied');
    expect(await push.token()).toStrictEqual(err({ kind: 'not-allowed' }));
  });
});
