// src/services/export-files/fake-export-files.ts: an in-memory ExportFilesPort with the adapter's contract, for tests.
import { utf8ByteLength } from '@/core/portable/utf8';
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  ExportFilesFailure,
  ExportFilesPort,
  ExportFolder,
} from '@/services/export-files/export-files-port';

export type FakeExportFiles = ExportFilesPort & {
  /** Published files per folder: name to text. A failed write never appears here. */
  readonly files: (folder: ExportFolder) => ReadonlyMap<string, string>;
  /** The next write fails with this failure, once (no file is published, the old one stays). */
  readonly failNextWrite: (failure: ExportFilesFailure) => void;
  /** What readText returns for a picked file's URI (readPrivate reads the 'private' folder). */
  readonly givePickedFile: (uri: string, text: string) => void;
};

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

/** The adapter checks the size on disk before reading; the fake checks the UTF-8 size. */
function within(text: string, maxBytes: number): Result<string, ExportFilesFailure> {
  const sizeBytes = utf8ByteLength(text);
  return sizeBytes > maxBytes ? err({ kind: 'too-large', sizeBytes, maxBytes }) : ok(text);
}

export function createFakeExportFiles(): FakeExportFiles {
  const folders: Record<ExportFolder, Map<string, string>> = {
    share: new Map(),
    private: new Map(),
  };
  const picked = new Map<string, string>();
  let nextFailure: ExportFilesFailure | null = null;
  return {
    files: (folder) => folders[folder],
    failNextWrite: (failure) => {
      nextFailure = failure;
    },
    givePickedFile: (uri, text) => {
      picked.set(uri, text);
    },
    write: ({ folder, name, text }) => {
      const failure = nextFailure ?? (SAFE_NAME.test(name) ? null : { kind: 'write-failed' });
      nextFailure = null;
      if (failure !== null) return err(failure);
      folders[folder].set(name, text);
      return ok({ uri: `file:///fake/${folder}/${name}`, name, bytes: utf8ByteLength(text) });
    },
    sweep: (folder, keep) => {
      for (const name of [...folders[folder].keys()]) {
        if (name !== keep) folders[folder].delete(name);
      }
    },
    readText: (uri, maxBytes) => {
      const text = picked.get(uri);
      return Promise.resolve(
        text === undefined ? err({ kind: 'read-failed' }) : within(text, maxBytes),
      );
    },
    readPrivate: (name, maxBytes) => {
      const text = folders.private.get(name);
      return Promise.resolve(text === undefined ? ok(null) : within(text, maxBytes));
    },
  };
}
