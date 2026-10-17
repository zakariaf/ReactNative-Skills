// src/hooks/use-push-taps.ts
// Routes notification taps for as long as the component that calls it stays mounted. Call it in
// the root Stack's component, below the navigator, so a cold-start tap navigates after the root
// layout has mounted (Expo Router refuses to navigate earlier). The navigate function is read
// through an effect event, so a new function each render does not re-subscribe.
import { useEffect, useEffectEvent } from 'react';

import { startPushTapRouting } from '@/services/push/push-tap-router';

import type { PushDestination } from '@/core/push/push-destination';
import type { PushPort } from '@/services/push/push-port';

export type PushTaps = {
  readonly push: Pick<PushPort, 'lastResponse' | 'clearLastResponse' | 'onResponse'>;
  /** Maps the destination to a route and pushes it (the app's route table lives in its model). */
  readonly navigate: (destination: PushDestination) => void;
};

export function usePushTaps({ push, navigate }: PushTaps): void {
  const open = useEffectEvent((destination: PushDestination) => {
    navigate(destination);
  });
  useEffect(() => startPushTapRouting({ push, navigate: open }), [push]);
}
