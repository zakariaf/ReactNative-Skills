// src/services/push/push-opt-in.test.ts
import { createFakePush } from './fake-push';
import { optInToPush } from './push-opt-in';

import type { PushPermission } from './push-port';

const CHANNELS = [
  { id: 'general', name: 'General', description: 'News', importance: 'default' },
] as const;

function setup(permission: PushPermission, promptAnswer?: PushPermission) {
  const push = createFakePush({
    permission,
    ...(promptAnswer === undefined ? {} : { promptAnswer }),
  });
  const synced: (string | null)[] = [];
  const registration = {
    sync: (accountId: string | null) => {
      synced.push(accountId);
      return Promise.resolve('register' as const);
    },
  };
  return { push, synced, deps: { push, registration, channels: CHANNELS } };
}

describe('optInToPush', () => {
  it('creates the channels before the prompt, then registers', async () => {
    const { push, synced, deps } = setup('undetermined');
    expect(await optInToPush(deps, 'acc-1')).toBe('enabled');
    expect(push.calls).toStrictEqual(['syncChannels', 'permission', 'requestPermission']);
    expect(push.channels()).toStrictEqual(CHANNELS);
    expect(synced).toStrictEqual(['acc-1']);
  });

  it('does not prompt when already granted', async () => {
    const { push, deps } = setup('granted');
    expect(await optInToPush(deps, null)).toBe('enabled');
    expect(push.calls).not.toContain('requestPermission');
  });

  it('asks for full alerts when iOS delivers only provisionally', async () => {
    const { push, deps } = setup('provisional', 'granted');
    expect(await optInToPush(deps, null)).toBe('enabled');
    expect(push.calls).toContain('requestPermission');
  });

  it('reports a refusal of the full prompt after provisional delivery', async () => {
    const { synced, deps } = setup('provisional', 'denied');
    expect(await optInToPush(deps, 'acc-1')).toBe('declined');
    expect(synced).toStrictEqual([]);
  });

  it('reports a refusal and registers nothing', async () => {
    const { synced, deps } = setup('undetermined', 'denied');
    expect(await optInToPush(deps, 'acc-1')).toBe('declined');
    expect(synced).toStrictEqual([]);
  });

  it('reports blocked without prompting, so the caller offers Settings', async () => {
    const { push, deps } = setup('blocked');
    expect(await optInToPush(deps, 'acc-1')).toBe('blocked');
    expect(push.calls).not.toContain('requestPermission');
  });

  it('reports blocked when the prompt answer can never be asked again', async () => {
    const { deps } = setup('denied', 'blocked');
    expect(await optInToPush(deps, 'acc-1')).toBe('blocked');
  });
});
