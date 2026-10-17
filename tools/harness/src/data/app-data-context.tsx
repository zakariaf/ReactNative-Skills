// src/data/app-data-context.tsx: hands the database's status, its error log and the repositories to the model hooks.
import { createContext, use } from 'react';

import type { Result } from '@/core/result';
import type { DatabaseStatus } from '@/data/app-database';
import type { TaskRepository } from '@/data/tasks/task-repository';
import type { StorageFailure } from '@/data/to-storage-failure';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { JSX, ReactNode } from 'react';

/**
 * What the data layer gives the app, created once by the root layout (openDeviceData). The first
 * screen reads `database.outcome` and `database.isPersistent` to tell the user when this session
 * runs in memory. The driver is not here: features read and write through repositories only. One
 * member per repository; tests build it from fakes.
 */
export type AppData = {
  readonly database: DatabaseStatus;
  /** The SQLite error log over this database (the session's memory log is its fallback). */
  readonly errorLog: ErrorLogPort;
  readonly tasks: TaskRepository;
  /**
   * "Delete all my data" (reset-data.ts): one transaction over every user table except the protected
   * ones. A failure rolled back and changed nothing. It changes rows several stores hold, so a store
   * layer calls it inside its publish-after-write helper (updateAndPublish).
   */
  readonly resetAllData: () => Result<void, StorageFailure>;
};

const AppDataContext = createContext<AppData | null>(null);

export type AppDataProviderProps = {
  readonly data: AppData;
  readonly children: ReactNode;
};

/** Hands the data layer down. It never changes after startup, so nothing re-renders for it. */
export function AppDataProvider({ data, children }: AppDataProviderProps): JSX.Element {
  return <AppDataContext value={data}>{children}</AppDataContext>;
}

/** Returns the data layer. A missing provider is a programmer error, so it throws. */
export function useAppData(): AppData {
  const data = use(AppDataContext);
  if (data === null) {
    throw new Error('useAppData() needs an <AppDataProvider> above it');
  }
  return data;
}
