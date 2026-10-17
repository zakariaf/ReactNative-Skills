// src/data/database-files.ts: the few file operations the open path needs beside SQL (finding and pruning its own snapshots).

/**
 * Adapters: expo-file-system-database-files-adapter.ts (devices, expo-file-system) and
 * test/sqlite/node-database-files.ts (Jest, node:fs). Paths are absolute, as SqlDriver.path gives
 * them; nothing else is ever deleted.
 */
export type DatabaseFiles = {
  /** Names of the files in the folder `dir`. */
  readonly list: (dir: string) => readonly string[];
  /** Deletes the one file at `path`. */
  readonly remove: (path: string) => void;
};
