// src/services/background-run-log/kv-background-run-log-adapter.ts
// The BackgroundRunLogPort on expo-sqlite/kv-store: a small key-value database apart from the app's
// data, so recording a run never opens (or migrates) the app database, and it works in an Android
// background launch where no screen ever rendered. One key per job and trigger holds its newest
// record (`background-run-log.background.tasks.sync-outbox`), so a foreground run never overwrites the
// background record the device proof reads.
import Storage from 'expo-sqlite/kv-store';
import * as v from 'valibot';

import { attempt } from '@/core/result';

import type {
  BackgroundRunLogPort,
  BackgroundRunRecord,
  RunTrigger,
} from '@/services/background-run-log/background-run-log-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Namespaced so it never collides with the app's own preferences. */
export const RUN_LOG_KEY_PREFIX = 'background-run-log.';

const RUN_END = v.picklist([
  'done',
  'partial',
  'deferred',
  'failed',
  'timed-out',
  'cancelled',
  'crashed',
  'overlapping',
]);

const RECORD = v.strictObject({
  name: v.string(),
  trigger: v.picklist(['background', 'foreground']),
  startedAtMs: v.number(),
  finishedAtMs: v.number(),
  end: RUN_END,
  processed: v.nullable(v.number()),
  reason: v.nullable(v.string()),
});

export type KvBackgroundRunLogDeps = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

function keyOf(name: string, trigger: RunTrigger): string {
  return `${RUN_LOG_KEY_PREFIX}${trigger}.${name}`;
}

function parseRecord(text: string): BackgroundRunRecord | null {
  const json = attempt(
    (): unknown => JSON.parse(text),
    () => ({ kind: 'run-log-unreadable' }) as const,
  );
  if (!json.ok) return null;
  const parsed = v.safeParse(RECORD, json.value);
  return parsed.success ? parsed.output : null;
}

export function createKvBackgroundRunLogAdapter(
  deps: KvBackgroundRunLogDeps,
): BackgroundRunLogPort {
  return {
    append: (record) => {
      try {
        Storage.setItemSync(keyOf(record.name, record.trigger), JSON.stringify(record));
      } catch (thrown: unknown) {
        deps.errorLog.record(
          'storage',
          new Error(`background run log: ${record.trigger} ${record.name} not saved`, {
            cause: thrown,
          }),
        );
      }
    },
    lastRun: (name, trigger) => {
      const read = attempt(
        () => Storage.getItemSync(keyOf(name, trigger)),
        (thrown: unknown) => ({ kind: 'run-log-unreadable', thrown }) as const,
      );
      if (!read.ok) {
        deps.errorLog.record('storage', read.error.thrown);
        return null;
      }
      return read.value === null ? null : parseRecord(read.value);
    },
  };
}
