// src/data/expo-file-system-database-files-adapter-web.test.ts
// Tests the .web sibling by its full name (the Jest projects resolve modules the way iOS does).
import { createExpoFileSystemDatabaseFilesAdapter } from './expo-file-system-database-files-adapter.web';

describe('createExpoFileSystemDatabaseFilesAdapter on the web', () => {
  it('lists no files: the SQLite worker owns the browser storage', () => {
    const files = createExpoFileSystemDatabaseFilesAdapter();

    expect(files.list('/data')).toStrictEqual([]);
  });

  it('removes nothing and never throws', () => {
    const files = createExpoFileSystemDatabaseFilesAdapter();

    expect(() => {
      files.remove('/data/app.db.v1.bak');
    }).not.toThrow();
  });
});
