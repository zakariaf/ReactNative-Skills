// src/services/push/kv-push-record-adapter.test.ts
// The adapter over a Map-backed stand-in for expo-sqlite/kv-store's synchronous API.
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { PUSH_RECORD_KEY, createKvPushRecordAdapter } from './kv-push-record-adapter';

const mockItems = new Map<string, string>();
let mockFailure: Error | null = null;

function mockFailOrRun<TValue>(run: () => TValue): TValue {
  if (mockFailure !== null) throw mockFailure;
  return run();
}

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockFailOrRun(() => mockItems.get(key) ?? null),
    setItemSync: (key: string, value: string) => {
      mockFailOrRun(() => mockItems.set(key, value));
    },
    removeItemSync: (key: string) => {
      mockFailOrRun(() => mockItems.delete(key));
    },
  },
}));

const RECORD = { token: 'tok-1', accountId: 'acc-1', language: 'ar', atMs: 5 };

function create() {
  const errorLog = createFakeErrorLog();
  return { record: createKvPushRecordAdapter({ errorLog }), errorLog };
}

describe('createKvPushRecordAdapter', () => {
  beforeEach(() => {
    mockItems.clear();
    mockFailure = null;
  });

  it('keeps the record for the next launch and removes it', () => {
    create().record.write(RECORD);
    const nextLaunch = create().record;
    expect(nextLaunch.read()).toStrictEqual(RECORD);
    nextLaunch.write(null);
    expect(mockItems.has(PUSH_RECORD_KEY)).toBe(false);
    expect(nextLaunch.read()).toBeNull();
  });

  it('reads damaged text as nothing saved', () => {
    mockItems.set(PUSH_RECORD_KEY, '{"token":');
    expect(create().record.read()).toBeNull();
  });

  it('records a failed read or write instead of throwing', () => {
    const { record, errorLog } = create();
    mockFailure = new Error('disk I/O error');
    expect(record.read()).toBeNull();
    record.write(RECORD);
    expect(errorLog.entries().map((entry) => [entry.source, entry.message])).toStrictEqual([
      ['storage', 'push record write failed'],
      ['storage', 'push record read failed'],
    ]);
  });
});
