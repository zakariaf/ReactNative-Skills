import type { SqlDriver, SqlValue } from './sql-driver';

/** Records statements instead of running them. */
export function createFakeSqlDriver(): SqlDriver & { readonly statements: readonly string[] } {
  const statements: string[] = [];
  return {
    statements,
    exec: (sql) => {
      statements.push(sql);
    },
    run: (sql, params: readonly SqlValue[]) => {
      statements.push(`${sql} ${JSON.stringify(params)}`);
    },
  };
}
