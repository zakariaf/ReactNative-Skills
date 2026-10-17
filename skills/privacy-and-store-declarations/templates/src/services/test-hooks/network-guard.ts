// src/services/test-hooks/network-guard.ts
// Test builds only: the test-only entry re-exports installNetworkGuard and the startup calls it first,
// so production bundles never contain it. It replaces fetch, XMLHttpRequest#open and WebSocket on
// the global scope with stubs that count and block every JavaScript request except the hosts the
// run allows (contracts/e2e.json "allowHosts" under the api-port profile; none offline-only) and a
// development build's own Metro on loopback. E2E then asserts the attempt count. It cannot see
// native SDK traffic: e2e-maestro's socket sampler covers that.
export type NetworkAttempt = {
  readonly kind: 'fetch' | 'xhr' | 'websocket';
  readonly target: string;
};
export type NetworkGuard = { readonly attempts: () => readonly NetworkAttempt[] };
export type GuardOptions = {
  /** Called once per blocked attempt (the error log, the debug menu's counter). */
  readonly onAttempt: (attempt: NetworkAttempt) => void;
  /** Hosts the run may reach (an api-port app's test server); empty: block everything. */
  readonly allowedHosts?: readonly string[];
  /** True in a development build, whose bundle and HMR socket come from Metro on loopback. */
  readonly isDev?: boolean;
};

const LOOPBACK =
  /^(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2)(?::\d+)?(?:\/|$)/u;
const HOST = /^[a-z]+:\/\/([^/:?#]+)/iu;

const SOCKET_STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;

/** The URL a request names: a string, a URL object, or a Request (its `url`). */
export function targetOf(input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const url: unknown = Reflect.get(input, 'url');
    if (typeof url === 'string') {
      return url;
    }
  }
  return String(input);
}

/** True for a request the guard lets through: Metro on loopback (development only) or an allowed host. */
export function isAllowedTarget(
  target: unknown,
  options: Omit<GuardOptions, 'onAttempt'>,
): boolean {
  const text = targetOf(target);
  if (options.isDev === true && LOOPBACK.test(text)) {
    return true;
  }
  const host = HOST.exec(text)?.[1]?.toLowerCase();
  return host !== undefined && (options.allowedHosts ?? []).includes(host);
}

function blockedError(attempt: NetworkAttempt): Error {
  return new Error(`network guard: ${attempt.kind} to ${attempt.target} blocked`);
}

type RecordAttempt = (attempt: NetworkAttempt) => Error;

function guardXhr(
  scope: object,
  isAllowed: (target: unknown) => boolean,
  record: RecordAttempt,
): void {
  const xhr: unknown = Reflect.get(scope, 'XMLHttpRequest');
  if (typeof xhr !== 'function') {
    return;
  }
  const proto = xhr.prototype as object;
  const realOpen: unknown = Reflect.get(proto, 'open');
  Reflect.set(proto, 'open', function guardedOpen(this: object, ...args: unknown[]) {
    if (isAllowed(args[1]) && typeof realOpen === 'function') {
      return Reflect.apply(realOpen, this, args) as unknown;
    }
    throw record({ kind: 'xhr', target: targetOf(args[1]) });
  });
}

/**
 * Replaces WebSocket with a guarded constructor that keeps what app code reads from the real one:
 * the CONNECTING/OPEN/CLOSING/CLOSED constants, the prototype (instanceof) and the other statics.
 */
function guardWebSocket(
  scope: object,
  isAllowed: (target: unknown) => boolean,
  record: RecordAttempt,
): void {
  const realWebSocket: unknown = Reflect.get(scope, 'WebSocket');
  function guardedWebSocket(url: unknown, ...rest: unknown[]): object {
    if (isAllowed(url) && typeof realWebSocket === 'function') {
      return Reflect.construct(realWebSocket, [url, ...rest]) as object;
    }
    throw record({ kind: 'websocket', target: targetOf(url) });
  }
  if (typeof realWebSocket === 'function') {
    Object.setPrototypeOf(guardedWebSocket, realWebSocket);
    Reflect.set(guardedWebSocket, 'prototype', Reflect.get(realWebSocket, 'prototype'));
    for (const state of SOCKET_STATES) {
      Object.defineProperty(guardedWebSocket, state, {
        value: Reflect.get(realWebSocket, state),
        enumerable: true,
      });
    }
  }
  Reflect.set(scope, 'WebSocket', guardedWebSocket);
}

export function installNetworkGuard(scope: object, options: GuardOptions): NetworkGuard {
  const seen: NetworkAttempt[] = [];
  const isAllowed = (target: unknown): boolean => isAllowedTarget(target, options);
  const record: RecordAttempt = (attempt) => {
    seen.push(attempt);
    options.onAttempt(attempt);
    return blockedError(attempt);
  };
  const realFetch: unknown = Reflect.get(scope, 'fetch');
  Reflect.set(scope, 'fetch', (input: unknown, ...rest: unknown[]) =>
    isAllowed(input) && typeof realFetch === 'function'
      ? (Reflect.apply(realFetch, scope, [input, ...rest]) as unknown)
      : Promise.reject(record({ kind: 'fetch', target: targetOf(input) })),
  );
  guardXhr(scope, isAllowed, record);
  guardWebSocket(scope, isAllowed, record);
  return { attempts: () => seen };
}
