// test/sqlite/node-database-files.ts: DatabaseFiles over node:fs, for the open path's tests.
import { readdirSync, rmSync } from 'node:fs';

import type { DatabaseFiles } from '@/data/database-files';

export function createNodeDatabaseFiles(): DatabaseFiles {
  return {
    list: (dir) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    remove: (path) => {
      rmSync(path);
    },
  };
}
