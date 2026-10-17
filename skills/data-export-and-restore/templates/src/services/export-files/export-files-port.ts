// src/services/export-files/export-files-port.ts: writing export files atomically, keeping one safety copy, and reading a picked file or that copy.
import type { Result } from '@/core/result';

/**
 * Where a file goes. 'share': the cache folder of files handed to the share sheet (the system may
 * purge it; nothing there is the only copy of anything). 'private': the documents folder, for the
 * one safety copy restore writes before it replaces data (kept, and included in device backups).
 */
export type ExportFolder = 'share' | 'private';

export type ExportFile = {
  /** A file:// URI the share sheet and the file system accept. */
  readonly uri: string;
  readonly name: string;
  /** UTF-8 bytes written. */
  readonly bytes: number;
};

export type ExportFilesFailure =
  | { readonly kind: 'no-space'; readonly neededBytes: number; readonly availableBytes: number }
  | { readonly kind: 'write-failed' }
  | { readonly kind: 'read-failed' }
  /** The file on disk is larger than the reader's limit: refused before it is read into memory. */
  | { readonly kind: 'too-large'; readonly sizeBytes: number; readonly maxBytes: number };

export type WriteRequest = {
  readonly folder: ExportFolder;
  /** A plain file name: letters, digits, '.', '-' and '_' only. */
  readonly name: string;
  readonly text: string;
};

/**
 * Adapter: expo-file-system-export-files-adapter.ts (devices). Fake: fake-export-files.ts.
 * Expected failures are Result values; no method throws or rejects.
 */
export type ExportFilesPort = {
  /**
   * Writes `text` as UTF-8 to a temporary file in the folder, then moves it over `name`. On any
   * failure the temporary file is deleted and `name` is untouched: no half-written file ever has the
   * published name, so a truncated export can never be shared or mistaken for a backup.
   */
  readonly write: (request: WriteRequest) => Result<ExportFile, ExportFilesFailure>;
  /** Deletes every file in the folder except `keep` (old exports; called before each new one). */
  readonly sweep: (folder: ExportFolder, keep: string) => void;
  /**
   * Reads a picked file's text (a file:// URI in the cache, copied there by the picker). The size on
   * disk is checked first: over `maxBytes` it is `too-large` and nothing is read (the picker does not
   * always report a size).
   */
  readonly readText: (uri: string, maxBytes: number) => Promise<Result<string, ExportFilesFailure>>;
  /**
   * Reads a file of the 'private' folder (the safety copy) by name, with the same size check;
   * ok(null) when there is no such file. The pickers cannot reach this folder, so the app offers it.
   */
  readonly readPrivate: (
    name: string,
    maxBytes: number,
  ) => Promise<Result<string | null, ExportFilesFailure>>;
};
