// src/features/task-detail/task-detail-params.test.ts
import { parseTaskDetailParams } from './task-detail-params';

describe('parseTaskDetailParams', () => {
  it('reads a task id from the route params', () => {
    expect(parseTaskDetailParams({ taskId: 'task-12' })).toStrictEqual({
      ok: true,
      value: { taskId: 'task-12' },
    });
  });

  it('ignores extra query params', () => {
    expect(parseTaskDetailParams({ taskId: 'task-12', utm: 'mail' })).toStrictEqual({
      ok: true,
      value: { taskId: 'task-12' },
    });
  });

  it.each([
    ['a missing id', {}],
    ['an empty id', { taskId: '' }],
    ['a repeated key (an array)', { taskId: ['task-1', 'task-2'] }],
    ['a path inside the id', { taskId: '../settings' }],
    ['an id that is too long', { taskId: 'a'.repeat(65) }],
  ])('rejects %s', (_label, raw) => {
    expect(parseTaskDetailParams(raw)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-route-params' },
    });
  });
});
