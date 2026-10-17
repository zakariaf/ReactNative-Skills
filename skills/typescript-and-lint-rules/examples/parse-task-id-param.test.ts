// src/features/tasks/parse-task-id-param.test.ts
import { parseTaskIdParam } from './parse-task-id-param';

describe('parseTaskIdParam', () => {
  it('returns the id for a well-formed parameter', () => {
    expect(parseTaskIdParam('task-42')).toStrictEqual({ ok: true, value: 'task-42' });
  });

  it('returns missing instead of throwing', () => {
    expect(parseTaskIdParam(undefined)).toStrictEqual({ ok: false, error: { kind: 'missing' } });
    expect(parseTaskIdParam('')).toStrictEqual({ ok: false, error: { kind: 'missing' } });
  });

  it('returns repeated for a parameter given twice', () => {
    expect(parseTaskIdParam(['task-1', 'task-2'])).toStrictEqual({
      ok: false,
      error: { kind: 'repeated', count: 2 },
    });
  });

  it('returns malformed for anything else', () => {
    expect(parseTaskIdParam('42')).toStrictEqual({
      ok: false,
      error: { kind: 'malformed', raw: '42' },
    });
  });
});
