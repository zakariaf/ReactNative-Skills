// src/data/use-checkpoint-on-background.ts: folds the WAL into the database file whenever the app goes to the background.
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { DatabaseStatus } from '@/data/app-database';

/**
 * Call once, in the root layout. A device backup taken while the app is suspended (iCloud or a
 * computer backup on iOS, Auto Backup on Android) then copies one self-contained file instead of
 * a database whose newest commits still sit in app.db-wal.
 */
export function useCheckpointOnBackground(database: Pick<DatabaseStatus, 'checkpoint'>): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') database.checkpoint();
    });
    return () => {
      subscription.remove();
    };
  }, [database]);
}
