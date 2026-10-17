// src/services/export-files/fake-export-files.test.ts
import { createFakeExportFiles } from './fake-export-files';

describe('createFakeExportFiles', () => {
  it('publishes a file under its name and reports its UTF-8 size', () => {
    const files = createFakeExportFiles();
    const written = files.write({ folder: 'share', name: 'tasks.json', text: 'é' });
    expect(written).toStrictEqual({
      ok: true,
      value: { uri: 'file:///fake/share/tasks.json', name: 'tasks.json', bytes: 2 },
    });
    expect(files.files('share').get('tasks.json')).toBe('é');
  });

  it('keeps the previous file when a write fails, and refuses a name with a path in it', () => {
    const files = createFakeExportFiles();
    files.write({ folder: 'private', name: 'safety.json', text: 'old' });
    files.failNextWrite({ kind: 'no-space', neededBytes: 10, availableBytes: 1 });
    expect(files.write({ folder: 'private', name: 'safety.json', text: 'new' }).ok).toBe(false);
    expect(files.write({ folder: 'private', name: '../escape.json', text: 'x' })).toStrictEqual({
      ok: false,
      error: { kind: 'write-failed' },
    });
    expect([...files.files('private')]).toStrictEqual([['safety.json', 'old']]);
  });

  it('sweeps every file but the one to keep, in that folder only', () => {
    const files = createFakeExportFiles();
    files.write({ folder: 'share', name: 'a.json', text: '1' });
    files.write({ folder: 'share', name: 'b.json', text: '2' });
    files.write({ folder: 'private', name: 'c.json', text: '3' });
    files.sweep('share', 'b.json');
    expect([...files.files('share').keys()]).toStrictEqual(['b.json']);
    expect([...files.files('private').keys()]).toStrictEqual(['c.json']);
  });

  it('reads a picked file, and fails as a value for an unknown or too large one', async () => {
    const files = createFakeExportFiles();
    files.givePickedFile('file:///cache/picked.json', '{}');
    await expect(files.readText('file:///cache/picked.json', 2)).resolves.toStrictEqual({
      ok: true,
      value: '{}',
    });
    await expect(files.readText('file:///cache/picked.json', 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'too-large', sizeBytes: 2, maxBytes: 1 },
    });
    await expect(files.readText('file:///cache/missing.json', 10)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'read-failed' },
    });
  });

  it('reads a private file by name, and gives null when there is none', async () => {
    const files = createFakeExportFiles();
    await expect(files.readPrivate('safety.json', 10)).resolves.toStrictEqual({
      ok: true,
      value: null,
    });
    files.write({ folder: 'private', name: 'safety.json', text: 'old' });
    await expect(files.readPrivate('safety.json', 10)).resolves.toStrictEqual({
      ok: true,
      value: 'old',
    });
  });
});
