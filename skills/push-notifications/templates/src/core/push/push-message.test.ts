// src/core/push/push-message.test.ts
import fc from 'fast-check';

import { parsePushData, PUSH_KINDS } from './push-message';

describe('parsePushData', () => {
  it.each([
    [
      { kind: 'task-assigned', taskId: 't-1' },
      { kind: 'task-assigned', taskId: 't-1' },
    ],
    [
      { kind: 'list-shared', listId: 'inbox_2' },
      { kind: 'list-shared', listId: 'inbox_2' },
    ],
    [{ kind: 'announcement' }, { kind: 'announcement' }],
  ])('reads %j', (data, expected) => {
    expect(parsePushData(data)).toStrictEqual(expected);
  });

  it('drops fields it does not know, so a newer server stays compatible', () => {
    expect(parsePushData({ kind: 'task-assigned', taskId: 't1', priority: 'high' })).toStrictEqual({
      kind: 'task-assigned',
      taskId: 't1',
    });
  });

  it.each([
    ['no data', undefined],
    ['null', null],
    ['a string', 'task-assigned'],
    ['an unknown kind', { kind: 'task-deleted', taskId: 't1' }],
    ['a missing id', { kind: 'task-assigned' }],
    ['a numeric id', { kind: 'task-assigned', taskId: 7 }],
    ['an empty id', { kind: 'list-shared', listId: '' }],
    ['a path as id', { kind: 'task-assigned', taskId: '../settings' }],
    ['a link as id', { kind: 'task-assigned', taskId: 'myapp://reset' }],
  ])('returns null for %s', (_label, data) => {
    expect(parsePushData(data)).toBeNull();
  });

  it('accepts an id of exactly 64 characters and refuses 65', () => {
    expect(parsePushData({ kind: 'task-assigned', taskId: 'a'.repeat(64) })).not.toBeNull();
    expect(parsePushData({ kind: 'task-assigned', taskId: 'a'.repeat(65) })).toBeNull();
  });

  it('lists the kinds the contract names', () => {
    expect(PUSH_KINDS).toStrictEqual(['task-assigned', 'list-shared', 'announcement']);
  });

  it('returns a known kind or null for any data', () => {
    fc.assert(
      fc.property(fc.anything(), (data) => {
        const message = parsePushData(data);
        expect(message === null || PUSH_KINDS.includes(message.kind)).toBe(true);
      }),
    );
  });
});
