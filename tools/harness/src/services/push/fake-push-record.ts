// src/services/push/fake-push-record.ts
// The PushRecordPort in memory, for tests: start it with a record "saved by an earlier launch" to
// test what a new process does.
import type { PushRecordPort } from './push-record-port';
import type { RegisteredRecord } from '@/core/push/registration-plan';

export type FakePushRecord = PushRecordPort & {
  /** How many writes reached the store. */
  readonly writes: () => number;
};

export function createFakePushRecord(initial: RegisteredRecord | null = null): FakePushRecord {
  let saved = initial;
  let writes = 0;
  return {
    read: () => saved,
    write: (record) => {
      saved = record;
      writes += 1;
    },
    writes: () => writes,
  };
}
