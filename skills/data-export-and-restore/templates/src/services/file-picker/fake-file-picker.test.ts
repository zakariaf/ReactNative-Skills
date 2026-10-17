// src/services/file-picker/fake-file-picker.test.ts
import { err, ok } from '@/core/result';

import { createFakeFilePicker } from './fake-file-picker';

describe('createFakeFilePicker', () => {
  it('answers queued picks in order, then a cancelled pick', async () => {
    const picker = createFakeFilePicker();
    const file = { uri: 'file:///cache/a.json', name: 'a.json', sizeBytes: 2, mimeType: null };
    picker.queue(ok(file));
    picker.queue(err({ kind: 'pick-failed' }));
    await expect(picker.pickFile()).resolves.toStrictEqual({ ok: true, value: file });
    await expect(picker.pickFile()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'pick-failed' },
    });
    await expect(picker.pickFile()).resolves.toStrictEqual({ ok: true, value: null });
    expect(picker.opened()).toBe(3);
  });
});
