// test/api/fake-api-client.ts
// Tests only (it lives in test/, so no app code can import it): an ApiClient that answers from a script. Bodies go through the request's schema like
// the real client, so a test proves the schema too; held answers let a test look at the cache while
// a request is in flight (optimistic updates). A request with no scripted answer rejects and names
// itself, so a test never passes against a request it did not expect.
import * as v from 'valibot';

import { err, ok } from '@/core/result';

import type { ApiClient, ApiRequest, HttpMethod } from '@/api/api-client';
import type { ApiFailure } from '@/api/api-failure';
import type { Result } from '@/core/result';

/** What a scripted answer settles with: a body (checked by the request's schema) or a failure. */
export type FakeOutcome = { readonly body: unknown } | { readonly failure: ApiFailure };

/** A held answer: the request waits until the test releases it (or aborts its signal). */
export type HeldAnswer = { readonly release: (outcome: FakeOutcome) => void };

export type FakeApiClient = ApiClient & {
  /** Answers `method path` with this body; answers are used in order and the last one repeats. */
  readonly respond: (method: HttpMethod, path: string, body: unknown) => void;
  readonly fail: (method: HttpMethod, path: string, failure: ApiFailure) => void;
  readonly hold: (method: HttpMethod, path: string) => HeldAnswer;
  /** Every request so far, oldest first (signals, bodies and query parameters included). */
  readonly calls: () => readonly ApiRequest<unknown>[];
};

type Answer = (request: ApiRequest<unknown>) => Promise<FakeOutcome>;

function settle<TValue>(
  request: ApiRequest<TValue>,
  outcome: FakeOutcome,
): Result<TValue, ApiFailure> {
  if ('failure' in outcome) return err(outcome.failure);
  const parsed = v.safeParse(request.schema, outcome.body);
  return parsed.success ? ok(parsed.output) : err({ kind: 'invalid-response', path: request.path });
}

/** Settles as cancelled once the request's signal aborts (never, without a signal). */
function cancelledOnAbort(signal: AbortSignal | undefined): Promise<FakeOutcome> {
  return new Promise((resolve) => {
    const cancel = (): void => {
      resolve({ failure: { kind: 'cancelled' } });
    };
    if (signal?.aborted === true) cancel();
    else signal?.addEventListener('abort', cancel);
  });
}

type Script = {
  readonly add: (key: string, answer: Answer) => void;
  readonly next: (key: string) => Answer | undefined;
};

/** Answers per `METHOD path`, used in order; the last one repeats. */
function createScript(): Script {
  const answers = new Map<string, Answer[]>();
  return {
    add: (key, answer) => {
      answers.set(key, [...(answers.get(key) ?? []), answer]);
    },
    next: (key) => {
      const queue = answers.get(key) ?? [];
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  };
}

/** A scripted ApiClient for tests. */
export function createFakeApiClient(): FakeApiClient {
  const script = createScript();
  const calls: ApiRequest<unknown>[] = [];
  const add = (method: HttpMethod, path: string, answer: Answer): void => {
    script.add(`${method} ${path}`, answer);
  };
  return {
    request: async (request) => {
      calls.push(request);
      const answer = script.next(`${request.method} ${request.path}`);
      if (answer === undefined) {
        throw new Error(`fake ApiClient: no answer scripted for ${request.method} ${request.path}`);
      }
      return settle(request, await answer(request));
    },
    respond: (method, path, body) => {
      add(method, path, () => Promise.resolve({ body }));
    },
    fail: (method, path, failure) => {
      add(method, path, () => Promise.resolve({ failure }));
    },
    hold: (method, path) => {
      let release: (outcome: FakeOutcome) => void = () => undefined;
      const outcome = new Promise<FakeOutcome>((resolve) => {
        release = resolve;
      });
      add(method, path, (request) => Promise.race([outcome, cancelledOnAbort(request.signal)]));
      return {
        release: (value) => {
          release(value);
        },
      };
    },
    calls: () => calls,
  };
}
