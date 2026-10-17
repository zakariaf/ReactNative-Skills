// src/services/updates/fake-updates.test.ts
import { err, ok } from '@/core/result';

import { EMBEDDED_LAUNCH, createFakeUpdates } from './fake-updates';

describe('createFakeUpdates', () => {
  it('runs the embedded bundle with nothing new by default', async () => {
    const updates = createFakeUpdates();
    expect(updates.running()).toStrictEqual(EMBEDDED_LAUNCH);
    await expect(updates.check()).resolves.toStrictEqual(ok('none'));
    await expect(updates.download()).resolves.toStrictEqual(ok('nothing-new'));
    await expect(updates.apply()).resolves.toStrictEqual(ok(undefined));
  });

  it('overrides the running update and the scripted answers', async () => {
    const updates = createFakeUpdates(
      { isEmergencyLaunch: true, emergencyLaunchReason: 'crashed' },
      { check: ok('new-update') },
    );
    expect(updates.running().isEmergencyLaunch).toBe(true);
    await expect(updates.check()).resolves.toStrictEqual(ok('new-update'));
    updates.answer({ download: err({ kind: 'download-failed', message: 'offline' }) });
    await expect(updates.download()).resolves.toStrictEqual(
      err({ kind: 'download-failed', message: 'offline' }),
    );
    await expect(updates.check()).resolves.toStrictEqual(ok('new-update'));
  });

  it('records every call in order', async () => {
    const updates = createFakeUpdates();
    await updates.check();
    await updates.download();
    await updates.apply();
    expect(updates.calls).toStrictEqual(['check', 'download', 'apply']);
  });
});
