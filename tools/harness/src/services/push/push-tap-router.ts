// src/services/push/push-tap-router.ts
// Turns taps on notifications into navigation. A tap that launched the app arrives as the last
// response (read once at start, then cleared, so a remount or a Fast Refresh does not open it
// again); taps while the app runs arrive through the listener. The same tap can come through both
// at a cold start, so each notification id is handled once. The data is parsed before anything acts
// on it, and only destinationFor maps it to a place: a payload never names a route or a URL. A tap
// whose data is not a push message (a local reminder, another feature's notification) is left
// alone, launch tap included: those routers read the same events, and clearing their launch tap
// would lose it for them whichever hook runs first.
import { destinationFor } from '@/core/push/push-destination';
import { parsePushData } from '@/core/push/push-message';

import type { PushPort, PushResponse, Unsubscribe } from './push-port';
import type { PushDestination } from '@/core/push/push-destination';

export type PushTapRouterDeps = {
  readonly push: Pick<PushPort, 'lastResponse' | 'clearLastResponse' | 'onResponse'>;
  /** Opens the destination; called after the navigator is mounted (the caller's effect). */
  readonly navigate: (destination: PushDestination) => void;
};

/** Handles the launch tap now and every later tap until the returned function is called. */
export function startPushTapRouting({ push, navigate }: PushTapRouterDeps): Unsubscribe {
  const handled = new Set<string>();
  const handle = (response: PushResponse): void => {
    const message = parsePushData(response.data);
    if (message === null) return;
    // Cleared for a repeat too: the listener's copy of the launch tap sets the last response again.
    push.clearLastResponse();
    if (handled.has(response.id)) return;
    handled.add(response.id);
    const destination = destinationFor(message, response.action);
    if (destination !== null) navigate(destination);
  };
  const launchTap = push.lastResponse();
  if (launchTap !== null) handle(launchTap);
  return push.onResponse(handle);
}
