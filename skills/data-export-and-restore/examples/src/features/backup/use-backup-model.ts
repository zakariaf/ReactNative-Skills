// src/features/backup/use-backup-model.ts: the Backup feature's model: every action runs from a press, one at a time, every outcome is a typed phase.
// A shape to imitate (examples/ are never copied): the app's own copy reads its service from where its
// composition puts it (here AppData.backup, built in openDeviceData from the three ports and the repository).
import { useRef, useState } from 'react';

import { useAppData } from '@/data/app-data-context';
import { stripIsolates } from '@/i18n/bidi';
import { formatDayMonth } from '@/i18n/format-date';
import { useT } from '@/i18n/t-context';
// local-date.ts ships as an example of dates-streaks-and-statistics, at this path, with its test:
// copy both. It turns an instant into the user's local calendar day (a DateKey) and back.
import { dateKeyOfLocalDate } from '@/services/clock/local-date';
import { useStores } from '@/stores/stores-context';
import { updateAndPublish } from '@/stores/update-and-publish';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { exportFailureMessage, restoreFailureMessage } from './backup-failure-messages';

import type { Result } from '@/core/result';
import type { ExportFailure, RestoreFailure } from '@/data/backup/backup-failures';
import type {
  BackupService,
  ExportArtifact,
  RestorePreview,
  RestoreReport,
} from '@/data/backup/backup-service';
import type { TFunction } from '@/i18n/create-t';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { ShareAnchor } from '@/services/share-sheet/share-sheet-port';
import type { Stores } from '@/stores/stores-context';

/** The confirmation's numbers and date, the values of its message ("Replace your 3 lists and 12 tasks ..."). */
export type RestoreConfirmation = {
  readonly currentLists: number;
  readonly currentTasks: number;
  readonly fileLists: number;
  readonly fileTasks: number;
  /** Current rows the database could not read; the replace removes them too (said when > 0). */
  readonly unreadableCurrentRows: number;
  /** When the file was written, in the user's calendar and digits ("1 Oct" / "١ أكتوبر"). */
  readonly exportedOn: string;
};

export type BackupPhase =
  | { readonly kind: 'idle' }
  /** Painted before the work starts on the next frame (hashing a few MB takes a moment). */
  | { readonly kind: 'working' }
  /** The screen shows artifact.skippedRows when > 0: rows the file does not hold. */
  | { readonly kind: 'exported'; readonly artifact: ExportArtifact }
  /** The confirmation: what the file holds, what it replaces, and the policy, before anything changes. */
  | {
      readonly kind: 'confirm-restore';
      readonly preview: RestorePreview;
      readonly confirmation: RestoreConfirmation;
    }
  | { readonly kind: 'restored'; readonly report: RestoreReport }
  /** "Restore the data from before your last restore" found no copy: no restore has run yet. */
  | { readonly kind: 'no-safety-copy' }
  | { readonly kind: 'failed'; readonly message: string };

/** Every word the screen shows, translated here: the views never call t() or render <T>. */
export type BackupCopy = {
  readonly exportLabel: string;
  readonly exportCsvLabel: string;
  readonly restoreLabel: string;
  readonly safetyCopyLabel: string;
  /** The line under the actions: rows an export skipped, or "no restore has run yet"; null for none. */
  readonly notice: string | null;
};

/** The confirmation as text: the question, the unreadable-rows line (null when 0), both buttons. */
export type RestoreConfirmationCopy = {
  readonly question: string;
  readonly unreadableRows: string | null;
  readonly replaceLabel: string;
  readonly cancelLabel: string;
};

export type BackupModel = {
  readonly phase: BackupPhase;
  readonly copy: BackupCopy;
  /** Set only while phase is 'confirm-restore'. */
  readonly confirmationCopy: RestoreConfirmationCopy | null;
  readonly isReducedMotion: boolean;
  /** Press handlers only: nothing here runs on mount, focus or a timer. */
  readonly onExportBackup: (anchor: ShareAnchor | null) => void;
  readonly onExportCsv: (anchor: ShareAnchor | null) => void;
  readonly onPickRestoreFile: () => void;
  readonly onPreviewSafetyCopy: () => void;
  readonly onConfirmRestore: () => void;
  readonly onCancel: () => void;
};

