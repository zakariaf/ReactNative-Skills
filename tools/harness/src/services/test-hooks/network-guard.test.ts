// src/services/test-hooks/network-guard.test.ts — drives the guard with a fake global scope.
// Targets are assembled from parts: the lint rule bans URL literals in app code, tests included.
import { installNetworkGuard, isAllowedTarget } from './network-guard';

import type { NetworkAttempt } from './network-guard';

/** Stands in for XMLHttpRequest: the guard patches open() on its prototype. */
function fakeRequest(): void {
  // Only its prototype matters.
}
const fakeRequestPrototype = Reflect.get(fakeRequest, 'prototype') as object;

/** Stands in for WebSocket: an instance with readyState, plus the state constants defined below. */
class FakeSocket {
  readonly readyState = 1;
  readonly target: string;

  constructor(target: string) {
    this.target = target;
  }
}
const SOCKET_STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
for (const [value, state] of SOCKET_STATES.entries()) {
  Object.defineProperty(FakeSocket, state, { value });
}

const url = (scheme: string, rest: string): string => [scheme, '://', rest].join('');

function setup(allowedHosts: readonly string[] = []): {
  member: (name: string) => (...args: readonly unknown[]) => unknown;
  seen: NetworkAttempt[];
} {
  const scope = {};
  Reflect.set(scope, 'XMLHttpRequest', fakeRequest);
  Reflect.set(scope, 'fetch', () => Promise.resolve('passed'));
  Reflect.set(scope, 'WebSocket', FakeSocket);
  const seen: NetworkAttempt[] = [];
  const guard = installNetworkGuard(scope, {
    onAttempt: (attempt) => seen.push(attempt),
    allowedHosts,
  });
  expect(guard.attempts()).toStrictEqual([]);
  const member = (name: string): ((...args: readonly unknown[]) => unknown) =>
    Reflect.get(name === 'open' ? fakeRequestPrototype : scope, name) as (
      ...args: readonly unknown[]
    ) => unknown;
  return { member, seen };
}

describe('installNetworkGuard', () => {
  it('rejects fetch and counts the attempt', async () => {
    const { member, seen } = setup();

    await expect(member('fetch')('remote-a')).rejects.toThrow(
      'network guard: fetch to remote-a blocked',
    );
    expect(seen).toStrictEqual([{ kind: 'fetch', target: 'remote-a' }]);
  });

  it('throws on XMLHttpRequest.open and on WebSocket, counting both', () => {
    const { member, seen } = setup();

    expect(() => member('open')('GET', 'remote-b')).toThrow('network guard: xhr to remote-b');
    expect(() => member('WebSocket')('socket-c')).toThrow('network guard: websocket to socket-c');
    expect(seen.map((attempt) => attempt.kind)).toStrictEqual(['xhr', 'websocket']);
  });

  it('reads the target of a Request object from its url', async () => {
    const { member, seen } = setup(['api.example.test']);
    const allowed = { url: url('https', 'api.example.test/tasks') };
    const blocked = { url: url('https', 'tracker.example.test/pixel') };

    await expect(member('fetch')(allowed)).resolves.toBe('passed');
    await expect(member('fetch')(blocked)).rejects.toThrow('network guard: fetch to');
    expect(seen).toStrictEqual([{ kind: 'fetch', target: blocked.url }]);
  });

  it('keeps the WebSocket constants and prototype for an allowed socket', () => {
    const { member } = setup(['api.example.test']);
    const guarded = member('WebSocket');
    const socket: unknown = Reflect.construct(guarded, [url('wss', 'api.example.test/live')]);

    for (const state of SOCKET_STATES) {
      expect(Reflect.get(guarded, state)).toBe(Reflect.get(FakeSocket, state));
    }
    expect(socket).toBeInstanceOf(FakeSocket);
    expect(socket).toBeInstanceOf(guarded);
    expect(Reflect.get(socket as object, 'readyState')).toBe(Reflect.get(guarded, 'OPEN'));
  });

  it('lets a request to an allowed host through', async () => {
    const { member, seen } = setup(['api.example.test']);

    await expect(member('fetch')(url('https', 'api.example.test/tasks'))).resolves.toBe('passed');
    expect(seen).toStrictEqual([]);
  });
});

describe('isAllowedTarget', () => {
  it("allows a development build's own Metro on loopback, and nothing else by default", () => {
    const metro = url('ws', 'localhost:8081/hot');
    const emulatorHost = url('http', '10.0.2.2:8081/index.bundle');

    expect(isAllowedTarget(metro, { isDev: true })).toBe(true);
    expect(isAllowedTarget(emulatorHost, { isDev: true })).toBe(true);
    expect(isAllowedTarget(metro, { isDev: false })).toBe(false);
    expect(isAllowedTarget(url('https', 'tracker.example.test/'), { isDev: true })).toBe(false);
  });
});
