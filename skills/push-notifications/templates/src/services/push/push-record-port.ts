// src/services/push/push-record-port.ts
// Where the push registration keeps, between launches, what the server last accepted from this
// device. Without it a launch after notifications were switched off in Settings would not know the
// token to unregister (Android ends the app's process when a permission is revoked; iOS often ends
// a backgrounded app while the person is in Settings), and the server would keep counting pushes to
// this phone as sent. Synchronous and small: one record. Adapter: kv-push-record-adapter.ts
// (expo-sqlite/kv-store). Fake: fake-push-record.ts.
import type { RegisteredRecord } from '@/core/push/registration-plan';

/** The one saved record of what the server last accepted from this device; never throws. */
export type PushRecordPort = {
  /** The saved record, or null (never registered, unregistered, or unreadable: recorded). */
  readonly read: () => RegisteredRecord | null;
  /** Replaces the saved record (null: nothing registered). Never throws: a failure is recorded. */
  readonly write: (record: RegisteredRecord | null) => void;
};
