// src/ui/feedback/notice.test.ts
import { INITIAL_NOTICE_STATE, noticeLifetimeMs, noticeReducer } from './notice';

import type { Notice } from './notice';

const DELETED: Notice = {
  text: 'Task deleted',
  testID: 'tasks.deleted-notice',
  action: { label: 'Undo', onPress: jest.fn() },
  serial: 1,
};
const SAVED: Notice = { text: 'Task saved', testID: 'tasks.saved-notice', serial: 2 };

describe('noticeReducer', () => {
  it('replaces the notice on screen instead of queueing the new one', () => {
    const shown = noticeReducer(INITIAL_NOTICE_STATE, { type: 'notice-shown', notice: DELETED });
    expect(noticeReducer(shown, { type: 'notice-shown', notice: SAVED })).toStrictEqual({
      current: SAVED,
    });
  });

  it('closes only the notice the event names', () => {
    const shown = noticeReducer(INITIAL_NOTICE_STATE, { type: 'notice-shown', notice: SAVED });
    expect(noticeReducer(shown, { type: 'notice-closed', serial: 1 })).toBe(shown);
    expect(noticeReducer(shown, { type: 'notice-closed', serial: 2 })).toBe(INITIAL_NOTICE_STATE);
  });
});

describe('noticeLifetimeMs', () => {
  it('gives a result notice the short time and an action notice the long one', () => {
    expect(noticeLifetimeMs(SAVED, false)).toBe(4000);
    expect(noticeLifetimeMs(DELETED, false)).toBe(8000);
  });

  it('keeps a notice with an action up while a screen reader runs', () => {
    expect(noticeLifetimeMs(DELETED, true)).toBeNull();
    expect(noticeLifetimeMs(SAVED, true)).toBe(4000);
  });
});
