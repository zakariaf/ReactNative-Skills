// test/sqlite/temp-database-folder.ts: one throwaway folder per test for real database files.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TempDatabaseFolder = {
  /** Absolute path of a file inside the folder (the file is not created). */
  readonly file: (name: string) => string;
  /** Deletes the folder and everything in it. */
  readonly remove: () => void;
};

export function makeTempDatabaseFolder(): TempDatabaseFolder {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-test-'));
  return {
    file: (name) => join(dir, name),
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
