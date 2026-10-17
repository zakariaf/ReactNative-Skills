// src/data/backup/tasks-csv.ts: the CSV export of tasks, for a spreadsheet. Lossy by design and never a restore source.
import { toCsv } from '@/core/portable/csv';

import type { BackupPayload } from '@/data/backup/backup-schema';

/**
 * Column codes, not translated labels: the same file reads the same in every locale and tool.
 * Values are canonical too: true/false, ISO-8601 UTC instants, never a formatted date or a
 * localized digit (a human-formatted report is a different export: a PDF or a share text).
 */
export const TASKS_CSV_HEADER: readonly string[] = ['list', 'title', 'done', 'created_at'];

export const CSV_MIME_TYPE = 'text/csv';
export const CSV_UTI = 'public.comma-separated-values-text';

/** One record per task, in id order, with its list's name. */
export function tasksCsv(payload: BackupPayload): string {
  const listNames = new Map(payload.lists.map((list) => [list.id, list.name]));
  const rows = payload.tasks.map((task) => [
    listNames.get(task.list_id) ?? null,
    task.title,
    task.is_done === 1,
    new Date(task.created_at_ms).toISOString(),
  ]);
  return toCsv(TASKS_CSV_HEADER, rows);
}
