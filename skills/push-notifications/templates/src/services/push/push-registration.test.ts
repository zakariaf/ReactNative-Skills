// src/services/push/push-registration.test.ts
import { REREGISTER_AFTER_MS } from '@/core/push/registration-plan';
import { err, ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createFakePush, FAKE_PUSH_TOKEN } from './fake-push';
import { createFakePushRecord } from './fake-push-record';
import { createPushRegistration, pushRegistrationStep } from './push-registration';

import type { FakePushRecord } from './fake-push-record';
import type { PushPermission } from './push-port';
import type {
  PushRegistration,
  PushRegistrar,
  RegistrarFailure,
} from '@/core/push/push-registration';
import type { RegisteredRecord } from '@/core/push/registration-plan';
import type { Result } from '@/core/result';

type Answer = Result<undefined, RegistrarFailure>;

type Unregistered = {
  readonly token: string;
  readonly accessToken: string | undefined;
  readonly signal: AbortSignal | undefined;
};

function createRegistrar(answer: Answer = ok(undefined)): PushRegistrar & {
  readonly registered: PushRegistration[];
  readonly unregistered: Unregistered[];
  setAnswer: (next: Answer) => void;
} {
  let current = answer;
  const registered: PushRegistration[] = [];
  const unregistered: Unregistered[] = [];
  return {
    registered,
    unregistered,
    setAnswer: (next) => {
      current = next;
    },
    register: (registration) => {
      registered.push(registration);
      return Promise.resolve(current);
    },
    unregister: (token, options) => {
      unregistered.push({ token, accessToken: options?.accessToken, signal: options?.signal });
      return Promise.resolve(current);
    },
  };
}

/** A registration an earlier launch saved (the default fake token, account acc-1, Arabic). */
const SAVED: RegisteredRecord = {
  token: FAKE_PUSH_TOKEN.value,
  accountId: 'acc-1',
  language: 'ar',
  atMs: 0,
};

type SetupOptions = {
  readonly permission?: PushPermission;
  readonly isAccountRequired?: boolean;
  /** The saved record, as a new process finds it. */
  readonly record?: FakePushRecord;
};

function setup({
  permission = 'granted',
  isAccountRequired = true,
  record = createFakePushRecord(),
}: SetupOptions = {}) {
  let nowMs = 0;
  const push = createFakePush({ permission });
  const registrar = createRegistrar();
  const errorLog = createFakeErrorLog();
  const registration = createPushRegistration({
    push,
    registrar,
    record,
    errorLog,
    clock: { nowMs: () => nowMs },
    requiresAccount: isAccountRequired,
    language: () => 'ar',
  });
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  return { push, registrar, record, errorLog, registration, advance };
}

describe('createPushRegistration', () => {
  it('registers once with the token, platform and language, then stays quiet', async () => {
    const { registration, registrar } = setup();
    expect(await registration.sync('acc-1')).toBe('register');
    expect(await registration.sync('acc-1')).toBe('none');
    expect(registrar.registered).toStrictEqual([
      {
        token: FAKE_PUSH_TOKEN.value,
        provider: 'expo',
        platform: 'ios',
        previousToken: null,
        language: 'ar',
      },
    ]);
  });

  it('sends the registration again after a day', async () => {
    const { registration, registrar, advance } = setup();
    await registration.sync('acc-1');
    advance(REREGISTER_AFTER_MS);
    expect(await registration.sync('acc-1')).toBe('register');
    expect(registrar.registered).toHaveLength(2);
  });

  it('skips the prompt and registers nothing without the permission', async () => {
    const { registration, registrar, push } = setup({ permission: 'undetermined' });
    expect(await registration.sync('acc-1')).toBe('none');
    expect(push.calls).not.toContain('requestPermission');
    expect(registrar.registered).toStrictEqual([]);
  });

  it('waits for sign-in when the server needs an account', async () => {
    const { registration, registrar } = setup();
    expect(await registration.sync(null)).toBe('none');
    expect(registrar.registered).toStrictEqual([]);
  });

  it('registers a signed-out device when the server accepts anonymous ones', async () => {
    const { registration } = setup({ isAccountRequired: false });
    expect(await registration.sync(null)).toBe('register');
  });

  it('unregisters after notifications were switched off in Settings', async () => {
    const { registration, registrar, push } = setup();
    await registration.sync('acc-1');
    push.setPermission('denied');
    expect(await registration.sync('acc-1')).toBe('unregister');
    expect(registrar.unregistered).toStrictEqual([
      { token: FAKE_PUSH_TOKEN.value, accessToken: undefined, signal: undefined },
    ]);
  });

  it('unregisters, on a new launch, what an earlier launch registered when notifications are off', async () => {
    const record = createFakePushRecord(SAVED);
    const { registration, registrar } = setup({ permission: 'denied', record });
    expect(await registration.sync('acc-1')).toBe('unregister');
    expect(registrar.unregistered).toStrictEqual([
      { token: SAVED.token, accessToken: undefined, signal: undefined },
    ]);
    expect(record.read()).toBeNull();
  });

  it('saves what the server accepted, so the next launch within a day sends nothing', async () => {
    const record = createFakePushRecord();
    await setup({ record }).registration.sync('acc-1');
    expect(record.read()).toStrictEqual(SAVED);
    const nextLaunch = setup({ record });
    expect(await nextLaunch.registration.sync('acc-1')).toBe('none');
    expect(nextLaunch.registrar.registered).toStrictEqual([]);
  });

  it('keeps the saved record when the server is unreachable, drops it when it refuses', async () => {
    const record = createFakePushRecord(SAVED);
    const { registration, registrar } = setup({ permission: 'denied', record });
    registrar.setAnswer(err({ kind: 'unavailable' }));
    expect(await registration.sync('acc-1')).toBe('failed');
    expect(record.read()).toStrictEqual(SAVED);
    registrar.setAnswer(err({ kind: 'rejected' }));
    expect(await registration.sync('acc-1')).toBe('failed');
    expect(record.read()).toBeNull();
    expect(await registration.sync('acc-1')).toBe('none');
  });

  it('records a failed registration and tries again on the next sync', async () => {
    const { registration, registrar, errorLog } = setup();
    registrar.setAnswer(err({ kind: 'unavailable' }));
    expect(await registration.sync('acc-1')).toBe('failed');
    registrar.setAnswer(ok(undefined));
    expect(await registration.sync('acc-1')).toBe('register');
    expect(errorLog.entries().map((entry) => entry.source)).toStrictEqual(['network']);
  });

  it('records a token failure other than a missing permission', async () => {
    const { registration, push, errorLog } = setup();
    push.setToken(err({ kind: 'network-unavailable' }));
    expect(await registration.sync('acc-1')).toBe('none');
    expect(errorLog.entries()[0]?.message).toBe('push token unavailable: network-unavailable');
  });

  it('registers a rotated token again and names the one it replaces', async () => {
    const { registration, registrar, push } = setup();
    const stop = registration.start();
    await registration.sync('acc-1');
    push.rotateToken({ ...FAKE_PUSH_TOKEN, value: 'ExponentPushToken[new]' });
    await flushMicrotasks();
    stop();
    expect(registrar.registered.map((sent) => [sent.token, sent.previousToken])).toStrictEqual([
      [FAKE_PUSH_TOKEN.value, null],
      ['ExponentPushToken[new]', FAKE_PUSH_TOKEN.value],
    ]);
  });

  it('serializes syncs, so concurrent calls register once', async () => {
    const { registration, registrar } = setup();
    const outcomes = await Promise.all([registration.sync('acc-1'), registration.sync('acc-1')]);
    expect(outcomes).toStrictEqual(['register', 'none']);
    expect(registrar.registered).toHaveLength(1);
  });

  it('registers again for the next account', async () => {
    const { registration, registrar } = setup();
    await registration.sync('acc-1');
    expect(await registration.sync('acc-2')).toBe('register');
    expect(registrar.registered).toHaveLength(2);
  });
});

