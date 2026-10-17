// src/data/expo-file-system-database-files-adapter.web.ts
// The web build's DatabaseFiles: expo-sqlite keeps the database in the origin private file system,
// owned by its worker and out of expo-file-system's reach (its calls throw in a browser), so there is
// no snapshot file to list or prune. Measured on expo-sqlite 57.0.3 in Chrome (web-support).
import type * as Native from './expo-file-system-database-files-adapter';

export const createExpoFileSystemDatabaseFilesAdapter: typeof Native.createExpoFileSystemDatabaseFilesAdapter =
  () => ({
    list: () => [],
    remove: () => undefined,
  });
