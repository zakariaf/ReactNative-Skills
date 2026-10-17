// src/data/sql-driver.ts
/** The SqlDriver port as far as these fixtures need it (persistence-and-migrations owns it). */
export type SqlDriver = {
  readonly run: (sql: string, params: readonly unknown[]) => { readonly changes: number };
};
