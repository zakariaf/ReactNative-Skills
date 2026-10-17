// src/data/sql-driver.ts
/** The tiny SQL port every repository talks to. */
export type SqlDriver = {
  readonly run: (sql: string, params?: readonly unknown[]) => void;
  readonly all: <TRow>(sql: string, params?: readonly unknown[]) => readonly TRow[];
};
