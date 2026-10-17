// src/services/session/session-machine.test.ts
import { ok } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeInstallMarker } from '@/services/install-marker/fake-install-marker';
import { createFakeOauth } from '@/services/oauth/fake-oauth';
import { createFakeSecureStorage } from '@/services/secure-storage/fake-secure-storage';

import {
  createMachine,
  markInstall,
  nextGeneration,
  publish,
  publishSignedOut,
  serial,
} from './session-machine';

import type { FakeInstallMarkerOptions } from '@/services/install-marker/fake-install-marker';

function machine(marker: FakeInstallMarkerOptions = {}) {
  const installMarker = createFakeInstallMarker(marker);
  const m = createMachine({
    secureStorage: createFakeSecureStorage(),
    installMarker,
    refresher: createFakeOauth(),
    clock: createFakeClock({ nowMs: 0, today: '2026-10-10' }),
    errorLog: createFakeErrorLog(),
    signOutSteps: [],
  });
  return { m, installMarker };
}

describe('session machine', () => {
  it('starts restoring with nothing in memory', () => {
    const { m } = machine();

    expect([m.snapshot.get(), m.current.get(), m.generation.get()]).toStrictEqual([
      { status: 'restoring' },
      null,
      0,
    ]);
  });

  it('publishes each snapshot to every subscriber', () => {
    const { m } = machine();
    const seen: string[] = [];
    m.listeners.add(() => seen.push(m.snapshot.get().status));

    publish(m, { status: 'unavailable' });
    publishSignedOut(m, 'user');

    expect(seen).toStrictEqual(['unavailable', 'signed-out']);
    expect(m.snapshot.get()).toStrictEqual({ status: 'signed-out', reason: 'user' });
  });

  it('runs queued work in call order, even after a piece fails', async () => {
    const { m } = machine();
    const order: string[] = [];

    const failing = serial(m, () => {
      order.push('first');
      return Promise.reject(new Error('locked'));
    });
    const next = serial(m, () => {
      order.push('second');
      return Promise.resolve(ok('done'));
    });

    await expect(failing).rejects.toThrow('locked');
    await expect(next).resolves.toStrictEqual(ok('done'));
    expect(order).toStrictEqual(['first', 'second']);
  });

  it('counts generations up by one', () => {
    const { m } = machine();

    expect([nextGeneration(m), nextGeneration(m)]).toStrictEqual([1, 2]);
  });

  it('answers whether the install marker changed', () => {
    const { m, installMarker } = machine({ isPresent: false });
    const failing = machine({ isFailing: true });

    expect([markInstall(m, true), installMarker.isSet()]).toStrictEqual([true, true]);
    expect(markInstall(failing.m, true)).toBe(false);
  });
});
