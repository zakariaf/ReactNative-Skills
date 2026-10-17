// src/data/backup/backup-service.test.ts
import { err, ok } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeExportFiles } from '@/services/export-files/fake-export-files';
import { createFakeFilePicker } from '@/services/file-picker/fake-file-picker';
import { createFakeShareSheet } from '@/services/share-sheet/fake-share-sheet';

import { encodeBackup } from './backup-envelope';
import { createBackupService, MAX_BACKUP_BYTES, SAFETY_COPY_NAME } from './backup-service';
import { createFakeBackupRepository } from './fake-backup-repository';

import type { BackupPayload } from './backup-schema';
import type { RestorePreview } from './backup-service';
import type { PickedFile } from '@/services/file-picker/file-picker-port';

const CURRENT: BackupPayload = {
  lists: [{ id: 1, name: 'Home', created_at_ms: 0 }],
  tasks: [{ id: 1, list_id: 1, title: 'Buy milk', is_done: 0, created_at_ms: 0 }],
};
const BACKED_UP: BackupPayload = {
  lists: [{ id: 7, name: 'Work', created_at_ms: 5 }],
  tasks: [
    { id: 3, list_id: 7, title: 'Send the report', is_done: 1, created_at_ms: 6 },
    { id: 4, list_id: 7, title: 'Book the room', is_done: 0, created_at_ms: 7 },
  ],
};
const PICKED: PickedFile = {
  uri: 'file:///cache/picked.json',
  name: 'picked.json',
  sizeBytes: 900,
  mimeType: null,
};

type SetupOptions = {
  readonly isPersistent?: boolean;
  readonly maxBackupBytes?: number;
  readonly current?: BackupPayload;
};

function setup({ isPersistent = true, maxBackupBytes, current = CURRENT }: SetupOptions = {}) {
  const repository = createFakeBackupRepository(current);
  const files = createFakeExportFiles();
  const shareSheet = createFakeShareSheet();
  const filePicker = createFakeFilePicker();
  const clock = createFakeClock({ nowMs: 1_790_000_120_000, today: '2026-09-21' });
  const service = createBackupService({
    isPersistent,
    repository,
    files,
    shareSheet,
    filePicker,
    clock,
    appVersion: '2.3.0',
    ...(maxBackupBytes === undefined ? {} : { maxBackupBytes }),
  });
  const pickFile = (text: string, picked = PICKED): void => {
    filePicker.queue(ok(picked));
    files.givePickedFile(picked.uri, text);
  };
  return { repository, files, shareSheet, filePicker, service, pickFile };
}

type Service = ReturnType<typeof setup>['service'];

async function previewOf(
  service: Service,
  open: (service: Service) => ReturnType<Service['pickBackup']> = (each) => each.pickBackup(),
): Promise<RestorePreview> {
  const picked = await open(service);
  if (!picked.ok || picked.value === null)
    throw new Error(`expected a preview: ${JSON.stringify(picked)}`);
  return picked.value;
}

