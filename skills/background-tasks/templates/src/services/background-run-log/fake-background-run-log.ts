// src/services/background-run-log/fake-background-run-log.ts
// Jest only: an in-memory BackgroundRunLogPort that keeps every appended record, oldest first.
import type {
  BackgroundRunLogPort,
  BackgroundRunRecord,
} from '@/services/background-run-log/background-run-log-port';

export type FakeBackgroundRunLog = BackgroundRunLogPort & {
  /** Every record appended, oldest first, for assertions. */
  readonly records: () => readonly BackgroundRunRecord[];
};

export function createFakeBackgroundRunLog(): FakeBackgroundRunLog {
  const appended: BackgroundRunRecord[] = [];
  return {
    append: (record) => {
      appended.push(record);
    },
    lastRun: (name, trigger) =>
      appended.findLast((record) => record.name === name && record.trigger === trigger) ?? null,
    records: () => [...appended],
  };
}
