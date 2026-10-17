// src/services/share-sheet/fake-share-sheet.test.ts
import { createFakeShareSheet } from './fake-share-sheet';

import type { ShareRequest } from './share-sheet-port';

const REQUEST: ShareRequest = {
  uri: 'file:///cache/exports/tasks-backup-2026-10-10.json',
  mimeType: 'application/json',
  uti: 'public.json',
  dialogTitle: 'Share backup',
  anchor: { x: 10, y: 20, width: 44, height: 44 },
};

describe('createFakeShareSheet', () => {
  it('records each request and answers sheet-closed', async () => {
    const sheet = createFakeShareSheet();
    await expect(sheet.shareFile(REQUEST)).resolves.toStrictEqual({
      ok: true,
      value: 'sheet-closed',
    });
    expect(sheet.requests).toStrictEqual([REQUEST]);
  });

  it('fails once as a value when told to, then works again', async () => {
    const sheet = createFakeShareSheet();
    sheet.failNext({ kind: 'unavailable' });
    await expect(sheet.shareFile(REQUEST)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unavailable' },
    });
    await expect(sheet.shareFile(REQUEST)).resolves.toHaveProperty('ok', true);
  });
});
