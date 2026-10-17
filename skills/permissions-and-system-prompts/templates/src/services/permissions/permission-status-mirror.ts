// src/services/permissions/permission-status-mirror.ts
// An OS-mirror store for one permission: the state the UI shows ("Camera access is off"), read
// fresh whenever the app returns to the foreground, because the person may have changed the switch
// in Settings meanwhile (both OSes may also end the app's process when a permission is revoked, and
// Android resets the permissions of apps unused for months). React reads it through
// useSyncExternalStore, so no effect copies OS state into React state. Reads are latest-wins: a
// read that an answer the app already holds (set) or a newer read overtook is dropped.
import { AppState } from 'react-native';

import { createLatestRequest } from '@/core/async/latest-request';

import type { PermissionState } from '@/core/permissions/permission-state';
import type { PermissionAccess } from '@/services/permissions/permissions-port';

/** The mirrored state; 'unknown' until the first read answers. */
export type PermissionSnapshot = PermissionState | 'unknown';

/** Calls `onActive` each time the app comes to the foreground; returns the unsubscribe. */
export type WatchAppActive = (onActive: () => void) => () => void;

/** The device source: React Native's AppState 'change' event, filtered to 'active'. */
export function watchAppActive(onActive: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') onActive();
  });
  return () => {
    subscription.remove();
  };
}

export type PermissionStatusMirrorOptions = {
  readonly access: Pick<PermissionAccess, 'permission'>;
  /** Where a failed read goes (the adapters never reject; this guards a hand-written access). */
  readonly onError: (error: unknown) => void;
  /** The foreground source (default watchAppActive); tests pass a scripted one. */
  readonly watchActive?: WatchAppActive;
};

export type PermissionStatusMirror = {
  /** useSyncExternalStore's subscribe: the first subscriber starts watching and reads at once. */
  readonly subscribe: (onChange: () => void) => () => void;
  readonly snapshot: () => PermissionSnapshot;
  /** Reads the OS again (latest wins). */
  readonly refresh: () => Promise<void>;
  /** Records an answer the app already holds (the result of requestPermission). */
  readonly set: (state: PermissionState) => void;
};

/** The subscribers of one mirror; add and remove answer how many remain. */
function createSubscribers(): {
  readonly add: (listener: () => void) => number;
  readonly remove: (listener: () => void) => number;
  readonly notify: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    add: (listener) => listeners.add(listener).size,
    remove: (listener) => {
      listeners.delete(listener);
      return listeners.size;
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
}

/** Creates the mirror: once per permission and screen, in a useState initializer. */
export function createPermissionStatusMirror(
  options: PermissionStatusMirrorOptions,
): PermissionStatusMirror {
  const watchActive = options.watchActive ?? watchAppActive;
  const subscribers = createSubscribers();
  const latest = createLatestRequest();
  let current: PermissionSnapshot = 'unknown';
  let stopWatching: (() => void) | null = null;
  const publish = (next: PermissionSnapshot): void => {
    if (next === current) return;
    current = next;
    subscribers.notify();
  };
  const refresh = async (): Promise<void> => {
    const signal = latest.start();
    const next = await options.access.permission();
    if (!signal.aborted) publish(next);
  };
  const refreshInBackground = (): void => {
    refresh().catch(options.onError);
  };
  const subscribe = (onChange: () => void): (() => void) => {
    if (subscribers.add(onChange) === 1) {
      stopWatching = watchActive(refreshInBackground);
      refreshInBackground();
    }
    return () => {
      if (subscribers.remove(onChange) > 0) return;
      stopWatching?.();
      stopWatching = null;
      latest.cancel();
    };
  };
  const set = (state: PermissionState): void => {
    latest.cancel();
    publish(state);
  };
  return { subscribe, snapshot: () => current, refresh, set };
}
