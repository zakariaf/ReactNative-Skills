// src/data/backup/backup-service.ts: export, share, pick and restore as typed Results, over the backup repository and three ports.
import { utf8ByteLength } from '@/core/portable/utf8';
import { err, ok } from '@/core/result';
import { BACKUP_MIME_TYPE, BACKUP_UTI, encodeBackup } from '@/data/backup/backup-envelope';
import { consistencyFailure, countsOf, readBackup } from '@/data/backup/read-backup';
import { CSV_MIME_TYPE, CSV_UTI, tasksCsv } from '@/data/backup/tasks-csv';

import type { Result } from '@/core/result';
import type { BackupCounts, ExportFailure, RestoreFailure } from '@/data/backup/backup-failures';
import type { BackupRepository } from '@/data/backup/backup-repository';
import type { BackupPayload } from '@/data/backup/backup-schema';
import type { DecodedBackup } from '@/data/backup/read-backup';
import type { ClockPort } from '@/services/clock/clock-port';
import type {
  ExportFile,
  ExportFilesFailure,
  ExportFilesPort,
} from '@/services/export-files/export-files-port';
import type { FilePickerPort, PickedFile } from '@/services/file-picker/file-picker-port';
import type {
  ShareAnchor,
  ShareFailure,
  ShareSheetPort,
} from '@/services/share-sheet/share-sheet-port';

/** The one restore policy: the file replaces every backed-up table. The confirmation says so. */
export const RESTORE_POLICY = 'replace';

/**
 * The copy of the current data restore writes first (private folder). One file: the next restore
 * replaces it, so it always holds the data from just before the last restore.
 */
export const SAFETY_COPY_NAME = '__APP_SLUG__-before-restore.json';

/**
 * The one size limit of a backup: export refuses to write a larger file and restore refuses to read
 * one, so the app never publishes a backup it would later refuse. Export, preview and the safety copy
 * each hash the whole payload on the JS thread (pure SHA-256: about 1.6 MB/s without a JIT, measured
 * in Node; Hermes on a device not measured), so measure the largest realistic backup on a low-end
 * Android phone before raising it; larger data needs a streaming design.
 */
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

export type ExportArtifact = {
  readonly file: ExportFile;
  readonly mimeType: string;
  readonly uti: string;
  readonly counts: BackupCounts;
  /** Rows the database holds but could not read; not in the file. The screen says so when > 0. */
  readonly skippedRows: number;
};

/** Where a preview came from: a file the user picked, or the safety copy of the last restore. */
export type RestoreSource =
  { readonly kind: 'picked-file'; readonly file: PickedFile } | { readonly kind: 'safety-copy' };

export type RestorePreview = {
  readonly source: RestoreSource;
  readonly backup: DecodedBackup;
  /** What the replace removes, for the confirmation: "replaces 12 tasks with 40". */
  readonly current: BackupCounts;
  /**
   * Rows the database holds but could not read: not in `current` and not in the safety copy, yet the
   * replace deletes them too. The confirmation says so when > 0 ("2 unreadable items are removed").
   */
  readonly currentSkippedRows: number;
  readonly policy: typeof RESTORE_POLICY;
};

export type RestoreReport = {
  readonly restored: BackupCounts;
  readonly replaced: BackupCounts;
  readonly safetyCopy: ExportFile;
  readonly policy: typeof RESTORE_POLICY;
};

export type ShareOptions = { readonly dialogTitle: string; readonly anchor: ShareAnchor | null };

export type BackupService = {
  readonly exportBackup: () => Result<ExportArtifact, ExportFailure>;
  readonly exportCsv: () => Result<ExportArtifact, ExportFailure>;
  readonly share: (
    artifact: ExportArtifact,
    options: ShareOptions,
  ) => Promise<Result<'sheet-closed', ShareFailure>>;
  /** Pick, read and check a file; nothing is written. ok(null) when the user cancelled. */
  readonly pickBackup: () => Promise<Result<RestorePreview | null, RestoreFailure>>;
  /**
   * The undo of the last restore: reads the safety copy through the same ladder; nothing is written.
   * ok(null) when no restore has run yet. The pickers cannot reach the private folder, so the app
   * offers this as its own row.
   */
  readonly previewSafetyCopy: () => Promise<Result<RestorePreview | null, RestoreFailure>>;
  /**
   * After the user confirmed the preview: a safety copy, then one replace transaction. A preview
   * restores once: a second call with it (a double tap) is `already-restored` and changes nothing.
   */
  readonly restore: (preview: RestorePreview) => Result<RestoreReport, RestoreFailure>;
};

