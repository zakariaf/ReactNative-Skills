// src/services/push/fake-push.ts
// An in-memory PushPort for tests: a permission the test sets, the system prompt's answer, the
// channels created, a token (or a failure), and helpers that rotate the token and tap a notification.
import { err, ok } from '@/core/result';

import { isPushAllowed } from './push-port';

import type {
  NamedPushChannel,
  PushPermission,
  PushPort,
  PushResponse,
  PushToken,
  PushTokenFailure,
} from './push-port';
import type { Result } from '@/core/result';

export type FakePushOptions = {
  readonly permission?: PushPermission;
  /** What the system prompt answers; default 'granted'. Ignored once the permission is blocked. */
  readonly promptAnswer?: PushPermission;
  readonly token?: Result<PushToken, PushTokenFailure>;
  readonly lastResponse?: PushResponse | null;
};

export type FakePush = PushPort & {
  /** Every call in order, for tests that assert the order (channels before the prompt). */
  readonly calls: readonly string[];
  readonly channels: () => readonly NamedPushChannel[];
  readonly setPermission: (permission: PushPermission) => void;
  readonly setToken: (token: Result<PushToken, PushTokenFailure>) => void;
  /** Rotates the token and tells every onTokenChange listener. */
  readonly rotateToken: (token: PushToken) => void;
  /** A tap while the app runs. */
  readonly tap: (response: PushResponse) => void;
};

export const FAKE_PUSH_TOKEN: PushToken = {
  provider: 'expo',
  value: 'ExponentPushToken[fake-1]',
  platform: 'ios',
};

type PermissionPart = Pick<FakePush, 'permission' | 'requestPermission' | 'setPermission'>;

function createPermissionPart(calls: string[], options: FakePushOptions): PermissionPart {
  let permission = options.permission ?? 'undetermined';
  return {
    setPermission: (next) => {
      permission = next;
    },
    permission: () => {
      calls.push('permission');
      return Promise.resolve(permission);
    },
    requestPermission: () => {
      calls.push('requestPermission');
      if (permission !== 'blocked') permission = options.promptAnswer ?? 'granted';
      return Promise.resolve(permission);
    },
  };
}

type TokenPart = Pick<FakePush, 'token' | 'setToken' | 'rotateToken' | 'onTokenChange'>;

function createTokenPart(
  calls: string[],
  permission: PermissionPart['permission'],
  initial: Result<PushToken, PushTokenFailure>,
): TokenPart {
  let token = initial;
  const listeners = new Set<(next: PushToken) => void>();
  return {
    setToken: (next) => {
      token = next;
    },
    rotateToken: (next) => {
      token = ok(next);
      for (const listener of listeners) listener(next);
    },
    token: async () => {
      const isAllowed = isPushAllowed(await permission());
      calls.push('token');
      return isAllowed ? token : err({ kind: 'not-allowed' });
    },
    onTokenChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type ResponsePart = Pick<FakePush, 'lastResponse' | 'clearLastResponse' | 'onResponse' | 'tap'>;

function createResponsePart(initial: PushResponse | null): ResponsePart {
  let last = initial;
  const listeners = new Set<(response: PushResponse) => void>();
  return {
    tap: (response) => {
      last = response;
      for (const listener of listeners) listener(response);
    },
    lastResponse: () => last,
    clearLastResponse: () => {
      last = null;
    },
    onResponse: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Creates a fake push stack: undetermined permission, a granted prompt and FAKE_PUSH_TOKEN by default. */
export function createFakePush(options: FakePushOptions = {}): FakePush {
  const calls: string[] = [];
  let channels: readonly NamedPushChannel[] = [];
  const permissions = createPermissionPart(calls, options);
  return {
    calls,
    channels: () => channels,
    syncChannels: (next) => {
      calls.push('syncChannels');
      channels = next;
      return Promise.resolve();
    },
    ...permissions,
    ...createTokenPart(calls, permissions.permission, options.token ?? ok(FAKE_PUSH_TOKEN)),
    ...createResponsePart(options.lastResponse ?? null),
  };
}