describe('createBackupService: export', () => {
  it('publishes a dated backup file in the share folder and reports what it holds', () => {
    const { service, files } = setup();
    const exported = service.exportBackup();
    expect(exported).toMatchObject({
      ok: true,
      value: {
        mimeType: 'application/json',
        uti: 'public.json',
        counts: { lists: 1, tasks: 1 },
        skippedRows: 0,
      },
    });
    expect([...files.files('share').keys()]).toStrictEqual(['__APP_SLUG__-backup-2026-09-21.json']);
  });

  it('sweeps the previous exports, and leaves nothing behind when a write fails', () => {
    const { service, files } = setup();
    service.exportCsv();
    files.failNextWrite({ kind: 'no-space', neededBytes: 9, availableBytes: 1 });
    expect(service.exportBackup()).toStrictEqual({
      ok: false,
      error: { kind: 'no-space', neededBytes: 9, availableBytes: 1 },
    });
    expect([...files.files('share').keys()]).toStrictEqual([]);
  });

  it('refuses a backup larger than restore accepts, and publishes nothing; CSV has no such limit', () => {
    const { service, files } = setup({ maxBackupBytes: 200 });
    const exported = service.exportBackup();
    expect(exported).toMatchObject({ ok: false, error: { kind: 'too-large', maxBytes: 200 } });
    if (exported.ok || exported.error.kind !== 'too-large') throw new Error('expected too-large');
    expect(exported.error.sizeBytes).toBeGreaterThan(200);
    expect([...files.files('share').keys()]).toStrictEqual([]);
    expect(service.exportCsv().ok).toBe(true);
  });

  it('refuses rows that would fail their own restore (a task whose list is missing)', () => {
    const orphaned: BackupPayload = { lists: [], tasks: CURRENT.tasks };
    const { service, files } = setup({ current: orphaned });
    expect(service.exportBackup()).toStrictEqual({
      ok: false,
      error: { kind: 'inconsistent', table: 'tasks', id: 1, reason: 'missing-parent' },
    });
    expect(files.files('share').size).toBe(0);
  });

  it('returns the storage failure when the tables cannot be read', () => {
    const { service, repository } = setup();
    repository.failNext({ kind: 'corrupt' });
    expect(service.exportCsv()).toStrictEqual({
      ok: false,
      error: { kind: 'storage', failure: { kind: 'corrupt' } },
    });
  });

  it('hands the published file to the share sheet with its types, title and anchor', async () => {
    const { service, shareSheet } = setup();
    const exported = service.exportCsv();
    if (!exported.ok) throw new Error('export failed');
    const anchor = { x: 1, y: 2, width: 3, height: 4 };
    await expect(
      service.share(exported.value, { dialogTitle: 'Share', anchor }),
    ).resolves.toStrictEqual({
      ok: true,
      value: 'sheet-closed',
    });
    expect(shareSheet.requests).toStrictEqual([
      {
        uri: 'file:///fake/share/__APP_SLUG__-2026-09-21.csv',
        mimeType: 'text/csv',
        uti: 'public.comma-separated-values-text',
        dialogTitle: 'Share',
        anchor,
      },
    ]);
  });
});

