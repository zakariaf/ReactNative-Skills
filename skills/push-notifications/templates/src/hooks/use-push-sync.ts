// src/hooks/use-push-sync.ts
// Keeps the push registration current while the app runs: at launch, each time the app comes back
// to the foreground (the person may have switched notifications on or off in Settings meanwhile)
// and when the account changes. It also creates (and renames, in the app's language) the Android
// channels, and every sync waits for the latest channel sync: Android issues no push token before a
// channel exists, and on Android 12L and older the permission is granted without a prompt, so the
// first launch would otherwise fetch the token first and register only at the next foreground. It
// never asks for the permission: that happens only from a person's action (optInToPush).
import { useEffect, useRef } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { NamedPushChannel, PushPort } from '@/services/push/push-port';
import type { PushRegistrationService } from '@/services/push/push-registration';

export type PushSync = {
  readonly push: Pick<PushPort, 'syncChannels'>;
  readonly registration: Pick<PushRegistrationService, 'sync'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  /** In the person's language; a new list (another language) renames the channels. */
  readonly channels: readonly NamedPushChannel[];
  /** The signed-in account, or null. */
  readonly accountId: string | null;
};

export function usePushSync({ push, registration, errorLog, channels, accountId }: PushSync): void {
  const isActive = useIsAppActive();
  // Effects run in order, so at launch the sync below already sees this launch's channel sync.
  const channelsSynced = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    channelsSynced.current = push.syncChannels(channels).catch((thrown: unknown) => {
      errorLog.record('service', thrown);
    });
  }, [push, channels, errorLog]);
  useEffect(() => {
    if (!isActive) return;
    channelsSynced.current
      .then(() => registration.sync(accountId))
      .catch((thrown: unknown) => {
        errorLog.record('service', thrown);
      });
  }, [registration, accountId, isActive, errorLog]);
}
