// src/services/push/push-tap-router.test.ts
import { createFakePush } from './fake-push';
import { startPushTapRouting } from './push-tap-router';

import type { PushDestination } from '@/core/push/push-destination';

const TASK_TAP = { id: 'n1', action: 'open', data: { kind: 'task-assigned', taskId: 't1' } };

function setup(lastResponse: typeof TASK_TAP | null = null) {
  const push = createFakePush({ lastResponse });
  const opened: PushDestination[] = [];
  const stop = startPushTapRouting({ push, navigate: (destination) => opened.push(destination) });
  return { push, opened, stop };
}

describe('startPushTapRouting', () => {
  it('opens the tap that launched the app, once, and clears it', () => {
    const { push, opened, stop } = setup(TASK_TAP);
    push.tap(TASK_TAP);
    stop();
    expect(opened).toStrictEqual([{ screen: 'task', taskId: 't1' }]);
    expect(push.lastResponse()).toBeNull();
  });

  it('opens taps while the app runs until stopped', () => {
    const { push, opened, stop } = setup();
    push.tap({ id: 'n2', action: 'open', data: { kind: 'list-shared', listId: 'l1' } });
    stop();
    push.tap({ id: 'n3', action: 'open', data: { kind: 'announcement' } });
    expect(opened).toStrictEqual([{ screen: 'list', listId: 'l1' }]);
  });

  it.each([
    ['a payload URL', { url: 'myapp://debug/reset' }],
    ['an unknown kind', { kind: 'task-deleted', taskId: 't1' }],
    ['no data', null],
  ])('opens nothing for %s', (_label, data) => {
    const { push, opened, stop } = setup();
    push.tap({ id: 'n4', action: 'open', data });
    stop();
    expect(opened).toStrictEqual([]);
  });

  it('leaves a launch tap with non-push data for other routers (lastResponse still set)', () => {
    const reminderTap = { id: 'r1', action: 'open', data: { reminderId: 'rem-1' } };
    const push = createFakePush({ lastResponse: reminderTap });
    const opened: PushDestination[] = [];
    const stop = startPushTapRouting({ push, navigate: (destination) => opened.push(destination) });
    stop();
    expect(opened).toStrictEqual([]);
    expect(push.lastResponse()).toStrictEqual(reminderTap);
  });

  it('opens nothing for an action button', () => {
    const { push, opened, stop } = setup();
    push.tap({ ...TASK_TAP, id: 'n5', action: 'snooze' });
    stop();
    expect(opened).toStrictEqual([]);
  });
});