type Show = {
  readonly setPhase: (next: BackupPhase) => void;
  readonly t: TFunction;
  readonly backup: BackupService;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/** Counts and a date formatted on screen: the file holds an ISO-8601 UTC instant, never display text. */
function confirmationOf(preview: RestorePreview, t: TFunction): RestoreConfirmation {
  const exportedOnDay = dateKeyOfLocalDate(new Date(preview.backup.header.exportedAt));
  return {
    currentLists: preview.current.lists,
    currentTasks: preview.current.tasks,
    fileLists: preview.backup.counts.lists,
    fileTasks: preview.backup.counts.tasks,
    unreadableCurrentRows: preview.currentSkippedRows,
    // Passed into another message, so without the isolates formatDayMonth adds (format-date.ts).
    exportedOn: stripIsolates(formatDayMonth(exportedOnDay, t)),
  };
}

/**
 * backup.export.skipped (en): "{count, plural, one {# item} other {# items}} could not be read and are
 * not in this file." backup.safety-copy.none (en): "There is no copy from before a restore yet."
 */
function copyOf(t: TFunction, phase: BackupPhase): BackupCopy {
  const notice =
    phase.kind === 'exported' && phase.artifact.skippedRows > 0
      ? t('backup.export.skipped', { count: phase.artifact.skippedRows })
      : phase.kind === 'no-safety-copy'
        ? t('backup.safety-copy.none')
        : null;
  return {
    exportLabel: t('backup.export.button'),
    exportCsvLabel: t('backup.export-csv.button'),
    restoreLabel: t('backup.restore.button'),
    safetyCopyLabel: t('backup.safety-copy.button'),
    notice,
  };
}

/**
 * backup.restore.confirm (en): "Replace your {currentLists} lists and {currentTasks} tasks with the
 * {fileLists} lists and {fileTasks} tasks from the backup of {exportedOn}? Tasks you added since then
 * will be removed. A copy of your current data is kept."
 * backup.safety-copy.confirm (en): "Replace your {currentLists} lists and {currentTasks} tasks with
 * the {fileLists} lists and {fileTasks} tasks you had before your last restore ({exportedOn})?"
 * backup.restore.unreadable-rows (en): "{unreadableCurrentRows, plural, one {# item} other {# items}}
 * of your current data could not be read and will be removed too." (only when > 0: those rows are in
 * neither count nor the safety copy)
 */
function confirmationCopyOf(t: TFunction, phase: BackupPhase): RestoreConfirmationCopy | null {
  if (phase.kind !== 'confirm-restore') return null;
  const { confirmation } = phase;
  const id =
    phase.preview.source.kind === 'safety-copy' ? 'backup.safety-copy.confirm' : 'backup.restore.confirm';
  return {
    question: t(id, confirmation),
    unreadableRows:
      confirmation.unreadableCurrentRows > 0
        ? t('backup.restore.unreadable-rows', {
            unreadableCurrentRows: confirmation.unreadableCurrentRows,
          })
        : null,
    replaceLabel: t('backup.restore.replace'),
    cancelLabel: t('common.cancel'),
  };
}

function showExport(
  show: Show,
  exported: Result<ExportArtifact, ExportFailure>,
  anchor: ShareAnchor | null,
): void {
  if (!exported.ok) {
    show.setPhase({ kind: 'failed', message: show.t(exportFailureMessage(exported.error)) });
    return;
  }
  show.setPhase({ kind: 'exported', artifact: exported.value });
  // 'sheet-closed' says nothing about where the file went: the screen never claims "saved".
  const options = { dialogTitle: show.t('backup.share.title'), anchor };
  show.backup.share(exported.value, options).catch((thrown: unknown) => {
    show.errorLog.record('service', thrown);
  });
}

function showPreview(
  show: Show,
  previewed: Result<RestorePreview | null, RestoreFailure>,
  whenNone: BackupPhase,
): void {
  if (!previewed.ok) {
    show.setPhase({ kind: 'failed', message: show.t(restoreFailureMessage(previewed.error)) });
  } else if (previewed.value === null) {
    show.setPhase(whenNone);
  } else {
    const preview = previewed.value;
    show.setPhase({
      kind: 'confirm-restore',
      preview,
      confirmation: confirmationOf(preview, show.t),
    });
  }
}

function showRestore(show: Show, restored: Result<RestoreReport, RestoreFailure>): void {
  show.setPhase(
    restored.ok
      ? { kind: 'restored', report: restored.value }
      : { kind: 'failed', message: show.t(restoreFailureMessage(restored.error)) },
  );
}

/**
 * One action at a time: a second tap (on Replace above all) while one runs does nothing. The busy
 * state is painted first and the work starts on the next frame: export, preview and restore hash
 * and parse on the JS thread. A pick paints it before the picker opens, so the frame after the
 * picker closes already shows it.
 */
function useExclusive(show: Pick<Show, 'setPhase' | 'errorLog' | 't'>) {
  const inFlight = useRef(false);
  return (work: () => Promise<void> | void): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    show.setPhase({ kind: 'working' });
    requestAnimationFrame(() => {
      Promise.resolve()
        .then(work)
        .finally(() => {
          inFlight.current = false;
        })
        .catch((thrown: unknown) => {
          show.errorLog.record('service', thrown);
          // Never left on 'working': the screen offers its buttons again. backup.failed (en):
          // "Something went wrong. Try again."
          show.setPhase({ kind: 'failed', message: show.t('backup.failed') });
        });
    });
  };
}

