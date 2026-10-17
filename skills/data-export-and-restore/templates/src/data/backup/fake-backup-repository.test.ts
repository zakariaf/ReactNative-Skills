// src/data/backup/fake-backup-repository.test.ts
import { createFakeBackupRepository, EMPTY_BACKUP_PAYLOAD } from './fake-backup-repository';

const PAYLOAD = {
  lists: [{ id: 1, name: 'Home', created_at_ms: 0 }],
  tasks: [{ id: 1, list_id: 1, title: 'Buy milk', is_done: 0 as const, created_at_ms: 0 }],
};

describe('createFakeBackupRepository', () => {
  it('reads what it holds and replaces it whole', () => {
    const repository = createFakeBackupRepository();
    expect(repository.readAll()).toStrictEqual({
      ok: true,
      value: { payload: EMPTY_BACKUP_PAYLOAD, skippedRows: 0 },
    });
    expect(repository.replaceAll(PAYLOAD)).toStrictEqual({
      ok: true,
      value: { lists: 1, tasks: 1 },
    });
    expect([repository.current(), repository.replaceCount()]).toStrictEqual([PAYLOAD, 1]);
  });

  it('fails once when told to, and a failed replace keeps the rows', () => {
    const repository = createFakeBackupRepository(PAYLOAD);
    repository.failNext({ kind: 'full' });
    expect(repository.replaceAll(EMPTY_BACKUP_PAYLOAD)).toStrictEqual({
      ok: false,
      error: { kind: 'storage', failure: { kind: 'full' } },
    });
    expect(repository.current()).toBe(PAYLOAD);
    repository.failNext({ kind: 'busy' });
    expect(repository.readAll()).toStrictEqual({ ok: false, error: { kind: 'busy' } });
    expect(repository.readAll().ok).toBe(true);
  });

  it('reports the unreadable rows it was told to skip', () => {
    const repository = createFakeBackupRepository(PAYLOAD);
    repository.skipRows(3);
    expect(repository.readAll()).toStrictEqual({
      ok: true,
      value: { payload: PAYLOAD, skippedRows: 3 },
    });
  });
});
