// src/services/session/sign-out-steps.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { runServerSignOutSteps, runSignOutSteps } from './sign-out-steps';

import type { ServerSignOutContext } from './session-types';

describe('runSignOutSteps', () => {
  it('runs every step in order, awaiting each one', async () => {
    const ran: string[] = [];
    const steps = [
      {
        name: 'query-cache',
        run: async () => {
          await Promise.resolve();
          ran.push('query-cache');
        },
      },
      {
        name: 'account-data',
        run: () => {
          ran.push('account-data');
        },
      },
    ];

    const failed = await runSignOutSteps(steps, createFakeErrorLog());

    expect([failed, ran]).toStrictEqual([[], ['query-cache', 'account-data']]);
  });

  it('records a failing step by name and still runs the rest', async () => {
    const errorLog = createFakeErrorLog();
    const ran: string[] = [];
    const steps = [
      {
        name: 'notifications',
        run: () => {
          throw new Error('scheduler gone');
        },
      },
      { name: 'query-cache', run: () => Promise.reject(new Error('cache busy')) },
      {
        name: 'account-data',
        run: () => {
          ran.push('account-data');
        },
      },
    ];

    const failed = await runSignOutSteps(steps, errorLog);

    expect([failed, ran]).toStrictEqual([['notifications', 'query-cache'], ['account-data']]);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'sign-out step query-cache failed',
      'sign-out step notifications failed',
    ]);
  });
});

describe('runServerSignOutSteps', () => {
  it('hands every step the still-valid token and a live signal', async () => {
    const seen: string[] = [];
    const step = (name: string) => ({
      name,
      run: ({ accessToken, signal }: ServerSignOutContext) => {
        seen.push(`${name}: ${accessToken}, aborted ${String(signal.aborted)}`);
      },
    });

    const failed = await runServerSignOutSteps(
      [step('push-registration'), step('server-session')],
      { accessToken: 'access-1', errorLog: createFakeErrorLog() },
    );

    expect([failed, seen]).toStrictEqual([
      [],
      ['push-registration: access-1, aborted false', 'server-session: access-1, aborted false'],
    ]);
  });

  it('records a failing step by name and still runs the rest', async () => {
    const errorLog = createFakeErrorLog();
    const ran: string[] = [];
    const steps = [
      { name: 'push-registration', run: () => Promise.reject(new Error('503')) },
      {
        name: 'server-session',
        run: () => {
          ran.push('server-session');
        },
      },
    ];

    const failed = await runServerSignOutSteps(steps, { accessToken: 'access-1', errorLog });

    expect([failed, ran]).toStrictEqual([['push-registration'], ['server-session']]);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'server sign-out step push-registration failed',
    ]);
  });

  it('gives up on a step at the deadline, aborts its signal and reports it once', async () => {
    const errorLog = createFakeErrorLog();
    const signals: AbortSignal[] = [];
    const steps = [
      {
        name: 'push-registration',
        run: ({ signal }: ServerSignOutContext) => {
          signals.push(signal);
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        },
      },
    ];

    const running = runServerSignOutSteps(steps, {
      accessToken: 'access-1',
      errorLog,
      timeoutMs: 20,
    });

    await expect(running).resolves.toStrictEqual(['push-registration']);
    await flushMicrotasks();
    expect(signals[0]?.aborted).toBe(true);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'server sign-out step push-registration did not finish within 20 ms',
    ]);
  });
});
