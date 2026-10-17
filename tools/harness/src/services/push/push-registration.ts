// src/services/push/push-registration.ts
// Keeps the server's registration of this device true: registers when the person allowed
// notifications, again when the token, the account or the language changes (and when the last
// accepted registration is a day old), unregisters when notifications were switched off in Settings,
// and removes the registration at sign-out while the session can still authorize the call. What the
// server last accepted is saved (PushRecordPort), so the first sync of a new process can still
// unregister a token an earlier launch registered. One sync runs at a time, so a rotation during a
// launch sync cannot register twice or out of order. A failure is recorded and left for the next
// trigger (launch, foreground, rotation): there is no retry timer.
import { planRegistration } from '@/core/push/registration-plan';
import { attemptAsync } from '@/core/result';

import { isPushAllowed } from './push-port';

import type { PushPort, PushToken, Unsubscribe } from './push-port';
import type { PushRecordPort } from './push-record-port';
import type { PushRegistrar, UnregisterOptions } from '@/core/push/push-registration';
import type { RegisteredRecord, RegistrationStep } from '@/core/push/registration-plan';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

export type PushRegistrationDeps = {
  readonly push: Pick<PushPort, 'permission' | 'token' | 'onTokenChange'>;
  readonly registrar: PushRegistrar;
  /** The last accepted registration, saved between launches. */
  readonly record: PushRecordPort;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  /** True when the server accepts only registrations of a signed-in account (contracts/push.json). */
  readonly requiresAccount: boolean;
  /** The app's current language, sent so the server writes notification text in it. */
  readonly language: () => string;
};

/** What one sync did. */
export type SyncOutcome = RegistrationStep['kind'] | 'failed';

export type PushRegistrationService = {
  /** Brings the server in line for this account (null: signed out); never rejects. */
  readonly sync: (accountId: string | null) => Promise<SyncOutcome>;
  /** Re-registers on every token rotation, for the account of the last sync. */
  readonly start: () => Unsubscribe;
  /**
   * Removes this device's registration. Rejects when the server did not confirm, so a sign-out
   * step reports it; the server also drops registrations of a revoked or expired session itself.
   */
  readonly unregister: (options?: UnregisterOptions) => Promise<void>;
};

/** What is known: the last accepted registration (saved), the newest token, the account. */
type Known = {
  readonly last: RegisteredRecord | null;
  readonly token: PushToken | null;
  readonly accountId: string | null;
};

/** One sync's result: what it did, and the knowledge to keep for the next one. */
type Synced = { readonly outcome: SyncOutcome; readonly known: Known };

async function currentToken(
  deps: PushRegistrationDeps,
  rotated: PushToken | null,
): Promise<PushToken | null> {
  if (rotated !== null) return rotated;
  const fetched = await deps.push.token();
  if (fetched.ok) return fetched.value;
  if (fetched.error.kind !== 'not-allowed') {
    deps.errorLog.record('service', new Error(`push token unavailable: ${fetched.error.kind}`));
  }
  return null;
}

async function register(
  deps: PushRegistrationDeps,
  known: Known,
  step: Extract<RegistrationStep, { kind: 'register' }>,
): Promise<Synced> {
  const token = known.token;
  if (token === null) return { outcome: 'none', known };
  const language = deps.language();
  const sent = await deps.registrar.register({
    token: step.token,
    provider: token.provider,
    platform: token.platform,
    previousToken: step.previousToken,
    language,
  });
  if (!sent.ok) {
    deps.errorLog.record('network', new Error(`push registration failed: ${sent.error.kind}`));
    return { outcome: 'failed', known };
  }
  const last = {
    token: step.token,
    accountId: known.accountId,
    language,
    atMs: deps.clock.nowMs(),
  };
  deps.record.write(last);
  return { outcome: 'register', known: { ...known, last } };
}

async function unregisterStep(
  deps: PushRegistrationDeps,
  known: Known,
  token: string,
): Promise<Synced> {
  const removed = await deps.registrar.unregister(token);
  if (!removed.ok) {
    deps.errorLog.record('network', new Error(`push unregistration failed: ${removed.error.kind}`));
  }
  // Unreachable: keep the record and try again on the next trigger. Rejected (4xx): the same call
  // will never succeed, so forget the record (the server's dropOn duties take it from there).
  if (!removed.ok && removed.error.kind === 'unavailable') return { outcome: 'failed', known };
  deps.record.write(null);
  return { outcome: removed.ok ? 'unregister' : 'failed', known: { ...known, last: null } };
}

