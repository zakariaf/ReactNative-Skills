// src/services/local-notifications/reminder-sync-context.tsx
// How the app's one reminder sync reaches the models that write reminder rows: the local
// notifications root kit (local-notifications-root-kit.tsx) wraps the root Stack in this provider,
// so a model calls sync.request() after a reminder write commits and sync.enable() from "Remind me".
// One instance matters: the sync is single flight, and two instances would race each other's diff.
import { createContext, use } from 'react';

import type { ReminderSync } from './reminder-sync';
import type { JSX, ReactNode } from 'react';

const ReminderSyncContext = createContext<ReminderSync | null>(null);

export type ReminderSyncProviderProps = {
  readonly sync: ReminderSync;
  readonly children: ReactNode;
};

/** Hands the one reminder sync down (the local notifications kit mounts it around the root Stack). */
export function ReminderSyncProvider({ sync, children }: ReminderSyncProviderProps): JSX.Element {
  return <ReminderSyncContext value={sync}>{children}</ReminderSyncContext>;
}

/** The app's one reminder sync. A missing provider is a wiring mistake, so it throws. */
export function useReminderSyncService(): ReminderSync {
  const sync = use(ReminderSyncContext);
  if (sync === null) {
    throw new Error(
      'useReminderSyncService() needs the local notifications root kit (createLocalNotificationsKit in createRootKits) above it',
    );
  }
  return sync;
}
