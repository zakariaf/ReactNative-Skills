export type SqlValue = string | number | null;

/** The storage port: two implementations, expo-sqlite (device) and node:sqlite (tests). */
export type SqlDriver = {
  readonly exec: (sql: string) => void;
  readonly run: (sql: string, params: readonly SqlValue[]) => void;
};
