// src/data/document/fake-document-store.test.ts: the fake keeps slots, simulates a failed commit and records quarantines.
import { createFakeDocumentStore } from './fake-document-store';

import type { SlotRecord } from '@/data/document/document-store';

const RECORD: SlotRecord = {
  schemaVersion: 1,
  appVersion: '1.0.0',
  writtenAtMs: 1,
  writeCount: 1,
  checksum: 'x',
  payload: '{}',
};

describe('createFakeDocumentStore', () => {
  it('keeps what was written, slot by slot', () => {
    const store = createFakeDocumentStore();
    store.write({ current: RECORD });
    expect([store.read('current'), store.read('backup')]).toStrictEqual([RECORD, null]);
    store.write({ backup: RECORD });
    expect(store.read('backup')).toBe(RECORD);
  });

  it('fails exactly the next write when asked to simulate a crash', () => {
    const store = createFakeDocumentStore();
    store.failNextWrite = true;
    expect(() => {
      store.write({ current: RECORD });
    }).toThrow('simulated crash before COMMIT');
    expect(store.read('current')).toBeNull();
    store.write({ current: RECORD });
    expect(store.read('current')).toBe(RECORD);
  });

  it('records quarantines in order', () => {
    const store = createFakeDocumentStore();
    store.quarantine('current', 'checksum', 5);
    expect(store.quarantined).toStrictEqual([{ slot: 'current', reason: 'checksum' }]);
  });
});
