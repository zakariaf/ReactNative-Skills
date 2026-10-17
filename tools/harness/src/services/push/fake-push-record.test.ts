// src/services/push/fake-push-record.test.ts
import { createFakePushRecord } from './fake-push-record';

const RECORD = { token: 'tok-1', accountId: 'acc-1', language: 'en', atMs: 5 };

describe('createFakePushRecord', () => {
  it('starts empty, or with the record of an earlier launch', () => {
    expect(createFakePushRecord().read()).toBeNull();
    expect(createFakePushRecord(RECORD).read()).toStrictEqual(RECORD);
  });

  it('replaces and clears the record, counting writes', () => {
    const record = createFakePushRecord();
    record.write(RECORD);
    expect(record.read()).toStrictEqual(RECORD);
    record.write(null);
    expect(record.read()).toBeNull();
    expect(record.writes()).toBe(2);
  });
});
