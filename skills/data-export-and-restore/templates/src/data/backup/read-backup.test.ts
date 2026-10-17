// src/data/backup/read-backup.test.ts
import { encodeBackup } from './backup-envelope';
import backupV1 from './fixtures/backup-v1.json';
import { readBackup } from './read-backup';

import type { BackupPayload } from './backup-schema';

const META = { appVersion: '2.3.0', exportedAtMs: 1_790_000_120_000 };
const list = (id: number) => ({ id, name: `List ${String(id)}`, created_at_ms: 0 });
const task = (id: number, listId: number, title = 'Buy milk') => ({
  id,
  list_id: listId,
  title,
  is_done: 0 as const,
  created_at_ms: 0,
});

/** Builds a file the way the app writes it, with whatever rows the test needs. */
const fileWith = (payload: BackupPayload): string => encodeBackup(payload, META);

describe('readBackup', () => {
  it('reads the frozen hostile fixture: quotes, formulas, CRLF, RTL with marks, emoji, blanks', () => {
    const read = readBackup(JSON.stringify(backupV1));
    if (!read.ok) throw new Error(`expected ok, got ${JSON.stringify(read.error)}`);
    expect(read.value.counts).toStrictEqual({ lists: 3, tasks: 8 });
    expect(read.value.header).toMatchObject({ schemaVersion: 1, appVersion: '1.0.0' });
    expect(read.value.payload.tasks.map((row) => row.title)).toContain('   ');
  });

  it('accepts text of the maximum length in code points, as the CHECK constraint counts it', () => {
    const emoji = '\u{1F4CA}'.repeat(200);
    expect(readBackup(fileWith({ lists: [list(1)], tasks: [task(1, 1, emoji)] })).ok).toBe(true);
    expect(
      readBackup(fileWith({ lists: [list(1)], tasks: [task(1, 1, `${emoji}x`)] })),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-row', path: 'tasks.0.title' },
    });
  });

  it('names the first row that breaks the schema', () => {
    const text = fileWith({ lists: [list(1)], tasks: [task(1, 1)] }).replace(
      '"is_done":0',
      '"is_done":2',
    );
    // The edit changed the payload, so the checksum refuses it first: recompute to reach rung 6.
    const payload = JSON.parse(text) as { payload: BackupPayload };
    expect(readBackup(fileWith(payload.payload))).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-row', path: 'tasks.0.is_done' },
    });
  });

  it('refuses an instant no Date can hold, so the CSV export never throws on a restored file', () => {
    const late = { ...task(1, 1), created_at_ms: 8_640_000_000_000_001 };
    expect(readBackup(fileWith({ lists: [list(1)], tasks: [late] }))).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-row', path: 'tasks.0.created_at_ms' },
    });
    const last = { ...task(1, 1), created_at_ms: 8_640_000_000_000_000 };
    expect(readBackup(fileWith({ lists: [list(1)], tasks: [last] })).ok).toBe(true);
  });

  it('refuses a repeated id and a task whose list is not in the file', () => {
    expect(readBackup(fileWith({ lists: [list(1), list(1)], tasks: [] }))).toStrictEqual({
      ok: false,
      error: { kind: 'inconsistent', table: 'lists', id: 1, reason: 'duplicate-id' },
    });
    expect(readBackup(fileWith({ lists: [list(1)], tasks: [task(5, 2)] }))).toStrictEqual({
      ok: false,
      error: { kind: 'inconsistent', table: 'tasks', id: 5, reason: 'missing-parent' },
    });
  });

  it('stops at the envelope before reading any row', () => {
    expect(readBackup('not a backup')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-backup' },
    });
  });
});
