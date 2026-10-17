// test/integration/data/expo-sqlite-sql-driver.test.ts
import { createExpoSqliteSqlDriver } from '@/data/expo-sqlite-sql-driver';

describe('createExpoSqliteSqlDriver', () => {
  it('returns no rows from an empty table', () => {
    expect(createExpoSqliteSqlDriver().all('SELECT 1')).toStrictEqual([]);
  });
});
