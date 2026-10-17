// src/data/expo-file-system-database-files-adapter.ts: DatabaseFiles over expo-file-system's synchronous File and Directory (devices only).
// device-only: covered by the kill test after an upgrade (kill-test.mjs); the API was read in expo-file-system 57.0.7 types and the same pruning runs on node:fs in test/sqlite/.
import { Directory, File } from 'expo-file-system';

import type { DatabaseFiles } from '@/data/database-files';

/** expo-file-system takes file:// URIs; SqlDriver.path is a plain absolute path. */
const toUri = (path: string): string => `file://${path}`;

export function createExpoFileSystemDatabaseFilesAdapter(): DatabaseFiles {
  return {
    list: (dir) =>
      new Directory(toUri(dir))
        .list()
        .filter((entry) => entry instanceof File)
        .map((entry) => entry.name),
    remove: (path) => {
      new File(toUri(path)).delete();
    },
  };
}