export type BackupServiceDeps = {
  readonly repository: BackupRepository;
  readonly files: ExportFilesPort;
  readonly shareSheet: ShareSheetPort;
  readonly filePicker: FilePickerPort;
  readonly clock: Pick<ClockPort, 'nowMs' | 'today'>;
  /** The app's version (expo-application or app config), written into the header for support. */
  readonly appVersion: string;
  /** AppData.database.isPersistent: false when this session runs in memory (restore is refused). */
  readonly isPersistent: boolean;
  /** MAX_BACKUP_BYTES unless a test passes a smaller limit. */
  readonly maxBackupBytes?: number;
};

type Export = {
  readonly name: string;
  readonly text: string;
  readonly mimeType: string;
  readonly uti: string;
};

const limitOf = (deps: BackupServiceDeps): number => deps.maxBackupBytes ?? MAX_BACKUP_BYTES;

const metaOf = (deps: BackupServiceDeps): { appVersion: string; exportedAtMs: number } => ({
  appVersion: deps.appVersion,
  exportedAtMs: deps.clock.nowMs(),
});

function exportFailureOf(failure: ExportFilesFailure): ExportFailure {
  return failure.kind === 'no-space' ? failure : { kind: 'write-failed' };
}

function readFailureOf(failure: ExportFilesFailure): RestoreFailure {
  return failure.kind === 'too-large' ? failure : { kind: 'unreadable' };
}

/**
 * The backup file, only when restore would accept it: consistent rows (rung 7) and within the one
 * size limit. Rows already passed their schemas in readAll.
 */
function backupExport(
  deps: BackupServiceDeps,
  payload: BackupPayload,
): Result<Export, ExportFailure> {
  const inconsistent = consistencyFailure(payload);
  if (inconsistent !== null) return err(inconsistent);
  const text = encodeBackup(payload, metaOf(deps));
  const sizeBytes = utf8ByteLength(text);
  const maxBytes = limitOf(deps);
  if (sizeBytes > maxBytes) return err({ kind: 'too-large', sizeBytes, maxBytes });
  const name = `__APP_SLUG__-backup-${deps.clock.today()}.json`;
  return ok({ name, text, mimeType: BACKUP_MIME_TYPE, uti: BACKUP_UTI });
}

function csvExport(deps: BackupServiceDeps, payload: BackupPayload): Result<Export, ExportFailure> {
  const name = `__APP_SLUG__-${deps.clock.today()}.csv`;
  return ok({ name, text: tasksCsv(payload), mimeType: CSV_MIME_TYPE, uti: CSV_UTI });
}

/** Reads every table, builds the file, sweeps older exports, publishes it atomically. */
function publishExport(
  deps: BackupServiceDeps,
  build: (deps: BackupServiceDeps, payload: BackupPayload) => Result<Export, ExportFailure>,
): Result<ExportArtifact, ExportFailure> {
  const snapshot = deps.repository.readAll();
  if (!snapshot.ok) return err({ kind: 'storage', failure: snapshot.error });
  const { payload, skippedRows } = snapshot.value;
  const built = build(deps, payload);
  if (!built.ok) return built;
  const { name, text, mimeType, uti } = built.value;
  deps.files.sweep('share', name);
  const written = deps.files.write({ folder: 'share', name, text });
  if (!written.ok) return err(exportFailureOf(written.error));
  return ok({ file: written.value, mimeType, uti, counts: countsOf(payload), skippedRows });
}

