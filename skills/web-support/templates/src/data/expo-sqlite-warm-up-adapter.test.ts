// src/data/expo-sqlite-warm-up-adapter.test.ts
import { createExpoSqliteWarmUpAdapter } from './expo-sqlite-warm-up-adapter';

describe('createExpoSqliteWarmUpAdapter', () => {
  it('waits for nothing on iOS and Android', () => {
    expect(createExpoSqliteWarmUpAdapter()).toBeNull();
  });
});