/** The work of each press, built inside the handler (never during render) and run by exclusive(). */
function exportJob(
  show: Show,
  make: () => Result<ExportArtifact, ExportFailure>,
  anchor: ShareAnchor | null,
): () => void {
  return () => {
    showExport(show, make(), anchor);
  };
}

function previewJob(
  show: Show,
  open: () => Promise<Result<RestorePreview | null, RestoreFailure>>,
  whenNone: BackupPhase,
): () => Promise<void> {
  return async () => {
    showPreview(show, await open(), whenNone);
  };
}

/** One transaction, then every store re-reads what is on disk (state-management-zustand). */
function restoreJob(show: Show, stores: Stores, preview: RestorePreview): () => void {
  return () => {
    showRestore(
      show,
      updateAndPublish(stores, () => show.backup.restore(preview)),
    );
  };
}

export function useBackupModel(): BackupModel {
  const { backup, errorLog } = useAppData();
  const stores = useStores();
  const [phase, setPhase] = useState<BackupPhase>({ kind: 'idle' });
  const t = useT();
  const show: Show = { setPhase, t, backup, errorLog };
  const exclusive = useExclusive(show);
  return {
    phase,
    copy: copyOf(t, phase),
    confirmationCopy: confirmationCopyOf(t, phase),
    isReducedMotion: useReduceMotion(),
    onExportBackup: (anchor) => {
      exclusive(exportJob(show, backup.exportBackup, anchor));
    },
    onExportCsv: (anchor) => {
      exclusive(exportJob(show, backup.exportCsv, anchor));
    },
    onPickRestoreFile: () => {
      exclusive(previewJob(show, backup.pickBackup, { kind: 'idle' }));
    },
    onPreviewSafetyCopy: () => {
      exclusive(previewJob(show, backup.previewSafetyCopy, { kind: 'no-safety-copy' }));
    },
    onConfirmRestore: () => {
      // Only from the confirmation; no screen keeps showing rows the restore replaced.
      if (phase.kind === 'confirm-restore') exclusive(restoreJob(show, stores, phase.preview));
    },
    onCancel: () => {
      setPhase({ kind: 'idle' });
    },
  };
}