describe('pushRegistrationStep', () => {
  const controller = new AbortController();
  const context = { accessToken: 'access-1', signal: controller.signal };

  it('unregisters with the still-valid access token under the sign-out deadline', async () => {
    const { registration, registrar, record } = setup();
    await registration.sync('acc-1');
    const step = pushRegistrationStep(registration);
    await step.run(context);
    expect(step.name).toBe('push-registration');
    expect(registrar.unregistered).toStrictEqual([
      { token: FAKE_PUSH_TOKEN.value, accessToken: 'access-1', signal: controller.signal },
    ]);
    expect(record.read()).toBeNull();
  });

  it('unregisters the token an earlier launch saved without fetching one', async () => {
    const record = createFakePushRecord(SAVED);
    const { registration, registrar, push } = setup({ record });
    await pushRegistrationStep(registration).run(context);
    expect(registrar.unregistered.map((call) => call.token)).toStrictEqual([SAVED.token]);
    expect(push.calls).not.toContain('token');
  });

  it('removes the token the server holds first when a rotation never reached it', async () => {
    const record = createFakePushRecord(SAVED);
    const { registration, registrar, push } = setup({ record });
    const stop = registration.start();
    expect(await registration.sync('acc-1')).toBe('none');
    registrar.setAnswer(err({ kind: 'unavailable' }));
    push.rotateToken({ ...FAKE_PUSH_TOKEN, value: 'ExponentPushToken[new]' });
    await flushMicrotasks();
    stop();
    expect(registrar.registered.map((sent) => sent.token)).toStrictEqual([
      'ExponentPushToken[new]',
    ]);
    registrar.setAnswer(ok(undefined));
    await pushRegistrationStep(registration).run(context);
    expect(registrar.unregistered.map((call) => call.token)).toStrictEqual([
      SAVED.token,
      'ExponentPushToken[new]',
    ]);
    expect(record.read()).toBeNull();
  });

  it('fetches the token when this run never registered (offline at launch)', async () => {
    const { registration, registrar } = setup();
    await pushRegistrationStep(registration).run(context);
    expect(registrar.unregistered).toHaveLength(1);
  });

  it('rejects when the server did not confirm, so the sign-out records it', async () => {
    const { registration, registrar } = setup();
    registrar.setAnswer(err({ kind: 'unavailable' }));
    await expect(pushRegistrationStep(registration).run(context)).rejects.toThrow(
      'push unregistration failed: unavailable',
    );
  });

  it('has nothing to remove without a token', async () => {
    const { registration, registrar } = setup({ permission: 'denied' });
    await pushRegistrationStep(registration).run(context);
    expect(registrar.unregistered).toStrictEqual([]);
  });

  it('starts over signed out: the next sync waits for an account', async () => {
    const { registration } = setup();
    await registration.sync('acc-1');
    await pushRegistrationStep(registration).run(context);
    expect(await registration.sync(null)).toBe('none');
  });
});