/** The ladder over text already read, then the current counts for the confirmation. */
function previewOf(
  deps: BackupServiceDeps,
  text: string,
  source: RestoreSource,
): Result<RestorePreview, RestoreFailure> {
  const backup = readBackup(text);
  if (!backup.ok) return backup;
  const current = deps.repository.readAll();
  if (!current.ok) return err({ kind: 'storage', failure: current.error });
  return ok({
    source,
    backup: backup.value,
    current: countsOf(current.value.payload),
    currentSkippedRows: current.value.skippedRows,
    policy: RESTORE_POLICY,
  });
}

async function pickBackup(
  deps: BackupServiceDeps,
): Promise<Result<RestorePreview | null, RestoreFailure>> {
  const picked = await deps.filePicker.pickFile();
  if (!picked.ok) return err({ kind: 'unreadable' });
  const file = picked.value;
  if (file === null) return ok(null);
  const maxBytes = limitOf(deps);
  if (file.sizeBytes !== null && file.sizeBytes > maxBytes) {
    return err({ kind: 'too-large', sizeBytes: file.sizeBytes, maxBytes });
  }
  // The picker does not always know the size: readText checks the size on disk before reading.
  const text = await deps.files.readText(file.uri, maxBytes);
  if (!text.ok) return err(readFailureOf(text.error));
  return previewOf(deps, text.value, { kind: 'picked-file', file });
}

async function previewSafetyCopy(
  deps: BackupServiceDeps,
): Promise<Result<RestorePreview | null, RestoreFailure>> {
  const text = await deps.files.readPrivate(SAFETY_COPY_NAME, limitOf(deps));
  if (!text.ok) return err(readFailureOf(text.error));
  if (text.value === null) return ok(null);
  return previewOf(deps, text.value, { kind: 'safety-copy' });
}

/**
 * The safety copy first: if it cannot be written, nothing is replaced. A copy over the size limit
 * counts as not written: previewSafetyCopy would refuse it as too-large, so the undo would be out of
 * reach. Then the replace, which is one transaction: it commits whole or rolls back whole.
 */
function restore(
  deps: BackupServiceDeps,
  preview: RestorePreview,
): Result<RestoreReport, RestoreFailure> {
  if (!deps.isPersistent) return err({ kind: 'session-in-memory' });
  const current = deps.repository.readAll();
  if (!current.ok) return err({ kind: 'storage', failure: current.error });
  const text = encodeBackup(current.value.payload, metaOf(deps));
  if (utf8ByteLength(text) > limitOf(deps)) return err({ kind: 'safety-copy-failed' });
  const safetyCopy = deps.files.write({ folder: 'private', name: SAFETY_COPY_NAME, text });
  if (!safetyCopy.ok) return err({ kind: 'safety-copy-failed' });
  const replaced = deps.repository.replaceAll(preview.backup.payload);
  if (!replaced.ok) {
    const failure = replaced.error;
    return err(failure.kind === 'storage' ? failure : { kind: 'invalid-row', path: failure.path });
  }
  return ok({
    restored: replaced.value,
    replaced: countsOf(current.value.payload),
    safetyCopy: safetyCopy.value,
    policy: RESTORE_POLICY,
  });
}

/**
 * A preview restores at most once. Without this, a second tap would write the just-restored data
 * as the safety copy, replacing the copy of what the user had before: the undo would be gone.
 */
function restoreOnce(
  deps: BackupServiceDeps,
): (preview: RestorePreview) => Result<RestoreReport, RestoreFailure> {
  const restored = new WeakSet<RestorePreview>();
  return (preview) => {
    if (restored.has(preview)) return err({ kind: 'already-restored' });
    const report = restore(deps, preview);
    if (report.ok) restored.add(preview);
    return report;
  };
}

export function createBackupService(deps: BackupServiceDeps): BackupService {
  return {
    exportBackup: () => publishExport(deps, backupExport),
    exportCsv: () => publishExport(deps, csvExport),
    share: (artifact, options) =>
      deps.shareSheet.shareFile({
        uri: artifact.file.uri,
        mimeType: artifact.mimeType,
        uti: artifact.uti,
        ...options,
      }),
    pickBackup: () => pickBackup(deps),
    previewSafetyCopy: () => previewSafetyCopy(deps),
    restore: restoreOnce(deps),
  };
}
