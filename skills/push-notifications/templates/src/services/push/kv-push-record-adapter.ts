// src/services/push/kv-push-record-adapter.ts
// The PushRecordPort on expo-sqlite/kv-store: a tiny key-value database apart from the app's data,
// with a synchronous API, so the registration knows the saved record from its first sync. A failed
// read or write is recorded and reads as "nothing saved": the next sync then registers again, which
// the server's idempotent upsert absorbs.
import Storage from 'expo-sqlite/kv-store';

import { decodeRegisteredRecord, encodeRegisteredRecord } from '@/core/push/registration-plan';
import { attempt } from '@/core/result';

import type { PushRecordPort } from './push-record-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The kv-store key; namespaced so it never collides with the app's own preferences. */
export const PUSH_RECORD_KEY = 'push.registration';

export type KvPushRecordOptions = {
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

export function createKvPushRecordAdapter({ errorLog }: KvPushRecordOptions): PushRecordPort {
  const fail = (what: string) => (thrown: unknown) => {
    errorLog.record('storage', new Error(`push record ${what} failed`, { cause: thrown }));
  };
  return {
    read: () => {
      const read = attempt(() => Storage.getItemSync(PUSH_RECORD_KEY), fail('read'));
      return read.ok && read.value !== null ? decodeRegisteredRecord(read.value) : null;
    },
    write: (record) => {
      attempt(() => {
        if (record === null) Storage.removeItemSync(PUSH_RECORD_KEY);
        else Storage.setItemSync(PUSH_RECORD_KEY, encodeRegisteredRecord(record));
      }, fail('write'));
    },
  };
}
