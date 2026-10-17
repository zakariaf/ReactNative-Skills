// src/services/export-files/expo-file-system-export-files-adapter.ts: ExportFilesPort over expo-file-system's File, Directory and Paths (devices only).
// device-only: covered by the export-share-restore drill on a named iOS simulator and Android emulator (references/platform-behaviour.md); the API was read in expo-file-system 57.0.7 types, and fake-export-files.ts runs the same contract in Jest.
import { Directory, File, Paths } from 'expo-file-system';

import { utf8ByteLength } from '@/core/portable/utf8';
import { attempt, attemptAsync, err, ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  ExportFile,
  ExportFilesFailure,
  ExportFilesPort,
  ExportFolder,
} from '@/services/export-files/export-files-port';

/** Below Paths.cache (purgeable) and Paths.document (kept), so a sweep never touches other files. */
const FOLDER_NAMES: Readonly<Record<ExportFolder, string>> = {
  share: 'exports',
  private: 'backups',
};

/** Bytes kept free beyond the file itself, so an export never fills the disk the database needs. */
const SPACE_MARGIN_BYTES = 5 * 1024 * 1024;

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

function folderOf(folder: ExportFolder): Directory {
  const base = folder === 'share' ? Paths.cache : Paths.document;
  const directory = new Directory(base, FOLDER_NAMES[folder]);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

const WRITE_FAILED: ExportFilesFailure = { kind: 'write-failed' };
const READ_FAILED: ExportFilesFailure = { kind: 'read-failed' };

/** The size on disk first (File.size: 0 when unreadable), then the text, off the JS thread. */
function readWithin(
  open: () => File,
  maxBytes: number,
): Promise<Result<string, ExportFilesFailure>> {
  const sized = attempt(
    () => {
      const file = open();
      return { file, sizeBytes: file.size };
    },
    () => READ_FAILED,
  );
  if (!sized.ok) return Promise.resolve(sized);
  const { file, sizeBytes } = sized.value;
  if (sizeBytes > maxBytes) return Promise.resolve(err({ kind: 'too-large', sizeBytes, maxBytes }));
  return attemptAsync(
    () => file.text(),
    () => READ_FAILED,
  );
}

/** ok(null) when the private file does not exist (no restore has run yet). */
function readPrivateFile(
  name: string,
  maxBytes: number,
): Promise<Result<string | null, ExportFilesFailure>> {
  if (!SAFE_NAME.test(name)) return Promise.resolve(err(READ_FAILED));
  const found = attempt(
    () => {
      const file = new File(folderOf('private'), name);
      return file.exists ? file : null;
    },
    () => READ_FAILED,
  );
  if (!found.ok) return Promise.resolve(found);
  if (found.value === null) return Promise.resolve(ok(null));
  const file = found.value;
  return readWithin(() => file, maxBytes);
}

/** Removes our own half-written temp file (never a published file, never user data). */
function discardPartial(temp: File): void {
  attempt(
    () => {
      if (temp.exists) temp.delete();
    },
    () => undefined,
  );
}

/**
 * Temp file in the same folder, then a move over the published name. When any step fails the temp
 * file is discarded and the published name is untouched (still the previous export, or absent).
 */
function writeAtomically(
  directory: Directory,
  name: string,
  text: string,
): Result<ExportFile, ExportFilesFailure> {
  const temp = new File(directory, `.${name}.partial`);
  const target = new File(directory, name);
  const moved = attempt(
    () => {
      temp.create({ overwrite: true });
      temp.write(text);
      temp.moveSync(target, { overwrite: true });
    },
    () => WRITE_FAILED,
  );
  if (!moved.ok) {
    discardPartial(temp);
    return moved;
  }
  return ok({ uri: target.uri, name, bytes: utf8ByteLength(text) });
}

export function createExpoFileSystemExportFilesAdapter(): ExportFilesPort {
  return {
    write: ({ folder, name, text }) => {
      if (!SAFE_NAME.test(name)) return err(WRITE_FAILED);
      const neededBytes = utf8ByteLength(text) + SPACE_MARGIN_BYTES;
      const availableBytes = Paths.availableDiskSpace;
      if (availableBytes < neededBytes)
        return err({ kind: 'no-space', neededBytes, availableBytes });
      const directory = attempt(
        () => folderOf(folder),
        () => WRITE_FAILED,
      );
      return directory.ok ? writeAtomically(directory.value, name, text) : directory;
    },
    sweep: (folder, keep) => {
      attempt(
        () => {
          for (const entry of folderOf(folder).list()) {
            if (entry instanceof File && entry.name !== keep) entry.delete();
          }
        },
        () => undefined,
      );
    },
    readText: (uri, maxBytes) => readWithin(() => new File(uri), maxBytes),
    readPrivate: readPrivateFile,
  };
}
