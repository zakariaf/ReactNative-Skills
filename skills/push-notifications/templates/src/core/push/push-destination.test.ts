// src/core/push/push-destination.test.ts
import { destinationFor, OPEN_ACTION } from './push-destination';

describe('destinationFor', () => {
  it.each([
    [{ kind: 'task-assigned', taskId: 't1' } as const, { screen: 'task', taskId: 't1' }],
    [{ kind: 'list-shared', listId: 'l1' } as const, { screen: 'list', listId: 'l1' }],
    [{ kind: 'announcement' } as const, { screen: 'inbox' }],
  ])('opens %j at %j', (message, destination) => {
    expect(destinationFor(message, OPEN_ACTION)).toStrictEqual(destination);
  });

  it('opens nothing for data this build does not understand', () => {
    expect(destinationFor(null, OPEN_ACTION)).toBeNull();
  });

  it('opens nothing for an action button it does not handle', () => {
    expect(destinationFor({ kind: 'task-assigned', taskId: 't1' }, 'snooze')).toBeNull();
  });
});