describe('createBackupService: restore', () => {
  const backupText = encodeBackup(BACKED_UP, { appVersion: '2.2.0', exportedAtMs: 5 });

  it('previews a picked backup without writing anything: what it holds and what it replaces', async () => {
    const { service, pickFile, repository, files } = setup();
    pickFile(backupText);
    const preview = await previewOf(service);
    expect(preview).toMatchObject({ policy: 'replace', current: { lists: 1, tasks: 1 } });
    expect(preview.backup.counts).toStrictEqual({ lists: 1, tasks: 2 });
    expect([repository.replaceCount(), files.files('private').size]).toStrictEqual([0, 0]);
  });

  it('writes the safety copy of the current data first, then replaces every table', async () => {
    const { service, pickFile, repository, files } = setup();
    pickFile(backupText);
    const report = service.restore(await previewOf(service));
    expect(report).toMatchObject({
      ok: true,
      value: {
        restored: { lists: 1, tasks: 2 },
        replaced: { lists: 1, tasks: 1 },
        policy: 'replace',
      },
    });
    expect(repository.current()).toStrictEqual(BACKED_UP);
    const safety = files.files('private').get(SAFETY_COPY_NAME) ?? '';
    expect(JSON.parse(safety)).toMatchObject({ payload: CURRENT });
  });

  it('replaces nothing when the safety copy cannot be written', async () => {
    const { service, pickFile, repository, files } = setup();
    pickFile(backupText);
    const preview = await previewOf(service);
    files.failNextWrite({ kind: 'write-failed' });
    expect(service.restore(preview)).toStrictEqual({
      ok: false,
      error: { kind: 'safety-copy-failed' },
    });
    expect([repository.replaceCount(), repository.current()]).toStrictEqual([0, CURRENT]);
  });

  it('replaces nothing when the safety copy would be over the size limit, so the undo stays reachable', async () => {
    const title = 'x'.repeat(200);
    const large: BackupPayload = {
      lists: CURRENT.lists,
      tasks: Array.from({ length: 20 }, (_, index) => ({
        id: index + 1,
        list_id: 1,
        title,
        is_done: 0 as const,
        created_at_ms: 0,
      })),
    };
    const { service, pickFile, repository, files } = setup({ current: large, maxBackupBytes: 2000 });
    pickFile(backupText);
    expect(service.restore(await previewOf(service))).toStrictEqual({
      ok: false,
      error: { kind: 'safety-copy-failed' },
    });
    expect([repository.replaceCount(), files.files('private').size]).toStrictEqual([0, 0]);
  });

  it('tells the confirmation how many unreadable current rows the replace removes', async () => {
    const { service, pickFile, repository } = setup();
    repository.skipRows(2);
    pickFile(backupText);
    const preview = await previewOf(service);
    expect([preview.current, preview.currentSkippedRows]).toStrictEqual([
      { lists: 1, tasks: 1 },
      2,
    ]);
  });

  it('refuses to restore into a session that runs in memory, before writing anything', async () => {
    const { service, pickFile, repository, files } = setup({ isPersistent: false });
    pickFile(backupText);
    expect(service.restore(await previewOf(service))).toStrictEqual({
      ok: false,
      error: { kind: 'session-in-memory' },
    });
    expect([repository.replaceCount(), files.files('private').size]).toStrictEqual([0, 0]);
  });

  it('reports a failed replace as storage: the transaction rolled back', async () => {
    const { service, pickFile, repository } = setup();
    pickFile(backupText);
    const preview = await previewOf(service);
    repository.failNext({ kind: 'full' });
    expect(service.restore(preview)).toStrictEqual({
      ok: false,
      error: { kind: 'storage', failure: { kind: 'full' } },
    });
  });

  it('returns null for a cancelled pick and typed failures for a file it cannot use', async () => {
    const { service, pickFile, filePicker } = setup();
    await expect(service.pickBackup()).resolves.toStrictEqual({ ok: true, value: null });
    filePicker.queue(err({ kind: 'pick-failed' }));
    await expect(service.pickBackup()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unreadable' },
    });
    pickFile('list,title\r\n');
    await expect(service.pickBackup()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-a-backup' },
    });
    pickFile(backupText, { ...PICKED, sizeBytes: MAX_BACKUP_BYTES + 1 });
    await expect(service.pickBackup()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'too-large', sizeBytes: MAX_BACKUP_BYTES + 1, maxBytes: MAX_BACKUP_BYTES },
    });
  });

  it('checks the size on disk when the picker reports none, before reading the file', async () => {
    const { service, pickFile } = setup({ maxBackupBytes: 100 });
    pickFile(backupText, { ...PICKED, sizeBytes: null });
    await expect(service.pickBackup()).resolves.toMatchObject({
      ok: false,
      error: { kind: 'too-large', maxBytes: 100 },
    });
  });

  it('restores a preview once: a second tap changes nothing and keeps the safety copy', async () => {
    const { service, pickFile, repository, files } = setup();
    pickFile(backupText);
    const preview = await previewOf(service);
    expect(service.restore(preview).ok).toBe(true);
    expect(service.restore(preview)).toStrictEqual({
      ok: false,
      error: { kind: 'already-restored' },
    });
    expect(repository.replaceCount()).toBe(1);
    const safety = files.files('private').get(SAFETY_COPY_NAME) ?? '';
    expect(JSON.parse(safety)).toMatchObject({ payload: CURRENT });
  });
});

describe('createBackupService: the safety copy is the undo', () => {
  const backupText = encodeBackup(BACKED_UP, { appVersion: '2.2.0', exportedAtMs: 5 });

  it('has nothing to offer before the first restore', async () => {
    const { service } = setup();
    await expect(service.previewSafetyCopy()).resolves.toStrictEqual({ ok: true, value: null });
  });

  it('previews the data from before the last restore and restores it through the same path', async () => {
    const { service, pickFile, repository } = setup();
    pickFile(backupText);
    service.restore(await previewOf(service));
    const undo = await previewOf(service, (each) => each.previewSafetyCopy());
    expect(undo).toMatchObject({
      source: { kind: 'safety-copy' },
      current: { lists: 1, tasks: 2 },
      policy: 'replace',
    });
    expect(undo.backup.counts).toStrictEqual({ lists: 1, tasks: 1 });
    expect(service.restore(undo).ok).toBe(true);
    expect(repository.current()).toStrictEqual(CURRENT);
  });

  it("refuses a damaged safety copy with the ladder's own failure", async () => {
    const { service, files } = setup();
    files.write({
      folder: 'private',
      name: SAFETY_COPY_NAME,
      text: backupText.replace('Work', 'Wxrk'),
    });
    await expect(service.previewSafetyCopy()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'damaged' },
    });
  });
});
