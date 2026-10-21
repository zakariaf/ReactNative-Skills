// functions/src/lib/define-callable.ts
// The one way a client-facing function is made. Every callable gets, in this order: App Check enforced
// (and replay protection when it costs money), a signed-in caller (anonymous counts), the request
// envelope and its payload parsed with valibot before any work, typed failures mapped once to
// HttpsError codes, and one structured log line that carries no user text and no raw uid.
import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import type { SecretParam } from 'firebase-functions/params';
import { type CallableFunction, type CallableOptions, type CallableRequest, onCall } from 'firebase-functions/v2/https';
import * as v from 'valibot';

import { type CallableFailure, toHttpsError } from './callable-failure.ts';

export type CallableResult<T> = { ok: true; value: T } | { ok: false; error: CallableFailure };

export interface CallableContext {
  uid: string;
  requestId: string;
}

export interface CallableSpec<TInput extends v.GenericSchema, TValue> {
  /** The exported function name, used in logs. */
  name: string;
  /** The payload schema, parsed after the shared envelope. */
  input: TInput;
  /** True on every callable that costs money (a paid provider, a batch job): one App Check token, one call. */
  consumeAppCheckToken?: boolean;
  /** Only the secrets this function reads. */
  secrets?: SecretParam[];
  /** Per-function overrides of the global limits. */
  maxInstances?: number;
  timeoutSeconds?: number;
  handler: (payload: v.InferOutput<TInput>, context: CallableContext) => Promise<CallableResult<TValue>>;
}

export const API_VERSION = 1;

/** The request envelope every callable shares: { apiVersion, requestId, payload }. */
export const CallableEnvelope = v.object({
  apiVersion: v.literal(API_VERSION),
  requestId: v.pipe(v.string(), v.uuid()),
  payload: v.unknown(),
});

/** A stable, non-reversible id for logs: never log the raw uid next to behaviour. */
export function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 16);
}

export async function runCallable<TInput extends v.GenericSchema, TValue>(
  spec: CallableSpec<TInput, TValue>,
  request: CallableRequest<unknown>,
): Promise<CallableResult<TValue>> {
  if (request.auth === undefined) return { ok: false, error: { kind: 'unauthenticated' } };
  // The SDK rejects a missing or invalid token itself, but a consumed one only sets alreadyConsumed.
  if (spec.consumeAppCheckToken === true && request.app?.alreadyConsumed === true) {
    return { ok: false, error: { kind: 'app-check-failed' } };
  }
  const envelope = v.safeParse(CallableEnvelope, request.data);
  if (!envelope.success) return { ok: false, error: { kind: 'invalid-input' } };
  const payload = v.safeParse(spec.input, envelope.output.payload);
  if (!payload.success) return { ok: false, error: { kind: 'invalid-input' } };
  try {
    return await spec.handler(payload.output, { uid: request.auth.uid, requestId: envelope.output.requestId });
  } catch (error) {
    // The name only: a message can carry user text or provider output.
    logger.error('callable-crash', { fn: spec.name, errorName: error instanceof Error ? error.name : typeof error });
    return { ok: false, error: { kind: 'internal' } };
  }
}

function limitsOf(spec: { maxInstances?: number; timeoutSeconds?: number }): Pick<CallableOptions, 'maxInstances' | 'timeoutSeconds'> {
  const limits: Pick<CallableOptions, 'maxInstances' | 'timeoutSeconds'> = {};
  if (spec.maxInstances !== undefined) limits.maxInstances = spec.maxInstances;
  if (spec.timeoutSeconds !== undefined) limits.timeoutSeconds = spec.timeoutSeconds;
  return limits;
}

export function defineCallable<TInput extends v.GenericSchema, TValue>(
  spec: CallableSpec<TInput, TValue>,
): CallableFunction<unknown, Promise<{ ok: true; value: TValue }>> {
  return onCall(
    {
      enforceAppCheck: true,
      consumeAppCheckToken: spec.consumeAppCheckToken === true,
      secrets: spec.secrets ?? [],
      ...limitsOf(spec),
    },
    async (request: CallableRequest<unknown>) => {
      const started = Date.now();
      const result = await runCallable(spec, request);
      logger.info('callable', {
        fn: spec.name,
        uidHash: request.auth === undefined ? null : uidHash(request.auth.uid),
        outcome: result.ok ? 'ok' : result.error.kind,
        ms: Date.now() - started,
      });
      if (!result.ok) throw toHttpsError(result.error);
      return { ok: true as const, value: result.value };
    },
  );
}