async function syncNow(
  deps: PushRegistrationDeps,
  given: Known,
  rotated: PushToken | null,
): Promise<Synced> {
  const isAllowed = isPushAllowed(await deps.push.permission());
  const token = isAllowed ? await currentToken(deps, rotated) : null;
  const known = token === null ? given : { ...given, token };
  const step = planRegistration({
    isAllowed,
    token: token?.value ?? null,
    accountId: known.accountId,
    requiresAccount: deps.requiresAccount,
    language: deps.language(),
    last: known.last,
    nowMs: deps.clock.nowMs(),
  });
  if (step.kind === 'unregister') return unregisterStep(deps, known, step.token);
  if (step.kind === 'register') return register(deps, known, step);
  return { outcome: 'none', known };
}

/**
 * The tokens the server may hold for this device, the one it accepted first: after a rotation whose
 * register call failed, the server still holds the saved token, not the newest one. A token is
 * fetched only when this run knows none (offline at launch, nothing saved).
 */
async function tokensToRemove(deps: PushRegistrationDeps, known: Known): Promise<string[]> {
  const candidates = [known.last?.token, known.token?.value].filter(
    (token): token is string => token !== undefined,
  );
  if (candidates.length === 0) {
    const fetched = await currentToken(deps, null);
    return fetched === null ? [] : [fetched.value];
  }
  return [...new Set(candidates)];
}

async function unregisterDevice(
  deps: PushRegistrationDeps,
  known: Known,
  options?: UnregisterOptions,
): Promise<void> {
  const failures: string[] = [];
  for (const token of await tokensToRemove(deps, known)) {
    const removed = await deps.registrar.unregister(token, options);
    if (!removed.ok) failures.push(removed.error.kind);
  }
  if (failures.length > 0) throw new Error(`push unregistration failed: ${failures.join(', ')}`);
}

/** Creates the app's push registration; the composition root creates one and starts it. */
export function createPushRegistration(deps: PushRegistrationDeps): PushRegistrationService {
  let known: Known = { last: deps.record.read(), token: null, accountId: null };
  // The queue only orders the work: each caller gets its own promise (`next`) with its outcome or
  // rejection, so the queue keeps the settled Result and drops nothing.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
    const next = queue.then(task);
    queue = attemptAsync(
      () => next,
      (thrown) => thrown,
    );
    return next;
  };
  const sync = async (given: Known, rotated: PushToken | null): Promise<SyncOutcome> => {
    const synced = await syncNow(deps, given, rotated);
    known = synced.known;
    return synced.outcome;
  };
  return {
    sync: (accountId) => serialize(async () => sync({ ...known, accountId }, null)),
    start: () =>
      deps.push.onTokenChange((rotated) => {
        serialize(async () => sync(known, rotated)).catch((thrown: unknown) => {
          deps.errorLog.record('service', thrown);
        });
      }),
    unregister: (options) =>
      serialize(async () => {
        const ending = known;
        known = { ...known, last: null, accountId: null };
        // Forgotten whatever the server answers: the session ends, and the server drops the
        // registrations of a revoked or expired session itself (contracts/push.json server.dropOn).
        deps.record.write(null);
        await unregisterDevice(deps, ending, options);
      }),
  };
}

/** auth-and-secure-storage's server sign-out step, listed as push-registration in contracts/auth.json. */
export type PushRegistrationStep = {
  readonly name: 'push-registration';
  readonly run: (context: {
    readonly accessToken: string;
    readonly signal: AbortSignal;
  }) => Promise<void>;
};

/** Removes this device's registration while the session that owns it is still valid. */
export function pushRegistrationStep(
  registration: Pick<PushRegistrationService, 'unregister'>,
): PushRegistrationStep {
  return {
    name: 'push-registration',
    // The still-valid access token goes with the call itself (the session is ending), under the
    // shared deadline; the registrar sends it as the bearer.
    run: ({ accessToken, signal }) => registration.unregister({ accessToken, signal }),
  };
}
