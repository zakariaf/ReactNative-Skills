// src/hooks/use-reminder-sync.ts
// Runs the reminder sync whenever the pending set may have drifted from the database while the app
// was away: on mount, every time the app returns to the foreground (the person may have changed the
// clock, the zone, the permission in Settings, or simply not opened the app for days, so the rolling
// window needs a refill), and when the app's t() changes (a language or digits switch: the texts
// are part of each identifier). It hands the sync that t(), so every run, including the ones a
// reminder write starts with sync.request() right after it commits, plans in the language the app
// shows, never in one read from module state that a parent effect has not updated yet.
import { useEffect } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { TFunction } from '@/i18n/create-t';
import type { ReminderSync } from '@/services/local-notifications/reminder-sync';

/**
 * Mount once, inside the providers (the root stack). `sync` comes from the composition root, `t`
 * from useT() in the same component.
 */
export function useReminderSync(sync: ReminderSync, t: TFunction): void {
  const isActive = useIsAppActive();
  useEffect(() => {
    if (!isActive) return;
    sync.request({ t });
  }, [sync, isActive, t]);
}
