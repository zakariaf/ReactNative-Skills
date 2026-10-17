// src/data/backup/tasks-csv.test.ts
import { parseCsv } from '@test/portable/parse-csv';

import backupV1 from './fixtures/backup-v1.json';
import { readBackup } from './read-backup';
import { TASKS_CSV_HEADER, tasksCsv } from './tasks-csv';

describe('tasksCsv', () => {
  const read = readBackup(JSON.stringify(backupV1));
  if (!read.ok) throw new Error('the frozen fixture must read');
  const [header, ...records] = parseCsv(tasksCsv(read.value.payload));

  it('writes the column codes, then one record per task in id order', () => {
    expect(header).toStrictEqual(TASKS_CSV_HEADER);
    expect(records.map((record) => record[1])).toStrictEqual(
      read.value.payload.tasks.map((row) =>
        /^[=+\-@]/.test(row.title) ? `'${row.title}` : row.title,
      ),
    );
  });

  it('neutralizes formulas, keeps CRLF inside a field, and writes canonical values', () => {
    expect(records[1]).toStrictEqual(['Home', "'=1+2", 'false', '2026-09-21T14:16:20.000Z']);
    expect(records[2]?.[1]).toBe("'@SUM(A1:A2)");
    expect(records[3]?.[1]).toBe('line one\r\nline two, "quoted"');
    expect(records[4]?.slice(2)).toStrictEqual(['true', '2100-01-01T00:00:00.000Z']);
  });
});
